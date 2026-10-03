import {NextRequest,NextResponse} from 'next/server';
import {randomBytes,randomUUID} from 'crypto';
import {getActiveSession} from '@/lib/auth';
import {getPool,query} from '@/lib/db';
import {ensureAttendanceSchema} from '@/lib/schema';
import {cardUid,tokenHash,uuid} from '@/lib/nfc';
import {validDay} from '@/lib/time';
export async function GET(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    await ensureAttendanceSchema();
    const auditId=req.nextUrl.searchParams.get('scanId');
    if(auditId){
      if(!/^[1-9]\d*$/.test(auditId))return NextResponse.json({error:'قراءة غير صالحة'},{status:400});
      const history=await query('SELECT a.*,u.name AS admin_name FROM nfc_review_audit a JOIN users u ON u.id=a.admin_id WHERE scan_id=$1 ORDER BY a.id',[auditId]);
      return NextResponse.json({history:history.rows},{headers:{'Cache-Control':'private, no-store'}});
    }
    const p=req.nextUrl.searchParams,page=Math.max(1,Number(p.get('page'))||1);
    if(!Number.isInteger(page)||page>100000)return NextResponse.json({error:'صفحة غير صالحة'},{status:400});
    const filter=p.get('review')==='true'?"AND s.status NOT IN ('accepted','duplicate_action','ignored','before_start')":'';
    const [devices,cards,scans,count,branches]=await Promise.all([
      query('SELECT id,name,branch_id,is_active,last_seen_at,created_at FROM nfc_devices ORDER BY created_at'),
      query('SELECT c.*,u.name,u.username FROM nfc_cards c JOIN users u ON u.id=c.user_id WHERE revoked_at IS NULL ORDER BY c.id'),
      query(`SELECT s.*,to_char(s.shift_day,'YYYY-MM-DD') AS shift_day,u.name AS user_name,d.name AS device_name FROM nfc_scans s LEFT JOIN users u ON u.id=s.user_id JOIN nfc_devices d ON d.id=s.device_id WHERE TRUE ${filter} ORDER BY s.received_at DESC,s.id DESC LIMIT 100 OFFSET $1`,[(page-1)*100]),
      query(`SELECT count(*)::int AS total FROM nfc_scans s WHERE TRUE ${filter}`),query('SELECT id,name FROM branches WHERE is_active=TRUE ORDER BY id')
    ]);
    return NextResponse.json({devices:devices.rows,cards:cards.rows,scans:scans.rows,total:count.rows[0].total,branches:branches.rows},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){console.error('NFC admin read',e);return NextResponse.json({error:'تعذر تحميل القارئات والكروت'},{status:503});}
}
export async function POST(req:NextRequest){
  const admin=await getActiveSession(req);if(admin?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    await ensureAttendanceSchema();const b=await req.json();
    if(b.action==='create_device'){
      if(typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!(await query('SELECT id FROM branches WHERE id=$1 AND is_active=TRUE',[b.branch_id])).rows.length)return NextResponse.json({error:'اسم وفرع صالحان مطلوبان'},{status:400});
      const id=randomUUID(),token=randomBytes(32).toString('base64url');
      await query('INSERT INTO nfc_devices(id,name,branch_id,token_hash) VALUES($1,$2,$3,$4)',[id,b.name.trim(),b.branch_id,tokenHash(token)]);
      return NextResponse.json({success:true,device_id:id,token,endpoint:new URL('/api/nfc/events',req.url).origin+'/api/nfc/events'});
    }
    if(b.action==='device_active'||b.action==='rotate_device'){
      if(!uuid(b.id)||(b.action==='device_active'&&typeof b.is_active!=='boolean'))return NextResponse.json({error:'قارئ غير صالح'},{status:400});
      const token=randomBytes(32).toString('base64url');
      const result=await query(b.action==='rotate_device'?'UPDATE nfc_devices SET token_hash=$2 WHERE id=$1 RETURNING id':'UPDATE nfc_devices SET is_active=$2 WHERE id=$1 RETURNING id',[b.id,b.action==='rotate_device'?tokenHash(token):b.is_active]);
      if(!result.rows.length)return NextResponse.json({error:'القارئ غير موجود'},{status:404});
      return NextResponse.json({success:true,...(b.action==='rotate_device'?{device_id:b.id,token}:{})});
    }
    const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
      if(b.action==='assign_card'){
        const uid=cardUid(b.uid);
        if(!uid||!Number.isInteger(b.user_id)||!(await client.query("SELECT id FROM users WHERE id=$1 AND role='employee' AND is_active=TRUE",[b.user_id])).rows.length){await client.query('ROLLBACK');return NextResponse.json({error:'كارت وحساب موظف نشط مطلوبان'},{status:400});}
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[uid]);
        if((await client.query('SELECT id FROM nfc_cards WHERE uid=$1 AND revoked_at IS NULL',[uid])).rows.length){await client.query('ROLLBACK');return NextResponse.json({error:'الكارت مرتبط بالفعل؛ ألغِ الربط القديم قبل نقله'},{status:409});}
        await client.query('INSERT INTO nfc_cards(uid,user_id) VALUES($1,$2)',[uid,b.user_id]);
      }else if(b.action==='revoke_card'){
        if(!Number.isInteger(b.id)){await client.query('ROLLBACK');return NextResponse.json({error:'كارت غير صالح'},{status:400});}
        const result=await client.query('UPDATE nfc_cards SET revoked_at=NOW() WHERE id=$1 AND revoked_at IS NULL RETURNING id',[b.id]);
        if(!result.rows.length){await client.query('ROLLBACK');return NextResponse.json({error:'الكارت غير موجود'},{status:404});}
      }else if(b.action==='review_scan'){
        if(!/^[1-9]\d*$/.test(String(b.id))||typeof b.note!=='string'||!b.note.trim()||b.note.length>1000||!['clock_in','clock_out','ignored'].includes(b.event_type)){await client.query('ROLLBACK');return NextResponse.json({error:'اختار نوع القراءة واكتب سبب التعديل'},{status:400});}
        // Same lock order as ingestion: device, settings, then user.
        const deviceId=(await client.query('SELECT device_id FROM nfc_scans WHERE id=$1',[b.id])).rows[0]?.device_id;
        if(!deviceId){await client.query('ROLLBACK');return NextResponse.json({error:'القراءة غير موجودة'},{status:404});}
        await client.query('SELECT id FROM nfc_devices WHERE id=$1 FOR UPDATE',[deviceId]);
        const settings=(await client.query("SELECT attendance_reset_at FROM settings WHERE id='main' FOR SHARE")).rows[0];
        const old=(await client.query('SELECT * FROM nfc_scans WHERE id=$1 FOR UPDATE',[b.id])).rows[0];
        const time=b.recorded_at===undefined?old.recorded_at:new Date(b.recorded_at);
        if(b.event_type!=='ignored'){
          if(!Number.isInteger(b.user_id)||!validDay(b.shift_day)||!time||!Number.isFinite(+new Date(time))||+new Date(time)>Date.now()+120000||+new Date(time)<+new Date(settings.attendance_reset_at)||!(await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[b.user_id])).rows.length){await client.query('ROLLBACK');return NextResponse.json({error:'الموظف ويوم الشيفت ووقت القراءة غير صالحين'},{status:400});}
          const conflict=await client.query("SELECT id FROM attendance_logs WHERE source='nfc' AND user_id=$1 AND shift_day=$2 AND event_type=$3 AND nfc_scan_id<>$4",[b.user_id,b.shift_day,b.event_type,b.id]);
          if(conflict.rows.length){await client.query('ROLLBACK');return NextResponse.json({error:'يوجد سجل من نفس النوع لهذا الشيفت؛ تجاهله أولًا لتصحيح القراءة'},{status:409});}
        }
        await client.query('DELETE FROM attendance_logs WHERE source=\'nfc\' AND nfc_scan_id=$1',[b.id]);
        if(b.event_type!=='ignored')await client.query(`INSERT INTO attendance_logs(user_id,timestamp,branch_id,event_type,client_event_id,source,shift_day,nfc_scan_id) VALUES($1,$2,$3,$4,$5,'nfc',$6,$7)`,[b.user_id,time,old.branch_id,b.event_type,old.event_id,b.shift_day,b.id]);
        const next={status:b.event_type==='ignored'?'ignored':'accepted',user_id:b.user_id||old.user_id,event_type:b.event_type==='ignored'?null:b.event_type,shift_day:b.shift_day||null,recorded_at:time};
        await client.query('UPDATE nfc_scans SET status=$1,user_id=$2,event_type=$3,shift_day=$4,recorded_at=$5,reviewed_by=$6,review_note=$7,reviewed_at=NOW() WHERE id=$8',[next.status,next.user_id,next.event_type,next.shift_day,next.recorded_at,admin.id,b.note.trim(),b.id]);
        await client.query('INSERT INTO nfc_review_audit(scan_id,admin_id,previous_data,new_data,note) VALUES($1,$2,$3,$4,$5)',[b.id,admin.id,JSON.stringify(old),JSON.stringify(next),b.note.trim()]);
      }else{await client.query('ROLLBACK');return NextResponse.json({error:'عملية غير صالحة'},{status:400});}
      await client.query('COMMIT');return NextResponse.json({success:true});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){if((e as {code?:string}).code==='23505')return NextResponse.json({error:'الكارت أو القراءة مرتبطان بالفعل'},{status:409});console.error('NFC admin update',e);return NextResponse.json({error:'تعذر حفظ التعديل'},{status:503});}
}
