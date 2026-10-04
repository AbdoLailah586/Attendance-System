import {NextRequest,NextResponse} from 'next/server';
import {getActiveSession} from '@/lib/auth';
import {query} from '@/lib/db';
import {loadSettings} from '@/lib/schema';
import {businessDay,dailyRules} from '@/lib/card-day';
import {addDays,type EmployeePolicy} from '@/lib/period-report';
import {buildReport,type AttendanceLog} from '@/lib/attendance';
import {validDay} from '@/lib/time';
import type {AppUser} from '@/lib/types';
export async function GET(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    const settings=await loadSettings(),now=new Date();
    const day=req.nextUrl.searchParams.get('date')||addDays(businessDay(now,settings.business_day_start_time),-1);
    if(!validDay(day)||day>businessDay(now,settings.business_day_start_time))return NextResponse.json({error:'يوم عمل غير صالح'},{status:400});
    const users=(await query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE role='employee' OR EXISTS(SELECT 1 FROM nfc_day_rules WHERE user_id=users.id AND business_day=$1) ORDER BY id",[day])).rows;
    const policies=(await query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies")).rows;
    const reports=await Promise.all(users.map(async user=>{
      const rule=(await query("SELECT *,to_char(shift_day,'YYYY-MM-DD') AS shift_day FROM nfc_day_rules WHERE user_id=$1 AND business_day=$2",[user.id,day])).rows[0]||dailyRules(user,policies.filter(p=>p.user_id===user.id),day,settings);
      const rows=(await query<AttendanceLog>("SELECT * FROM attendance_logs WHERE user_id=$1 AND (shift_day=$2 OR (shift_day IS NULL AND timestamp>=$3 AND timestamp<$4)) ORDER BY timestamp,id",[user.id,rule.shift_day,rule.day_start,new Date(+new Date(rule.day_end)+36*3600000)])).rows;
      const report=buildReport(user,rows,settings,rule.shift_day,new Date(rule.day_start),new Date(rule.day_end),now);
      const span=report.summary.branches.reduce((s,b)=>s+b.minutes,0)+report.summary.outsideMinutes+report.summary.unknownMinutes;
      const places=[...report.summary.branches.map(b=>({...b,percentage:span?Math.round(100*b.minutes/span):0})),{id:'outside',name:'خارج الفروع',minutes:report.summary.outsideMinutes,formatted:report.summary.outsideFormatted,percentage:span?Math.round(100*report.summary.outsideMinutes/span):0},{id:'unknown',name:'غير معلوم / فجوة تتبع',minutes:report.summary.unknownMinutes,formatted:report.summary.unknownFormatted,percentage:span?Math.round(100*report.summary.unknownMinutes/span):0}];
      return {user:{id:user.id,name:user.name,username:user.username},...report,places,dayEnded:now>=new Date(rule.day_end)};
    }));
    return NextResponse.json({businessDay:day,boundary:settings.business_day_start_time,generatedAt:now.toISOString(),reports},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){console.error('Day close report',e);return NextResponse.json({error:'تعذر تحميل ملخص يوم العمل'},{status:503});}
}
