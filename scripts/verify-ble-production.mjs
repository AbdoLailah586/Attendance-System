import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

// Every HTTP check targets the actual Vercel deployment. Direct database writes
// below age only this run's isolated fixtures to cover outages without a long wait.
const origin = 'https://attendance-system-joe-2026.vercel.app';
assert.ok(process.env.DATABASE_URL, 'Cloud database required for isolated fixture cleanup');
assert.ok(process.env.QA_ADMIN_USERNAME && process.env.QA_ADMIN_PASSWORD, 'QA administrator login required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const users = [], devices = [], tags = [], checks = [];
let admin, token, reader, tag, user, boot = randomUUID();
const timelineBoot = boot;
let captureClockOffset = 0;
const captureNow = () => new Date(Date.now() + captureClockOffset);
const pass = name => { checks.push(name); console.log('PASS ' + name); };
const date = at => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const time = at => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
const address = () => ('F2' + randomBytes(5).toString('hex')).toUpperCase().match(/.{2}/g).join(':');
async function call(path, credential, data, method = data ? 'POST' : 'GET') {
  const response = await fetch(origin + path, { method, headers: { ...(credential ? { Authorization: 'Bearer ' + credential } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(45000) });
  return { status: response.status, body: await response.json() };
}
const operation = body => call('/api/ble/admin', admin, body);
const config = credential => call('/api/ble/config?device_id=' + reader.device_id, credential ?? reader.token);
const event = (state, at = captureNow(), extra = {}) => ({ event_id: randomUUID(), tag_address: tag.address, state, recorded_at: at.toISOString(), boot_id: boot, ...(state === 'seen' ? { rssi: -55 } : {}), ...extra });
const send = (events = [], state = 'ready', at = captureNow(), extra = {}, credential) => call('/api/ble/events', credential ?? reader.token,
  { device_id: reader.device_id, boot_id: boot, receiver_state: state, heartbeat_at: at.toISOString(), events, ...extra });
const scan = (uid, at = captureNow()) => call('/api/nfc/events', reader.token, { device_id: reader.device_id, events: [{ event_id: randomUUID(), card_uid: uid, recorded_at: at.toISOString() }] });
const getAdmin = async () => {
  const response = await call('/api/ble/admin?from_day=' + date(base) + '&to_day=' + date(new Date()) + '&user_id=' + user.id, admin);
  assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body;
};
const currentObservation = data => data.tags.find(t => t.id === tag.id)?.observations.find(o => o.device_id === reader.device_id);
const base = new Date(Date.now() - 10 * 60000);
async function createUser(suffix) {
  const username = 'qa_ble_' + randomBytes(5).toString('hex') + suffix, password = randomBytes(12).toString('hex');
  const response = await call('/api/users', admin, { username, password, name: 'اختبار بلوتوث مؤقت ' + suffix,
    shift_start: time(new Date(Date.now() - 3600000)), shift_end: time(new Date(Date.now() + 4 * 3600000)), checkout_open_time: time(new Date(+base + 60000)),
    attendance_start_date: date(new Date(Date.now() - 86400000)), work_days: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(response.status, 200, JSON.stringify(response.body)); users.push(response.body.user.id);
  const login = await call('/api/auth/login', null, { username, password }); assert.equal(login.status, 200);
  return { user: response.body.user, token: login.body.token };
}
function parseCsv(text) {
  const rows=[]; let row=[],cell='',quoted=false;
  const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i++) {
    const char=input[i];
    if(char==='"') { if(quoted&&input[i+1]==='"'){cell+='"';i++;}else quoted=!quoted; }
    else if(char===','&&!quoted){row.push(cell);cell='';}
    else if((char==='\r'||char==='\n')&&!quoted){row.push(cell);rows.push(row);row=[];cell='';if(char==='\r'&&input[i+1]==='\n')i++;}
    else cell+=char;
  }
  if(cell.length||row.length){row.push(cell);rows.push(row);}
  return rows;
}
const summaryKeys=['observed_seconds','not_seen_seconds','unknown_seconds','session_seconds'];
function verifyBleSummary(row,expected,label) {
  assert.equal(row.ble_has_history,true,label+' retains tag history'); assert.equal(row.ble_truncated,false,label+' is not truncated');
  assert.ok(Array.isArray(row.ble_branches),label+' has branch observations');
  for(const key of summaryKeys){assert.ok(Number.isFinite(row.ble_summary?.[key]),label+' '+key);assert.ok(row.ble_summary[key]>=0);if(expected)assert.ok(Math.abs(row.ble_summary[key]-expected[key])<0.001,label+' '+key+' matches the daily union');}
  assert.ok(Math.abs(row.ble_summary.session_seconds-row.ble_summary.observed_seconds-row.ble_summary.not_seen_seconds-row.ble_summary.unknown_seconds)<0.001,label+' elapsed time is counted once');
}

try {
  const login = await call('/api/auth/login', null, { username: process.env.QA_ADMIN_USERNAME, password: process.env.QA_ADMIN_PASSWORD });
  assert.equal(login.status, 200); admin = login.body.token;
  const health = (await call('/api/health')).body;
  assert.equal((await call('/api/ble/admin', null)).status, 403);
  assert.equal((await call('/api/ble/admin', null, { action: 'assign_tag' })).status, 403); pass('BLE management requires administrator access');
  assert.equal((await call('/api/ble/self', null)).status, 401);
  assert.equal((await call('/api/ble/self', admin)).status, 401); pass('Employee presence requires an active employee session');
  const made = await call('/api/nfc/admin', admin, { action: 'create_device', name: 'QA BLE ' + randomBytes(4).toString('hex'), branch_id: 'branch2' });
  assert.equal(made.status, 200); reader = made.body; devices.push(reader.device_id);
  ({ user, token } = await createUser('one'));
  const second = await createUser('two');
  assert.equal((await call('/api/ble/admin', token)).status, 403);
  assert.equal((await call('/api/ble/admin', token, { action: 'assign_tag' })).status, 403);
  assert.equal((await config(token)).status, 401); pass('Employee credentials cannot administer BLE or impersonate a receiver');
  let ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.user.id,user.id); assert.equal(ownPresence.tracking_mode,'gps'); assert.equal(ownPresence.state,'off_shift');
  assert.deepEqual(ownPresence.tags,[]); assert.equal(ownPresence.summary.session_seconds,0);
  assert.equal((await call('/api/ble/self?userId='+second.user.id,token)).status,403);
  assert.equal((await call('/api/ble/self?user_id='+user.id,second.token)).status,403);
  pass('Employee self presence is isolated and unassigned users retain GPS mode');
  const initialConfig = await config(); assert.equal(initialConfig.status, 200);
  // Windows wall time can run ahead of UTC. Use the deployment's clock for
  // synthetic captures, conservatively behind the response by half a second.
  // Keep this offset fixed so adjacent state transitions remain monotonic.
  captureClockOffset = Date.parse(initialConfig.body.server_time) - Date.now() - 500;
  assert.equal((await config('B'.repeat(43))).status, 401);
  assert.equal((await call('/api/ble/config?device_id=bad', reader.token)).status, 400); pass('Receiver configuration validates reader ID and device token');
  tag = { address: address() };
  const unknown = event('seen', new Date(+base - 30000));
  let result = await send([unknown], 'ready', new Date(+base - 30000));
  assert.equal(result.status, 200); assert.equal(result.body.acknowledged[0].status, 'unknown_tag');
  result = await send([unknown]); assert.equal(result.body.acknowledged[0].duplicate, true);
  const original = (await pool.query('SELECT * FROM ble_events WHERE device_id=$1 AND event_id=$2', [reader.device_id, unknown.event_id])).rows;
  assert.equal(original.length, 1); assert.equal(original[0].user_id, null); assert.equal(original[0].branch_id, 'branch2');
  assert.equal(+new Date(original[0].recorded_at), +base - 30000); assert.ok(+new Date(original[0].received_at) > +base);
  pass('Unknown tag diagnostics retain capture/receipt times and acknowledge retries once');
  const unknownAdmin = await call('/api/ble/admin', admin);
  assert.ok(unknownAdmin.body.unknown_tags.some(t => t.tag_address === tag.address)); pass('Unassigned hardware appears for administrator binding without selecting an employee');
  result = await operation({ action: 'assign_tag', address: tag.address.toLowerCase(), user_id: user.id, grace_seconds: 90 });
  assert.equal(result.status, 200, JSON.stringify(result.body)); tag = result.body.tag; tags.push(tag.id);
  await pool.query('UPDATE ble_tags SET assigned_at=$2 WHERE id=$1 AND user_id=$3', [tag.id, new Date(+base - 10000), user.id]);
  assert.equal((await operation({ action: 'assign_tag', address: tag.address, user_id: user.id })).status, 409);
  const afterBinding = (await pool.query('SELECT user_id,status FROM ble_events WHERE device_id=$1 AND event_id=$2', [reader.device_id, unknown.event_id])).rows[0];
  assert.equal(afterBinding.user_id, null); assert.equal(afterBinding.status, 'unknown_tag'); pass('Binding is normalized, exclusive and does not rewrite unknown historical scans');
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.tracking_mode,'ble'); assert.equal(ownPresence.tags.length,1); assert.equal(ownPresence.tags[0].id,tag.id); assert.equal(ownPresence.session.active,false);
  let nativeSchedule=(await call('/api/attendance/tracking-window',token)).body;
  assert.equal(nativeSchedule.source,'ble'); assert.equal(nativeSchedule.active,false); assert.deepEqual(nativeSchedule.windows,[]);
  assert.deepEqual((await call('/api/ble/self',second.token)).body.tags,[]);
  pass('Tag assignment disables GPS windows for old native apps without exposing another employee tag');
  result = await config(); assert.equal(result.body.tags.find(t => t.address === tag.address).enabled, false);
  result = await send([event('seen')]); assert.equal(result.body.acknowledged[0].status, 'outside_session');
  let stored = (await pool.query('SELECT user_id FROM ble_events WHERE device_id=$1 ORDER BY id DESC LIMIT 1', [reader.device_id])).rows[0];
  assert.equal(stored.user_id, null); pass('Without NFC arrival, assigned tags remain disabled and raw events have no employee identity');
  const uid = randomBytes(7).toString('hex').toUpperCase();
  assert.equal((await call('/api/nfc/admin', admin, { action: 'assign_card', uid, user_id: user.id })).status, 200);
  await pool.query('UPDATE nfc_cards SET assigned_at=$2 WHERE uid=$1 AND user_id=$3', [uid, new Date(+base - 1000), user.id]);
  result = await scan(uid, base); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.acknowledged[0].event_type, 'clock_in');
  result = await config(); const setting = result.body.tags.find(t => t.address === tag.address);
  assert.equal(setting.enabled, true); assert.equal(setting.tracking_active, true); assert.ok(Date.parse(setting.tracking_until) > Date.now());
  pass('Official NFC arrival opens BLE configuration with an explicit tracking deadline');
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.session.active,true); assert.equal(ownPresence.session.state,'active'); assert.equal(Date.parse(ownPresence.session.from),+base);
  assert.equal(ownPresence.session.missing_checkout,false);
  nativeSchedule=(await call('/api/attendance/tracking-window',token)).body;
  assert.equal(nativeSchedule.card_session_active,true); assert.equal(nativeSchedule.active,false); assert.deepEqual(nativeSchedule.windows,[]);
  pass('NFC session remains visible in BLE mode while native GPS collection stays disabled');
  assert.equal((await operation({ action: 'set_grace', id: tag.id, grace_seconds: 30 })).status, 400);
  assert.equal((await operation({ action: 'set_grace', id: tag.id, grace_seconds: 600 })).status, 200);
  assert.equal((await config()).body.tags.find(t => t.address === tag.address).grace_seconds, 600);
  assert.equal((await operation({ action: 'set_grace', id: tag.id, grace_seconds: 90 })).status, 200); pass('Administrator grace setting is editable and constrained to 60–600 seconds');
  assert.equal((await send([event('seen')], 'ready', captureNow(), {}, 'B'.repeat(43))).status, 401);
  assert.equal((await send([event('seen', captureNow(), { tag_address: 'not-a-tag' })])).status, 400);
  assert.equal((await send([event('seen', captureNow(), { event_id: 'bad' })])).status, 400);
  assert.equal((await send([event('seen', captureNow(), { rssi: -200 })])).status, 400);
  assert.equal((await send([event('seen', new Date(+captureNow() + 180000))])).status, 400);
  assert.equal((await send(Array.from({ length: 101 }, () => event('seen')))).status, 400);
  pass('Invalid credentials, addresses, event IDs, RSSI, future clocks and oversized batches are rejected');
  // Remove only this QA receiver's earlier diagnostic heartbeats before its controlled timeline.
  await pool.query('DELETE FROM ble_receiver_heartbeats WHERE device_id=$1', [reader.device_id]);
  for (let seconds = 0; seconds <= 330; seconds += 30) {
    const at = new Date(+base + seconds * 1000);
    const state = seconds === 210 || seconds === 240 ? 'fault' : 'ready';
    const events = seconds === 210 || seconds === 240 || seconds === 270 ? [] : [event(seconds < 120 || seconds >= 300 ? 'seen' : 'not_seen', at)];
    result = await send(events, state, at, { branch_id: 'branch1' }); assert.equal(result.status, 200, JSON.stringify(result.body));
    if (events.length) assert.equal(result.body.acknowledged[0].status, 'accepted');
  }
  await pool.query('UPDATE ble_receiver_heartbeats SET received_at=recorded_at WHERE device_id=$1', [reader.device_id]);
  let data = await getAdmin(), report = data.reports.find(r => r.device_id === reader.device_id);
  assert.ok(report); assert.equal(report.not_seen_seconds, 90); assert.equal(report.observed_seconds, 240); assert.ok(report.unknown_seconds >= 180);
  assert.ok(Math.abs(report.session_seconds - report.observed_seconds - report.not_seen_seconds - report.unknown_seconds) < 0.001);
  stored = (await pool.query('SELECT DISTINCT branch_id FROM ble_events WHERE device_id=$1', [reader.device_id])).rows;
  assert.deepEqual(stored.map(r => r.branch_id), ['branch2']);
  pass('Captured BLE timeline uses reader branch and counts explicit loss once without adding a second grace');
  pass('Faults, recovery without a fresh tag reading and stale receiver periods remain unknown inside card sessions');
  let at = captureNow(); result = await send([event('seen', at)], 'ready', at); assert.equal(result.status, 200);
  data = await getAdmin(); assert.equal(currentObservation(data).state, 'seen'); assert.equal(currentObservation(data).in_card_session, true);
  ownPresence=(await call('/api/ble/self',token)).body; assert.equal(ownPresence.state,'seen'); assert.equal(ownPresence.branch_id,'branch2');
  assert.equal(ownPresence.user.id,user.id); assert.ok(ownPresence.captured_at); assert.equal(ownPresence.tags[0].id,tag.id);
  const live=(await call('/api/attendance/live',admin)).body.employees.find(employee=>employee.user.id===user.id);
  assert.equal(live.presence_source,'ble'); assert.equal(live.ble.state,'seen'); assert.equal(live.latestLog,null);
  pass('Live and employee views use BLE evidence without fabricating GPS coordinates');
  const repeat = event('seen', captureNow()); result = await send([repeat]); assert.equal(result.status, 200);
  result = await send([repeat]); assert.equal(result.body.acknowledged[0].duplicate, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ble_events WHERE device_id=$1 AND event_id=$2', [reader.device_id, repeat.event_id])).rows[0].n, 1);
  pass('Fresh connected-tag observation appears live and repeated upload is idempotent');
  result = await send([], 'fault'); assert.equal(result.status, 200); data = await getAdmin(); assert.equal(currentObservation(data).state, 'unknown');
  result = await send([], 'ready'); assert.equal(result.status, 200); data = await getAdmin(); assert.equal(currentObservation(data).state, 'unknown');
  at = captureNow(); result = await send([event('not_seen', at)], 'ready', at); assert.equal(result.status, 200);
  data = await getAdmin(); assert.equal(currentObservation(data).state, 'not_seen'); pass('Reader fault overrides tag state and recovery requires a fresh explicit observation');
  const secondaryResult=await call('/api/nfc/admin',admin,{action:'create_device',name:'QA BLE union '+randomBytes(4).toString('hex'),branch_id:'branch1'});
  assert.equal(secondaryResult.status,200); const secondary=secondaryResult.body; devices.push(secondary.device_id);
  const secondaryBoot=randomUUID(),bothAt=captureNow();
  const uploadSecondary=await call('/api/ble/events',secondary.token,{device_id:secondary.device_id,boot_id:secondaryBoot,receiver_state:'ready',heartbeat_at:bothAt.toISOString(),events:[event('seen',bothAt,{boot_id:secondaryBoot})]});
  assert.equal(uploadSecondary.status,200);
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.receivers.find(receiver=>receiver.id===reader.device_id).state,'not_seen');
  assert.equal(ownPresence.state,'seen'); assert.equal(ownPresence.branch_id,'branch1');
  at=captureNow(); assert.equal((await send([event('seen',at)],'ready',at)).status,200);
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.state,'seen'); assert.equal(ownPresence.branch_id,null); assert.equal(ownPresence.observed_branches.length,2);
  const branchSeen=ownPresence.branches.reduce((sum,branch)=>sum+branch.observed_seconds,0);
  assert.ok(branchSeen>ownPresence.summary.observed_seconds);
  assert.ok(Math.abs(ownPresence.summary.session_seconds-ownPresence.summary.observed_seconds-ownPresence.summary.not_seen_seconds-ownPresence.summary.unknown_seconds)<0.001);
  pass('A second branch seen overrides first-branch loss and overlapping branch observations count once');
  const faultAt=captureNow();
  assert.equal((await call('/api/ble/events',secondary.token,{device_id:secondary.device_id,boot_id:secondaryBoot,receiver_state:'fault',heartbeat_at:faultAt.toISOString(),events:[]})).status,200);
  at=captureNow(); assert.equal((await send([event('not_seen',at)],'ready',at)).status,200);
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.state,'unknown');
  pass('Unobserved tag at one reader cannot imply global absence while another configured reader has a fault');
  boot = randomUUID(); result = await send(); assert.equal(result.status, 200); data = await getAdmin(); assert.equal(currentObservation(data).state, 'unknown');
  at = captureNow(); result = await send([event('seen', at)], 'ready', at); assert.equal(result.status, 200);
  data = await getAdmin(); assert.equal(currentObservation(data).state, 'seen'); pass('Reboot cannot reuse observations from the previous receiver boot');
  await pool.query("UPDATE ble_receiver_heartbeats SET recorded_at=NOW()-INTERVAL '91 seconds',received_at=NOW()-INTERVAL '91 seconds' WHERE device_id=$1 AND recorded_at>NOW()-INTERVAL '90 seconds'", [reader.device_id]);
  data = await getAdmin(); assert.equal(data.devices.find(d => d.id === reader.device_id).receiver_state, 'stale'); assert.equal(currentObservation(data).state, 'unknown');
  pass('Receiver/network heartbeat loss becomes unknown rather than inferred absence');
  await pool.query("UPDATE attendance_logs SET tracking_deadline=NOW()-INTERVAL '1 second' WHERE user_id=$1 AND source='nfc' AND event_type='clock_in'", [user.id]);
  assert.equal((await config()).body.tags.find(t => t.address === tag.address).enabled, false);
  const expiredPresence=(await call('/api/ble/self',token)).body;
  assert.equal(expiredPresence.session.state,'expired'); assert.equal(expiredPresence.session.missing_checkout,true);
  result = await send([event('seen')]); assert.equal(result.body.acknowledged[0].status, 'outside_session');
  await pool.query("UPDATE attendance_logs SET tracking_deadline=timestamp+INTERVAL '12 hours' WHERE user_id=$1 AND source='nfc' AND event_type='clock_in'", [user.id]);
  pass('Maximum tracking cap disables BLE tracking without manufacturing an NFC checkout');
  result = await scan(uid); assert.equal(result.status, 200, JSON.stringify(result.body)); assert.equal(result.body.acknowledged[0].event_type, 'clock_out');
  assert.equal((await config()).body.tags.find(t => t.address === tag.address).enabled, false);
  result = await send([event('seen')]); assert.equal(result.body.acknowledged[0].status, 'outside_session');
  data = await getAdmin(); assert.equal(currentObservation(data).in_card_session, false);
  ownPresence=(await call('/api/ble/self',token)).body;
  assert.equal(ownPresence.session.active,false); assert.equal(ownPresence.session.state,'closed'); assert.equal(ownPresence.state,'off_shift');
  assert.ok(ownPresence.session.lastDeparture); assert.equal(ownPresence.tracking_mode,'ble');
  const beforeEnd = data.reports.find(r => r.device_id === reader.device_id).session_seconds;
  result = await send([event('seen')]); assert.equal(result.status, 200);
  assert.equal((await getAdmin()).reports.find(r => r.device_id === reader.device_id).session_seconds, beforeEnd);
  pass('NFC checkout stops interpretation and subsequent diagnostics cannot extend employee hours');
  const rule=(await pool.query("SELECT to_char(shift_day,'YYYY-MM-DD') AS shift_day,to_char(business_day,'YYYY-MM-DD') AS business_day FROM nfc_day_rules WHERE user_id=$1 ORDER BY business_day DESC LIMIT 1",[user.id])).rows[0];
  const closed=(await pool.query("SELECT timestamp FROM attendance_logs WHERE user_id=$1 AND source='nfc' AND event_type='clock_out' ORDER BY timestamp DESC LIMIT 1",[user.id])).rows[0];
  const dailyResponse=await call('/api/attendance/report?date='+rule.shift_day+'&userId='+user.id,admin);
  assert.equal(dailyResponse.status,200,JSON.stringify(dailyResponse.body)); const daily=dailyResponse.body.reports.find(report=>report.user.id===user.id);
  verifyBleSummary(daily,null,'Daily report'); const expectedSummary=daily.ble_summary;
  assert.ok(Math.abs(expectedSummary.session_seconds-(+new Date(closed.timestamp)-+base)/1000)<0.001);
  assert.ok(expectedSummary.observed_seconds>0);
  assert.ok(daily.ble_branches.reduce((sum,branch)=>sum+branch.observed_seconds,0)>expectedSummary.observed_seconds);
  pass('Original daily report carries BLE union hours and preserves official NFC elapsed time');
  for(const mode of ['daily','weekly','monthly','custom']) {
    const parameters=new URLSearchParams({mode,date:rule.shift_day,userId:String(user.id)});
    if(mode==='weekly')parameters.set('start',rule.shift_day);
    if(mode==='custom'){parameters.set('start',rule.shift_day);parameters.set('end',rule.shift_day);}
    const response=await call('/api/attendance/period-report?'+parameters,admin);
    assert.equal(response.status,200,JSON.stringify(response.body)); const period=response.body.reports.find(report=>report.user.id===user.id);
    verifyBleSummary(period,expectedSummary,mode+' period');
    const day=period.days.find(item=>item.date===rule.shift_day); assert.ok(day); verifyBleSummary(day,expectedSummary,mode+' day row');
    for(const item of period.days.filter(item=>item.date>rule.shift_day)) { assert.equal(item.ble_summary.session_seconds,0); assert.equal(item.ble_has_history,false); }
  }
  pass('Daily, weekly, monthly and custom reports share the same BLE union and correctly scoped daily rows');
  const dayClose=await call('/api/attendance/day-close?date='+rule.business_day,admin);
  assert.equal(dayClose.status,200,JSON.stringify(dayClose.body));
  verifyBleSummary(dayClose.body.reports.find(report=>report.user.id===user.id),expectedSummary,'Day-close report');
  pass('End-of-day report includes NFC-scoped BLE observed, unobserved and unknown durations');
  for(const details of [false,true]) {
    const url='/api/attendance/export?mode=daily&date='+rule.shift_day+'&userId='+user.id+(details?'&details=true':'');
    const response=await fetch(origin+url,{headers:{Authorization:'Bearer '+admin},signal:AbortSignal.timeout(45000)});
    assert.equal(response.status,200); assert.ok(response.headers.get('content-type').includes('text/csv'));
    const csv=parseCsv(await response.text()),header=csv[0],row=csv.find((item,index)=>index>0&&item[header.indexOf('اسم الدخول')]===user.username);
    assert.ok(row); assert.equal(row[header.indexOf('رصد BLE متاح')],'نعم'); assert.equal(row[header.indexOf('بيانات BLE محدودة')],'لا');
    const columns=['التاج مرصود بالدقائق','التاج غير مرصود بالدقائق','فجوات BLE بالدقائق','فترة متابعة الكارت BLE بالدقائق'];
    columns.forEach((column,index)=>{assert.ok(header.includes(column));assert.equal(Number(row[header.indexOf(column)]),Math.round(expectedSummary[summaryKeys[index]]/60*100)/100);});
    for(const branch of daily.ble_branches){const column='رصد BLE في '+branch.name+' بالدقائق';assert.ok(header.includes(column));assert.equal(Number(row[header.indexOf(column)]),Math.round(branch.observed_seconds/60*100)/100);}
    if(details)assert.equal(row[header.indexOf('التاريخ')],rule.shift_day);
  }
  pass('Summary and detail CSV exports contain correctly rounded BLE union and branch values');
  const isolatedReport=await call('/api/attendance/period-report?mode=daily&date='+rule.shift_day+'&userId='+user.id,second.token);
  assert.equal(isolatedReport.status,200); assert.equal(isolatedReport.body.reports.length,1); assert.equal(isolatedReport.body.reports[0].user.id,second.user.id);
  assert.equal(isolatedReport.body.reports[0].ble_summary.session_seconds,0);
  pass('Employee report queries cannot expose another employee BLE supplement');
  assert.equal((await operation({ action: 'revoke_tag', id: tag.id })).status, 200);
  result = await operation({ action: 'assign_tag', address: tag.address, user_id: second.user.id }); assert.equal(result.status, 200); tags.push(result.body.tag.id);
  const delayed = event('seen', new Date(+base + 70000), { boot_id: timelineBoot }); result = await send([delayed]); assert.equal(result.status, 200);
  const historical = (await pool.query('SELECT user_id,tag_assignment_id,boot_id FROM ble_events WHERE device_id=$1 AND event_id=$2', [reader.device_id, delayed.event_id])).rows[0];
  assert.equal(historical.user_id, user.id); assert.equal(historical.tag_assignment_id, tag.id);
  assert.equal(historical.boot_id, timelineBoot);
  assert.equal((await operation({ action: 'set_grace', id: tag.id, grace_seconds: 90 })).status, 404);
  pass('Reassignment preserves capture-time ownership for delayed offline events');
  assert.equal((await call('/api/ble/self',token)).body.tracking_mode,'gps');
  const secondPresence=(await call('/api/ble/self',second.token)).body;
  assert.equal(secondPresence.tracking_mode,'ble'); assert.equal(secondPresence.tags[0].id,result.body.tag?.id || tags.at(-1));
  assert.equal(secondPresence.summary.session_seconds,0); assert.equal(secondPresence.captured_at,null);
  const secondUid=randomBytes(7).toString('hex').toUpperCase();
  assert.equal((await call('/api/nfc/admin',admin,{action:'assign_card',uid:secondUid,user_id:second.user.id})).status,200);
  await pool.query('UPDATE nfc_cards SET assigned_at=$2 WHERE uid=$1 AND user_id=$3',[secondUid,new Date(+captureNow()-10000),second.user.id]);
  assert.equal((await scan(secondUid)).body.acknowledged[0].event_type,'clock_in');
  assert.equal((await call('/api/attendance/tracking-window',second.token)).body.source,'ble');
  assert.equal((await operation({action:'revoke_tag',id:tags.at(-1)})).status,200);
  const restored=(await call('/api/attendance/tracking-window',second.token)).body;
  assert.equal(restored.source,'gps'); assert.equal(restored.active,true); assert.ok(restored.windows.length>0);
  pass('Reassignment does not leak prior employee history and revocation restores NFC-limited GPS windows');
  assert.equal((await call('/api/ble/admin?from_day=bad', admin)).status, 400);
  assert.equal((await call('/api/ble/admin?page=0', admin)).status, 400);
  assert.equal((await call('/api/ble/admin?from_day=2026-01-01&to_day=2026-03-01', admin)).status, 400); pass('Administrator period and page validation prevents invalid reports');
  const official = (await pool.query("SELECT event_type,count(*)::int AS n FROM attendance_logs WHERE user_id=$1 AND source='nfc' GROUP BY event_type", [user.id])).rows;
  assert.equal(official.length, 2); assert.ok(official.every(r => r.n === 1));
  const mobileLogs = (await pool.query("SELECT count(*)::int AS n FROM attendance_logs WHERE user_id=$1 AND source<>'nfc'", [user.id])).rows[0].n;
  assert.equal(mobileLogs, 0); pass('BLE creates no attendance actions, GPS logs or wage deductions');
  await writeFile('artifacts/ble-production-verification.json', JSON.stringify({ origin, commit: health.commit, run_at: new Date().toISOString(), completed: true, checks }, null, 2));
} finally {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('attendance-ble-write'))");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('nfc-attendance-write'))");
    await client.query('DELETE FROM ble_events WHERE device_id=ANY($1::uuid[])', [devices]);
    await client.query('DELETE FROM ble_receiver_heartbeats WHERE device_id=ANY($1::uuid[])', [devices]);
    await client.query('DELETE FROM ble_tags WHERE id=ANY($1::int[]) AND user_id=ANY($2::int[])', [tags, users]);
    await client.query('DELETE FROM nfc_review_audit WHERE scan_id IN (SELECT id FROM nfc_scans WHERE device_id=ANY($1::uuid[]))', [devices]);
    await client.query('DELETE FROM attendance_logs WHERE user_id=ANY($1::int[])', [users]);
    await client.query('DELETE FROM nfc_scans WHERE device_id=ANY($1::uuid[])', [devices]);
    await client.query('DELETE FROM nfc_day_rule_history WHERE user_id=ANY($1::int[])', [users]);
    await client.query('DELETE FROM nfc_day_rules WHERE user_id=ANY($1::int[])', [users]);
    await client.query('DELETE FROM nfc_cards WHERE user_id=ANY($1::int[])', [users]);
    await client.query('DELETE FROM nfc_devices WHERE id=ANY($1::uuid[])', [devices]);
    await client.query("DELETE FROM users WHERE id=ANY($1::int[]) AND username LIKE 'qa_ble_%'", [users]);
    await client.query('COMMIT'); console.log('Only this run\'s isolated BLE fixtures removed; real employee/readers retained');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); await pool.end(); }
}
console.log(checks.length + ' production BLE checks passed');
