import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';
import { buildReport,type AttendanceLog } from '@/lib/attendance';

import { dayWindow } from '@/lib/period-report';
import {businessDay,dailyRules} from '@/lib/card-day';
import type {AppUser} from '@/lib/types';
import {loadBlePresence} from '@/lib/ble';

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session || session.role !== 'admin') return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    const settings = await loadSettings();
    const users = await query<AppUser>("SELECT id, username, name, phone, role,shift_start, shift_end, is_active,grace_period_mins FROM users WHERE role='employee' AND is_active=TRUE ORDER BY id");
    const presence=await loadBlePresence(users.rows,settings);

    const employees = await Promise.all(users.rows.map(async user => {
      // Before an overnight shift starts, live tracking belongs to the preceding shift day.
      const shiftStart=user.shift_start||settings.shift_start_time,shiftEnd=user.shift_end||settings.shift_end_time;

      const rule=(await query("SELECT to_char(shift_day,'YYYY-MM-DD') AS shift_day FROM nfc_day_rules WHERE user_id=$1 AND day_start<=NOW() AND day_end>NOW() ORDER BY day_start DESC LIMIT 1",[user.id])).rows[0];
      const reportDay=rule?.shift_day||dailyRules({...user,role:'employee'},[],businessDay(new Date(),settings.business_day_start_time),settings).shift_day;
      const {start,end}=dayWindow(reportDay,{shift_start:shiftStart,shift_end:shiftEnd});
      const result = await query<AttendanceLog>(`(SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 AND event_type IN ('clock_in','clock_out') ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp >= $2 AND timestamp <= NOW()) ORDER BY timestamp,id`, [user.id, new Date(+start-86400000).toISOString()]);
      const report = buildReport(user, result.rows, {...settings,grace_period_mins:user.grace_period_mins??settings.grace_period_mins}, reportDay, start, end);
      const latestLog = result.rows.filter(l=>l.event_type==='ping'&&report.firstArrival&&+new Date(l.timestamp)>=Date.parse(report.firstArrival)).at(-1)||null;
      const minutesSincePing = latestLog ? Math.floor((Date.now() - new Date(latestLog.timestamp).getTime()) / 60000) : null;
      const isOnline = report.onDuty && minutesSincePing !== null && minutesSincePing <= Math.max(3, settings.ping_interval_secs / 20);
      const ble=presence.get(user.id)||null;
      return { user, ...report, latestLog, minutesSincePing, isOnline, currentStatus: !latestLog ? 'not_started' : !report.onDuty ? 'clocked_out' : isOnline ? latestLog.branch_id : 'offline',
        presence_source:ble?.tracking_mode||'gps',ble };
    }));
    return NextResponse.json({ timestamp: new Date().toISOString(), settings, employees }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Radar failed:', error);
    return NextResponse.json({ error: 'تعذر تحميل متابعة الموظفين' }, { status: 503 });
  }
}
