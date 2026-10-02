import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getSessionFromRequest } from '@/lib/auth';
import { formatDurationArabic, evaluatePunctuality } from '@/lib/geo';

export async function GET(req: NextRequest) {
  try {
    const session = getSessionFromRequest(req);
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    // Get settings
    const settingsRes = await query('SELECT * FROM settings WHERE id = $1', ['main']);
    const settings = settingsRes.rows[0];

    // Get all employees
    const usersRes = await query(
      `SELECT id, username, name, phone, shift_start, shift_end, is_active 
       FROM users 
       WHERE role = 'employee' AND is_active = TRUE
       ORDER BY id ASC`
    );

    const employees = usersRes.rows;
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const liveData = [];

    for (const emp of employees) {
      // Get all logs of today for this employee
      const logsRes = await query(
        `SELECT id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type
         FROM attendance_logs
         WHERE user_id = $1 AND timestamp >= $2
         ORDER BY timestamp ASC`,
        [emp.id, startOfToday]
      );

      const logs = logsRes.rows;
      const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;

      // Online status: pinged within last 3 minutes
      let isOnline = false;
      let minutesSincePing = null;

      if (latestLog) {
        const pingTime = new Date(latestLog.timestamp).getTime();
        minutesSincePing = Math.round((Date.now() - pingTime) / 60000);
        isOnline = minutesSincePing <= 3;
      }

      // Calculate time breakdown from logs
      // Each interval between pings is attributed to that log's branch
      // Max interval between pings counted as continuous presence is 5 minutes (to avoid counting inactive gaps)
      let branch1Mins = 0;
      let branch2Mins = 0;
      let outsideMins = 0;
      let firstArrival = null;
      let lastDeparture = null;

      if (logs.length > 0) {
        // First log inside branch 1 or 2 is arrival
        const insideLogs = logs.filter((l) => l.branch_id === 'branch1' || l.branch_id === 'branch2');
        if (insideLogs.length > 0) {
          firstArrival = insideLogs[0].timestamp;
          lastDeparture = insideLogs[insideLogs.length - 1].timestamp;
        } else {
          firstArrival = logs[0].timestamp;
          lastDeparture = logs[logs.length - 1].timestamp;
        }

        for (let i = 0; i < logs.length; i++) {
          const current = logs[i];
          const next = logs[i + 1];

          let durationSecs = 60; // default for 1 ping
          if (next) {
            const diffSecs = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;
            // Cap to 5 mins if there was a disconnect
            durationSecs = Math.min(diffSecs, 300);
          }

          const durationMins = durationSecs / 60;

          if (current.branch_id === 'branch1') {
            branch1Mins += durationMins;
          } else if (current.branch_id === 'branch2') {
            branch2Mins += durationMins;
          } else {
            outsideMins += durationMins;
          }
        }
      }

      const totalPresenceMins = branch1Mins + branch2Mins;
      const punctuality = evaluatePunctuality(
        firstArrival,
        emp.shift_start || settings.shift_start_time || '10:00',
        settings.grace_period_mins || 30
      );

      liveData.push({
        user: emp,
        isOnline,
        minutesSincePing,
        currentStatus: latestLog
          ? isOnline
            ? latestLog.branch_id
            : 'offline'
          : 'not_started',
        latestLog,
        firstArrival,
        lastDeparture,
        punctuality,
        summary: {
          totalMinutes: Math.round(totalPresenceMins),
          totalFormatted: formatDurationArabic(totalPresenceMins),
          branch1Minutes: Math.round(branch1Mins),
          branch1Formatted: formatDurationArabic(branch1Mins),
          branch2Minutes: Math.round(branch2Mins),
          branch2Formatted: formatDurationArabic(branch2Mins),
          outsideMinutes: Math.round(outsideMins),
          outsideFormatted: formatDurationArabic(outsideMins),
        },
      });
    }

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      settings,
      employees: liveData,
    });
  } catch (err: unknown) {
    console.error('Attendance live GET error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء تحميل بيانات الحضور الحية' }, { status: 500 });
  }
}
