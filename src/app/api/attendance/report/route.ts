import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';
import { buildReport,type AttendanceLog } from '@/lib/attendance';
import {businessDay,dailyRules} from '@/lib/card-day';
import type {AppUser} from '@/lib/types';
import { cairoTime, localDate, nextDay, shiftWindow, validDay, TIME_ZONE } from '@/lib/time';
import { loadBleRangeSummaries } from '@/lib/ble';
import { bleReportFields } from '@/lib/ble-report';

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    const params = req.nextUrl.searchParams;
    const day = params.get('date') || localDate();
    const id = session.role === 'employee' ? session.id : params.get('userId') ? Number(params.get('userId')) : null;
    if (!validDay(day) || (id !== null && (!Number.isInteger(id) || id < 1))) return NextResponse.json({ error: 'تاريخ أو موظف غير صالح' }, { status: 400 });
    const settings = await loadSettings();
    const users = await query<AppUser>(`SELECT u.id,u.username,u.name,u.phone,u.role,u.is_active,COALESCE(p.shift_start,u.shift_start) AS shift_start,
      COALESCE(p.shift_end,u.shift_end) AS shift_end,COALESCE(p.grace_period_mins,u.grace_period_mins) AS grace_period_mins FROM users u
      LEFT JOIN LATERAL(SELECT * FROM employee_policies WHERE user_id=u.id AND effective_from<=$1::date ORDER BY effective_from DESC LIMIT 1)p ON TRUE
      WHERE u.role = 'employee' ${id ? 'AND u.id = $2' : ''} ORDER BY u.id`, id ? [day,id] : [day]);
    const reports = await Promise.all(users.rows.map(async user => {
      const overnight = (user.shift_end || settings.shift_end_time) <= (user.shift_start || settings.shift_start_time);

      let reportDay=day;
      if(!params.has('date')){const rule=(await query("SELECT to_char(shift_day,'YYYY-MM-DD') AS shift_day FROM nfc_day_rules WHERE user_id=$1 AND day_start<=NOW() AND day_end>NOW() ORDER BY day_start DESC LIMIT 1",[user.id])).rows[0];reportDay=rule?.shift_day||dailyRules(user,[],businessDay(new Date(),settings.business_day_start_time),settings).shift_day;}

      const start = cairoTime(reportDay);
      const shift = shiftWindow(reportDay, user.shift_start || settings.shift_start_time, user.shift_end || settings.shift_end_time);
      const rangeStart = overnight ? shift.start : start;
      const rangeEnd = overnight ? shiftWindow(nextDay(reportDay), user.shift_start || settings.shift_start_time, user.shift_end || settings.shift_end_time).start : cairoTime(nextDay(reportDay));
    const result = await query<AttendanceLog>(`(SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 ORDER BY timestamp DESC, id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 AND event_type IN ('clock_in','clock_out') ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp >= $2 AND timestamp < $3)
        ORDER BY timestamp, id`, [user.id, new Date(+rangeStart-86400000).toISOString(), new Date(+rangeEnd+86400000).toISOString()]);
      const ble=await loadBleRangeSummaries([user.id],+cairoTime(nextDay(reportDay))-2*86400000,+cairoTime(nextDay(reportDay))+36*3600000,[reportDay]);
      return { user,date:reportDay, ...buildReport(user, result.rows, {...settings,grace_period_mins:user.grace_period_mins??settings.grace_period_mins}, reportDay, rangeStart, rangeEnd),...bleReportFields(ble.get(user.id)?.daily?.[reportDay]) };
    }));
    return NextResponse.json({ date: day, timeZone: TIME_ZONE, settings, reports }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Report failed:', error);
    return NextResponse.json({ error: 'تعذر تحميل التقرير' }, { status: 503 });
  }
}
