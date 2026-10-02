import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET() {
  try {
    const res = await query('SELECT * FROM settings WHERE id = $1', ['main']);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 });
    }
    return NextResponse.json({ settings: res.rows[0] });
  } catch (err: unknown) {
    console.error('Settings GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة لتعديل الإعدادات' }, { status: 403 });
    }

    const body = await req.json();
    const {
      branch1_name,
      branch1_lat,
      branch1_lng,
      branch1_radius,
      branch2_name,
      branch2_lat,
      branch2_lng,
      branch2_radius,
      shift_start_time,
      shift_end_time,
      grace_period_mins,
      ping_interval_secs,
    } = body;

    const res = await query(
      `UPDATE settings
       SET branch1_name = COALESCE($1, branch1_name),
           branch1_lat = COALESCE($2, branch1_lat),
           branch1_lng = COALESCE($3, branch1_lng),
           branch1_radius = COALESCE($4, branch1_radius),
           branch2_name = COALESCE($5, branch2_name),
           branch2_lat = COALESCE($6, branch2_lat),
           branch2_lng = COALESCE($7, branch2_lng),
           branch2_radius = COALESCE($8, branch2_radius),
           shift_start_time = COALESCE($9, shift_start_time),
           shift_end_time = COALESCE($10, shift_end_time),
           grace_period_mins = COALESCE($11, grace_period_mins),
           ping_interval_secs = COALESCE($12, ping_interval_secs),
           updated_at = NOW()
       WHERE id = 'main'
       RETURNING *;`,
      [
        branch1_name,
        branch1_lat,
        branch1_lng,
        branch1_radius,
        branch2_name,
        branch2_lat,
        branch2_lng,
        branch2_radius,
        shift_start_time,
        shift_end_time,
        grace_period_mins,
        ping_interval_secs,
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات الفروع والشيفتات بنجاح',
      settings: res.rows[0],
    });
  } catch (err: unknown) {
    console.error('Settings PUT error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ الإعدادات' }, { status: 500 });
  }
}
