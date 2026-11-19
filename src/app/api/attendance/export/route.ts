import { NextRequest,NextResponse } from 'next/server';
import { GET as periodReport } from '../period-report/route';
import { reportCsv } from '@/lib/report-csv';
import type { PeriodReport } from '@/lib/period-report';
import { periodReportPdfHtml, renderPdfFromHtml, dailyReportPdfHtml } from '@/lib/report-pdf';
import { validDay, localDate } from '@/lib/time';
import { query } from '@/lib/db';
import { computeEmployeeDailyTimeline } from '@/lib/daily-timeline';

export async function GET(req:NextRequest){
  const format = req.nextUrl.searchParams.get('format');
  const mode = req.nextUrl.searchParams.get('mode') || 'daily';
  const date = req.nextUrl.searchParams.get('date');
  const userIdParam = req.nextUrl.searchParams.get('userId');

  // If daily PDF is requested, generate the rich daily PDF with rulers and timelines
  if (format === 'pdf' && mode === 'daily') {
    const targetDate = date && validDay(date) ? date : localDate();
    let userQuery = `SELECT id, name, role FROM users WHERE role = 'employee' AND is_active = TRUE`;
    const queryParams: any[] = [];
    if (userIdParam && userIdParam !== 'all' && !Number.isNaN(Number(userIdParam))) {
      userQuery += ` AND id = $1`;
      queryParams.push(Number(userIdParam));
    }
    userQuery += ` ORDER BY id ASC`;
    const users = (await query<{ id: number; name: string; role: string }>(userQuery, queryParams)).rows;

    const timelines = await Promise.all(
      users.map(u => computeEmployeeDailyTimeline(u.id, u.name, u.role, targetDate))
    );

    const html = dailyReportPdfHtml(targetDate, timelines);
    const pdf = await renderPdfFromHtml(html);

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="daily-report-${targetDate}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  }

  const result=await periodReport(req);if(!result.ok)return result;
  const data=await result.json() as {mode:string;anchor:string;reports:PeriodReport[]};
  if(format === 'pdf'){
    const headings:{[k:string]:string}={weekly:'التقرير الأسبوعي لساعات الحضور',monthly:'التقرير الشهري لساعات الحضور'};
    const heading=headings[req.nextUrl.searchParams.get('heading')||'']||'تقرير الحضور والانصراف';
    const pdf=await renderPdfFromHtml(periodReportPdfHtml(data.reports,heading));
    return new NextResponse(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="attendance-${data.mode}-${data.anchor}.pdf"`,'Cache-Control':'private, no-store'}});
  }
  const details=req.nextUrl.searchParams.get('details')==='true';
  return new NextResponse(reportCsv(data.reports,details),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="attendance-${data.mode}-${data.anchor}-${details?'days':'summary'}.csv"`,'Cache-Control':'private, no-store'}});
}
