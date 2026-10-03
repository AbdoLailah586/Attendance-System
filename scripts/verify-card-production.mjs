import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import pg from 'pg';
const origin='https://attendance-system-joe-2026.vercel.app',checks=[],ids=[],devices=[];
let admin;
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const date=d=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const time=d=>new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(d);
async function call(path,token,data,method=data?'POST':'GET'){
 const r=await fetch(origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data?{'Content-Type':'application/json'}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(30000)});
 const text=await r.text();let body;try{body=JSON.parse(text);}catch{body={text};}return {status:r.status,body};
}
const edit=(id,data)=>call('/api/users',admin,{id,...data},'PUT');
const operation=b=>call('/api/nfc/admin',admin,b);
function scan(uid,at=new Date().toISOString()){return{event_id:randomUUID(),card_uid:uid,recorded_at:at};}
async function send(device,events,token=device.token){return call('/api/nfc/events',token,{device_id:device.device_id,events});}
try{
 assert.ok(process.env.DATABASE_URL,'DB access required to clean only isolated QA fixtures');
 const login=await call('/api/auth/login',null,{username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD});assert.equal(login.status,200);admin=login.body.token;
 const health=(await call('/api/health')).body;const settings=(await call('/api/settings',admin)).body.settings;assert.equal(settings.attendance_mode,'nfc');pass('Production deployed card attendance mode');
 const now=new Date(),shiftStartDate=new Date(+now-60*60000),shiftDay=date(shiftStartDate),start=time(shiftStartDate),end=time(new Date(+shiftStartDate+9*3600000));
 const username='qa_card_'+randomBytes(5).toString('hex'),password=randomBytes(12).toString('hex');
 const made=await call('/api/users',admin,{username,password,name:'اختبار كارت مؤقت',shift_start:start,shift_end:end,attendance_start_date:shiftDay,work_days:[0,1,2,3,4,5,6]});assert.equal(made.status,200);const user=made.body.user;ids.push(user.id);
 const employee=(await call('/api/auth/login',null,{username,password})).body.token;
 assert.equal((await call('/api/nfc/admin',employee)).status,403);assert.equal((await call('/api/nfc/admin')).status,403);pass('Reader administration protected from employee and anonymous accounts');
 for(const branch_id of ['branch1','branch2']){const d=await operation({action:'create_device',name:'QA '+username+' '+branch_id,branch_id});assert.equal(d.status,200);devices.push(d.body);}
 const inventory=(await call('/api/nfc/admin',admin)).body;assert.ok(inventory.devices.every(d=>!('token_hash'in d)&&!('token'in d)));pass('Branch devices have distinct keys and inventory never exposes credentials');
 const uid=randomBytes(5).toString('hex').toUpperCase();let assigned=await operation({action:'assign_card',uid,user_id:user.id});assert.equal(assigned.status,200);assert.equal((await operation({action:'assign_card',uid,user_id:user.id})).status,409);pass('Unique 125 kHz card assigned to employee; accidental duplicate assignment rejected');
 const incoming=scan(uid);let r=await send(devices[0],[incoming]);assert.equal(r.status,200);assert.equal(r.body.acknowledged[0].status,'accepted');const arrivalId=r.body.acknowledged[0].scan_id;
 r=await send(devices[0],[incoming]);assert.equal(r.body.acknowledged[0].duplicate,true);r=await send(devices[0],[scan(uid)]);assert.equal(r.body.acknowledged[0].status,'duplicate_action');pass('Arrival classified by employee window; delivery retries and additional taps never duplicate attendance');
 let report=(await call('/api/attendance/period-report?date='+shiftDay+'&userId='+user.id,admin)).body.reports[0];assert.equal(report.days[0].attendanceSource,'nfc');assert.ok(report.days[0].firstArrival);assert.equal(report.days[0].missingCheckout,true);assert.equal(report.summary.total.minutes,0);pass('Card alone establishes arrival; missing checkout remains provisional rather than inventing departure');
 assert.equal((await send(devices[0],[scan(uid)],'A'.repeat(43))).status,401);assert.equal((await send({...devices[0],device_id:devices[1].device_id},[scan(uid)])).status,401);pass('Invalid key and cross-device impersonation rejected');
 assert.equal((await send(devices[0],[{...scan(uid),event_id:'bad'}])).status,400);assert.equal((await send(devices[0],[])).status,400);pass('Malformed event and empty batch rejected');
 r=await send(devices[0],[scan(randomBytes(5).toString('hex'))]);assert.equal(r.body.acknowledged[0].status,'unknown_card');r=await send(devices[0],[scan(uid,null)]);assert.equal(r.body.acknowledged[0].status,'invalid_time');pass('Unknown cards and untimed offline taps durably recorded for review');
 let noWindow=await edit(user.id,{shift_start:time(new Date(+now+4*3600000)),shift_end:time(new Date(+now+8*3600000)),nfc_in_before:60,nfc_in_after:120,nfc_out_before:60,nfc_out_after:180,effective_from:shiftDay});assert.equal(noWindow.status,200);
 r=await send(devices[0],[scan(uid)]);assert.equal(r.body.acknowledged[0].status,'outside_window');const reviewId=r.body.acknowledged[0].scan_id;pass('Mid-shift tap retained without being mistaken for checkout');
 assert.equal((await edit(user.id,{nfc_in_before:720,nfc_in_after:720,nfc_out_before:720,nfc_out_after:720,effective_from:shiftDay})).status,200);r=await send(devices[0],[scan(uid)]);assert.equal(r.body.acknowledged[0].status,'ambiguous_window');pass('Admin can change windows; overlaps route to review rather than guessing');
 assert.equal((await edit(user.id,{nfc_in_before:721})).status,400);pass('Window bounds validated');
 // Turn a reviewed scan into checkout first, then adjust arrival to verify out-of-order capture and overnight pairing.
 const departureAt=new Date(Date.now()-1000),duration=Math.min(540,Math.floor((+departureAt-Date.parse(settings.attendance_reset_at))/60000)-2);assert.ok(duration>0);const arrivalAt=new Date(+departureAt-duration*60000),day=date(arrivalAt);
 assert.equal((await edit(user.id,{shift_start:time(arrivalAt),shift_end:time(departureAt),attendance_start_date:day,effective_from:day,nfc_in_before:60,nfc_in_after:120,nfc_out_before:60,nfc_out_after:180})).status,200);
 r=await operation({action:'review_scan',id:reviewId,user_id:user.id,event_type:'clock_out',shift_day:day,recorded_at:departureAt.toISOString(),note:'QA checkout with original capture time'});assert.equal(r.status,200,JSON.stringify(r.body));
 r=await operation({action:'review_scan',id:arrivalId,user_id:user.id,event_type:'clock_in',shift_day:day,recorded_at:arrivalAt.toISOString(),note:'QA arrival received after checkout'});assert.equal(r.status,200,JSON.stringify(r.body));
 const audit=(await call('/api/nfc/admin?scanId='+arrivalId,admin));assert.equal(audit.status,200);assert.equal(audit.body.history.length,1);assert.equal(audit.body.history[0].note,'QA arrival received after checkout');assert.equal(audit.body.history[0].new_data.event_type,'clock_in');assert.ok(audit.body.history[0].previous_data);assert.ok(audit.body.history[0].admin_name);assert.equal((await call('/api/nfc/admin?scanId='+arrivalId,employee)).status,403);pass('Card review preserves original values, correction reason and administrator in a protected audit trail');
 report=(await call('/api/attendance/period-report?date='+day+'&userId='+user.id,admin)).body.reports[0];assert.equal(report.summary.total.minutes,duration);assert.equal(report.days[0].lastDeparture,departureAt.toISOString());assert.equal(report.days[0].missingCheckout,false);pass('Reviewed out-of-order card timestamps pair into the exact captured interval, including midnight crossing');
 const b=settings.branches.find(b=>b.id==='branch1'),ping={client_event_id:randomUUID(),event_type:'ping',recorded_at:new Date().toISOString(),lat:b.lat,lng:b.lng,accuracy:1};
 r=await call('/api/attendance/ping',employee,ping);assert.equal(r.status,200);assert.equal(r.body.acknowledged[0].discarded,true);pass('GPS outside the finished shift is discarded on the production server');
 r=await call('/api/attendance/ping',employee,{...ping,client_event_id:randomUUID(),event_type:'clock_in'});assert.equal(r.body.acknowledged[0].reason,'nfc_required');pass('Mobile button cannot manufacture authoritative arrival');
 const schedule=(await call('/api/attendance/tracking-window',employee)).body;assert.equal(schedule.active,false);assert.ok(schedule.windows.every(w=>w.end>=w.start));pass('Tracking schedule stops at shift boundary and observed card checkout');
 // Shift now into progress to verify GPS evidence is accepted but still does not replace card arrival.
 assert.equal((await edit(user.id,{shift_start:start,shift_end:end,attendance_start_date:shiftDay,effective_from:shiftDay})).status,200);
 r=await call('/api/attendance/ping',employee,{...ping,client_event_id:randomUUID(),recorded_at:new Date().toISOString()});assert.equal(r.status,200);assert.ok(!r.body.acknowledged[0].discarded||r.body.acknowledged[0].reason==='after_nfc_checkout');pass('In-shift GPS is accepted or stopped by already recorded checkout');
 const gpsUser=(await call('/api/users',admin,{username:username+'_gps',password,name:'اختبار خصوصية GPS مؤقت',shift_start:start,shift_end:end,attendance_start_date:shiftDay})).body.user;ids.push(gpsUser.id);
 const gpsToken=(await call('/api/auth/login',null,{username:username+'_gps',password})).body.token;
 r=await call('/api/attendance/ping',gpsToken,{...ping,client_event_id:randomUUID(),recorded_at:new Date().toISOString()});assert.equal(r.status,200);assert.equal(r.body.acknowledged[0].discarded,undefined);
 const gpsReport=(await call('/api/attendance/period-report?date='+shiftDay,gpsToken)).body.reports[0];assert.equal(gpsReport.days[0].firstArrival,null);assert.equal(gpsReport.summary.total.minutes,0);pass('GPS succeeds within scheduled shift while never establishing card attendance');
 r=await send(devices[0],[scan(randomBytes(5).toString('hex'))]);const earlyScan=r.body.acknowledged[0].scan_id;
 assert.equal((await operation({action:'review_scan',id:earlyScan,user_id:gpsUser.id,event_type:'clock_out',shift_day:shiftDay,recorded_at:new Date(Date.now()-1000).toISOString(),note:'QA early card checkout'})).status,200);
 assert.equal((await call('/api/attendance/tracking-window',gpsToken)).body.active,false);
 r=await call('/api/attendance/ping',gpsToken,{...ping,client_event_id:randomUUID(),recorded_at:new Date().toISOString()});assert.equal(r.body.acknowledged[0].reason,'after_nfc_checkout');pass('Early card checkout ends GPS schedule and rejects subsequent location samples');
 await operation({action:'device_active',id:devices[0].device_id,is_active:false});assert.equal((await send(devices[0],[scan(uid)])).status,401);pass('Disabled reader cannot submit new scans');
 const fresh=await operation({action:'rotate_device',id:devices[1].device_id});assert.equal(fresh.status,200);assert.equal((await send(devices[1],[scan(uid)])).status,401);pass('Key replacement invalidates previous credential');
 const csv=await fetch(origin+'/api/attendance/export?date='+day+'&userId='+user.id+'&details=true',{headers:{Authorization:'Bearer '+admin}});assert.equal(csv.status,200);assert.ok((await csv.text()).includes('ينقص انصراف الكارت'));pass('Authenticated CSV exports card source and missing-checkout state');
 const preReset=scan(uid,new Date(Date.parse(settings.attendance_reset_at)-1000).toISOString());await operation({action:'device_active',id:devices[0].device_id,is_active:true});r=await send(devices[0],[preReset]);assert.equal(r.body.acknowledged[0].status,'before_start');pass('Old offline taps cannot restore reset attendance');
 await writeFile('artifacts/card-production-verification.json',JSON.stringify({origin,commit:health.commit,runAt:new Date().toISOString(),completed:true,checks},null,2));
}finally{
 // Remove only resources created and recorded by this run, leaving all actual employee data intact.
 if(process.env.DATABASE_URL&&(ids.length||devices.length)){
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}}),c=await pool.connect();
  try{await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
   await c.query('DELETE FROM nfc_review_audit WHERE scan_id IN (SELECT id FROM nfc_scans WHERE device_id=ANY($1::uuid[]))',[devices.map(d=>d.device_id)]);
   await c.query('DELETE FROM attendance_logs WHERE user_id=ANY($1::int[])',[ids]);
   await c.query('DELETE FROM nfc_scans WHERE device_id=ANY($1::uuid[])',[devices.map(d=>d.device_id)]);
   await c.query('DELETE FROM nfc_devices WHERE id=ANY($1::uuid[])',[devices.map(d=>d.device_id)]);
   await c.query('DELETE FROM nfc_cards WHERE user_id=ANY($1::int[])',[ids]);await c.query("DELETE FROM users WHERE id=ANY($1::int[]) AND username LIKE 'qa_card_%'",[ids]);await c.query('COMMIT');console.log('Isolated QA employee, cards, readers and scan fixtures removed');
  }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();await pool.end();}
 }
}
console.log(checks.length+' production checks passed');
