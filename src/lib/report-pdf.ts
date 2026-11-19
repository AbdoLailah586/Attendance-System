// Renders a full HTML document to a PDF buffer using headless Chromium for Arabic letter-joining.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EmployeeDailyTimeline, TimelineSegment } from './daily-timeline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT_DIR = path.join(__dirname, 'fonts');
let fontFaceCss: string | undefined;

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
    await page.evaluateHandle('document.fonts.ready');
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
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

export const PDF_STYLES = `
  ${loadFontFaceCss()}
  * { box-sizing: border-box; }
  body {
    font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
    direction: rtl;
    text-align: right;
    color: #0f172a;
    background: #ffffff;
    margin: 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.4;
  }
  .employee-page {
    page-break-after: always;
    min-height: 98vh;
    padding-bottom: 20px;
  }
  .employee-page:last-child {
    page-break-after: auto;
  }
  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 2px solid #2563eb;
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .masthead .brand {
    font-size: 10px;
    color: #64748b;
    font-weight: 600;
  }
  .masthead h1 {
    font-size: 18px;
    font-weight: 700;
    margin: 2px 0;
    color: #1e3a8a;
  }
  .masthead .subtitle {
    font-size: 10.5px;
    color: #475569;
  }
  .meta-box {
    text-align: left;
    font-size: 11px;
    direction: ltr;
  }
  .badge-present {
    background: #dcfce7;
    color: #15803d;
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 11px;
    direction: rtl;
    display: inline-block;
  }
  .badge-absent {
    background: #fee2e2;
    color: #b91c1c;
    padding: 4px 10px;
    border-radius: 999px;
    font-weight: 700;
    font-size: 11px;
    direction: rtl;
    display: inline-block;
  }

  /* Stats Grid Outside Ruler */
  .stat-grid-main {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }
  .stat-box {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 8px 10px;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .stat-box.primary {
    background: #f0fdf4;
    border-color: #bbf7d0;
  }
  .stat-box.prayer {
    background: #fefce8;
    border-color: #fef08a;
  }
  .stat-box.unexcused {
    background: #fef2f2;
    border-color: #fecaca;
  }
  .stat-label {
    font-size: 9.5px;
    color: #64748b;
    font-weight: 600;
    margin-bottom: 2px;
  }
  .stat-val {
    font-size: 15px;
    font-weight: 700;
    color: #0f172a;
  }
  .highlight-green { color: #16a34a; }
  .highlight-yellow { color: #b45309; }
  .highlight-red { color: #dc2626; }
  .highlight-blue { color: #2563eb; }
  .highlight-purple { color: #7c3aed; }

  /* Ruler Section */
  .ruler-card {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    padding: 12px 14px;
    background: #ffffff;
    margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.02);
  }
  .ruler-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 14px;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ruler-title {
    font-size: 12.5px;
    font-weight: 700;
    color: #1e293b;
  }
  .ruler-legend {
    display: flex;
    gap: 12px;
    font-size: 10px;
    color: #475569;
  }
  .legend-item {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block;
  }
  .dot.green { background: #16a34a; }
  .dot.yellow { background: #eab308; }
  .dot.red { background: #dc2626; }
  .dot.gray { background: #cbd5e1; }
  .dot.blue { background: #2563eb; }
  .dot.purple { background: #9333ea; }
  .dot.lightgray { background: #f1f5f9; border: 1px solid #cbd5e1; }

  .ruler-wrapper {
    position: relative;
    padding-top: 26px;
    padding-bottom: 10px;
    margin: 0 4px;
  }
  .ruler-ticks {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 24px;
  }
  .tick {
    position: absolute;
    transform: translateX(50%);
    text-align: center;
    font-size: 8.5px;
    color: #64748b;
    font-weight: 600;
    white-space: nowrap;
    direction: ltr;
  }
  .tick::after {
    content: '';
    position: absolute;
    bottom: -6px;
    left: 50%;
    width: 1px;
    height: 6px;
    background: #cbd5e1;
  }
  .tick.shift-start {
    color: #16a34a;
    font-weight: 700;
  }
  .tick.shift-start::after {
    background: #16a34a;
    height: 8px;
    width: 2px;
  }
  .tick.shift-end {
    color: #dc2626;
    font-weight: 700;
  }
  .tick.shift-end::after {
    background: #dc2626;
    height: 8px;
    width: 2px;
  }

  .ruler-bar-track {
    position: relative;
    height: 28px;
    border-radius: 6px;
    background: #f1f5f9;
    border: 1px solid #cbd5e1;
    overflow: visible;
  }
  .ruler-seg {
    position: absolute;
    top: 0;
    bottom: 0;
    height: 100%;
  }
  .ruler-seg.seg-present { background: #16a34a; }
  .ruler-seg.seg-prayer_absent { background: #eab308; }
  .ruler-seg.seg-absent { background: #dc2626; }
  .ruler-seg.seg-off_session { background: #e2e8f0; }
  .ruler-seg.seg-branch1 { background: #2563eb; }
  .ruler-seg.seg-branch2 { background: #9333ea; }
  .ruler-seg.seg-outside { background: #f8fafc; }

  /* Pin Markers for Clock-In & Clock-Out */
  .marker-pin {
    position: absolute;
    top: -18px;
    bottom: -6px;
    width: 2px;
    z-index: 10;
    pointer-events: none;
    transform: translateX(50%);
  }
  .marker-pin.pin-in {
    background: #1e3a8a;
  }
  .marker-pin.pin-out {
    background: #b91c1c;
  }
  .pin-badge {
    position: absolute;
    top: -14px;
    left: 50%;
    transform: translateX(-50%);
    background: #1e3a8a;
    color: #ffffff;
    font-size: 8px;
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 4px;
    white-space: nowrap;
    direction: rtl;
  }
  .marker-pin.pin-out .pin-badge {
    background: #b91c1c;
  }

  /* Transition Table */
  .table-card {
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    overflow: hidden;
    margin-top: 10px;
  }
  .table-header {
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    padding: 6px 12px;
    font-weight: 700;
    font-size: 11px;
    color: #475569;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10.5px;
  }
  th, td {
    padding: 5px 10px;
    border-bottom: 1px solid #f1f5f9;
    text-align: right;
  }
  th {
    background: #ffffff;
    font-weight: 700;
    color: #64748b;
    border-bottom: 1px solid #e2e8f0;
  }
  tr:last-child td {
    border-bottom: none;
  }
  td.ltr-cell {
    direction: ltr;
    text-align: left;
  }
`;

