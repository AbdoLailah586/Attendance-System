import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { broadcastPushToAdmins } from '@/lib/fcm';
import { query } from '@/lib/db';

export async function POST(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
  }

  try {
    const devices = await query<{ count: string }>('SELECT COUNT(*) as count FROM admin_push_devices');
    const deviceCount = parseInt(devices.rows[0]?.count || '0', 10);

    const result = await broadcastPushToAdmins({
      title: 'إشعار تجريبي من جو ستور 🚀',
      body: 'خدمة Firebase FCM تعمل بنجاح والإشعارات تصلك حتى لو التطبيق مقفول تماماً!',
      kind: 'test_alert',
      timestamp: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      registered_devices: deviceCount,
      sent: result.sent,
      failed: result.failed,
      message: result.sent > 0 
        ? `تم إرسال الإشعار بنجاح إلى ${result.sent} جهاز`
        : deviceCount === 0 
          ? 'لا توجد أجهزة مسجلة حالياً؛ افتح تطبيق الإدارة على الموبايل لتسجيل الجهاز تلقائياً'
          : 'تعذر إرسال الإشعار لجميع الأجهزة المسجلة',
    });
  } catch (error) {
    console.error('Test push error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء إرسال الإشعار التجريبي' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
  }

  try {
    const devices = await query('SELECT id, user_id, platform, updated_at, token FROM admin_push_devices ORDER BY updated_at DESC');
    return NextResponse.json({
      total: devices.rows.length,
      devices: devices.rows.map(d => ({
        id: d.id,
        user_id: d.user_id,
        platform: d.platform,
        updated_at: d.updated_at,
        token_preview: d.token ? `${d.token.slice(0, 15)}...${d.token.slice(-10)}` : '',
      })),
    });
  } catch (error) {
    return NextResponse.json({ error: 'تعذر جلب الأجهزة' }, { status: 500 });
  }
}
