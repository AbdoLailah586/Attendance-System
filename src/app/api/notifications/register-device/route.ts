import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { ensureAttendanceSchema } from '@/lib/schema';

export async function POST(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const platform = typeof body?.platform === 'string' ? body.platform.trim() : 'android';

    if (!token || token.length < 10) {
      return NextResponse.json({ error: 'رمز الجهاز غير صالح' }, { status: 400 });
    }

    await ensureAttendanceSchema();
    await query(
      `INSERT INTO admin_push_devices (user_id, token, platform, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, updated_at = NOW()`,
      [session.id, token, platform]
    );

    return NextResponse.json({ success: true, message: 'تم تسجيل الجهاز بنجاح' });
  } catch (error) {
    console.error('Register device error:', error);
    return NextResponse.json({ error: 'تعذر تسجيل الجهاز للإشعارات' }, { status: 500 });
  }
}