function renderRulerBar(
  title: string,
  legendHtml: string,
  segments: TimelineSegment[],
  typeClassPrefix: 'seg-' | 'branch-',
  clockInPercent: number | null = null,
  clockInText: string | null = null,
  clockOutPercent: number | null = null,
  clockOutText: string | null = null
): string {
  const segDivs = segments.map(s => {
    const width = Math.max(0.1, s.endPercent - s.startPercent);
    // RTL positioning: on RTL page, left or right. We can use left with LTR wrapper or right in RTL!
    // Using left % with direction: ltr wrapper guarantees exact 15:00 to 01:00 progression from left to right.
    const keyClass = typeClassPrefix === 'branch-' ? `seg-${s.branchId || 'outside'}` : `seg-${s.type}`;
    return `<div class="ruler-seg ${keyClass}" style="left: ${s.startPercent.toFixed(2)}%; width: ${width.toFixed(2)}%;" title="${s.label} (${s.startTime} - ${s.endTime})"></div>`;
  }).join('');

  let markersHtml = '';
  if (clockInPercent !== null && clockInPercent >= 0 && clockInPercent <= 100) {
    markersHtml += `
      <div class="marker-pin pin-in" style="left: ${clockInPercent.toFixed(2)}%;">
        <div class="pin-badge">حضور ${clockInText || ''}</div>
      </div>
    `;
  }
  if (clockOutPercent !== null && clockOutPercent >= 0 && clockOutPercent <= 100) {
    markersHtml += `
      <div class="marker-pin pin-out" style="left: ${clockOutPercent.toFixed(2)}%;">
        <div class="pin-badge">انصراف ${clockOutText || ''}</div>
      </div>
    `;
  }

  return `
    <div class="ruler-card">
      <div class="ruler-header">
        <div class="ruler-title">${title}</div>
        <div class="ruler-legend">${legendHtml}</div>
      </div>
      <div class="ruler-wrapper" style="direction: ltr;">
        <div class="ruler-ticks">
          <div class="tick" style="left: 0%;"><span>03:00 PM</span></div>
          <div class="tick shift-start" style="left: 10%;"><span>04:00 PM<br><b>بداية الشيفت</b></span></div>
          <div class="tick" style="left: 20%;"><span>05:00 PM</span></div>
          <div class="tick" style="left: 30%;"><span>06:00 PM</span></div>
          <div class="tick" style="left: 40%;"><span>07:00 PM</span></div>
          <div class="tick" style="left: 50%;"><span>08:00 PM</span></div>
          <div class="tick" style="left: 60%;"><span>09:00 PM</span></div>
          <div class="tick" style="left: 70%;"><span>10:00 PM</span></div>
          <div class="tick" style="left: 80%;"><span>11:00 PM</span></div>
          <div class="tick shift-end" style="left: 90%;"><span>12:00 AM<br><b>نهاية الشيفت</b></span></div>
          <div class="tick" style="left: 100%;"><span>01:00 AM</span></div>
        </div>
        <div class="ruler-bar-track">
          ${segDivs}
          ${markersHtml}
        </div>
      </div>
    </div>
  `;
}

