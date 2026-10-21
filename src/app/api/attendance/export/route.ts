import { NextRequest,NextResponse } from 'next/server';
import { GET as periodReport } from '../period-report/route';
import { reportCsv } from '@/lib/report-csv';
import type { PeriodReport } from '@/lib/period-report';
import { periodReportPdfHtml, renderPdfFromHtml } from '@/lib/report-pdf';
export async function GET(req:NextRequest){
  const result=await periodReport(req);if(!result.ok)return result;
  const data=await result.json() as {mode:string;anchor:string;reports:PeriodReport[]};
  if(req.nextUrl.searchParams.get('format')==='pdf'){
    const pdf=await renderPdfFromHtml(periodReportPdfHtml(data.reports,'تقرير الحضور والانصراف'));
    return new NextResponse(new Uint8Array(pdf),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="attendance-${data.mode}-${data.anchor}.pdf"`,'Cache-Control':'private, no-store'}});
  }
  const details=req.nextUrl.searchParams.get('details')==='true';
  return new NextResponse(reportCsv(data.reports,details),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="attendance-${data.mode}-${data.anchor}-${details?'days':'summary'}.csv"`,'Cache-Control':'private, no-store'}});
}
