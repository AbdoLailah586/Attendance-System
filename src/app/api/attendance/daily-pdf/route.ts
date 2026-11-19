import { NextRequest, NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { validDay } from '@/lib/time';
import { computeEmployeeDailyTimeline } from '@/lib/daily-timeline';
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

    const userIdParam = req.nextUrl.searchParams.get('userId');
    let userQuery = `SELECT id, name, role FROM users WHERE role = 'employee' AND is_active = TRUE`;
    const queryParams: any[] = [];
    if (userIdParam && userIdParam !== 'all' && !Number.isNaN(Number(userIdParam))) {
      userQuery += ` AND id = $1`;
      queryParams.push(Number(userIdParam));
    }
    userQuery += ` ORDER BY id ASC`;

    const users = (await query<{ id: number; name: string; role: string }>(
      userQuery,
      queryParams
    )).rows;

    const timelines = await Promise.all(
      users.map(u => computeEmployeeDailyTimeline(u.id, u.name, u.role, date))
    );

    const html = dailyReportPdfHtml(date, timelines);
    const pdf = await renderPdfFromHtml(html);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="daily-report-${date}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Daily PDF failed:', error);
    return NextResponse.json({ error: 'تعذر إنشاء التقرير اليومي' }, { status: 503 });
  }
}
