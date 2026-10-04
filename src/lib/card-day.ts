import type {PoolClient} from 'pg';
import {policyOn,addDays,type EmployeePolicy} from './period-report';
import {cairoTime,localDate,shiftWindow} from './time';
import type {AppUser} from './types';
import type {StoreSettings} from './geo';

export function businessDay(time:Date,start='10:00'){
  const date=localDate(time);
  return time<cairoTime(date,start)?addDays(date,-1):date;
}
export function dailyRules(user:AppUser,policies:EmployeePolicy[],day:string,settings:StoreSettings){
  const boundary=settings.business_day_start_time||'10:00';
  let p=policyOn(user,policies,day);
  const shiftDay=p.shift_start<boundary?addDays(day,1):day;
  p=policyOn(user,policies,shiftDay);
  const shift=shiftWindow(shiftDay,p.shift_start,p.shift_end);
  const wall=(time:string)=>cairoTime(time<boundary?addDays(day,1):day,time);
  return {business_day:day,day_start:cairoTime(day,boundary),day_end:cairoTime(addDays(day,1),boundary),
    shift_day:shiftDay,shift_start:shift.start,shift_end:shift.end,
    attendance_open:p.attendance_open_time?wall(p.attendance_open_time):cairoTime(day,boundary),
    checkout_open:p.checkout_open_time?wall(p.checkout_open_time):new Date(+shift.end-(p.nfc_out_before??60)*60000),
    max_tracking_hours:p.max_tracking_hours??settings.max_tracking_hours??12,debounce_secs:settings.scan_debounce_secs??30};
}
export async function ensureDay(client:PoolClient,user:AppUser,policies:EmployeePolicy[],day:string,settings:StoreSettings){
  const r=dailyRules(user,policies,day,settings);
  const inserted=await client.query(`INSERT INTO nfc_day_rules(user_id,business_day,day_start,day_end,shift_day,shift_start,shift_end,attendance_open,checkout_open,max_tracking_hours,debounce_secs)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING RETURNING *`,
    [user.id,day,r.day_start,r.day_end,r.shift_day,r.shift_start,r.shift_end,r.attendance_open,r.checkout_open,r.max_tracking_hours,r.debounce_secs]);
  if(inserted.rows.length)await client.query('INSERT INTO nfc_day_rule_history(user_id,business_day,effective_at,rules) VALUES($1,$2,$3,$4)',[user.id,day,r.day_start,JSON.stringify(inserted.rows[0])]);
}
// Reconcile original capture times, including batches arriving out of order from different branches.
// Reviewed decisions are fixed; automatic decisions can move when an older offline scan arrives.
export async function reconcileDay(client:PoolClient,userId:number,day:string){
  const r=(await client.query('SELECT * FROM nfc_day_rules WHERE user_id=$1 AND business_day=$2',[userId,day])).rows[0];
  if(!r)return;
  const scans=(await client.query(`SELECT * FROM nfc_scans WHERE user_id=$1 AND business_day=$2 AND flow_version=2
    ORDER BY recorded_at,id FOR UPDATE`,[userId,day])).rows;
  const automatic=scans.filter(s=>!s.reviewed_by);
  if(automatic.length)await client.query("DELETE FROM attendance_logs WHERE source='nfc' AND nfc_scan_id=ANY($1::bigint[])",[automatic.map(s=>s.id)]);
  const manualIn=scans.find(s=>s.reviewed_by&&s.status==='accepted'&&s.event_type==='clock_in');
  const manualOut=scans.find(s=>s.reviewed_by&&s.status==='accepted'&&s.event_type==='clock_out');
  let arrival=manualIn?+new Date(manualIn.recorded_at):null,departure=manualOut?+new Date(manualOut.recorded_at):null;
  const excluded=new Set(['invalid_time','unknown_card','inactive_user','before_start']);
  for(const s of scans){
    if(s.reviewed_by||excluded.has(s.status))continue;
    const rule=s.day_rule||r;
    const t=+new Date(s.recorded_at);
    let status='accepted',type='refresh';
    if(t<+new Date(rule.attendance_open)||t>=+new Date(r.day_end)){status='before_open';type='';}
    else if(arrival===null){type='clock_in';arrival=t;}
    else if(t<arrival){status='manual_conflict';type='';}
    else if(departure!==null&&t>=departure){status='after_checkout';}
    else if(t-arrival<rule.debounce_secs*1000){status='rapid_repeat';}
    else if(t>=+new Date(rule.checkout_open)&&!manualOut){type='clock_out';departure=t;}
    await client.query('UPDATE nfc_scans SET status=$1,event_type=$2,shift_day=$3 WHERE id=$4',[status,type||null,r.shift_day,s.id]);
    if(status==='accepted'&&(type==='clock_in'||type==='clock_out')){
      const deadline=type==='clock_in'?new Date(t+r.max_tracking_hours*3600000):null;
      await client.query(`INSERT INTO attendance_logs(user_id,timestamp,branch_id,event_type,client_event_id,source,shift_day,nfc_scan_id,tracking_deadline)
        VALUES($1,$2,$3,$4,$5,'nfc',$6,$7,$8)`,[userId,s.recorded_at,s.branch_id,type,s.event_id,r.shift_day,s.id,deadline]);
    }
  }
  if(manualIn)await client.query("UPDATE attendance_logs SET tracking_deadline=timestamp+($2::int*INTERVAL '1 hour') WHERE nfc_scan_id=$1 AND event_type='clock_in'",[manualIn.id,r.max_tracking_hours]);
  if(arrival!==null)await client.query("UPDATE attendance_logs SET tracking_deadline=LEAST(tracking_deadline,$2) WHERE user_id=$1 AND source='nfc' AND event_type='clock_in' AND timestamp<$2 AND tracking_deadline>$2",[userId,new Date(arrival)]);
}

export const cardWindowsSql=`SELECT to_char(i.shift_day,'YYYY-MM-DD') AS day,i.timestamp AS start,
  LEAST(COALESCE(o.timestamp,'infinity'::timestamptz),COALESCE(i.tracking_deadline,i.timestamp+($2::int*INTERVAL '1 hour')),
    COALESCE((SELECT MIN(n.timestamp) FROM attendance_logs n WHERE n.user_id=i.user_id AND n.source='nfc' AND n.event_type='clock_in' AND n.timestamp>i.timestamp),'infinity'::timestamptz)) AS finish
  FROM attendance_logs i LEFT JOIN attendance_logs o ON o.user_id=i.user_id AND o.shift_day=i.shift_day AND o.source='nfc' AND o.event_type='clock_out'
  WHERE i.user_id=$1 AND i.source='nfc' AND i.event_type='clock_in' AND i.timestamp>=$3 AND i.timestamp<$4`;
