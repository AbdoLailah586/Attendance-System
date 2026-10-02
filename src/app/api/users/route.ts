import { NextRequest, NextResponse } from 'next/server';
import { query,getPool } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { hashPassword } from '@/lib/password';
import { loadSettings } from '@/lib/schema';
import { localDate, validDay } from '@/lib/time';
import type { PoolClient } from 'pg';

const fields="id,username,name,phone,role,shift_start,shift_end,is_active,work_days,cycle_start_day,grace_period_mins,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date,created_at";
function validation(b:Record<string,unknown>){
  for(const key of ['username','name'])if(b[key]!==undefined&&(typeof b[key]!=='string'||!(b[key] as string).trim()||(b[key] as string).length>(key==='name'?150:100)))return 'تحقق من الاسم واسم الدخول';
  if(b.password!==undefined&&(typeof b.password!=='string'||b.password.length<6||b.password.length>200))return 'كلمة المرور لا تقل عن 6 أحرف';
  if(b.phone!==undefined&&(typeof b.phone!=='string'||b.phone.length>50))return 'رقم الهاتف غير صالح';
  if(b.role!==undefined&&!['admin','employee'].includes(String(b.role)))return 'الصلاحية غير صالحة';
  if(b.is_active!==undefined&&typeof b.is_active!=='boolean')return 'حالة الحساب غير صالحة';
  for(const key of ['shift_start','shift_end'])if(b[key]!==undefined&&(typeof b[key]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(b[key] as string)))return 'موعد الشيفت غير صالح';
  if(b.work_days!==undefined&&(!Array.isArray(b.work_days)||new Set(b.work_days).size!==b.work_days.length||b.work_days.some(d=>!Number.isInteger(d)||d<0||d>6)))return 'أيام العمل غير صالحة';
  if(b.grace_period_mins!==undefined&&(!Number.isInteger(b.grace_period_mins)||Number(b.grace_period_mins)<0||Number(b.grace_period_mins)>180))return 'فترة السماح من 0 إلى 180 دقيقة';
  if(b.cycle_start_day!==undefined&&(!Number.isInteger(b.cycle_start_day)||Number(b.cycle_start_day)<1||Number(b.cycle_start_day)>31))return 'بداية الدورة من 1 إلى 31';
  for(const key of ['effective_from','attendance_start_date'])if(b[key]!==undefined&&(typeof b[key]!=='string'||!validDay(b[key] as string)))return 'تاريخ غير صالح';
  if(b.effective_from!==undefined&&String(b.effective_from)>localDate())return 'تاريخ السريان يجب أن يكون اليوم أو يومًا سابقًا';
  return null;
}
async function policy(client:PoolClient,id:number,day:string){
  await client.query(`INSERT INTO employee_policies(user_id,effective_from,shift_start,shift_end,work_days,cycle_start_day,grace_period_mins,role,is_active)
    SELECT id,$2,shift_start,shift_end,work_days,cycle_start_day,grace_period_mins,role,is_active FROM users WHERE id=$1
    ON CONFLICT(user_id,effective_from) DO UPDATE SET shift_start=EXCLUDED.shift_start,shift_end=EXCLUDED.shift_end,work_days=EXCLUDED.work_days,cycle_start_day=EXCLUDED.cycle_start_day,grace_period_mins=EXCLUDED.grace_period_mins,role=EXCLUDED.role,is_active=EXCLUDED.is_active`,[id,day]);
}
function failure(error:unknown){
  if((error as {code?:string})?.code==='23505')return NextResponse.json({error:'اسم الدخول مستخدم بالفعل'},{status:409});
  console.error('Users request failed:',error);return NextResponse.json({error:'تعذر حفظ بيانات الحساب'},{status:503});
}
export async function GET(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    await loadSettings();
    const users=await query(`SELECT ${fields} FROM users ORDER BY role,id`);
    const policies=await query("SELECT user_id,to_char(effective_from,'YYYY-MM-DD') AS effective_from,shift_start,shift_end,work_days,cycle_start_day,grace_period_mins,role,is_active FROM employee_policies ORDER BY effective_from DESC");
    return NextResponse.json({users:users.rows,policies:policies.rows});
  }catch(e){return failure(e);}
}
export async function POST(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    const b=await req.json();if(!b||typeof b!=='object')return NextResponse.json({error:'بيانات غير صالحة'},{status:400});
    const error=validation(b);if(error||!b.username||!b.name||!b.password)return NextResponse.json({error:error||'الاسم واسم الدخول وكلمة المرور مطلوبة'},{status:400});
    const defaults=await loadSettings();const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      const result=await client.query(`INSERT INTO users(username,password,name,phone,role,shift_start,shift_end,is_active,work_days,cycle_start_day,grace_period_mins,attendance_start_date)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${fields}`,
        [b.username.trim(),hashPassword(b.password),b.name.trim(),b.phone?.trim()||null,b.role||'employee',b.shift_start||defaults.shift_start_time,b.shift_end||defaults.shift_end_time,b.is_active??true,b.work_days||[0,1,2,3,4,5,6],b.cycle_start_day||1,b.grace_period_mins??defaults.grace_period_mins,b.attendance_start_date||localDate()]);
      await policy(client,result.rows[0].id,b.effective_from||b.attendance_start_date||localDate());
      await client.query('COMMIT');return NextResponse.json({success:true,user:result.rows[0]});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){return failure(e);}
}
export async function PUT(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    const b=await req.json();if(!b||typeof b!=='object'||!Number.isInteger(b.id)||b.id<1)return NextResponse.json({error:'حساب غير صالح'},{status:400});
    const error=validation(b);if(error)return NextResponse.json({error},{status:400});
    await loadSettings();const client=await getPool().connect();
    try{
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const old=(await client.query('SELECT * FROM users WHERE id=$1',[b.id])).rows[0];
      if(!old){await client.query('ROLLBACK');return NextResponse.json({error:'الحساب غير موجود'},{status:404});}
      if(old.role==='admin'&&old.is_active&&(b.role==='employee'||b.is_active===false)){
        const admins=await client.query("SELECT count(*)::int AS count FROM users WHERE role='admin' AND is_active=TRUE AND id<>$1",[b.id]);
        if(!admins.rows[0].count){await client.query('ROLLBACK');return NextResponse.json({error:'لا يمكن تعطيل أو تغيير صلاحية آخر مدير نشط'},{status:409});}
      }
      const result=await client.query(`UPDATE users SET username=COALESCE($1,username),name=COALESCE($2,name),phone=COALESCE($3,phone),role=COALESCE($4,role),
        shift_start=COALESCE($5,shift_start),shift_end=COALESCE($6,shift_end),is_active=COALESCE($7,is_active),password=COALESCE($8,password),
        work_days=COALESCE($9,work_days),cycle_start_day=COALESCE($10,cycle_start_day),grace_period_mins=COALESCE($11,grace_period_mins),attendance_start_date=COALESCE($12::date,attendance_start_date)
        WHERE id=$13 RETURNING ${fields}`,[b.username?.trim(),b.name?.trim(),b.phone?.trim(),b.role,b.shift_start,b.shift_end,b.is_active,b.password?hashPassword(b.password):null,b.work_days,b.cycle_start_day,b.grace_period_mins,b.attendance_start_date,b.id]);
      if(['shift_start','shift_end','work_days','cycle_start_day','grace_period_mins','role','is_active'].some(k=>b[k]!==undefined))await policy(client,b.id,b.effective_from||localDate());
      await client.query('COMMIT');return NextResponse.json({success:true,user:result.rows[0],effective_from:b.effective_from||localDate()});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){return failure(e);}
}
export async function DELETE(req:NextRequest){
  const id=Number(req.nextUrl.searchParams.get('id'));
  if(!Number.isInteger(id)||id<1)return NextResponse.json({error:'حساب غير صالح'},{status:400});
  return PUT(new NextRequest(req.url,{method:'PUT',headers:req.headers,body:JSON.stringify({id,is_active:false})}));
}