function renderEmployeePage(t: EmployeeDailyTimeline, generatedAt: string): string {
  const statusLegend = `
    <span class="legend-item"><span class="dot green"></span> حاضر بالبلوتوث</span>
    <span class="legend-item"><span class="dot yellow"></span> خارج المحل (أثناء الصلاة)</span>
    <span class="legend-item"><span class="dot red"></span> غير متواجد (خارج الصلاة)</span>
    <span class="legend-item"><span class="dot gray"></span> خارج فترة الدوام</span>
  `;

  const branchLegend = `
    <span class="legend-item"><span class="dot blue"></span> المحل الأول (الرئيسي)</span>
    <span class="legend-item"><span class="dot purple"></span> المحل الثاني (الجملة)</span>
    <span class="legend-item"><span class="dot lightgray"></span> خارج الفروع</span>
  `;

  const statusRulerHtml = renderRulerBar(
    'مسطرة التواجد وحالة الحضور (تتبع البلوتوث BLE فقط بدون لوكيشن)',
    statusLegend,
    t.statusSegments,
    'seg-',
    t.clockInPercent,
    t.stats.clockInFormatted,
    t.clockOutPercent,
    t.stats.clockOutFormatted
  );

  const branchRulerHtml = renderRulerBar(
    'مسطرة التواجد بين الفروع (المحل الأول vs المحل الثاني)',
    branchLegend,
    t.branchSegments,
    'branch-'
  );

  // Filter meaningful segments for the table (duration >= 1 min)
  const tableRows = t.statusSegments
    .filter(s => s.durationMinutes >= 1)
    .map(s => {
      let badgeCls = 'highlight-green';
      if (s.type === 'prayer_absent') badgeCls = 'highlight-yellow';
      else if (s.type === 'absent') badgeCls = 'highlight-red';
      else if (s.type === 'off_session') badgeCls = '';

      return `<tr>
        <td class="${badgeCls}"><strong>${s.label}</strong></td>
        <td class="ltr-cell">${s.startTime}</td>
        <td class="ltr-cell">${s.endTime}</td>
        <td>${s.durationMinutes} دقيقة</td>
        <td>${s.type === 'prayer_absent' ? 'مستثنى ومقبول (فترة الصلاة)' : (s.type === 'absent' ? 'فجوة تتبع / غير متواجد' : '—')}</td>
      </tr>`;
    }).join('');

  return `
    <div class="employee-page">
      <header class="masthead">
        <div>
          <div class="brand">نظام الحضور والانصراف • جو ستور</div>
          <h1>التقرير اليومي: ${t.userName}</h1>
          <div class="subtitle">الشيفت الرسمي: 04:00 عصراً إلى 12:00 منتصف الليل • نافذة الانصراف المتاحة حتى 01:00 صباحاً</div>
        </div>
        <div class="meta-box">
          <div style="font-weight: 700; color: #1e3a8a; margin-bottom: 4px;">${t.day}</div>
          <div><span class="${t.clockIn ? 'badge-present' : 'badge-absent'}">${t.clockIn ? 'سجل حضور بالكارت' : 'لم يسجل كارت'}</span></div>
        </div>
      </header>

      <!-- Outside Numbers & Stats Grid -->
      <div class="stat-grid-main">
        <div class="stat-box primary">
          <span class="stat-label">🕒 إجمالي الحضور الفعلي (بلوتوث)</span>
          <span class="stat-val highlight-green">${t.stats.totalPresentFormatted}</span>
        </div>
        <div class="stat-box prayer">
          <span class="stat-label">🕌 عدم التواجد في أوقات الصلاة</span>
          <span class="stat-val highlight-yellow">${t.stats.prayerAbsentFormatted}</span>
        </div>
        <div class="stat-box unexcused">
          <span class="stat-label">⚠️ عدم التواجد خارج أوقات الصلاة</span>
          <span class="stat-val highlight-red">${t.stats.unexcusedAbsentFormatted}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">🏬 إجمالي المحل الأول (الرئيسي)</span>
          <span class="stat-val highlight-blue">${t.stats.branch1Formatted}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">🏪 إجمالي المحل الثاني (الجملة)</span>
          <span class="stat-val highlight-purple">${t.stats.branch2Formatted}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">🏷️ وقت تسجيل الحضور</span>
          <span class="stat-val">${t.stats.clockInFormatted}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">🏷️ وقت تسجيل الانصراف</span>
          <span class="stat-val">${t.stats.clockOutFormatted}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">📅 دورة الشهر الحسابية</span>
          <span class="stat-val" style="font-size: 13px;">تبدأ يوم 20 من كل شهر</span>
        </div>
      </div>

      <!-- RULER 1: Presence & Prayer Status -->
      ${statusRulerHtml}

      <!-- RULER 2: Branches -->
      ${branchRulerHtml}

      <!-- Table -->
      <div class="table-card">
        <div class="table-header">سجل الفترات الزمنية التفصيلي للموظف</div>
        <table>
          <thead>
            <tr>
              <th>الحالة</th>
              <th>من</th>
              <th>إلى</th>
              <th>المدة</th>
              <th>ملاحظات</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows || '<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding: 12px;">لا توجد فترات مسجلة</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

export function dailyReportPdfHtml(businessDay: string, timelines: EmployeeDailyTimeline[]): string {
  const generatedAt = new Date().toLocaleString('en-GB', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });
  const pagesHtml = timelines.map(t => renderEmployeePage(t, generatedAt)).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>التقرير اليومي الشامل - ${businessDay}</title>
  <style>${PDF_STYLES}</style>
</head>
<body>
  ${pagesHtml}
</body>
</html>`;
}

