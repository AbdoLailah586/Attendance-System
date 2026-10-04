// Targeted regression: a 36-hour local tracking cap must survive an offline phone
// beyond the default 24-hour schedule-cache validity. All fixtures are isolated.
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import pg from 'pg';
const origin='https://attendance-system-joe-2026.vercel.app';
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
let id,device;
async function call(path,token,data,method=data?'POST':'GET'){
 const r=await fetch(origin+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(45000)});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;
}
try{
 const {token:admin}=await call('/api/auth/login',null,{username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD});
 const username='qa_daily_long_'+randomBytes(5).toString('hex'),password=randomBytes(12).toString('hex');
 const {user}=await call('/api/users',admin,{username,password,name:'اختبار حد تتبع طويل مؤقت',shift_start:'12:00',shift_end:'21:00',max_tracking_hours:36,attendance_start_date:new Date(Date.now()-86400000).toISOString().slice(0,10)});id=user.id;
 const {token}=await call('/api/auth/login',null,{username,password});const uid=randomBytes(4).toString('hex').toUpperCase();
 await call('/api/nfc/admin',admin,{action:'assign_card',uid,user_id:id});device=await call('/api/nfc/admin',admin,{action:'create_device',name:'QA long cap',branch_id:'branch1'});
 const captured=new Date();await call('/api/nfc/events',device.token,{device_id:device.device_id,events:[{event_id:randomUUID(),card_uid:uid,recorded_at:captured.toISOString()}]});
 const schedule=await call('/api/attendance/tracking-window',token);assert.equal(schedule.active,true);assert.equal(schedule.windows[0].end,+captured+36*3600000);assert.ok(schedule.valid_until>=schedule.windows[0].end);
 console.log('PASS Deployed 36-hour cap has cache validity through its complete offline tracking interval');
}finally{
 const c=await pool.connect();try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
  if(id){await c.query('DELETE FROM attendance_logs WHERE user_id=$1',[id]);await c.query('DELETE FROM nfc_scans WHERE user_id=$1',[id]);await c.query('DELETE FROM nfc_day_rule_history WHERE user_id=$1',[id]);await c.query('DELETE FROM nfc_day_rules WHERE user_id=$1',[id]);await c.query('DELETE FROM nfc_cards WHERE user_id=$1',[id]);await c.query("DELETE FROM users WHERE id=$1 AND username LIKE 'qa_daily_long_%'",[id]);}
  if(device)await c.query('DELETE FROM nfc_devices WHERE id=$1',[device.device_id]);await c.query('COMMIT');console.log('Long-cap QA fixtures removed');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
}
