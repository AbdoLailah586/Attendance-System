import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

// This suite deliberately refuses localhost and preview URLs.
const origin='https://attendance-system-joe-2026.vercel.app';
const checks=[];
async function call(path,{method='GET',token,data}={}) {
  const response=await fetch(origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(45000)});
  let body;try{body=await response.json();}catch{body={};}
  return {status:response.status,body};
}
function pass(name){checks.push(name);console.log('PASS '+name);}
const adminCredentials={username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD};
if(!adminCredentials.username||!adminCredentials.password)throw new Error('Set QA_ADMIN_USERNAME and QA_ADMIN_PASSWORD. Credentials are never written to the report.');
let testId;
let adminToken;
try {
  const health=await call('/api/health');assert.equal(health.status,200);assert.equal(health.body.version,'attendance-mobile-v2');pass('Deployed release and database health');
  const anonymous=await call('/api/attendance/report');assert.equal(anonymous.status,401);pass('Anonymous report access denied');
  const login=await call('/api/auth/login',{method:'POST',data:adminCredentials});assert.equal(login.status,200);adminToken=login.body.token;
  const settingsResult=await call('/api/settings',{token:adminToken});assert.equal(settingsResult.status,200);const settings=settingsResult.body.settings;assert.ok(settings.branches.length>=2);pass('Admin login and branch settings');
  const users=await call('/api/users',{token:adminToken});assert.equal(users.status,200);assert.ok(users.body.users.every(u=>!Object.hasOwn(u,'password')));pass('Password data excluded from API');
  if(!process.argv.includes('--write-test-events')) { const live=await call('/api/attendance/live',{token:adminToken});assert.equal(live.status,200);const logs=await call('/api/attendance/logs',{token:adminToken});assert.equal(logs.status,200);pass('Admin radar and logs'); }
  else {
    const username='qa_sync_'+randomUUID().slice(0,8);const password=randomBytes(18).toString('base64url');
    const created=await call('/api/users',{method:'POST',token:adminToken,data:{username,password,name:'QA · اختبار مزامنة معزول',shift_start:'10:00',shift_end:'10:08'}});assert.equal(created.status,200);testId=created.body.user.id;
    const employee=await call('/api/auth/login',{method:'POST',data:{username,password}});assert.equal(employee.status,200);const token=employee.body.token;
    assert.equal((await call('/api/attendance/live',{token})).status,403);
    assert.equal((await call('/api/attendance/logs',{token})).status,403);
    assert.equal((await call('/api/branches',{method:'PUT',token,data:{branches:settings.branches}})).status,403);pass('Employee cannot read staff radar/logs or edit branches');
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const day=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10);
    // Ask the deployed database's Cairo rules through the offset in Intl (no host timezone assumption).
    const anchor=Date.parse(day+'T10:00:00Z');
    const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(anchor)).map(p=>[p.type,p.value]));
    const represented=Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
    const start=anchor-(represented-anchor);
    const b1=settings.branches.find(b=>b.id==='branch1'),b2=settings.branches.find(b=>b.id==='branch2');
    const outside={lat:b1.lat>80?b1.lat-5:b1.lat+5,lng:b1.lng};
    const events=Array.from({length:10},(_,minute)=>{
      const b=minute<2?b1:minute<4?outside:b2;
      return {client_event_id:randomUUID(),recorded_at:new Date(start+minute*60000).toISOString(),event_type:minute===0?'clock_in':minute===9?'clock_out':'ping',lat:b.lat,lng:b.lng,accuracy:3};
    });
    const invalid=await call('/api/attendance/ping',{method:'POST',token,data:{...events[0],lat:999}});assert.equal(invalid.status,400);pass('Invalid GPS rejected');
    const future=await call('/api/attendance/ping',{method:'POST',token,data:{...events[0],recorded_at:new Date(Date.now()+3600000).toISOString()}});assert.equal(future.status,400);pass('Future timestamps rejected');
    const saved=await call('/api/attendance/ping',{method:'POST',token,data:{events:[...events].reverse()}});assert.equal(saved.status,200);assert.equal(saved.body.acknowledged.length,10);pass('Offline batch accepts original timestamps and out-of-order delivery');
    const duplicate=await call('/api/attendance/ping',{method:'POST',token,data:{events}});assert.equal(duplicate.status,200);assert.ok(duplicate.body.acknowledged.every(a=>a.duplicate));pass('Retry acknowledges duplicates without inserting them');
    const personal=await call(`/api/attendance/report?date=${day}&userId=1`,{token});assert.equal(personal.status,200);assert.equal(personal.body.reports.length,1);const report=personal.body.reports[0];assert.equal(report.user.id,testId);assert.equal(report.logCount,10);assert.equal(report.summary.totalMinutes,7);assert.equal(report.summary.outsideMinutes,2);assert.equal(report.summary.overtimeMinutes,1);assert.equal(report.summary.unknownMinutes,0);assert.equal(report.exitCount,1);assert.equal(report.onDuty,false);assert.equal(report.punctuality.status,'on_time');pass('Cairo report: 7 minutes presence, 2 outside, 1 overtime; employee isolation');
    const audit=await call(`/api/attendance/logs?date=${day}&userId=${testId}`,{token:adminToken});assert.equal(audit.status,200);assert.equal(audit.body.logs.length,10);assert.ok(audit.body.logs.every(l=>Date.parse(l.received_at)>Date.parse(l.timestamp)));pass('Admin sees event time separately from receipt time');
    const demo=await call('/api/attendance/seed-demo',{method:'POST',token:adminToken});assert.equal(demo.status,410);pass('Destructive demo generator disabled');
  }
} finally {
  if(testId&&adminToken) {
    const disabled=await call(`/api/users?id=${testId}`,{method:'DELETE',token:adminToken});assert.equal(disabled.status,200);
    const users=await call('/api/users',{token:adminToken});assert.equal(users.body.users.find(u=>u.id===testId).is_active,false);pass('QA account deactivated; audit history retained');
  }
  await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/production-verification.json',JSON.stringify({origin,runAt:new Date().toISOString(),testUserId:testId||null,checks},null,2));
}
console.log(`${checks.length} checks passed against ${origin}`);
