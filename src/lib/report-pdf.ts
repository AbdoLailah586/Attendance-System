// Renders a full HTML document to a PDF buffer using a real headless Chromium — not a
// lightweight PDF-drawing library — specifically so Arabic text gets proper letter-joining,
// identical to how it already renders correctly on screen in the web dashboard.
// On Vercel (Linux serverless) this uses @sparticuz/chromium's bundled binary via
// puppeteer-core; locally (this dev machine is Windows) it falls back to full `puppeteer`,
// which downloads its own OS-appropriate Chromium — so this can be exercised in local dev too.
export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const isServerless = !!process.env.VERCEL;
  const browser = isServerless ? await launchServerless() : await launchLocal();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '12mm', right: '12mm' } });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

async function launchServerless() {
  const [{ default: chromium }, puppeteer] = await Promise.all([import('@sparticuz/chromium'), import('puppeteer-core')]);
  return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
}

async function launchLocal() {
  const puppeteer = await import('puppeteer');
  return puppeteer.launch({ headless: true });
}

export const PDF_STYLES = `
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; text-align: right; color: #0f172a; margin: 0; padding: 0; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-bottom: 2px solid #2563eb; padding-bottom: 6px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 12px; }
  th, td { border: 1px solid #e2e8f0; padding: 6px 8px; text-align: right; }
  th { background: #f1f5f9; }
  .summary-grid { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .stat { border: 1px solid #e2e8f0; border-radius: 8px; padding: 8px 12px; font-size: 12px; min-width: 120px; }
  .stat strong { display: block; font-size: 14px; }
  .label-unknown { color: #b91c1c; }
  .label-prayer { color: #7c3aed; }
  .label-outside { color: #92400e; }
  .employee-section { page-break-inside: avoid; margin-bottom: 20px; }
`;

export function pageShell(title: string, generatedAt: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${PDF_STYLES}</style></head>
    <body><h1>${title}</h1><p class="meta">أُنشئ في: ${generatedAt}</p>${bodyHtml}</body></html>`;
}

const TIMELINE_LABEL_CLASS: Record<string, string> = { unknown: 'label-unknown', prayer: 'label-prayer', outside: 'label-outside' };
const arabicTime = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });

export interface PdfTimelineEntry { branch_id: string; branch_name: string; start: string; end: string; durationFormatted: string }
export function timelineTableHtml(timeline: PdfTimelineEntry[]): string {
  if (!timeline.length) return '<p class="meta">لا توجد حركة مسجلة.</p>';
  const rows = timeline.map(t => {
    const cls = TIMELINE_LABEL_CLASS[t.branch_id] || '';
    return `<tr><td class="${cls}">${t.branch_name}</td><td>${arabicTime(t.start)}</td><td>${arabicTime(t.end)}</td><td>${t.durationFormatted}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>الحالة / الفرع</th><th>من</th><th>إلى</th><th>المدة</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STATUS_LABELS: Record<string, string> = { present: 'حاضر', absent: 'غائب', off: 'راحة أسبوعية', pending: 'الشيفت لم ينتهِ', upcoming: 'لم يبدأ الشيفت', unverified: 'حضور غير مؤكد', untracked: 'خارج فترة المتابعة' };

interface PeriodReportDay {
  date: string; status: string; firstArrival: string | null; lastDeparture: string | null;
  summary: { cardMinutes: number; cardFormatted: string }; timeline: PdfTimelineEntry[];
}
interface PeriodReportLike {
  user: { name: string; username: string }; start: string | null; end: string | null;
  summary: { total: { formatted: string }; card: { formatted: string }; regular: { formatted: string }; overtime: { formatted: string };
    outside: { formatted: string }; unknown: { formatted: string }; prayer: { formatted: string } };
  days: PeriodReportDay[];
}

function employeeSectionHtml(report: PeriodReportLike): string {
  const stat = (label: string, value: string) => `<div class="stat">${label}<strong>${value}</strong></div>`;
  const dayRows = report.days.map(d => `<tr><td>${d.date}</td><td>${STATUS_LABELS[d.status] || d.status}</td>
      <td>${d.firstArrival ? arabicTime(d.firstArrival) : '—'}</td><td>${d.lastDeparture ? arabicTime(d.lastDeparture) : '—'}</td><td>${d.summary.cardFormatted}</td></tr>`).join('');
  const gaps = report.days.flatMap(d => d.timeline.filter(t => t.branch_id === 'unknown' || t.branch_id === 'prayer'));
  return `<section class="employee-section">
    <h2>${report.user.name} (${report.user.username})</h2>
    <p class="meta">${report.start || ''} — ${report.end || ''}</p>
    <div class="summary-grid">
      ${stat('إجمالي الوقت', report.summary.total.formatted)}
      ${stat('فترة الكارت', report.summary.card.formatted)}
      ${stat('الأساسي', report.summary.regular.formatted)}
      ${stat('الإضافي', report.summary.overtime.formatted)}
      ${stat('خارج الفروع', report.summary.outside.formatted)}
      ${stat('فجوات تتبع', report.summary.unknown.formatted)}
      ${stat('مستثنى (وقت الصلاة)', report.summary.prayer.formatted)}
    </div>
    <table><thead><tr><th>اليوم</th><th>الحالة</th><th>أول وصول</th><th>آخر انصراف</th><th>فترة الكارت</th></tr></thead><tbody>${dayRows}</tbody></table>
    <h3>فترات عدم التواجد (فجوات التتبع والاستثناءات)</h3>
    ${timelineTableHtml(gaps)}
  </section>`;
}

export function periodReportPdfHtml(reports: PeriodReportLike[], title: string): string {
  return pageShell(title, new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }), reports.map(employeeSectionHtml).join(''));
}

interface DayCloseReportLike {
  user: { name: string; username: string }; firstArrival: string | null; lastDeparture: string | null;
  summary: { cardFormatted: string; unknownFormatted: string; prayerFormatted: string; outsideFormatted: string };
  timeline: PdfTimelineEntry[];
}
function dayCloseSectionHtml(report: DayCloseReportLike): string {
  const stat = (label: string, value: string) => `<div class="stat">${label}<strong>${value}</strong></div>`;
  const gaps = report.timeline.filter(t => t.branch_id === 'unknown' || t.branch_id === 'prayer');
  return `<section class="employee-section">
    <h2>${report.user.name} (${report.user.username})</h2>
    <div class="summary-grid">
      ${stat('أول وصول', report.firstArrival ? arabicTime(report.firstArrival) : 'لم يحضر')}
      ${stat('آخر انصراف', report.lastDeparture ? arabicTime(report.lastDeparture) : '—')}
      ${stat('فترة الكارت', report.summary.cardFormatted)}
      ${stat('خارج الفروع', report.summary.outsideFormatted)}
      ${stat('فجوات تتبع', report.summary.unknownFormatted)}
      ${stat('مستثنى (وقت الصلاة)', report.summary.prayerFormatted)}
    </div>
    <h3>فترات عدم التواجد (فجوات التتبع والاستثناءات)</h3>
    ${timelineTableHtml(gaps)}
  </section>`;
}

export function dailyReportPdfHtml(businessDay: string, reports: DayCloseReportLike[]): string {
  return pageShell(`التقرير اليومي — ${businessDay}`, new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }), reports.map(dayCloseSectionHtml).join(''));
}
