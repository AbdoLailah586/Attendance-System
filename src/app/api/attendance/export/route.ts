import { NextRequest,NextResponse } from 'next/server';
import { GET as periodReport } from '../period-report/route';
import { reportCsv } from '@/lib/report-csv';
import type { PeriodReport } from '@/lib/period-report';
export async function GET(req:NextRequest){
  const result=await periodReport(req);if(!result.ok)return result;
  const data=await result.json() as {mode:string;anchor:string;reports:PeriodReport[]};
  const details=req.nextUrl.searchParams.get('details')==='true';
  return new NextResponse(reportCsv(data.reports,details),{headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="attendance-${data.mode}-${data.anchor}-${details?'days':'summary'}.csv"`,'Cache-Control':'private, no-store'}});
}
