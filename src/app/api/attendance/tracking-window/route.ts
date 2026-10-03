import {NextRequest,NextResponse} from 'next/server';
import {getActiveSession} from '@/lib/auth';
import {query} from '@/lib/db';
import {ensureAttendanceSchema} from '@/lib/schema';
import {scheduleWindows,inTrackingWindow} from '@/lib/tracking-window';
import type {AppUser} from '@/lib/types';
import type {EmployeePolicy} from '@/lib/period-report';
export async function GET(req:NextRequest){
  const session=await getActiveSession(req);
  if(!session||session.role!=='employee')return NextResponse.json({error:'حساب موظف مطلوب'},{status:401});
  try{
    await ensureAttendanceSchema();
    const user=(await query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE id=$1",[session.id])).rows[0];
    const policies=(await query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies WHERE user_id=$1",[session.id])).rows;
    const windows=scheduleWindows(user,policies);
    const outs=(await query<{day:string;timestamp:Date}>("SELECT to_char(shift_day,'YYYY-MM-DD') AS day,timestamp FROM attendance_logs WHERE user_id=$1 AND source='nfc' AND event_type='clock_out' AND timestamp>NOW()-INTERVAL '2 days'",[session.id])).rows;
    for(const w of windows){const out=outs.find(o=>o.day===w.day);if(out)w.end=Math.max(w.start,Math.min(w.end,+new Date(out.timestamp)));}
    return NextResponse.json({windows,active:inTrackingWindow(windows),timeZone:'Africa/Cairo',server_time:Date.now(),valid_until:windows.length?Math.max(...windows.map(w=>w.end)):Date.now()+86400000},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){console.error('Tracking schedule',e);return NextResponse.json({error:'تعذر تحميل مواعيد المتابعة'},{status:503});}
}
