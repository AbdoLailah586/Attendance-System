import pg from 'pg';
import {mkdir,writeFile} from 'node:fs/promises';

// One-time owner-requested reset. Backups remain private in the same cloud database.
if(!process.argv.includes('--execute'))throw new Error('Explicit --execute required. This resets all attendance records.');
const origin='https://attendance-system-joe-2026.vercel.app';
if(!process.env.DATABASE_URL||!process.env.QA_ADMIN_USERNAME||!process.env.QA_ADMIN_PASSWORD)throw new Error('Cloud connection and QA administrator credentials required');
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD})});
if(!login.ok)throw new Error('Production admin login failed');const {token}=await login.json();
const headers={Authorization:`Bearer ${token}`};
const deployed=await(await fetch(origin+'/api/settings',{headers,cache:'no-store'})).json();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:1});
const client=await pool.connect();
let receipt;
try{
  await client.query('BEGIN');
  const settings=(await client.query("SELECT * FROM settings WHERE id='main' FOR UPDATE")).rows[0];
  if(settings.branch1_lat!==deployed.settings.branch1_lat||settings.branch2_lng!==deployed.settings.branch2_lng)throw new Error('Local connection does not match deployed branch settings');
  await client.query('LOCK TABLE attendance_logs IN ACCESS EXCLUSIVE MODE');
  const tag=new Date().toISOString().replace(/[-:.TZ]/g,'').slice(0,17);
  const logsTable='logs_'+tag,usersTable='qa_users_'+tag;
  await client.query('CREATE SCHEMA IF NOT EXISTS private_attendance_archive');
  await client.query('REVOKE ALL ON SCHEMA private_attendance_archive FROM PUBLIC');
  await client.query(`CREATE TABLE private_attendance_archive.${logsTable} AS TABLE attendance_logs`);
  await client.query(`CREATE TABLE private_attendance_archive.${usersTable} AS SELECT * FROM users WHERE username ~ '^qa_(sync|period)_' AND name LIKE 'QA%'`);
  const removed=(await client.query('DELETE FROM attendance_logs')).rowCount;
  const qa=(await client.query("DELETE FROM users WHERE username ~ '^qa_(sync|period)_' AND name LIKE 'QA%' AND role='employee'")).rowCount;
  await client.query("UPDATE users SET phone=NULL WHERE phone IN ('01000000000','01011112222','01022223333','01033334444','01044445555','01055556666')");
  const reset=(await client.query("UPDATE settings SET attendance_reset_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id='main' RETURNING attendance_reset_at")).rows[0].attendance_reset_at;
  await client.query('COMMIT');
  receipt={origin,resetAt:reset,removedAttendanceRecords:removed,removedQAAccounts:qa,remainingRecords:Number((await client.query('SELECT count(*) FROM attendance_logs')).rows[0].count),backupSchema:'private_attendance_archive',logsTable,usersTable};
}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();await pool.end();}
const after=await(await fetch(origin+'/api/settings',{headers,cache:'no-store'})).json();
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/attendance-reset.json',JSON.stringify(receipt,null,2));
if(new Date(after.settings.attendance_reset_at).getTime()!==new Date(receipt.resetAt).getTime())throw new Error('Reset timestamp not visible on production');
if(after.settings.branch1_lat!==deployed.settings.branch1_lat||after.settings.branch2_lng!==deployed.settings.branch2_lng||after.settings.branch1_radius!==deployed.settings.branch1_radius||after.settings.branch2_radius!==deployed.settings.branch2_radius)throw new Error('Branch settings changed during reset');
console.log(JSON.stringify(receipt,null,2));
