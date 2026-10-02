import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getActiveSession } from '@/lib/auth';
import { loadSettings } from '@/lib/schema';

export async function GET(req: NextRequest) {
  try {
    if (!await getActiveSession(req)) return NextResponse.json({error:'غير مصرح'},{status:401});
    return NextResponse.json({settings:await loadSettings()});
  } catch (err: unknown) {
    console.error('Settings GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getActiveSession(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة لتعديل الإعدادات' }, { status: 403 });
    }

    const body = await req.json();
    for (const [key,value] of Object.entries(body)) {
      if (value == null) continue;
      if (/^branch[12]_(lat|lng|radius)$/.test(key) && (typeof value!=='number'||!Number.isFinite(value))) return NextResponse.json({error:'إحداثيات الفرع غير صالحة'},{status:400});
      if (key.endsWith('_lat') && Math.abs(Number(value))>90 || key.endsWith('_lng') && Math.abs(Number(value))>180 || key.endsWith('_radius') && (!Number.isInteger(value)||Number(value)<10||Number(value)>5000)) return NextResponse.json({error:'إحداثيات الفرع أو نطاقه غير صالح'},{status:400});
      if (key.endsWith('_name') && (typeof value!=='string'||!value.trim()||value.length>100)) return NextResponse.json({error:'اسم الفرع غير صالح'},{status:400});
      if (['shift_start_time','shift_end_time'].includes(key) && (typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))) return NextResponse.json({error:'موعد الشيفت غير صالح'},{status:400});
      if (key==='grace_period_mins' && (!Number.isInteger(value)||Number(value)<0||Number(value)>180) || key==='ping_interval_secs' && (!Number.isInteger(value)||Number(value)<15||Number(value)>300)) return NextResponse.json({error:'فترة السماح أو التحديث غير صالحة'},{status:400});
    }
    await loadSettings();
    const {
      branch1_name,
      branch1_lat,
      branch1_lng,
      branch1_radius,
      branch2_name,
      branch2_lat,
      branch2_lng,
      branch2_radius,
      shift_start_time,
      shift_end_time,
      grace_period_mins,
      ping_interval_secs,
    } = body;

    const res = await query(
      `UPDATE settings
       SET branch1_name = COALESCE($1, branch1_name),
           branch1_lat = COALESCE($2, branch1_lat),
           branch1_lng = COALESCE($3, branch1_lng),
           branch1_radius = COALESCE($4, branch1_radius),
           branch2_name = COALESCE($5, branch2_name),
           branch2_lat = COALESCE($6, branch2_lat),
           branch2_lng = COALESCE($7, branch2_lng),
           branch2_radius = COALESCE($8, branch2_radius),
           shift_start_time = COALESCE($9, shift_start_time),
           shift_end_time = COALESCE($10, shift_end_time),
           grace_period_mins = COALESCE($11, grace_period_mins),
           ping_interval_secs = COALESCE($12, ping_interval_secs),
           updated_at = NOW()
       WHERE id = 'main'
       RETURNING *;`,
      [
        branch1_name,
        branch1_lat,
        branch1_lng,
        branch1_radius,
        branch2_name,
        branch2_lat,
        branch2_lng,
        branch2_radius,
        shift_start_time,
        shift_end_time,
        grace_period_mins,
        ping_interval_secs,
      ]
    );

    for (const id of ['branch1','branch2']) {
      const s=res.rows[0];
      await query('UPDATE branches SET name=$1,lat=$2,lng=$3,radius=$4 WHERE id=$5', [s[`${id}_name`],s[`${id}_lat`],s[`${id}_lng`],s[`${id}_radius`],id]);
    }
    return NextResponse.json({
      success: true,
      message: 'تم حفظ إعدادات الفروع والشيفتات بنجاح',
      settings: await loadSettings(),
    });
  } catch (err: unknown) {
    console.error('Settings PUT error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء حفظ الإعدادات' }, { status: 500 });
  }
}
