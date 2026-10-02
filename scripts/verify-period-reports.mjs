import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
const origin='https://attendance-system-joe-2026.vercel.app',checks=[];
async function call(path,{method='GET',token,data}={}){
  const r=await fetch(origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{ }),...(data!==undefined?{'Content-Type':'application/json'}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(45000)});
  return {status:r.status,body:await r.json()};
}
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const add=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const day=add(today,-2),next=add(today,-1);
function time(d,h=10,m=0){
  const anchor=Date.parse(d+`T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00Z`);
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(anchor)).map(p=>[p.type,p.value]));
  return anchor-(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`)-anchor);
}
let token,id,employeeToken,completed=false,commit;
try{
  const health=await call('/api/health');assert.equal(health.status,200);commit=health.body.commit;pass('Production database and deployed release healthy');
  assert.equal((await call('/api/attendance/period-report')).status,401);pass('Anonymous period reports rejected');
  const login=await call('/api/auth/login',{method:'POST',data:{username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD}});assert.equal(login.status,200);token=login.body.token;
  const settings=(await call('/api/settings',{token})).body.settings;
  const username='qa_period_'+randomUUID().slice(0,8),password=randomBytes(18).toString('hex');
  const created=await call('/api/users',{method:'POST',token,data:{username,password,name:'QA · تقرير معزول',shift_start:'10:00',shift_end:'10:08',grace_period_mins:0,work_days:[0,1,2,3,4,5,6],cycle_start_day:15,attendance_start_date:add(today,-40)}});
  assert.equal(created.status,200);id=created.body.user.id;
  const employee=await call('/api/auth/login',{method:'POST',data:{username,password}});assert.equal(employee.status,200);employeeToken=employee.body.token;
  const b1=settings.branches.find(b=>b.id==='branch1'),b2=settings.branches.find(b=>b.id==='branch2');
  const events=[day,next].flatMap(d=>Array.from({length:10},(_,i)=>({client_event_id:randomUUID(),recorded_at:new Date(time(d)+i*60000).toISOString(),event_type:i===0?'clock_in':i===9?'clock_out':'ping',lat:i<2?b1.lat:i<4?b1.lat+1:b2.lat,lng:i<4?b1.lng:b2.lng,accuracy:1})));
  assert.equal((await call('/api/attendance/ping',{method:'POST',token:employeeToken,data:{events:[...events].reverse()}})).status,200);
  const report=async params=>{const r=await call('/api/attendance/period-report?'+params,{token});assert.equal(r.status,200);return r.body.reports.find(u=>u.user.id===id);};
  const daily=await report(`mode=daily&date=${day}&userId=${id}`);
  assert.equal(daily.summary.total.minutes,7);assert.equal(daily.summary.outside.minutes,2);assert.equal(daily.summary.overtime.minutes,1);assert.equal(daily.summary.presentDays,1);assert.equal(daily.summary.branches.find(b=>b.id==='branch1').minutes,2);assert.equal(daily.summary.branches.find(b=>b.id==='branch2').minutes,5);pass('Daily real event aggregation splits primary/wholesale branches, outside and overtime');
  const custom=await report(`mode=custom&start=${day}&end=${next}&userId=${id}`);assert.equal(custom.summary.total.minutes,14);assert.equal(custom.summary.presentDays,2);assert.equal(custom.summary.overtime.minutes,2);pass('Custom inclusive date range sums two days without duplicate minutes');
  const weekly=await report(`mode=weekly&start=${day}&userId=${id}`);assert.equal(weekly.days.length,7);assert.equal(weekly.summary.presentDays,2);assert.equal(weekly.summary.absentDays,weekly.days.filter(d=>![day,next].includes(d.date)&&time(d.date,10,8)<Date.now()).length);assert.ok(weekly.days.some(d=>d.status==='upcoming'));pass('Weekly range has seven days and future days are not absences');
  const monthly=await report(`mode=monthly&date=${today}&userId=${id}`);assert.equal(monthly.start,'2026-09-15');assert.equal(monthly.end,'2026-10-14');assert.equal(monthly.summary.presentDays,2);pass('Employee month cycle starts on day 15 and ends on next day 14');
  for(const cycle of [28,29,30,31]){
    assert.equal((await call('/api/users',{method:'PUT',token,data:{id,cycle_start_day:cycle,effective_from:add(today,-300)}})).status,200);
    const feb=await report(`mode=monthly&date=2026-02-28&userId=${id}`);assert.equal(feb.start,'2026-02-28');assert.equal(feb.end,`2026-03-${String(cycle-1).padStart(2,'0')}`);
  }pass('Month days 28–31 clamp correctly in February with no overlap');
  const offDay=add(day,-1),offWeekday=new Date(offDay+'T12:00:00Z').getUTCDay();
  assert.equal((await call('/api/users',{method:'PUT',token,data:{id,work_days:[0,1,2,3,4,5,6].filter(d=>d!==offWeekday),cycle_start_day:15,effective_from:offDay}})).status,200);
  const rest=await report(`mode=daily&date=${offDay}&userId=${id}`);assert.equal(rest.summary.offDays,1);assert.equal(rest.summary.absentDays,0);pass('Per-employee weekly rest days do not count as absence');
  const absence=await report(`mode=daily&date=${add(day,-2)}&userId=${id}`);assert.equal(absence.summary.absentDays,1);pass('Completed scheduled day without events counts as absence');
  const before=await report(`mode=daily&date=${add(today,-41)}&userId=${id}`);assert.equal(before.summary.absentDays,0);assert.equal(before.days[0].status,'untracked');pass('Days before employee attendance start excluded from absence');
  const changed=await call('/api/users',{method:'PUT',token,data:{id,name:'QA · بروفايل معدل',username:username+'_new',phone:'',shift_start:'11:00',shift_end:'12:00',work_days:[0,1,2,3,4,5,6],grace_period_mins:5,cycle_start_day:20,effective_from:today}});assert.equal(changed.status,200);assert.equal(changed.body.user.username,username+'_new');
  const history=await report(`mode=daily&date=${day}&userId=${id}`);assert.equal(history.days[0].policy.shift_start,'10:00');assert.equal(history.summary.total.minutes,7);assert.equal(history.summary.overtime.minutes,1);
  const current=await report(`mode=daily&date=${today}&userId=${id}`);assert.equal(current.days[0].policy.shift_start,'11:00');assert.equal(current.days[0].policy.grace_period_mins,5);pass('Profile editing stores effective dated rules while preserving previous days');
  const isolated=await call(`/api/attendance/period-report?mode=custom&start=${day}&end=${next}&userId=1`,{token:employeeToken});assert.equal(isolated.status,200);assert.equal(isolated.body.reports.length,1);assert.equal(isolated.body.reports[0].user.id,id);pass('Employee period reports restricted to own account');
  assert.equal((await call('/api/users',{method:'PUT',token:employeeToken,data:{id,name:'blocked'}})).status,403);pass('Employees cannot edit account profiles or permissions');
  assert.equal((await call('/api/users',{method:'PUT',token,data:{id,role:'admin'}})).status,200);assert.equal((await call('/api/attendance/live',{token:employeeToken})).status,200);
  assert.equal((await call('/api/users',{method:'PUT',token,data:{id,role:'employee'}})).status,200);assert.equal((await call('/api/attendance/live',{token:employeeToken})).status,403);pass('Role changes immediately change permissions on existing sessions');
  const users=(await call('/api/users',{token})).body.users;const admin=users.find(u=>u.username===process.env.QA_ADMIN_USERNAME);
  if(users.filter(u=>u.role==='admin'&&u.is_active).length===1){assert.equal((await call('/api/users',{method:'PUT',token,data:{id:admin.id,is_active:false}})).status,409);pass('Last active administrator cannot be disabled');}
  for(const params of ['mode=custom&start=2026-10-03&end=2026-10-01','mode=custom&start=2024-01-01&end=2026-01-01','mode=invalid','mode=daily&date=2026-02-30'])assert.equal((await call('/api/attendance/period-report?'+params,{token})).status,400);
  assert.equal((await call('/api/users',{method:'PUT',token,data:{id,cycle_start_day:32}})).status,400);assert.equal((await call('/api/users',{method:'PUT',token,data:{id,work_days:[7]}})).status,400);pass('Invalid ranges, cycle days and work weekdays rejected');
  assert.equal((await call('/api/attendance/seed-demo',{method:'POST',token})).status,410);pass('Demo generator remains disabled');
  const after=(await call('/api/settings',{token})).body.settings;assert.equal(after.branch1_lat,settings.branch1_lat);assert.equal(after.branch2_lat,settings.branch2_lat);assert.equal(after.branch1_radius,20);assert.equal(after.branch2_radius,20);pass('Actual branch locations and 20 metre geofences preserved');
  completed=true;
}finally{
  if(id&&token){assert.equal((await call(`/api/users?id=${id}`,{method:'DELETE',token})).status,200);pass('Isolated QA account disabled after production checks');}
  await mkdir('artifacts',{recursive:true});await writeFile('artifacts/period-report-verification.json',JSON.stringify({origin,commit,runAt:new Date().toISOString(),completed,testUserId:id,checks},null,2));
}
console.log(`${checks.length} production checks passed`);
