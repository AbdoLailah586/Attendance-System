import { NextRequest,NextResponse } from 'next/server';
import { getActiveSession } from '@/lib/auth';
import { query } from '@/lib/db';
import { loadSettings } from '@/lib/schema';
import { localDate,validDay,TIME_ZONE,cairoTime } from '@/lib/time';
import { addDays,rangeDays,cycleRange,policyOn,buildPeriodReport,type EmployeePolicy,type ReportMode } from '@/lib/period-report';
import type { AppUser } from '@/lib/types';
import type { AttendanceLog } from '@/lib/attendance';
import { loadBleRangeSummaries } from '@/lib/ble';
import { bleReportFields } from '@/lib/ble-report';

export async function GET(req:NextRequest){
  try{
    const session=await getActiveSession(req);
    if(!session)return NextResponse.json({error:'غير مصرح'},{status:401});
    const p=req.nextUrl.searchParams,mode=(p.get('mode')||'daily') as ReportMode,anchor=p.get('date')||localDate();
    const id=session.role==='employee'?session.id:p.has('userId')?Number(p.get('userId')):null;
    if(!['daily','weekly','monthly','custom'].includes(mode)||!validDay(anchor)||(id!==null&&(!Number.isInteger(id)||id<1)))return NextResponse.json({error:'نوع تقرير أو تاريخ أو موظف غير صالح'},{status:400});
    let start=anchor,end=anchor;
    if(mode==='weekly'){start=p.get('start')||anchor;end=validDay(start)?addDays(start,6):start;}
    if(mode==='custom'){start=p.get('start')||'';end=p.get('end')||'';}
    try{rangeDays(start,end);}catch(e){return NextResponse.json({error:(e as Error).message},{status:400});}
    const settings=await loadSettings();
    const users=await query<AppUser>(`SELECT u.nfc_in_before,u.nfc_in_after,u.nfc_out_before,u.nfc_out_after,u.id,u.username,u.name,u.role,u.phone,u.shift_start,u.shift_end,u.work_days,u.cycle_start_day,u.is_active,u.grace_period_mins,
      to_char(u.attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users u
      WHERE (u.role='employee' OR EXISTS(SELECT 1 FROM employee_policies ep WHERE ep.user_id=u.id AND ep.role='employee')) ${id?'AND u.id=$1':''} ORDER BY u.id`,id?[id]:[]);
    const policies=(await query<EmployeePolicy>(`SELECT user_id,to_char(effective_from,'YYYY-MM-DD') AS effective_from,shift_start,shift_end,work_days,cycle_start_day,role,is_active,grace_period_mins,nfc_in_before,nfc_in_after,nfc_out_before,nfc_out_after FROM employee_policies ORDER BY effective_from`)).rows;
    const reports=await Promise.all(users.rows.map(async user=>{
      const history=policies.filter(p=>p.user_id===user.id);
      const range=mode==='monthly'?cycleRange(anchor,policyOn(user,history,anchor).cycle_start_day):{start,end};
      const from=cairoTime(addDays(range.start,-1)),to=cairoTime(addDays(range.end,2));
      const result=await query<AttendanceLog>(`(SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp<$2 ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp<$2 AND event_type IN ('clock_in','clock_out') ORDER BY timestamp DESC,id DESC LIMIT 1)
        UNION (SELECT * FROM attendance_logs WHERE user_id=$1 AND timestamp >=$2 AND timestamp<$3) ORDER BY timestamp,id`,[user.id,from.toISOString(),to.toISOString()]);
      const report=buildPeriodReport(user,history,result.rows,settings,range.start,range.end);
      // A late arrival on the final shift day can run for the configured 36-hour cap.
      const bleEnd=+cairoTime(addDays(range.end,1))+36*3600000;
      const ble=(await loadBleRangeSummaries([user.id],+from,bleEnd,report.days.map(day=>day.date))).get(user.id);
      return {...report,...bleReportFields(ble),days:report.days.map(day=>({...day,...bleReportFields(ble?.daily?.[day.date])}))};
    }));
    return NextResponse.json({mode,anchor,start:mode==='monthly'?null:start,end:mode==='monthly'?null:end,timeZone:TIME_ZONE,generatedAt:new Date().toISOString(),settings,reports},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('Period report failed:',error);return NextResponse.json({error:'تعذر تحميل التقرير؛ حاول التحديث'},{status:503});}
}
