import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { ensureAttendanceSchema } from '@/lib/schema';
import { cairoTime, localDate, nextDay, validDay } from '@/lib/time';

export async function GET(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') return NextResponse.json({error:'صلاحيات المدير مطلوبة'}, {status:403});
  try {
    await ensureAttendanceSchema();
    const day = req.nextUrl.searchParams.get('date') || localDate();
    const page = Number(req.nextUrl.searchParams.get('page') || 1);
    const userId = Number(req.nextUrl.searchParams.get('userId') || 0);
    if (!validDay(day) || !Number.isInteger(page) || page < 1 || !Number.isInteger(userId) || userId < 0) return NextResponse.json({error:'فلتر غير صالح'},{status:400});
    const values = [cairoTime(day).toISOString(), cairoTime(nextDay(day)).toISOString(), userId, (page-1)*100];
    const result = await query(`SELECT l.*, u.name, u.username, COUNT(*) OVER()::int AS total_count
      FROM attendance_logs l JOIN users u ON u.id=l.user_id
      WHERE l.timestamp >= $1 AND l.timestamp < $2 AND ($3::int=0 OR l.user_id=$3)
      ORDER BY l.timestamp DESC,l.id DESC LIMIT 100 OFFSET $4`, values);
    return NextResponse.json({logs:result.rows, page, total: result.rows[0]?.total_count || 0});
  } catch (error) { console.error(error); return NextResponse.json({error:'تعذر تحميل السجل'},{status:503}); }
}
