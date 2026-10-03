import { buildReport, type AttendanceLog } from './attendance';
import { formatDurationArabic, type StoreSettings } from './geo';
import { cairoTime, nextDay, shiftWindow, validDay, localDate } from './time';
import type { AppUser } from './types';

export type ReportMode = 'daily' | 'weekly' | 'monthly' | 'custom';
export interface EmployeePolicy {
  user_id:number; effective_from:string; shift_start:string; shift_end:string;
  work_days:number[]; cycle_start_day:number; role:string; is_active:boolean; grace_period_mins:number; nfc_in_before?:number; nfc_in_after?:number; nfc_out_before?:number; nfc_out_after?:number;
}
export function addDays(day:string, count:number) {
  return new Date(Date.parse(day+'T12:00:00Z')+count*86400000).toISOString().slice(0,10);
}
function monthStart(year:number, month:number, day:number) {
  const last = new Date(Date.UTC(year,month+1,0)).getUTCDate();
  return new Date(Date.UTC(year,month,Math.min(day,last),12)).toISOString().slice(0,10);
}
export function cycleRange(anchor:string, cycleDay:number) {
  if (!validDay(anchor) || !Number.isInteger(cycleDay) || cycleDay<1 || cycleDay>31) throw new Error('دورة شهر غير صالحة');
  const d=new Date(anchor+'T12:00:00Z'), y=d.getUTCFullYear(), m=d.getUTCMonth();
  const thisStart=monthStart(y,m,cycleDay);
  const start=anchor>=thisStart?thisStart:monthStart(y,m-1,cycleDay);
  const next=anchor>=thisStart?monthStart(y,m+1,cycleDay):thisStart;
  return {start,end:addDays(next,-1)};
}
export function rangeDays(start:string,end:string) {
  if(!validDay(start)||!validDay(end)||start>end) throw new Error('اختار فترة صحيحة؛ تاريخ البداية لا يتجاوز النهاية');
  const count=Math.round((Date.parse(end)-Date.parse(start))/86400000)+1;
  if(count>366)throw new Error('الفترة القصوى 366 يومًا');
  return Array.from({length:count},(_,i)=>addDays(start,i));
}
export function policyOn(user:AppUser, policies:EmployeePolicy[], day:string):EmployeePolicy {
  return [...policies].filter(p=>p.effective_from<=day).sort((a,b)=>b.effective_from.localeCompare(a.effective_from))[0] || {
    nfc_in_before:user.nfc_in_before,nfc_in_after:user.nfc_in_after,nfc_out_before:user.nfc_out_before,nfc_out_after:user.nfc_out_after,user_id:user.id,effective_from:'1900-01-01',shift_start:user.shift_start||'10:00',shift_end:user.shift_end||'22:00',
    work_days:user.work_days||[0,1,2,3,4,5,6],cycle_start_day:user.cycle_start_day||1,role:user.role,is_active:user.is_active!==false,grace_period_mins:user.grace_period_mins??30,
  };
}
export function dayWindow(day:string, policy:Pick<EmployeePolicy,'shift_start'|'shift_end'>) {
  const overnight=policy.shift_end<=policy.shift_start;
  return {start:overnight?cairoTime(day,policy.shift_start):cairoTime(day),end:overnight?cairoTime(nextDay(day),policy.shift_start):cairoTime(nextDay(day))};
}
export function buildPeriodReport(user:AppUser, policies:EmployeePolicy[], logs:AttendanceLog[], settings:StoreSettings, start:string,end:string,now=new Date()) {
  const resetDay=settings.attendance_reset_at?localDate(new Date(settings.attendance_reset_at)):null;
  const begins=[user.attendance_start_date||'1900-01-01',resetDay||'1900-01-01'].sort().at(-1)!;
  const sorted=[...logs].sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime()||a.id-b.id);
  const days=rangeDays(start,end).map(date=>{
    const policy=policyOn(user,policies,date),window=dayWindow(date,policy),shift=shiftWindow(date,policy.shift_start,policy.shift_end);
    const before=sorted.filter(l=>new Date(l.timestamp)<window.start),last=before.at(-1),control=before.filter(l=>['clock_in','clock_out'].includes(l.event_type)).at(-1);
    const current=sorted.filter(l=>l.source==='nfc'?(typeof l.shift_day==='string'?l.shift_day.slice(0,10):l.shift_day?localDate(new Date(l.shift_day)):null)===date:new Date(l.timestamp)>=window.start&&new Date(l.timestamp)<window.end);
    const carried=[last,control].filter((l):l is AttendanceLog=>Boolean(l));
    const data=buildReport(policy,[...new Map([...carried,...current].map(l=>[l.id,l])).values()],{...settings,grace_period_mins:policy.grace_period_mins},date,window.start,window.end,now);
    const eligible=date>=begins&&policy.role==='employee'&&policy.is_active;
    const scheduled=eligible&&policy.work_days.includes(new Date(date+'T12:00:00Z').getUTCDay());
    const finished=now>=shift.end;
    const status=!eligible?'untracked':data.firstArrival?'present':!scheduled?'off':now<shift.start?'upcoming':data.attendanceSource==='nfc'?(data.missingArrival?'unverified':finished?'absent':'pending'):current.length||data.onDuty?'unverified':finished?'absent':'pending';
    return {date,policy,scheduled,finished,status,...data,logCount:current.length,lateMinutes:data.punctuality.status==='late'?Math.max(0,data.punctuality.diffMinutes):0};
  });
  const branchTotals:Record<string,number>={};
  let regular=0,overtime=0,outside=0,unknown=0,total=0;
  for(const d of days){
    const shift=shiftWindow(d.date,d.policy.shift_start,d.policy.shift_end);
    if(d.attendanceSource==='nfc'){total+=d.summary.totalMinutes;regular+=d.summary.regularMinutes;overtime+=d.summary.overtimeMinutes;}
    for(const t of d.timeline){
      if(t.branch_id==='outside')outside+=t.durationMinutes;
      else if(t.branch_id==='unknown')unknown+=t.durationMinutes;
      else{
        branchTotals[t.branch_id]=(branchTotals[t.branch_id]||0)+t.durationMinutes;
        const s=Date.parse(t.start),e=Date.parse(t.end);
        if(d.attendanceSource!=='nfc'){total+=t.durationMinutes;regular+=Math.max(0,Math.min(e,+shift.end)-Math.max(s,+shift.start))/60000;
        overtime+=Math.max(0,e-Math.max(s,+shift.end))/60000;}
      }
    }
  }
  const branchNames=Object.fromEntries((settings.branches||[]).map(b=>[b.id,b.name]));

  const duration=(n:number)=>({minutes:Math.round(n),formatted:formatDurationArabic(n)});
  const allIds=[...new Set([...(settings.branches||[]).map(b=>b.id),...Object.keys(branchTotals)])];
  return {user,start,end,days,summary:{
    calendarDays:days.length,missingCheckoutDays:days.filter(d=>d.missingCheckout).length,missingArrivalDays:days.filter(d=>d.missingArrival).length,provisional:duration(days.reduce((s,d)=>s+d.provisionalMinutes,0)),scheduledDays:days.filter(d=>d.scheduled&&d.status!=='upcoming').length,
    presentDays:days.filter(d=>d.status==='present').length,absentDays:days.filter(d=>d.status==='absent').length,
    offDays:days.filter(d=>d.status==='off').length,pendingDays:days.filter(d=>d.status==='pending').length,
    unverifiedDays:days.filter(d=>d.status==='unverified').length,untrackedDays:days.filter(d=>d.status==='untracked').length,
    lateDays:days.filter(d=>d.status==='present'&&d.lateMinutes>0).length,
    late:duration(days.reduce((s,d)=>s+d.lateMinutes,0)),total:duration(total),regular:duration(regular),overtime:duration(overtime),outside:duration(outside),unknown:duration(unknown),
    earlyDeparture:duration(days.reduce((s,d)=>s+d.summary.earlyDepartureMinutes,0)),exitCount:days.reduce((s,d)=>s+d.exitCount,0),
    branches:allIds.map(id=>({id,name:branchNames[id]||id,...duration(branchTotals[id]||0)})),
  }};
}
export type PeriodReport=ReturnType<typeof buildPeriodReport>;
