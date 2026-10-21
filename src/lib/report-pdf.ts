// Renders a full HTML document to a PDF buffer using a real headless Chromium — not a
// lightweight PDF-drawing library — specifically so Arabic text gets proper letter-joining.
// On Vercel (Linux serverless) this uses @sparticuz/chromium's bundled binary via
// puppeteer-core; locally (this dev machine is Windows) it falls back to full `puppeteer`,
// which downloads its own OS-appropriate Chromium — so this can be exercised in local dev too.
//
// @sparticuz/chromium's minimal build ships with NO Arabic fonts installed (confirmed in
// production: labels rendered as blank glyphs, only digits/Latin text showed). The fix is to
// embed an Arabic font directly in the page as a base64 data URI, so rendering never depends
// on whatever fonts happen to exist on the machine running Chromium.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, 'fonts');
let fontFaceCss: string | undefined;

// Cairo (SIL Open Font License — see src/lib/fonts/OFL.txt), embedded once per process.
function loadFontFaceCss(): string {
  if (fontFaceCss) return fontFaceCss;
  const weights: [string, number][] = [['Cairo-Regular.ttf', 400], ['Cairo-SemiBold.ttf', 600], ['Cairo-Bold.ttf', 700]];
  fontFaceCss = weights.map(([file, weight]) => {
    const base64 = fs.readFileSync(path.join(FONT_DIR, file)).toString('base64');
    return `@font-face { font-family: 'Cairo'; font-weight: ${weight}; font-style: normal; src: url(data:font/ttf;base64,${base64}) format('truetype'); }`;
  }).join('\n');
  return fontFaceCss;
}

