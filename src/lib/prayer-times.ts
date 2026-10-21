import { query } from './db';
import { ensureAttendanceSchema, loadSettings } from './schema';
import { cairoTime, nextDay } from './time';

export const PRAYER_GRACE_MINUTES = 40;
const PRAYERS = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type PrayerName = typeof PRAYERS[number];
export interface PrayerTimes { date: string; fajr: string; dhuhr: string; asr: string; maghrib: string; isha: string }

interface AladhanTimings { Fajr: string; Dhuhr: string; Asr: string; Maghrib: string; Isha: string }
interface AladhanDay { date: { gregorian: { date: string } }; timings: AladhanTimings }

// Strip any "(TimezoneAbbrev)" suffix Aladhan sometimes appends (e.g. "04:32 (EET)").
function hhmm(value: string): string {
  return value.slice(0, 5);
}

async function fetchMonth(year: number, month: number, lat: number, lng: number): Promise<PrayerTimes[]> {
  const url = `https://api.aladhan.com/v1/calendar/${year}/${month}?latitude=${lat}&longitude=${lng}&method=5`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Aladhan API returned ${response.status}`);
  const body = await response.json() as { code: number; data: AladhanDay[] };
  if (body.code !== 200 || !Array.isArray(body.data)) throw new Error('Unexpected Aladhan API response');
  return body.data.map(day => {
    // Aladhan returns gregorian dates as DD-MM-YYYY.
    const [d, m, y] = day.date.gregorian.date.split('-');
    return {
      date: `${y}-${m}-${d}`, fajr: hhmm(day.timings.Fajr), dhuhr: hhmm(day.timings.Dhuhr),
      asr: hhmm(day.timings.Asr), maghrib: hhmm(day.timings.Maghrib), isha: hhmm(day.timings.Isha),
    };
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// In-process cache of in-flight/completed month loads, keyed "YYYY-MM". A report can ask for
// dozens of days concurrently (a monthly period report, times two for overnight-shift lookahead);
// without this, each one would independently hit the DB and the Aladhan API, exhausting the
// connection pool and the API's rate limit. This collapses that fan-out to one load per month.
const monthCache = new Map<string, Promise<Map<string, PrayerTimes>>>();

async function loadMonth(year: number, month: number): Promise<Map<string, PrayerTimes>> {
  await ensureAttendanceSchema();
  const total = daysInMonth(year, month);
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = `${year}-${String(month).padStart(2, '0')}-${String(total).padStart(2, '0')}`;
  const cached = (await query<PrayerTimes>('SELECT date::text,fajr,dhuhr,asr,maghrib,isha FROM prayer_times WHERE date BETWEEN $1 AND $2', [first, last])).rows;
  const map = new Map(cached.map(row => [row.date, row]));
  if (map.size >= total) return map; // whole month already cached
  try {
    const settings = await loadSettings();
    const branch = settings.branches?.[0];
    const lat = branch?.lat ?? settings.branch1_lat, lng = branch?.lng ?? settings.branch1_lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return map;
    const days = await fetchMonth(year, month, lat, lng);
    for (const day of days) {
      await query(`INSERT INTO prayer_times(date,fajr,dhuhr,asr,maghrib,isha,source,fetched_at) VALUES($1,$2,$3,$4,$5,$6,'aladhan',NOW())
        ON CONFLICT(date) DO UPDATE SET fajr=$2,dhuhr=$3,asr=$4,maghrib=$5,isha=$6,source='aladhan',fetched_at=NOW()`,
      [day.date, day.fajr, day.dhuhr, day.asr, day.maghrib, day.isha]);
      map.set(day.date, day);
    }
  } catch (error) {
    console.error('Prayer times fetch failed', error);
  }
  return map;
}

function getMonth(year: number, month: number): Promise<Map<string, PrayerTimes>> {
  const key = `${year}-${String(month).padStart(2, '0')}`;
  let promise = monthCache.get(key);
  if (!promise) {
    promise = loadMonth(year, month);
    monthCache.set(key, promise);
    // A failed load (e.g. a transient DB/API outage) should not poison the cache forever.
    promise.catch(() => monthCache.delete(key));
  }
  return promise;
}

// Never throws — a prayer-time outage should degrade to "no exemption applied", not break a report.
export async function getPrayerTimes(date: string): Promise<PrayerTimes | null> {
  const [year, month] = date.split('-').map(Number);
  const map = await getMonth(year, month);
  return map.get(date) || null;
}

// Absolute [start,end) windows (epoch ms) for every prayer on `day`, each PRAYER_GRACE_MINUTES
// long starting at the adhan time. Covers `day` and the day after, so an overnight shift that
// crosses midnight still sees the next day's Fajr/Dhuhr/etc. windows.
export async function prayerWindowsFor(day: string): Promise<{ start: number; end: number }[]> {
  const windows: { start: number; end: number }[] = [];
  for (const date of [day, nextDay(day)]) {
    const times = await getPrayerTimes(date);
    if (!times) continue;
    for (const prayer of PRAYERS) {
      const start = +cairoTime(date, times[prayer]);
      windows.push({ start, end: start + PRAYER_GRACE_MINUTES * 60000 });
    }
  }
  return windows;
}
