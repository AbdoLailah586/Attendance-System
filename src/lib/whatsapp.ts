import { loadDayCloseReport } from './day-close-report';

const WHATSAPP_API_LOGIN = 'https://whatsapp-pro-crm-production-613b.up.railway.app/api/auth/login';
const WHATSAPP_API_SEND = 'https://whatsapp-pro-crm-production-613b.up.railway.app/api/send';
const WHATSAPP_EMAIL = process.env.WHATSAPP_CRM_EMAIL || '201554826209@whatsapp.pro';
const WHATSAPP_PASSWORD = process.env.WHATSAPP_CRM_PASSWORD || 'WpAdmin#2026Secure';
export const DEFAULT_ADMIN_WHATSAPP = '201099930530';

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getWhatsAppToken(): Promise<string | null> {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  try {
    const res = await fetch(WHATSAPP_API_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: WHATSAPP_EMAIL,
        password: WHATSAPP_PASSWORD,
      }),
    });

    if (!res.ok) {
      console.warn('WhatsApp CRM login failed:', res.status);
      return null;
    }

    const data = await res.json();
    if (data.token) {
      cachedToken = data.token;
      tokenExpiresAt = Date.now() + 60 * 60 * 1000;
      return cachedToken;
    }
    return null;
  } catch (err) {
    console.warn('WhatsApp login network error:', err);
    return null;
  }
}

export async function sendWhatsAppMessage(toPhone: string, text: string): Promise<boolean> {
  const token = await getWhatsAppToken();
  if (!token) return false;

  const cleanPhone = toPhone.replace(/[^0-9]/g, '');

  try {
    const res = await fetch(WHATSAPP_API_SEND, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: cleanPhone,
        text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn('WhatsApp send failed:', res.status, err);
      return false;
    }

    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.warn('WhatsApp send error:', err);
    return false;
  }
}

function durationLabel(seconds: number): string {
  const n = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  if (h > 0) return `${h} س ${m} د`;
  return `${m} دقيقة`;
}

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', {
      timeZone: 'Africa/Cairo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  } catch {
    return '—';
  }
}

export async function sendDailyAttendanceWhatsApp(day: string, targetPhone = DEFAULT_ADMIN_WHATSAPP): Promise<boolean> {
  try {
    const data = await loadDayCloseReport(day);
    const domain = process.env.NEXT_PUBLIC_APP_URL || 'https://attendance-system-joe-2026.vercel.app';
    const secretKey = process.env.JWT_SECRET || 'attendance-secret-key-super-secure-token-2026';
    const pdfUrl = `${domain}/api/attendance/daily-pdf?date=${day}&key=${encodeURIComponent(secretKey)}`;

    let msg = `📊 *تقرير الحضور والانصراف اليومي — جو ستور* 📊\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📅 *يوم العمل:* ${day}\n`;
    msg += `🕒 *توقيت الإرسال:* الساعة 1:00 صباحاً (بتوقيت القاهرة)\n`;
    msg += `👥 *إجمالي الموظفين:* ${data.reports.length}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (!data.reports.length) {
      msg += `لا توجد سجلات حضور مسجلة لهذا اليوم.\n\n`;
    } else {
      data.reports.forEach((r, idx) => {
        const empName = r.user.name;
        const arrival = timeLabel(r.firstArrival);
        const departure = r.missingCheckout 
          ? '⚠️ انصراف ناقص (لم يسجل)' 
          : r.lastDeparture ? timeLabel(r.lastDeparture) : 'لم يسجل انصراف';
        const observed = durationLabel(r.ble_summary?.observed_seconds || 0);
        const notSeen = durationLabel(r.ble_summary?.not_seen_seconds || 0);

        msg += `*${idx + 1}. ${empName}*\n`;
        msg += `   • حضور الكارت: ${arrival}\n`;
        msg += `   • انصراف الكارت: ${departure}\n`;
        msg += `   • التاج داخل الفرع: ${observed}\n`;
        if ((r.ble_summary?.not_seen_seconds || 0) > 600) {
          msg += `   • غير مرصود للمراجعة: ${notSeen}\n`;
        }
        msg += `\n`;
      });
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `📥 *تحميل ملف الـ PDF المنسق كاملاً:* \n`;
    msg += `${pdfUrl}\n\n`;
    msg += `_تم الإرسال تلقائياً عبر نظام جو ستور الذكي._`;

    return await sendWhatsAppMessage(targetPhone, msg);
  } catch (err) {
    console.error('sendDailyAttendanceWhatsApp error:', err);
    return false;
  }
}
