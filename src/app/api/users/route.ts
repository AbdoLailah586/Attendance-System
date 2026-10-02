import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const res = await query(
      `SELECT id, username, password, name, phone, role, shift_start, shift_end, is_active, created_at 
       FROM users 
       ORDER BY role ASC, id ASC`
    );

    return NextResponse.json({ users: res.rows });
  } catch (err: unknown) {
    console.error('Users GET error:', err);
    return NextResponse.json({ error: 'فشل استرجاع الموظفين' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const body = await req.json();
    const { username, password, name, phone, shift_start, shift_end } = body;

    if (!username || !password || !name) {
      return NextResponse.json(
        { error: 'يرجى إدخال اسم المستخدم، كلمة المرور، والاسم الكامل للموظف' },
        { status: 400 }
      );
    }

    // Check if username already exists
    const check = await query('SELECT id FROM users WHERE username = $1', [username.trim()]);
    if (check.rows.length > 0) {
      return NextResponse.json({ error: 'اسم المستخدم مسجل مسبقاً، يرجى اختيار اسم آخر' }, { status: 400 });
    }

    const res = await query(
      `INSERT INTO users (username, password, name, phone, role, shift_start, shift_end, is_active)
       VALUES ($1, $2, $3, $4, 'employee', $5, $6, TRUE)
       RETURNING id, username, password, name, phone, role, shift_start, shift_end, is_active, created_at`,
      [
        username.trim(),
        password.trim(),
        name.trim(),
        phone ? phone.trim() : null,
        shift_start || '10:00',
        shift_end || '22:00',
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'تم إضافة الموظف بنجاح ويمكنه الآن تسجيل الدخول',
      user: res.rows[0],
    });
  } catch (err: unknown) {
    console.error('Users POST error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء إضافة الموظف' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const body = await req.json();
    const { id, password, name, phone, shift_start, shift_end, is_active } = body;

    if (!id) {
      return NextResponse.json({ error: 'معرف الموظف مطلوب' }, { status: 400 });
    }

    const res = await query(
      `UPDATE users
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           shift_start = COALESCE($3, shift_start),
           shift_end = COALESCE($4, shift_end),
           is_active = COALESCE($5, is_active),
           password = CASE WHEN $6::text IS NOT NULL AND $6::text <> '' THEN $6 ELSE password END
       WHERE id = $7 AND role = 'employee'
       RETURNING id, username, password, name, phone, role, shift_start, shift_end, is_active;`,
      [name, phone, shift_start, shift_end, is_active, password || null, id]
    );

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'لم يتم العثور على الموظف' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'تم تحديث بيانات الموظف بنجاح',
      user: res.rows[0],
    });
  } catch (err: unknown) {
    console.error('Users PUT error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء تعديل بيانات الموظف' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'معرف الموظف مطلوب' }, { status: 400 });
    }

    // Do not allow deleting admin
    const check = await query('SELECT role FROM users WHERE id = $1', [id]);
    if (check.rows.length > 0 && check.rows[0].role === 'admin') {
      return NextResponse.json({ error: 'لا يمكن حذف حساب المدير' }, { status: 400 });
    }

    await query('DELETE FROM users WHERE id = $1', [id]);

    return NextResponse.json({ success: true, message: 'تم حذف الموظف بنجاح' });
  } catch (err: unknown) {
    console.error('Users DELETE error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء حذف الموظف' }, { status: 500 });
  }
}
