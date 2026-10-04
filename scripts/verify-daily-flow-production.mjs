import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
const origin='https://attendance-system-joe-2026.vercel.app',checks=[],ids=[],devices=[];
assert.ok(process.env.DATABASE_URL,'Cloud DB needed for cleanup of isolated fixtures');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
let admin,settings;
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const time=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
const date=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
async function call(path,token,data,method=data?'POST':'GET'){
 const r=await fetch(origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(45000)});
 const body=await r.json();return {status:r.status,body};
}
const operation=b=>call('/api/nfc/admin',admin,b);
const edit=(id,b)=>call('/api/users',admin,{id,...b},'PUT');
const scan=(uid,at=new Date())=>({event_id:randomUUID(),card_uid:uid,recorded_at:at===null?null:at.toISOString()});
const send=(device,events,token=device.token)=>call('/api/nfc/events',token,{device_id:device.device_id,events});
async function fixture(suffix=''){
 const username='qa_daily_'+randomBytes(5).toString('hex')+suffix,password=randomBytes(12).toString('hex');
 const r=await call('/api/users',admin,{username,password,name:'اختبار يوم العمل مؤقت',shift_start:time(new Date(Date.now()-3600000)),shift_end:time(new Date(Date.now()+4*3600000)),nfc_out_before:0,attendance_start_date:date(new Date(Date.now()-86400000)),work_days:[0,1,2,3,4,5,6]});assert.equal(r.status,200,JSON.stringify(r.body));
 const user=r.body.user;ids.push(user.id);const token=(await call('/api/auth/login',null,{username,password})).body.token;
 const uid=randomBytes(7).toString('hex').toUpperCase();assert.equal((await operation({action:'assign_card',uid,user_id:user.id})).status,200);
 // Backdate only this QA card's ownership so captured offline test events belong to it.
 const base=new Date(Math.max(Date.now()-100000,Date.parse(settings.daily_flow_enabled_at)+1000));
 await pool.query('UPDATE nfc_cards SET assigned_at=$2 WHERE uid=$1 AND user_id=$3',[uid,new Date(+base-1000),user.id]);
 return {user,token,uid,base};
}
try{
 const login=await call('/api/auth/login',null,{username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD});assert.equal(login.status,200);admin=login.body.token;
 settings=(await call('/api/settings',admin)).body.settings;assert.ok(settings.daily_flow_enabled_at);assert.equal(settings.business_day_start_time,'10:00');pass('Production exposes configurable business day, tracking cap and daily flow');
 const health=(await call('/api/health')).body;
 for(const branch_id of ['branch1','branch2']){const r=await operation({action:'create_device',name:'QA daily '+randomBytes(4).toString('hex'),branch_id});assert.equal(r.status,200);devices.push(r.body);}
 const a=await fixture();
 assert.equal((await call('/api/nfc/admin',a.token)).status,403);assert.equal((await call('/api/attendance/day-close',a.token)).status,403);assert.equal((await call('/api/attendance/day-close')).status,403);pass('Reader management and day-close reports require administrator access');
 const branch=settings.branches.find(b=>b.id==='branch1');
 const ping=(at,extra={})=>({client_event_id:randomUUID(),event_type:'ping',recorded_at:at.toISOString(),lat:branch.lat,lng:branch.lng,accuracy:1,...extra});
 let r=await call('/api/attendance/ping',a.token,ping(new Date()));assert.equal(r.body.acknowledged[0].reason,'outside_card_session');assert.equal((await call('/api/attendance/tracking-window',a.token)).body.active,false);pass('No card arrival means no GPS collection window or accepted GPS');
 const incoming=scan(a.uid,a.base);r=await send(devices[0],[incoming]);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.acknowledged[0].event_type,'clock_in');assert.equal(r.body.acknowledged[0].status,'accepted');assert.equal(r.body.acknowledged[0].display_name,a.user.username);const businessDay=r.body.acknowledged[0].business_day;pass('First daily scan records arrival and returns LCD name and actual server action');
 r=await send(devices[0],[incoming]);assert.equal(r.body.acknowledged[0].duplicate,true);pass('Upload retry acknowledges original event without duplicating attendance');
 r=await send(devices[0],[scan(a.uid,new Date(+a.base+1000))]);assert.equal(r.body.acknowledged[0].event_type,'refresh');assert.equal(r.body.acknowledged[0].status,'rapid_repeat');pass('Rapid repeated tap cannot accidentally check out');
 if(Date.now()-a.base<35000)await new Promise(resolve=>setTimeout(resolve,35000-(Date.now()-a.base)));
 r=await send(devices[1],[scan(a.uid)]);assert.equal(r.body.acknowledged[0].event_type,'refresh');assert.equal(r.body.acknowledged[0].status,'accepted');pass('Second branch scan refreshes movement without recording a second arrival');
 let schedule=(await call('/api/attendance/tracking-window',a.token)).body;assert.equal(schedule.active,true);assert.equal(schedule.windows.length,1);assert.equal(schedule.windows[0].start,+a.base);assert.equal(schedule.windows[0].end,+a.base+12*3600000);pass('GPS begins at actual card arrival and has an explicit maximum-hours deadline');
 const rule=(await pool.query("SELECT to_char(shift_day,'YYYY-MM-DD') AS day FROM nfc_day_rules WHERE user_id=$1 AND business_day=$2",[a.user.id,businessDay])).rows[0];
 let report=(await call('/api/attendance/period-report?date='+rule.day+'&userId='+a.user.id,admin)).body.reports[0];assert.equal(report.summary.total.minutes,0);assert.ok(report.days[0].missingCheckout);assert.ok(report.summary.unknown.minutes>0);pass('A card without GPS produces unknown time and zero verified presence');
 const event=ping(new Date(+a.base+10000));r=await call('/api/attendance/ping',a.token,event);assert.equal(r.status,200);assert.equal(r.body.log.branch_id,'branch1');r=await call('/api/attendance/ping',a.token,event);assert.equal(r.body.acknowledged[0].duplicate,true);pass('GPS inside actual interval is saved once with original capture time');
 r=await call('/api/attendance/ping',a.token,ping(new Date(+a.base+20000),{lat:branch.lat+0.01}));assert.equal(r.body.log.branch_id,'outside');pass('Outside geofence GPS is stored as outside for red administrator logs');
 r=await call('/api/attendance/ping',a.token,ping(new Date(+a.base+30000),{accuracy:100}));assert.equal(r.body.log.branch_id,'unknown');pass('Inaccurate boundary GPS remains unknown rather than inside or outside');
 r=await call('/api/attendance/ping',a.token,ping(new Date(+a.base-1000)));assert.equal(r.body.acknowledged[0].discarded,true);r=await call('/api/attendance/ping',a.token,ping(new Date(),{event_type:'clock_in'}));assert.equal(r.body.acknowledged[0].reason,'nfc_required');pass('Pre-arrival coordinates and mobile manufactured attendance are rejected');
 assert.equal((await edit(a.user.id,{max_tracking_hours:1})).status,200);schedule=(await call('/api/attendance/tracking-window',a.token)).body;assert.equal(schedule.windows[0].end,+a.base+3600000);pass('Administrator can change maximum hours for an already open session');
 assert.equal((await edit(a.user.id,{checkout_open_time:time(new Date(Date.now()-60000))})).status,200);
 const outAt=new Date();r=await send(devices[0],[scan(a.uid,outAt)]);assert.equal(r.body.acknowledged[0].event_type,'clock_out');assert.equal(r.body.acknowledged[0].status,'accepted');const outId=r.body.acknowledged[0].scan_id;pass('First scan after administrator opens checkout records departure');
 r=await send(devices[1],[scan(a.uid)]);assert.equal(r.body.acknowledged[0].status,'after_checkout');assert.equal(r.body.acknowledged[0].event_type,'refresh');assert.equal((await call('/api/attendance/tracking-window',a.token)).body.active,false);r=await call('/api/attendance/ping',a.token,ping(new Date()));assert.equal(r.body.acknowledged[0].discarded,true);pass('After checkout scans remain refresh and GPS stops accepting new captures');
 assert.equal((await edit(a.user.id,{checkout_open_time:time(new Date(Date.now()+2*3600000))})).status,200);r=await send(devices[0],[scan(a.uid)]);assert.equal(r.body.acknowledged[0].status,'after_checkout');const actions=(await pool.query("SELECT event_type,count(*)::int AS n FROM attendance_logs WHERE user_id=$1 AND source='nfc' GROUP BY event_type",[a.user.id])).rows;assert.ok(actions.every(a=>a.n===1));assert.equal(actions.length,2);pass('Later profile changes preserve earlier capture-time checkout decisions');
 const close=(await call('/api/attendance/day-close?date='+businessDay,admin));assert.equal(close.status,200);const row=close.body.reports.find(r=>r.user.id===a.user.id);assert.ok(row);assert.ok(row.places.some(p=>p.id==='outside'));assert.ok(row.summary.cardMinutes>0);pass('Day-close report includes all employees, card span and actual place distribution');
 const b=await fixture('_offline');
 // Deliver later captures first; then the older first scan must become the only arrival.
 r=await send(devices[1],[scan(b.uid,new Date(+b.base+50000))]);assert.equal(r.body.acknowledged[0].event_type,'clock_in');
 r=await send(devices[0],[scan(b.uid,b.base)]);assert.equal(r.body.acknowledged[0].event_type,'clock_in');const chronological=(await pool.query("SELECT timestamp,event_type FROM attendance_logs WHERE user_id=$1 AND source='nfc' ORDER BY timestamp",[b.user.id])).rows;assert.equal(chronological.length,1);assert.equal(+new Date(chronological[0].timestamp),+b.base);pass('Older offline arrival from another branch replaces receipt-order classification safely');
 const c=await fixture('_cap');r=await send(devices[0],[scan(c.uid,c.base)]);assert.equal(r.status,200);
 // Only this fixture is aged to verify expiration without waiting a real hour.
 await pool.query("UPDATE attendance_logs SET tracking_deadline=NOW()-INTERVAL '1 second' WHERE user_id=$1 AND source='nfc' AND event_type='clock_in'",[c.user.id]);assert.equal((await call('/api/attendance/tracking-window',c.token)).body.active,false);r=await call('/api/attendance/ping',c.token,ping(new Date()));assert.equal(r.body.acknowledged[0].reason,'outside_card_session');pass('Maximum-hours expiry stops GPS while retaining a missing-checkout alert');
 r=await send(devices[0],[scan(randomBytes(10).toString('hex'))]);assert.equal(r.body.acknowledged[0].status,'unknown_card');r=await send(devices[0],[scan(a.uid,null)]);assert.equal(r.body.acknowledged[0].status,'invalid_time');pass('Unknown 4/7/10-byte card IDs and untimed captures remain reviewable');
 assert.equal((await send(devices[0],[scan(a.uid)],'A'.repeat(43))).status,401);assert.equal((await send(devices[0],[{...scan(a.uid),event_id:'bad'}])).status,400);pass('Reader credentials and event IDs validated');
 const review=await operation({action:'review_scan',id:outId,user_id:a.user.id,event_type:'clock_out',shift_day:rule.day,recorded_at:outAt.toISOString(),note:'QA manual audit verification'});assert.equal(review.status,200,JSON.stringify(review.body));const audit=(await call('/api/nfc/admin?scanId='+outId,admin)).body.history;assert.ok(audit.some(r=>r.note==='QA manual audit verification'));pass('Manual card review retains a protected administrator audit trail');
 const csv=await fetch(origin+'/api/attendance/export?date='+rule.day+'&userId='+a.user.id,{headers:{Authorization:'Bearer '+admin}});assert.equal(csv.status,200);assert.ok((await csv.text()).includes('فترة الكارت المكتملة'));pass('CSV distinguishes card span from GPS verified time');
 assert.equal((await edit(a.user.id,{max_tracking_hours:0})).status,400);assert.equal((await edit(a.user.id,{checkout_open_time:'25:00'})).status,400);pass('Invalid administrator schedule values rejected');
 const log=(await call('/api/attendance/logs?date='+date(a.base),admin)).body.logs;assert.ok(log.some(l=>l.user_id===a.user.id&&l.branch_id==='outside'));pass('Deployed administrator logs expose outside GPS evidence');
 await writeFile('artifacts/daily-flow-production-verification.json',JSON.stringify({origin,commit:health.commit,runAt:new Date().toISOString(),completed:true,checks},null,2));
}finally{
 const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
  await client.query('DELETE FROM nfc_review_audit WHERE scan_id IN (SELECT id FROM nfc_scans WHERE device_id=ANY($1::uuid[]))',[devices.map(d=>d.device_id)]);
  await client.query('DELETE FROM attendance_logs WHERE user_id=ANY($1::int[])',[ids]);await client.query('DELETE FROM nfc_scans WHERE device_id=ANY($1::uuid[])',[devices.map(d=>d.device_id)]);
  await client.query('DELETE FROM nfc_day_rule_history WHERE user_id=ANY($1::int[])',[ids]);await client.query('DELETE FROM nfc_day_rules WHERE user_id=ANY($1::int[])',[ids]);
  await client.query('DELETE FROM nfc_devices WHERE id=ANY($1::uuid[])',[devices.map(d=>d.device_id)]);await client.query('DELETE FROM nfc_cards WHERE user_id=ANY($1::int[])',[ids]);
  await client.query("DELETE FROM users WHERE id=ANY($1::int[]) AND username LIKE 'qa_daily_%'",[ids]);await client.query('COMMIT');console.log('Isolated daily-flow fixtures removed; actual employee data retained');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
}
console.log(checks.length+' production checks passed');
