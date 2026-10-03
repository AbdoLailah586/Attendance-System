import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';
import { buildReport,type AttendanceLog } from '@/lib/attendance';
import { localDate } from '@/lib/time';
import { dayWindow } from '@/lib/period-report';

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session || session.role !== 'admin') return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    const settings = await loadSettings();
    const users = await query("SELECT id, username, name, phone, shift_start, shift_end, is_active,grace_period_mins FROM users WHERE role='employee' AND is_active=TRUE ORDER BY id");
    const day = localDate();
    const employees = await Promise.all(users.rows.map(async user => {
      // Before an overnight shift starts, live tracking belongs to the preceding shift day.
      const shiftStart=user.shift_start||settings.shift_start_time,shiftEnd=user.shift_end||settings.shift_end_time;
      const todayWindow=dayWindow(day,{shift_start:shiftStart,shift_end:shiftEnd});
      const reportDay=shiftEnd<=shiftStart && new Date()<todayWindow.start?new Date(Date.parse(day+'T12:00:00Z')-86400000).toISOString().slice(0,10):day;
      const {start,end}=dayWindow(reportDay,{shift_start:shiftStart,shift_end:shiftEnd});
      const result = await query<AttendanceLog>(`(SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 AND event_type IN ('clock_in','clock_out') ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp >= $2 AND timestamp <= NOW()) ORDER BY timestamp,id`, [user.id, new Date(+start-86400000).toISOString()]);
      const report = buildReport(user, result.rows, {...settings,grace_period_mins:user.grace_period_mins}, reportDay, start, end);
      const latestLog = result.rows.at(-1) || null;
      const minutesSincePing = latestLog ? Math.floor((Date.now() - new Date(latestLog.timestamp).getTime()) / 60000) : null;
      const isOnline = report.onDuty && minutesSincePing !== null && minutesSincePing <= Math.max(3, settings.ping_interval_secs / 20);
      return { user, ...report, latestLog, minutesSincePing, isOnline, currentStatus: !latestLog ? 'not_started' : !report.onDuty ? 'clocked_out' : isOnline ? latestLog.branch_id : 'offline' };
    }));
    return NextResponse.json({ timestamp: new Date().toISOString(), settings, employees }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Radar failed:', error);
    return NextResponse.json({ error: 'تعذر تحميل متابعة الموظفين' }, { status: 503 });
  }
}
