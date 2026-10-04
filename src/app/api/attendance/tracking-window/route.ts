import {NextRequest,NextResponse} from 'next/server';
import {getActiveSession} from '@/lib/auth';
import {query} from '@/lib/db';
import {ensureAttendanceSchema} from '@/lib/schema';
import {inTrackingWindow} from '@/lib/tracking-window';
import {cardWindowsSql} from '@/lib/card-day';
import {loadSettings} from '@/lib/schema';
import type {AppUser} from '@/lib/types';

export async function GET(req:NextRequest){
  const session=await getActiveSession(req);
  if(!session||session.role!=='employee')return NextResponse.json({error:'حساب موظف مطلوب'},{status:401});
  try{
    await ensureAttendanceSchema();
    const user=(await query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE id=$1",[session.id])).rows[0];
    const settings=await loadSettings();
    const rows=(await query<{day:string;start:Date;finish:Date}>(cardWindowsSql,[session.id,user.max_tracking_hours??settings.max_tracking_hours??12,new Date(Date.now()-32*86400000),new Date(Date.now()+120000)])).rows;
    const windows=user.is_active!==false&&user.role==='employee'?rows.map(r=>({day:r.day,start:+new Date(r.start),end:+new Date(r.finish)})):[];
    return NextResponse.json({ping_interval_secs:settings.ping_interval_secs,windows,active:inTrackingWindow(windows),timeZone:'Africa/Cairo',server_time:Date.now(),valid_until:Math.max(Date.now()+86400000,...windows.map(w=>w.end))},{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){console.error('Tracking schedule',e);return NextResponse.json({error:'تعذر تحميل مواعيد المتابعة'},{status:503});}
}
