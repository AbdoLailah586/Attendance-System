import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { determineBranchLocation, StoreSettings } from '@/lib/geo';

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'يرجى تسجيل الدخول أولاً' }, { status: 401 });
    }

    const body = await req.json();
    const { lat, lng, accuracy, event_type = 'ping' } = body;

    if (lat === undefined || lng === undefined) {
      return NextResponse.json({ error: 'إحداثيات الموقع (lat, lng) مطلوبة' }, { status: 400 });
    }

    // Get current store settings
    const settingsRes = await query('SELECT * FROM settings WHERE id = $1', ['main']);
    if (settingsRes.rows.length === 0) {
      return NextResponse.json({ error: 'إعدادات الفروع غير متوفرة' }, { status: 500 });
    }

    const settings: StoreSettings = settingsRes.rows[0];

    // Determine location and branch
    const geoResult = determineBranchLocation(Number(lat), Number(lng), settings);

    // Save attendance log
    const logRes = await query(
      `INSERT INTO attendance_logs 
       (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
       VALUES ($1, NOW(), $2, $3, $4, $5, $6, $7, $8)
       RETURNING *;`,
      [
        session.id,
        geoResult.branch_id,
        lat,
        lng,
        accuracy || 0,
        geoResult.distance1,
        geoResult.distance2,
        event_type,
      ]
    );

    return NextResponse.json({
      success: true,
      log: logRes.rows[0],
      location: geoResult,
      settings: {
        branch1_name: settings.branch1_name,
        branch2_name: settings.branch2_name,
        ping_interval_secs: settings.ping_interval_secs,
      },
    });
  } catch (err: unknown) {
    console.error('Attendance ping error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء تسجيل الموقع' }, { status: 500 });
  }
}
