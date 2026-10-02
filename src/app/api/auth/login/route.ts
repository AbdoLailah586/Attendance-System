import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createToken } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'يرجى إدخال اسم المستخدم وكلمة المرور' },
        { status: 400 }
      );
    }

    const res = await query(
      'SELECT id, username, password, name, phone, role, is_active FROM users WHERE username = $1',
      [username.trim()]
    );

    if (res.rows.length === 0) {
      return NextResponse.json(
        { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }

    const user = res.rows[0];

    if (!user.is_active) {
      return NextResponse.json(
        { error: 'هذا الحساب معطل، يرجى مراجعة إدارة المحل' },
        { status: 403 }
      );
    }

    // In production we compare hashed password or exact match
    if (user.password !== password.trim()) {
      return NextResponse.json(
        { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' },
        { status: 401 }
      );
    }

    const sessionPayload = {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role as 'admin' | 'employee',
    };

    const token = createToken(sessionPayload);

    const response = NextResponse.json({
      success: true,
      user: sessionPayload,
      token,
    });

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (err: unknown) {
    console.error('Login error:', err);
    return NextResponse.json(
      { error: 'حدث خطأ في الخادم أثناء تسجيل الدخول' },
      { status: 500 }
    );
  }
}