// Keep legacy interfaces for backwards compatibility with period reports
export interface PdfTimelineEntry { branch_id: string; branch_name: string; start: string; end: string; durationFormatted: string }

const PERIOD_STATUS_LABELS: Record<string, string> = {
  present: 'حاضر',
  absent: 'غائب',
  off: 'راحة أسبوعية',
  pending: 'الشيفت لم ينتهِ',
  upcoming: 'لم يبدأ الشيفت',
  unverified: 'حضور غير مؤكد',
  untracked: 'خارج فترة المتابعة'
};

function formatClockTime(val: string | null | undefined): string {
  if (!val) return '—';
  try {
    return new Date(val).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: true });
  } catch {
    return '—';
  }
}

function formatBleSeconds(sec = 0): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h} س ${m} د`;
  return `${m} دقيقة`;
}

export function periodReportPdfHtml(reports: any[], title: string): string {
  const range = reports[0] ? `${reports[0].start || ''} — ${reports[0].end || ''}` : '';
  const generatedAt = new Date().toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', dateStyle: 'medium', timeStyle: 'short' });

  const sectionsHtml = (reports || []).map(r => {
    const u = r.user || {};
    const s = r.summary || {};
    const days = r.days || [];

    const dayRows = days.map((d: any) => {
      const statusText = PERIOD_STATUS_LABELS[d.status] || d.status;
      const isAbsent = d.status === 'absent';
      const isPresent = d.status === 'present';
      const statusClass = isPresent ? 'highlight-green' : isAbsent ? 'highlight-red' : '';
      const arrival = formatClockTime(d.firstArrival);
      const departure = formatClockTime(d.lastDeparture);
      const bleObserved = d.ble_has_history ? formatBleSeconds(d.ble_summary?.observed_seconds) : '—';
      const bleNotSeen = d.ble_has_history ? formatBleSeconds(d.ble_summary?.not_seen_seconds) : '—';

      return `<tr>
        <td>${d.date}</td>
        <td class="${statusClass}"><strong>${statusText}</strong></td>
        <td>${d.policy?.shift_start || '—'} - ${d.policy?.shift_end || '—'}</td>
        <td class="ltr-cell">${arrival}</td>
        <td class="ltr-cell">${departure}</td>
        <td>${d.summary?.totalFormatted || '—'}</td>
        <td>${bleObserved}</td>
        <td style="${d.ble_summary?.not_seen_seconds > 0 ? 'color:#dc2626;font-weight:700;' : ''}">${bleNotSeen}</td>
        <td>${d.summary?.prayerFormatted || '0 دقيقة'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="employee-page">
        <header class="masthead">
          <div>
            <div class="brand">نظام الحضور والانصراف • جو ستور</div>
            <h1>${title}: ${u.name || ''}</h1>
            <div class="subtitle">اسم المستخدم: ${u.username || ''} • الفترة: ${r.start || ''} إلى ${r.end || ''}</div>
          </div>
          <div class="meta-box">
            <div style="font-weight:700; color:#1e3a8a;">${days.length} يوم في الفترة</div>
            <div style="color:#64748b; font-size:10px;">أُنشئ: ${generatedAt}</div>
          </div>
        </header>

        <div class="stat-grid-main">
          <div class="stat-box primary">
            <span class="stat-label">📅 أيام الحضور الفعلي</span>
            <span class="stat-val highlight-green">${s.presentDays ?? 0} يوم</span>
          </div>
          <div class="stat-box unexcused">
            <span class="stat-label">❌ أيام الغياب الكامل</span>
            <span class="stat-val highlight-red">${s.absentDays ?? 0} يوم</span>
          </div>
          <div class="stat-box unexcused">
            <span class="stat-label">⚠️ إجمالي الغياب وعدم التواجد</span>
            <span class="stat-val highlight-red">${s.absenceTotal?.formatted || '0 دقيقة'}</span>
          </div>
          <div class="stat-box prayer">
            <span class="stat-label">🕌 مستثنى أوقات الصلاة</span>
            <span class="stat-val highlight-yellow">${s.prayer?.formatted || '0 دقيقة'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">🏷️ فترة الكارت المعتمدة</span>
            <span class="stat-val highlight-blue">${s.card?.formatted || '0 دقيقة'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">🏬 داخل الفروع المحددة</span>
            <span class="stat-val">${s.total?.formatted || '0 دقيقة'}</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">☕ أيام الراحة</span>
            <span class="stat-val">${s.offDays ?? 0} يوم</span>
          </div>
          <div class="stat-box">
            <span class="stat-label">⏰ أيام التأخير</span>
            <span class="stat-val">${s.lateDays ?? 0} يوم</span>
          </div>
        </div>

        <div class="table-card">
          <div class="table-header">سجل تفاصيل أيام الفترة</div>
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الحالة</th>
                <th>الشيفت</th>
                <th>وصل</th>
                <th>انصرف</th>
                <th>إجمالي الوقت</th>
                <th>رصد التاج</th>
                <th>التاج غير مرصود</th>
                <th>وقت الصلاة</th>
              </tr>
            </thead>
            <tbody>
              ${dayRows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:12px;">لا توجد سجلات في هذه الفترة</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <title>${title} - ${range}</title>
  <style>${PDF_STYLES}</style>
</head>
<body>
  ${sectionsHtml || '<div style="padding:40px;text-align:center;font-size:16px;">لا توجد بيانات متاحة لهذا التقرير</div>'}
</body>
</html>`;
}
