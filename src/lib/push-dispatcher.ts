import { query } from './db';
import { loadSettings } from './schema';
import { ensureBleSchema } from './ble';
import { businessDay, dailyRules } from './card-day';
import { addDays, policyOn, type EmployeePolicy } from './period-report';
import type { AppUser } from './types';
import { cairoTime } from './time';
import { broadcastPushToAdmins } from './fcm';

export interface DispatchResult {
  checked: number;
  dispatched: number;
  keys: string[];
}

export async function dispatchReadyShiftAlerts(): Promise<DispatchResult> {
  const now = new Date();
  const since = +now - 7 * 86400000;
  const settings = await loadSettings();
  await ensureBleSchema();
  const current = businessDay(now, settings.business_day_start_time);

  const [users, policies] = await Promise.all([
    query<AppUser>("SELECT *,to_char(attendance_start_date,'YYYY-MM-DD') AS attendance_start_date FROM users WHERE role='employee' AND is_active=TRUE ORDER BY id"),
    query<EmployeePolicy>("SELECT *,to_char(effective_from,'YYYY-MM-DD') AS effective_from FROM employee_policies")
  ]);

  interface JobItem {
    key: string;
    kind: string;
    due_at: string;
    ready: boolean;
    title: string;
    body: string;
    business_day: string;
    user_id?: number | null;
    report_url?: string;
    filename?: string;
  }

  const jobs: JobItem[] = [];
  const pdfSend = '01:00';
  const inWindow = (due: number) => due >= since && due <= +now + 48 * 3600000;

  for (let offset = -7; offset <= 1; offset++) {
    const day = addDays(current, offset);

    // Daily PDF
    const dailyPdfDue = +cairoTime(addDays(day, 1), pdfSend);
    if (inWindow(dailyPdfDue) && dailyPdfDue <= +now) {
      jobs.push({
        key: `daily-pdf:${day}`,
        kind: 'daily_pdf',
        due_at: new Date(dailyPdfDue).toISOString(),
        ready: true,
        business_day: day,
        filename: `daily-report-${day}.pdf`,
        title: 'تم حفظ التقرير اليومي',
        body: `تقرير ${day} لساعات حضور كل موظف تم حفظه في Downloads.`,
        report_url: `/api/attendance/daily-pdf?date=${day}`
      });
    }

    // Weekly PDF
    if (new Date(day + 'T12:00:00Z').getUTCDay() === 5) {
      const weekStart = addDays(day, -6);
      const weeklyDue = +cairoTime(addDays(day, 1), pdfSend);
      if (inWindow(weeklyDue) && weeklyDue <= +now) {
        jobs.push({
          key: `weekly-pdf:${day}`,
          kind: 'weekly_pdf',
          due_at: new Date(weeklyDue).toISOString(),
          ready: true,
          business_day: day,
          filename: `weekly-report-${weekStart}-${day}.pdf`,
          title: 'تم حفظ التقرير الأسبوعي',
          body: `ساعات حضور كل موظف من ${weekStart} إلى ${day} تم حفظها في Downloads.`,
          report_url: `/api/attendance/export?format=pdf&mode=weekly&start=${weekStart}&date=${weekStart}&heading=weekly`
        });
      }
    }

    // Monthly PDF
    const monthNext = addDays(day, 1);
    if (monthNext.slice(8, 10) === '01') {
      const monthStart = `${day.slice(0, 8)}01`;
      const monthlyDue = +cairoTime(monthNext, pdfSend);
      if (inWindow(monthlyDue) && monthlyDue <= +now) {
        jobs.push({
          key: `monthly-pdf:${day}`,
          kind: 'monthly_pdf',
          due_at: new Date(monthlyDue).toISOString(),
          ready: true,
          business_day: day,
          filename: `monthly-report-${day.slice(0, 7)}.pdf`,
          title: 'تم حفظ التقرير الشهري',
          body: `ساعات حضور كل موظف خلال ${day.slice(0, 7)} تم حفظها في Downloads.`,
          report_url: `/api/attendance/export?format=pdf&mode=custom&date=${monthStart}&start=${monthStart}&end=${day}&heading=monthly`
        });
      }
    }

    // Shift report per employee
    for (const user of users.rows) {
      const own = policies.rows.filter(p => p.user_id === user.id);
      const rule = dailyRules(user, own, day, settings);
      const policy = policyOn(user, own, rule.shift_day);
      if (policy.role !== 'employee' || !policy.is_active || rule.shift_day < (user.attendance_start_date || '1900-01-01') || !policy.work_days.includes(new Date(rule.shift_day + 'T12:00:00Z').getUTCDay())) continue;
      const end = +new Date(rule.shift_end);
      if (end >= since && end <= +now) {
        jobs.push({
          key: `${user.id}:${day}`,
          kind: 'shift_report',
          user_id: user.id,
          business_day: day,
          due_at: new Date(end).toISOString(),
          ready: true,
          title: `تقرير شيفت ${user.name}`,
          body: `انتهى ميعاد شيفت ${user.name} اليوم (${day}). اضغط لفتح تقرير الحضور.`,
          report_url: `/api/attendance/day-close?date=${day}`
        });
      }
    }
  }

  if (!jobs.length) {
    return { checked: 0, dispatched: 0, keys: [] };
  }

  // Check which keys have already been delivered
  const keys = jobs.map(j => j.key);
  const deliveredResult = await query<{ job_key: string }>(
    'SELECT job_key FROM admin_push_deliveries WHERE job_key = ANY($1)',
    [keys]
  );
  const deliveredSet = new Set(deliveredResult.rows.map(r => r.job_key));

  const pendingJobs = jobs.filter(j => !deliveredSet.has(j.key));
  if (!pendingJobs.length) {
    return { checked: jobs.length, dispatched: 0, keys: [] };
  }

  const dispatchedKeys: string[] = [];

  for (const job of pendingJobs) {
    try {
      const pushResult = await broadcastPushToAdmins({
        title: job.title,
        body: job.body,
        kind: job.kind,
        key: job.key,
        business_day: job.business_day,
        user_id: job.user_id ?? undefined,
        report_url: job.report_url,
        filename: job.filename,
      });

      // If at least one device was reached, or if no devices are registered yet, record delivery to avoid spamming
      await query(
        'INSERT INTO admin_push_deliveries (job_key, delivered_at) VALUES ($1, NOW()) ON CONFLICT DO NOTHING',
        [job.key]
      );
      dispatchedKeys.push(job.key);
    } catch (err) {
      console.error(`Failed to dispatch alert ${job.key}:`, err);
    }
  }

  return {
    checked: jobs.length,
    dispatched: dispatchedKeys.length,
    keys: dispatchedKeys,
  };
}
