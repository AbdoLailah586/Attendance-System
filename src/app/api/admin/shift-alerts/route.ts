import {NextRequest,NextResponse} from 'next/server';
import {getActiveSession} from '@/lib/auth';
import {query} from '@/lib/db';
import {loadSettings} from '@/lib/schema';
import {ensureBleSchema} from '@/lib/ble';
import {businessDay,dailyRules} from '@/lib/card-day';
import {addDays,policyOn,type EmployeePolicy} from '@/lib/period-report';
import type {AppUser} from '@/lib/types';
import {cairoTime} from '@/lib/time';
export async function GET(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    const now=new Date(),raw=req.nextUrl.searchParams.get('since'),requested=raw?Date.parse(raw):+now-86400000;
    if(!Number.isFinite(requested)||requested>+now+300000)return NextResponse.json({error:'وقت متابعة غير صالح'},{status:400});
    const since=Math.max(requested,+now-7*86400000),settings=await loadSettings();await ensureBleSchema();
    const current=businessDay(now,settings.business_day_start_time);
    const [users,policies]=await Promise.all([
      query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE role='employee' AND is_active=TRUE ORDER BY id"),
      query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies")
    ]);
    const jobs:Array<{due_at:string;user_id:number|null;ready:boolean;[key:string]:unknown}>=[];
    const pdfSend='01:00';
    const inWindow=(due:number)=>due>=since&&due<=+now+48*3600000;
    const pushPdf=(job:object,due:number)=>{if(inWindow(due))jobs.push({user_id:null,...job,due_at:new Date(due).toISOString(),ready:due<=+now});};
    for(let offset=-7;offset<=1;offset++){
      const day=addDays(current,offset);
      // Combined PDFs for every employee: daily at 1 AM Cairo the next calendar day, weekly
      // Saturday 1 AM covering Sat–Fri, monthly on the 1st at 1 AM covering the previous month.
      const dailyPdfDue=+cairoTime(addDays(day,1),pdfSend);
      pushPdf({key:`daily-pdf:${day}`,kind:'daily_pdf',business_day:day,shift_day:day,filename:`daily-report-${day}.pdf`,
        title:'تم حفظ التقرير اليومي',body:`تقرير ${day} لساعات حضور كل موظف تم حفظه في Downloads.`,
        report_url:`/api/attendance/daily-pdf?date=${day}`},dailyPdfDue);
      if(new Date(day+'T12:00:00Z').getUTCDay()===5){
        const weekStart=addDays(day,-6),weeklyDue=+cairoTime(addDays(day,1),pdfSend);
        pushPdf({key:`weekly-pdf:${day}`,kind:'weekly_pdf',business_day:day,shift_day:day,filename:`weekly-report-${weekStart}-${day}.pdf`,
          title:'تم حفظ التقرير الأسبوعي',body:`ساعات حضور كل موظف من ${weekStart} إلى ${day} تم حفظها في Downloads.`,
          report_url:`/api/attendance/export?format=pdf&mode=weekly&start=${weekStart}&date=${weekStart}&heading=weekly`},weeklyDue);
      }
      const monthNext=addDays(day,1);
      if(monthNext.slice(8,10)==='01'){
        const monthStart=`${day.slice(0,8)}01`,monthlyDue=+cairoTime(monthNext,pdfSend);
        pushPdf({key:`monthly-pdf:${day}`,kind:'monthly_pdf',business_day:day,shift_day:day,filename:`monthly-report-${day.slice(0,7)}.pdf`,
          title:'تم حفظ التقرير الشهري',body:`ساعات حضور كل موظف خلال ${day.slice(0,7)} تم حفظها في Downloads.`,
          report_url:`/api/attendance/export?format=pdf&mode=custom&start=${monthStart}&end=${day}&heading=monthly`},monthlyDue);
      }
      for(const user of users.rows){
        const own=policies.rows.filter(p=>p.user_id===user.id),rule=dailyRules(user,own,day,settings);
        const policy=policyOn(user,own,rule.shift_day);
        if(policy.role!=='employee'||!policy.is_active||rule.shift_day<(user.attendance_start_date||'1900-01-01')||!policy.work_days.includes(new Date(rule.shift_day+'T12:00:00Z').getUTCDay()))continue;
        const end=+new Date(rule.shift_end);
        if(end<since||end>+now+48*3600000)continue;
        jobs.push({key:`${user.id}:${day}`,kind:'shift_report',user_id:user.id,name:user.name,business_day:day,shift_day:rule.shift_day,
          shift_start:new Date(rule.shift_start).toISOString(),due_at:new Date(end).toISOString(),ready:end<=+now,report_url:`/api/attendance/day-close?date=${day}`});
      }
    }
    jobs.sort((a,b)=>a.due_at.localeCompare(b.due_at)||(a.user_id??0)-(b.user_id??0));
    return NextResponse.json({server_time:now.toISOString(),timezone:'Africa/Cairo',next_due_at:jobs.find(j=>!j.ready)?.due_at||null,jobs},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){console.error('Shift alerts',error);return NextResponse.json({error:'تعذر تحميل مواعيد تقارير الشيفت'},{status:503});}
}
