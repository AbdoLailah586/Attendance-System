import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session || session.role !== 'admin') {
      return NextResponse.json({ error: 'صلاحيات المدير مطلوبة' }, { status: 403 });
    }

    // Get settings
    const settingsRes = await query('SELECT * FROM settings WHERE id = $1', ['main']);
    const settings = settingsRes.rows[0];

    // Get employees
    const usersRes = await query(`SELECT id, username FROM users WHERE role = 'employee' ORDER BY id ASC LIMIT 5`);
    const emps = usersRes.rows;

    if (emps.length === 0) {
      return NextResponse.json({ error: 'لا يوجد موظفين مسجلين' }, { status: 400 });
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    const day = today.getDate();

    // Clear today's logs for demo recreation
    const startOfToday = new Date(year, month, day, 0, 0, 0).toISOString();
    await query(`DELETE FROM attendance_logs WHERE timestamp >= $1`, [startOfToday]);

    // Scenario 1: Employee 1 (أحمد محمود) - Arrived Early at 09:45 AM, worked mostly in Branch 1
    if (emps[0]) {
      const empId = emps[0].id;
      // 09:45 to 13:00 in Branch 1 (pings every 5 mins for demo sample density)
      for (let m = 0; m <= 195; m += 5) {
        const time = new Date(year, month, day, 9, 45 + m);
        await query(
          `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
           VALUES ($1, $2, 'branch1', $3, $4, 4.2, 5, 45, 'ping')`,
          [empId, time.toISOString(), settings.branch1_lat, settings.branch1_lng]
        );
      }
      // 13:00 to 13:30 outside (Lunch break)
      for (let m = 5; m <= 30; m += 5) {
        const time = new Date(year, month, day, 13, m);
        await query(
          `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
           VALUES ($1, $2, 'outside', $3, $4, 6.0, 150, 180, 'ping')`,
          [empId, time.toISOString(), settings.branch1_lat + 0.001, settings.branch1_lng + 0.001]
        );
      }
      // 13:30 to 17:30 in Branch 2
      for (let m = 5; m <= 240; m += 5) {
        const time = new Date(year, month, day, 13, 30 + m);
        await query(
          `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
           VALUES ($1, $2, 'branch2', $3, $4, 5.0, 50, 8, 'ping')`,
          [empId, time.toISOString(), settings.branch2_lat, settings.branch2_lng]
        );
      }
    }

    // Scenario 2: Employee 2 (محمد علي) - Arrived On Time at 10:15 AM (Grace period)
    if (emps[1]) {
      const empId = emps[1].id;
      for (let m = 0; m <= 360; m += 5) {
        const time = new Date(year, month, day, 10, 15 + m);
        const branch = m < 180 ? 'branch2' : 'branch1';
        const lat = branch === 'branch1' ? settings.branch1_lat : settings.branch2_lat;
        const lng = branch === 'branch1' ? settings.branch1_lng : settings.branch2_lng;
        await query(
          `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
           VALUES ($1, $2, $3, $4, $5, 4.0, 10, 12, 'ping')`,
          [empId, time.toISOString(), branch, lat, lng]
        );
      }
    }

    // Scenario 3: Employee 3 (كريم حسن) - Arrived LATE at 11:10 AM (Late flag)
    if (emps[2]) {
      const empId = emps[2].id;
      for (let m = 0; m <= 240; m += 5) {
        const time = new Date(year, month, day, 11, 10 + m);
        await query(
          `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
           VALUES ($1, $2, 'branch1', $3, $4, 5.0, 8, 48, 'ping')`,
          [empId, time.toISOString(), settings.branch1_lat, settings.branch1_lng]
        );
      }
    }

    // Scenario 4: Employee 4 (يوسف إبراهيم) - Live active right now in Branch 1!
    if (emps[3]) {
      const empId = emps[3].id;
      // From 10:00 AM until current time
      const currentHour = today.getHours();
      const currentMin = today.getMinutes();
      const totalMinutesSinceTen = Math.max(10, (currentHour - 10) * 60 + currentMin);

      for (let m = 0; m <= totalMinutesSinceTen; m += 5) {
        const time = new Date(year, month, day, 10, m);
        if (time.getTime() <= Date.now()) {
          await query(
            `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
             VALUES ($1, $2, 'branch1', $3, $4, 3.5, 6, 42, 'ping')`,
            [empId, time.toISOString(), settings.branch1_lat, settings.branch1_lng]
          );
        }
      }
    }

    // Scenario 5: Employee 5 (عمر فاروق) - Live active right now in Branch 2!
    if (emps[4]) {
      const empId = emps[4].id;
      const currentHour = today.getHours();
      const currentMin = today.getMinutes();
      const totalMinutesSinceTen = Math.max(10, (currentHour - 10) * 60 + currentMin);

      for (let m = 0; m <= totalMinutesSinceTen; m += 5) {
        const time = new Date(year, month, day, 10, 5 + m);
        if (time.getTime() <= Date.now()) {
          await query(
            `INSERT INTO attendance_logs (user_id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type)
             VALUES ($1, $2, 'branch2', $3, $4, 4.0, 48, 7, 'ping')`,
            [empId, time.toISOString(), settings.branch2_lat, settings.branch2_lng]
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'تم توليد بيانات حضور تجريبية واقعية لليوم بنجاح (مبكر، في الميعاد، متأخر، وحالي في الفرعين)',
    });
  } catch (err: unknown) {
    console.error('Seed demo error:', err);
    return NextResponse.json({ error: 'فشل توليد البيانات التجريبية' }, { status: 500 });
  }
}
