import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { loadDayCloseReport } from '@/lib/day-close-report';
import { validDay } from '@/lib/time';
import { dailyReportPdfHtml, renderPdfFromHtml } from '@/lib/report-pdf';

export async function GET(req: NextRequest) {
  try {
    const keyParam = req.nextUrl.searchParams.get('key');
    const expectedSecret = process.env.JWT_SECRET || 'attendance-secret-key-super-secure-token-2026';
    const isValidKey = keyParam && keyParam === expectedSecret;
    const session = await getActiveSession(req);

    if (!isValidKey && session?.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }
    const date = req.nextUrl.searchParams.get('date');
    if (!date || !validDay(date)) return NextResponse.json({ error: 'تاريخ غير صالح' }, { status: 400 });
    const data = await loadDayCloseReport(date);
    const pdf = await renderPdfFromHtml(dailyReportPdfHtml(data.businessDay, data.reports));
    return new NextResponse(new Uint8Array(pdf), { headers: {
      'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="daily-report-${date}.pdf"`, 'Cache-Control': 'private, no-store',
    } });
  } catch (error) {
    console.error('Daily PDF failed:', error);
    return NextResponse.json({ error: 'تعذر إنشاء التقرير اليومي' }, { status: 503 });
  }
}
