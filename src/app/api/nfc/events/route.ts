import {NextRequest,NextResponse} from 'next/server';
import {getPool,query} from '@/lib/db';
import {ensureAttendanceSchema} from '@/lib/schema';
import {cardUid,classifyScan,tokenHash,uuid} from '@/lib/nfc';
import type {AppUser} from '@/lib/types';
import type {EmployeePolicy} from '@/lib/period-report';
import {businessDay,ensureDay,reconcileDay} from '@/lib/card-day';
import type {StoreSettings} from '@/lib/geo';
export async function POST(req:NextRequest){
  try{
    await ensureAttendanceSchema();
    const b=await req.json().catch(()=>null);
    if(!b||!uuid(b.device_id)||!Array.isArray(b.events)||b.events.length<1||b.events.length>100)return NextResponse.json({error:'Invalid device or batch (1–100 events)'},{status:400});
    const credential=req.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if(!credential)return NextResponse.json({error:'Device credential required'},{status:401});
    for(const e of b.events){
      if(!e||!uuid(e.event_id)||!cardUid(e.card_uid)||(e.recorded_at!==null&&(typeof e.recorded_at!=='string'||!/^\d{4}-\d\d-\d\dT.*(Z|[+-]\d\d:\d\d)$/.test(e.recorded_at)||!Number.isFinite(Date.parse(e.recorded_at)))))return NextResponse.json({error:'Invalid event ID, card UID, or UTC timestamp'},{status:400});
    }
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
      // Serializes a device batch with device revocation; user locks below serialize branch readers.
      const device=(await client.query(`SELECT d.* FROM nfc_devices d JOIN branches b ON b.id=d.branch_id AND b.is_active=TRUE WHERE d.id=$1 AND d.token_hash=$2 AND d.is_active=TRUE FOR UPDATE OF d`,[b.device_id,tokenHash(credential)])).rows[0];
      if(!device){await client.query('ROLLBACK');return NextResponse.json({error:'Device disabled or credential invalid'},{status:401});}
      const settings=(await client.query<StoreSettings>("SELECT * FROM settings WHERE id='main' FOR SHARE")).rows[0];
      const acknowledged:{event_id:string;scan_id:string;status:string;duplicate:boolean}[]=[];
      const affected=new Map<string,{user:number;day:string}>();
      for(const e of b.events){
        const existing=(await client.query('SELECT id,status FROM nfc_scans WHERE device_id=$1 AND event_id=$2',[device.id,e.event_id])).rows[0];
        if(existing){acknowledged.push({event_id:e.event_id,scan_id:existing.id,status:existing.status,duplicate:true});continue;}
        const uid=cardUid(e.card_uid),time=e.recorded_at?new Date(e.recorded_at):null;
        const card=time?(await client.query(`SELECT c.user_id FROM nfc_cards c WHERE c.uid=$1 AND c.assigned_at<=$2 AND (c.revoked_at IS NULL OR c.revoked_at>$2) ORDER BY c.assigned_at DESC LIMIT 1`,[uid,time])).rows[0]:null;
        let status='unknown_card',event_type:string|null=null,shift_day:string|null=null,day:string|null=null,version=1;
        if(!time||+time>Date.now()+120000||+time<Date.now()-90*86400000)status='invalid_time';
        else if(+time<Math.max(settings.attendance_reset_at?+new Date(settings.attendance_reset_at):0,+new Date(settings.nfc_enabled_at!)))status='before_start';
        else if(card){
          const user=(await client.query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE id=$1 FOR UPDATE",[card.user_id])).rows[0];
          const policies=(await client.query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies WHERE user_id=$1",[card.user_id])).rows;
          if(+time>=+new Date(settings.daily_flow_enabled_at!)){
            version=2;const prior=(await client.query("SELECT to_char(business_day,'YYYY-MM-DD') AS day FROM nfc_day_rules WHERE user_id=$1 AND day_start<=$2 AND day_end>$2 ORDER BY day_start DESC LIMIT 1",[user.id,time])).rows[0];day=String(prior?.day||businessDay(time,settings.business_day_start_time));
            await ensureDay(client,user,policies,day,settings);
            shift_day=(await client.query("SELECT to_char(shift_day,'YYYY-MM-DD') AS day FROM nfc_day_rules WHERE user_id=$1 AND business_day=$2",[user.id,day])).rows[0].day;
            status='pending';affected.set(`${user.id}/${day}`,{user:user.id,day});
          }else ({status,event_type,shift_day}=classifyScan(user,policies,time));
          if(!user.is_active||user.role!=='employee')status='inactive_user';
          else if(shift_day&&shift_day<(user.attendance_start_date||'1900-01-01'))status='before_start';
        }
        const scan=(await client.query(`INSERT INTO nfc_scans(device_id,event_id,card_uid,user_id,branch_id,recorded_at,status,event_type,shift_day,business_day,flow_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[device.id,e.event_id,uid,card?.user_id||null,device.branch_id,time,status,event_type,shift_day,day,version])).rows[0];
        if(version===2)await client.query(`UPDATE nfc_scans SET day_rule=(SELECT rules FROM nfc_day_rule_history WHERE user_id=$2 AND business_day=$3 AND effective_at<=$4 ORDER BY effective_at DESC,id DESC LIMIT 1) WHERE id=$1`,[scan.id,card?.user_id,day,time]);
        if(version===1&&status==='accepted'){
          const result=await client.query(`INSERT INTO attendance_logs(user_id,timestamp,branch_id,event_type,client_event_id,source,shift_day,nfc_scan_id) VALUES($1,$2,$3,$4,$5,'nfc',$6,$7) ON CONFLICT DO NOTHING RETURNING id`,[card.user_id,time,device.branch_id,event_type,e.event_id,shift_day,scan.id]);
          if(!result.rows.length){status='duplicate_action';await client.query('UPDATE nfc_scans SET status=$1 WHERE id=$2',[status,scan.id]);}
        }
        acknowledged.push({event_id:e.event_id,scan_id:scan.id,status,duplicate:false});
      }
      for(const a of affected.values())await reconcileDay(client,a.user,a.day);
      const details=(await client.query(`SELECT s.id,s.status,s.event_type,to_char(s.business_day,'YYYY-MM-DD') AS business_day,u.name,u.username
        FROM nfc_scans s LEFT JOIN users u ON u.id=s.user_id WHERE s.id=ANY($1::bigint[])`,[acknowledged.map(a=>a.scan_id)])).rows;
      const replies=acknowledged.map(a=>{const d=details.find(d=>String(d.id)===String(a.scan_id));return {...a,...d,display_name:d?.username||'Unknown card',verification:'GPS required'};});
      await client.query('UPDATE nfc_devices SET last_seen_at=NOW() WHERE id=$1',[device.id]);
      await client.query('COMMIT');
      return NextResponse.json({success:true,acknowledged:replies,server_time:new Date().toISOString()},{headers:{'Cache-Control':'no-store'}});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(error){console.error('Reader upload failed',error);return NextResponse.json({error:'Keep events and retry later'},{status:503});}
}

export async function GET(){
  // No identities or credentials exposed to unauthenticated readers.
  await query('SELECT 1');
  return NextResponse.json({protocol:'attendance-reader-v1',maxBatch:100,timeZone:'Africa/Cairo'});
}
