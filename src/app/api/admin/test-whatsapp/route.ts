import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { sendDailyAttendanceWhatsApp, sendWhatsAppMessage, DEFAULT_ADMIN_WHATSAPP } from '@/lib/whatsapp';
import { businessDay } from '@/lib/card-day';
import { loadSettings } from '@/lib/schema';

export async function POST(req: NextRequest) {
  const session = await getActiveSession(req);
  if (!session || session.role !== 'admin') {
    return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
  }

  try {
    const json = await req.json().catch(() => ({}));
    const phone = json.phone || DEFAULT_ADMIN_WHATSAPP;
    const sendFullReport = json.fullReport === true;

    if (sendFullReport) {
      const settings = await loadSettings();
      const today = businessDay(new Date(), settings.business_day_start_time);
      const ok = await sendDailyAttendanceWhatsApp(today, phone);
      return NextResponse.json({
        success: ok,
        phone,
        message: ok ? `تم إرسال تقرير الحضور اليومي بنجاح إلى رقم الواتساب (${phone})` : 'تعذر إرسال التقرير عبر الواتساب',
      });
    }

    const testText = json.text || '🔔 *إشعار تجريبي من نظام حضور جو ستور* 🚀\nخدمة الواتساب تعمل بنجاح وسوف يصلك التقرير اليومي هنا الساعة 1:00 صباحاً.';
    const ok = await sendWhatsAppMessage(phone, testText);

    return NextResponse.json({
      success: ok,
      phone,
      message: ok ? `تم إرسال الرسالة التجريبية بنجاح إلى رقم الواتساب (${phone})` : 'تعذر إرسال الرسالة عبر الواتساب',
    });
  } catch (error) {
    console.error('Test WhatsApp error:', error);
    return NextResponse.json({ error: 'حدث خطأ أثناء الإرسال عبر الواتساب' }, { status: 500 });
  }
}
