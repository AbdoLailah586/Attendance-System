import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';
import { buildReport,type AttendanceLog } from '@/lib/attendance';
import { cairoTime, localDate, nextDay, shiftWindow, validDay, TIME_ZONE } from '@/lib/time';

export async function GET(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    const params = req.nextUrl.searchParams;
    const day = params.get('date') || localDate();
    const id = session.role === 'employee' ? session.id : params.get('userId') ? Number(params.get('userId')) : null;
    if (!validDay(day) || (id !== null && (!Number.isInteger(id) || id < 1))) return NextResponse.json({ error: 'تاريخ أو موظف غير صالح' }, { status: 400 });
    const settings = await loadSettings();
    const users = await query(`SELECT u.id,u.username,u.name,u.phone,u.role,u.is_active,COALESCE(p.shift_start,u.shift_start) AS shift_start,
      COALESCE(p.shift_end,u.shift_end) AS shift_end,COALESCE(p.grace_period_mins,u.grace_period_mins) AS grace_period_mins FROM users u
      LEFT JOIN LATERAL(SELECT * FROM employee_policies WHERE user_id=u.id AND effective_from<=$1::date ORDER BY effective_from DESC LIMIT 1)p ON TRUE
      WHERE u.role = 'employee' ${id ? 'AND u.id = $2' : ''} ORDER BY u.id`, id ? [day,id] : [day]);
    const reports = await Promise.all(users.rows.map(async user => {
      const start = cairoTime(day);
      const shift = shiftWindow(day, user.shift_start || settings.shift_start_time, user.shift_end || settings.shift_end_time);
      const overnight = (user.shift_end || settings.shift_end_time) <= (user.shift_start || settings.shift_start_time);
      const rangeStart = overnight ? shift.start : start;
      const rangeEnd = overnight ? shiftWindow(nextDay(day), user.shift_start || settings.shift_start_time, user.shift_end || settings.shift_end_time).start : cairoTime(nextDay(day));
    const result = await query<AttendanceLog>(`(SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 ORDER BY timestamp DESC, id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp < $2 AND event_type IN ('clock_in','clock_out') ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp >= $2 AND timestamp < $3)
        ORDER BY timestamp, id`, [user.id, rangeStart.toISOString(), rangeEnd.toISOString()]);
      return { user, ...buildReport(user, result.rows, {...settings,grace_period_mins:user.grace_period_mins}, day, rangeStart, rangeEnd) };
    }));
    return NextResponse.json({ date: day, timeZone: TIME_ZONE, settings, reports }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('Report failed:', error);
    return NextResponse.json({ error: 'تعذر تحميل التقرير' }, { status: 503 });
  }
}