export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  const isServerless = !!process.env.VERCEL;
  const browser = isServerless ? await launchServerless() : await launchLocal();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluateHandle('document.fonts.ready'); // embedded @font-face must finish loading before paint
    const pdf = await page.pdf({
      format: 'A4', printBackground: true, margin: { top: '18mm', bottom: '16mm', left: '14mm', right: '14mm' },
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:9px;color:#94a3b8;text-align:center;font-family:Arial,sans-serif;">
        <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
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

// Design system: one accent blue, a slate neutral scale, and the three gap labels already
// used on-screen in AttendanceReports.tsx (kept identical so the PDF reads as the same
// product, not a different tool). Stat tiles are a fixed CSS grid so the layout never
// reflows between reports — only the numbers inside it change, as requested.
const INK = '#0f172a', MUTED = '#64748b', BORDER = '#e2e8f0', ACCENT_DARK = '#1d4ed8', SOFT_BG = '#f8fafc';
export const PDF_STYLES = `
  ${loadFontFaceCss()}
  * { box-sizing: border-box; }
  body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; text-align: right; color: ${INK}; margin: 0; padding: 0; font-size: 13px; line-height: 1.5; }
  .masthead { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid ${ACCENT_DARK}; padding-bottom: 14px; margin-bottom: 22px; }
  .masthead .brand { font-size: 11px; color: ${MUTED}; font-weight: 600; letter-spacing: 0.3px; }
  .masthead h1 { font-size: 21px; font-weight: 700; margin: 2px 0 0; color: ${ACCENT_DARK}; }
  .masthead .meta-box { text-align: left; font-size: 10.5px; color: ${MUTED}; direction: ltr; }
  .masthead .meta-box div { margin-bottom: 2px; }
  .employee-card { page-break-inside: avoid; border: 1px solid ${BORDER}; border-radius: 10px; margin-bottom: 18px; overflow: hidden; }
  .employee-head { background: ${SOFT_BG}; border-bottom: 1px solid ${BORDER}; padding: 10px 16px; display: flex; align-items: baseline; justify-content: space-between; }
  .employee-head h2 { font-size: 15px; font-weight: 700; margin: 0; }
  .employee-head .username { font-size: 11px; color: ${MUTED}; direction: ltr; unicode-bidi: isolate; }
  .employee-head .range { font-size: 10.5px; color: ${MUTED}; direction: ltr; }
  .employee-body { padding: 14px 16px 16px; }
  .headline-banner { display: flex; align-items: center; justify-content: space-between; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 14px; margin-bottom: 4px; }
  .headline-banner span { font-weight: 700; color: #991b1b; font-size: 12.5px; }
  .headline-banner strong { font-size: 17px; color: #991b1b; }
  .stat-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 14px; }
  .stat-grid.secondary { grid-template-columns: repeat(2, 1fr); max-width: 50%; margin-right: auto; }
  .stat { border: 1px solid ${BORDER}; border-radius: 8px; padding: 8px 10px; background: #fff; }
  .stat .stat-label { font-size: 10px; color: ${MUTED}; font-weight: 600; display: block; margin-bottom: 4px; }
  .stat .stat-value { font-size: 15px; font-weight: 700; color: ${INK}; }
  .stat.accent-prayer .stat-value { color: #7c3aed; }
  .stat.accent-unknown .stat-value { color: #b91c1c; }
  h3.block-title { font-size: 11.5px; font-weight: 700; color: ${MUTED}; margin: 14px 0 6px; text-transform: none; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { border: 1px solid ${BORDER}; padding: 6px 9px; text-align: right; }
  th { background: ${SOFT_BG}; font-weight: 700; color: ${INK}; font-size: 10.5px; }
  tbody tr:nth-child(even) td { background: #fafbfc; }
  td.ltr-cell { direction: ltr; unicode-bidi: isolate; text-align: left; }
  .empty-note { color: ${MUTED}; font-size: 11.5px; padding: 8px 2px; margin: 0; }
  .label-unknown { color: #b91c1c; font-weight: 600; }
  .label-prayer { color: #7c3aed; font-weight: 600; }
  .label-outside { color: #92400e; font-weight: 600; }
`;

export function pageShell(title: string, generatedAt: string, dateRange: string, bodyHtml: string): string {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${title}</title><style>${PDF_STYLES}</style></head>
    <body>
      <header class="masthead">
        <div><div class="brand">نظام الحضور والانصراف</div><h1>${title}</h1></div>
        <div class="meta-box"><div>${dateRange}</div><div>Generated ${generatedAt}</div></div>
      </header>
      ${bodyHtml}
    </body></html>`;
}

const TIMELINE_LABEL_CLASS: Record<string, string> = { unknown: 'label-unknown', prayer: 'label-prayer', outside: 'label-outside' };
const arabicTime = (iso: string) => new Date(iso).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
const ltr = (text: string) => `<span dir="ltr">${text}</span>`;

export interface PdfTimelineEntry { branch_id: string; branch_name: string; start: string; end: string; durationFormatted: string }
export function timelineTableHtml(timeline: PdfTimelineEntry[]): string {
  if (!timeline.length) return '<p class="empty-note">لا توجد فجوات أو استثناءات مسجلة في هذه الفترة.</p>';
  const rows = timeline.map(t => {
    const cls = TIMELINE_LABEL_CLASS[t.branch_id] || '';
    return `<tr><td class="${cls}">${t.branch_name}</td><td class="ltr-cell">${arabicTime(t.start)}</td><td class="ltr-cell">${arabicTime(t.end)}</td><td>${t.durationFormatted}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>الحالة</th><th>من</th><th>إلى</th><th>المدة</th></tr></thead><tbody>${rows}</tbody></table>`;
}

const STATUS_LABELS: Record<string, string> = { present: 'حاضر', absent: 'غائب', off: 'راحة أسبوعية', pending: 'الشيفت لم ينتهِ', upcoming: 'لم يبدأ الشيفت', unverified: 'حضور غير مؤكد', untracked: 'خارج فترة المتابعة' };

function statTile(label: string, value: string, variant?: 'prayer' | 'unknown'): string {
  const cls = variant ? ` accent-${variant}` : '';
  return `<div class="stat${cls}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
}

interface PeriodReportDay {
  date: string; status: string; firstArrival: string | null; lastDeparture: string | null;
  summary: { cardMinutes: number; cardFormatted: string }; timeline: PdfTimelineEntry[];
}
interface PeriodReportLike {
  user: { name: string; username: string }; start: string | null; end: string | null;
  summary: { total: { formatted: string }; card: { formatted: string }; regular: { formatted: string }; overtime: { formatted: string };
    outside: { formatted: string }; unknown: { formatted: string }; prayer: { formatted: string };
    absenceTotal: { formatted: string }; absentShiftMinutes: { formatted: string } };
  days: PeriodReportDay[];
}

function employeeSectionHtml(report: PeriodReportLike): string {
  const dayRows = report.days.map(d => `<tr><td class="ltr-cell">${d.date}</td><td>${STATUS_LABELS[d.status] || d.status}</td>
      <td class="ltr-cell">${d.firstArrival ? arabicTime(d.firstArrival) : '—'}</td><td class="ltr-cell">${d.lastDeparture ? arabicTime(d.lastDeparture) : '—'}</td><td>${d.summary.cardFormatted}</td></tr>`).join('');
  const gaps = report.days.flatMap(d => d.timeline.filter(t => t.branch_id === 'unknown' || t.branch_id === 'prayer'));
  return `<section class="employee-card">
    <div class="employee-head">
      <h2>${report.user.name} <span class="username">(${report.user.username})</span></h2>
      <span class="range">${ltr((report.start || '') + ' — ' + (report.end || ''))}</span>
    </div>
    <div class="employee-body">
      <div class="headline-banner">
        <span>إجمالي الغياب وعدم التواجد الفعلي (الرقم النهائي)</span>
        <strong>${report.summary.absenceTotal.formatted}</strong>
      </div>
      <p class="empty-note">يجمع أيام الغياب الكاملة (${report.summary.absentShiftMinutes.formatted}) وفجوات التتبع أثناء الشيفت (${report.summary.unknown.formatted})، باستثناء وقت الصلاة.</p>
      <div class="stat-grid">
        ${statTile('إجمالي الوقت', report.summary.total.formatted)}
        ${statTile('فترة الكارت', report.summary.card.formatted)}
        ${statTile('الأساسي', report.summary.regular.formatted)}
        ${statTile('الإضافي', report.summary.overtime.formatted)}
        ${statTile('خارج الفروع', report.summary.outside.formatted)}
      </div>
      <div class="stat-grid secondary">
        ${statTile('فجوات تتبع', report.summary.unknown.formatted, 'unknown')}
        ${statTile('مستثنى (وقت الصلاة)', report.summary.prayer.formatted, 'prayer')}
      </div>
      <h3 class="block-title">تفاصيل الأيام</h3>
      <table><thead><tr><th>اليوم</th><th>الحالة</th><th>أول وصول</th><th>آخر انصراف</th><th>فترة الكارت</th></tr></thead><tbody>${dayRows}</tbody></table>
      <h3 class="block-title">فترات عدم التواجد (فجوات التتبع والاستثناءات)</h3>
      ${timelineTableHtml(gaps)}
    </div>
  </section>`;
}

export function periodReportPdfHtml(reports: PeriodReportLike[], title: string): string {
  const range = reports[0] ? `${reports[0].start || ''} — ${reports[0].end || ''}` : '';
  const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
  return pageShell(title, generatedAt, range, reports.map(employeeSectionHtml).join(''));
}

interface DayCloseReportLike {
  user: { name: string; username: string }; firstArrival: string | null; lastDeparture: string | null;
  summary: { cardFormatted: string; unknownFormatted: string; prayerFormatted: string; outsideFormatted: string };
  timeline: PdfTimelineEntry[];
}
function dayCloseSectionHtml(report: DayCloseReportLike): string {
  const gaps = report.timeline.filter(t => t.branch_id === 'unknown' || t.branch_id === 'prayer');
  return `<section class="employee-card">
    <div class="employee-head">
      <h2>${report.user.name} <span class="username">(${report.user.username})</span></h2>
    </div>
    <div class="employee-body">
      <div class="stat-grid">
        ${statTile('أول وصول', report.firstArrival ? arabicTime(report.firstArrival) : 'لم يحضر')}
        ${statTile('آخر انصراف', report.lastDeparture ? arabicTime(report.lastDeparture) : '—')}
        ${statTile('فترة الكارت', report.summary.cardFormatted)}
        ${statTile('خارج الفروع', report.summary.outsideFormatted)}
      </div>
      <div class="stat-grid secondary">
        ${statTile('فجوات تتبع', report.summary.unknownFormatted, 'unknown')}
        ${statTile('مستثنى (وقت الصلاة)', report.summary.prayerFormatted, 'prayer')}
      </div>
      <h3 class="block-title">فترات عدم التواجد (فجوات التتبع والاستثناءات)</h3>
      ${timelineTableHtml(gaps)}
    </div>
  </section>`;
}

export function dailyReportPdfHtml(businessDay: string, reports: DayCloseReportLike[]): string {
  const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
  return pageShell('التقرير اليومي الشامل', generatedAt, businessDay, reports.map(dayCloseSectionHtml).join(''));
}
