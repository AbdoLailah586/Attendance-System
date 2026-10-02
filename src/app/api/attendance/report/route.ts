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

    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get('date'); // YYYY-MM-DD
    const userIdParam = searchParams.get('userId');

    // Default to today if dateParam is omitted
    const targetDate = dateParam ? new Date(dateParam) : new Date();
    const startOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
    const endOfDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

    // Get settings
    const settingsRes = await query('SELECT * FROM settings WHERE id = $1', ['main']);
    const settings = settingsRes.rows[0];

    // Filter employees: if employee role, they can only view their own report
    let userFilterSql = `WHERE role = 'employee' AND is_active = TRUE`;
    const userFilterParams: unknown[] = [];

    if (session.role === 'employee') {
      userFilterSql += ` AND id = $1`;
      userFilterParams.push(session.id);
    } else if (userIdParam) {
      userFilterSql += ` AND id = $1`;
      userFilterParams.push(parseInt(userIdParam, 10));
    }

    const usersRes = await query(
      `SELECT id, username, name, phone, shift_start, shift_end, is_active 
       FROM users 
       ${userFilterSql} 
       ORDER BY id ASC`,
      userFilterParams
    );

    const employees = usersRes.rows;
    const reports = [];

    for (const emp of employees) {
      const logsRes = await query(
        `SELECT id, timestamp, branch_id, lat, lng, accuracy, distance_branch1, distance_branch2, event_type
         FROM attendance_logs
         WHERE user_id = $1 AND timestamp >= $2 AND timestamp <= $3
         ORDER BY timestamp ASC`,
        [emp.id, startOfDay.toISOString(), endOfDay.toISOString()]
      );

      const logs = logsRes.rows;

      let branch1Mins = 0;
      let branch2Mins = 0;
      let outsideMins = 0;
      let firstArrival = null;
      let lastDeparture = null;
      const timeline: Array<{
        branch_id: string;
        branch_name: string;
        start: string;
        end: string;
        durationMinutes: number;
        durationFormatted: string;
      }> = [];

      if (logs.length > 0) {
        const insideLogs = logs.filter((l) => l.branch_id === 'branch1' || l.branch_id === 'branch2');
        if (insideLogs.length > 0) {
          firstArrival = insideLogs[0].timestamp;
          lastDeparture = insideLogs[insideLogs.length - 1].timestamp;
        } else {
          firstArrival = logs[0].timestamp;
          lastDeparture = logs[logs.length - 1].timestamp;
        }

        let currentInterval: {
          branch_id: string;
          start: Date;
          end: Date;
        } | null = null;

        for (let i = 0; i < logs.length; i++) {
          const current = logs[i];
          const next = logs[i + 1];

          let durationSecs = 60;
          if (next) {
            const diffSecs = (new Date(next.timestamp).getTime() - new Date(current.timestamp).getTime()) / 1000;
            durationSecs = Math.min(diffSecs, 300); // cap gap to 5 mins
          }

          const durationMins = durationSecs / 60;

          if (current.branch_id === 'branch1') {
            branch1Mins += durationMins;
          } else if (current.branch_id === 'branch2') {
            branch2Mins += durationMins;
          } else {
            outsideMins += durationMins;
          }

          // Build timeline intervals
          const logDate = new Date(current.timestamp);
          if (!currentInterval) {
            currentInterval = {
              branch_id: current.branch_id,
              start: logDate,
              end: new Date(logDate.getTime() + durationSecs * 1000),
            };
          } else if (currentInterval.branch_id === current.branch_id) {
            currentInterval.end = new Date(logDate.getTime() + durationSecs * 1000);
          } else {
            // Branch changed
            const intervalMins = Math.round(
              (currentInterval.end.getTime() - currentInterval.start.getTime()) / 60000
            );
            if (intervalMins > 0) {
              timeline.push({
                branch_id: currentInterval.branch_id,
                branch_name:
                  currentInterval.branch_id === 'branch1'
                    ? settings.branch1_name
                    : currentInterval.branch_id === 'branch2'
                    ? settings.branch2_name
                    : 'خارج المحلين',
                start: currentInterval.start.toISOString(),
                end: currentInterval.end.toISOString(),
                durationMinutes: intervalMins,
                durationFormatted: formatDurationArabic(intervalMins),
              });
            }
            currentInterval = {
              branch_id: current.branch_id,
              start: logDate,
              end: new Date(logDate.getTime() + durationSecs * 1000),
            };
          }
        }

        if (currentInterval) {
          const intervalMins = Math.round(
            (currentInterval.end.getTime() - currentInterval.start.getTime()) / 60000
          );
          if (intervalMins > 0) {
            timeline.push({
              branch_id: currentInterval.branch_id,
              branch_name:
                currentInterval.branch_id === 'branch1'
                  ? settings.branch1_name
                  : currentInterval.branch_id === 'branch2'
                  ? settings.branch2_name
                  : 'خارج المحلين',
              start: currentInterval.start.toISOString(),
              end: currentInterval.end.toISOString(),
              durationMinutes: intervalMins,
              durationFormatted: formatDurationArabic(intervalMins),
            });
          }
        }
      }

      const totalPresenceMins = branch1Mins + branch2Mins;
      const punctuality = evaluatePunctuality(
        firstArrival,
        emp.shift_start || settings.shift_start_time || '10:00',
        settings.grace_period_mins || 30
      );

      reports.push({
        user: emp,
        hasLogs: logs.length > 0,
        logCount: logs.length,
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
        timeline,
      });
    }

    return NextResponse.json({
      date: startOfDay.toISOString().split('T')[0],
      settings,
      reports,
    });
  } catch (err: unknown) {
    console.error('Attendance report GET error:', err);
    return NextResponse.json({ error: 'حدث خطأ أثناء إعداد تقرير الحضور' }, { status: 500 });
  }
}
