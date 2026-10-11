import {query} from './db';
import {loadSettings} from './schema';
import {cardWindowsSql,dailyRules} from './card-day';
import {policyOn,type EmployeePolicy} from './period-report';
import {buildReport,type AttendanceLog} from './attendance';
import type {AppUser} from './types';
import {ensureBleSchema,loadBleRangeSummaries} from './ble';
import {bleReportFields} from './ble-report';

export async function loadDayCloseReport(day:string,now=new Date()){
  const settings=await loadSettings();await ensureBleSchema();
    const users=(await query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE role='employee' OR EXISTS(SELECT 1 FROM nfc_day_rules WHERE user_id=users.id AND business_day=$1) ORDER BY id",[day])).rows;
    const policies=(await query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies")).rows;
    const reports=await Promise.all(users.map(async user=>{
      const rule=(await query("SELECT *,to_char(shift_day,'YYYY-MM-DD') AS shift_day FROM nfc_day_rules WHERE user_id=$1 AND business_day=$2",[user.id,day])).rows[0]||dailyRules(user,policies.filter(p=>p.user_id===user.id),day,settings);
      const rows=(await query<AttendanceLog>("SELECT * FROM attendance_logs WHERE user_id=$1 AND (shift_day=$2 OR (shift_day IS NULL AND timestamp>=$3 AND timestamp<$4)) ORDER BY timestamp,id",[user.id,rule.shift_day,rule.day_start,new Date(+new Date(rule.day_end)+36*3600000)])).rows;
      const ownPolicies=policies.filter(p=>p.user_id===user.id),scheduled=dailyRules(user,ownPolicies,day,settings),policy=policyOn(user,ownPolicies,rule.shift_day);
      const report=buildReport(policy,rows,{...settings,grace_period_mins:policy.grace_period_mins},rule.shift_day,new Date(rule.day_start),new Date(rule.day_end),now);
      const lastSeen=(await query<{last_seen:Date|null}>(`WITH windows AS (${cardWindowsSql})
        SELECT MAX(e.recorded_at) AS last_seen FROM ble_events e WHERE e.user_id=$1 AND e.state='seen' AND e.status='accepted'
        AND EXISTS(SELECT 1 FROM windows w WHERE w.day=$5 AND e.recorded_at>=w.start AND e.recorded_at<w.finish)`,
        [user.id,rule.max_tracking_hours,new Date(+new Date(rule.day_start)-86400000),new Date(+new Date(rule.day_end)+36*3600000),rule.shift_day])).rows[0]?.last_seen;
      const span=report.summary.branches.reduce((s,b)=>s+b.minutes,0)+report.summary.outsideMinutes+report.summary.unknownMinutes;
      const places=[...report.summary.branches.map(b=>({...b,percentage:span?Math.round(100*b.minutes/span):0})),{id:'outside',name:'خارج الفروع',minutes:report.summary.outsideMinutes,formatted:report.summary.outsideFormatted,percentage:span?Math.round(100*report.summary.outsideMinutes/span):0},{id:'unknown',name:'غير معلوم / فجوة تتبع',minutes:report.summary.unknownMinutes,formatted:report.summary.unknownFormatted,percentage:span?Math.round(100*report.summary.unknownMinutes/span):0}];
      const ble=(await loadBleRangeSummaries([user.id],+new Date(rule.day_start)-86400000,+new Date(rule.day_end)+36*3600000,[rule.shift_day])).get(user.id);
      return {user:{id:user.id,name:user.name,username:user.username},...report,places,dayEnded:now>=new Date(rule.day_end),
        scheduledShiftStart:new Date(scheduled.shift_start).toISOString(),scheduledShiftEnd:new Date(scheduled.shift_end).toISOString(),
        attendanceOpen:new Date(rule.attendance_open).toISOString(),checkoutOpen:new Date(rule.checkout_open).toISOString(),
        lastTagSeen:lastSeen?new Date(lastSeen).toISOString():null,...bleReportFields(ble?.daily?.[rule.shift_day])};
    }));
  return {businessDay:day,boundary:settings.business_day_start_time,generatedAt:now.toISOString(),reports};
}
export type DayCloseData=Awaited<ReturnType<typeof loadDayCloseReport>>;
