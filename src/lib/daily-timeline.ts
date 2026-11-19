import { query } from './db';
import { cairoTime, nextDay } from './time';
import { prayerWindowsFor } from './prayer-times';
import { formatDurationArabic } from './geo';
import { BLE_STALE_SECONDS } from './ble';

export interface TimelineSegment {
  startPercent: number; // 0 to 100 on the 15:00 - 01:00 scale
  endPercent: number;   // 0 to 100
  startTime: string;    // HH:MM (Cairo)
  endTime: string;      // HH:MM (Cairo)
  durationMinutes: number;
  type: 'present' | 'prayer_absent' | 'absent' | 'off_session';
  branchId?: 'branch1' | 'branch2' | 'outside';
  label: string;
}

export interface EmployeeDailyTimeline {
  userId: number;
  userName: string;
  userRole: string;
  day: string;
  rulerStart: string; // ISO
  rulerEnd: string;   // ISO
  shiftStart: string; // ISO
  shiftEnd: string;   // ISO
  clockIn: string | null;  // ISO
  clockOut: string | null; // ISO
  clockInPercent: number | null;
  clockOutPercent: number | null;
  statusSegments: TimelineSegment[];
  branchSegments: TimelineSegment[];
  stats: {
    totalPresentMinutes: number;
    totalPresentFormatted: string;
    prayerAbsentMinutes: number;
    prayerAbsentFormatted: string;
    unexcusedAbsentMinutes: number;
    unexcusedAbsentFormatted: string;
    branch1Minutes: number;
    branch1Formatted: string;
    branch2Minutes: number;
    branch2Formatted: string;
    clockInFormatted: string;
    clockOutFormatted: string;
  };
}

function hhmm(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function arabicClock(iso: string | null): string {
  if (!iso) return 'لم يسجل';
  return new Date(iso).toLocaleTimeString('ar-EG', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export async function computeEmployeeDailyTimeline(
  userId: number,
  userName: string,
  userRole: string,
  day: string,
  now = new Date()
): Promise<EmployeeDailyTimeline> {
  const rulerStartDate = cairoTime(day, '15:00');
  const rulerEndDate = cairoTime(nextDay(day), '01:00');
  const shiftStartDate = cairoTime(day, '16:00');
  const shiftEndDate = cairoTime(nextDay(day), '00:00');

  const rStart = +rulerStartDate;
  const rEnd = +rulerEndDate;
  const totalRulerMs = rEnd - rStart; // 10 hours = 36,000,000 ms

  const toPercent = (timeMs: number) => {
    const clamped = Math.max(rStart, Math.min(rEnd, timeMs));
    return ((clamped - rStart) / totalRulerMs) * 100;
  };

  // 1. NFC Card logs for arrival & departure
  const cardLogs = (await query<{ timestamp: Date; event_type: string }>(
    `SELECT timestamp, event_type FROM attendance_logs 
     WHERE user_id = $1 AND shift_day = $2 AND source = 'nfc' 
     ORDER BY timestamp ASC, id ASC`,
    [userId, day]
  )).rows;

  const inLog = cardLogs.find(l => l.event_type === 'clock_in');
  const outLog = cardLogs.find(l => l.event_type === 'clock_out');

  const clockIn = inLog ? new Date(inLog.timestamp).toISOString() : null;
  const clockOut = outLog ? new Date(outLog.timestamp).toISOString() : null;

  const clockInPercent = inLog ? toPercent(+new Date(inLog.timestamp)) : null;
  const clockOutPercent = outLog ? toPercent(+new Date(outLog.timestamp)) : null;

  // Session start & end for attendance tracking
  // If no check-in, employee was never checked in.
  // If check-in exists but no check-out, day is forcibly capped at shiftEndDate (00:00 midnight)
  const sessionStartMs = inLog ? +new Date(inLog.timestamp) : null;
  const sessionEndMs = inLog
    ? (outLog ? +new Date(outLog.timestamp) : Math.min(+now, +shiftEndDate))
    : null;

  // 2. Prayer windows
  const prayerWindows = await prayerWindowsFor(day);

  // 3. User's active BLE tags
  const tags = (await query<{ address: string; grace_seconds: number }>(
    `SELECT address, grace_seconds FROM ble_tags WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  )).rows;
  const tagAddresses = tags.map(t => t.address);

  // 4. Receivers mapping (branch1 vs branch2)
  const receivers = (await query<{ id: string; branch_id: string }>(
    `SELECT id, branch_id FROM nfc_devices WHERE is_active = TRUE`
  )).rows;
  const branchByDevice = new Map<string, 'branch1' | 'branch2'>();
  for (const r of receivers) {
    branchByDevice.set(r.id, r.branch_id === 'branch2' ? 'branch2' : 'branch1');
  }

  // 5. Fetch BLE events in range [rStart - 60s, rEnd]
  const bleEvents = tagAddresses.length > 0
    ? (await query<{
        device_id: string;
        tag_address: string;
        state: string;
        recorded_at: Date;
        grace_seconds: number;
      }>(
        `SELECT device_id, tag_address, state, recorded_at, grace_seconds 
         FROM ble_events 
         WHERE user_id = $1 AND tag_address = ANY($2::text[])
           AND recorded_at >= $3 AND recorded_at <= $4
         ORDER BY recorded_at ASC, id ASC`,
        [userId, tagAddresses, new Date(rStart - 60000), new Date(rEnd)]
      )).rows
    : [];

  // Heartbeats for receivers
  const heartbeats = (await query<{ device_id: string; recorded_at: Date; state: string }>(
    `SELECT device_id, recorded_at, state FROM ble_receiver_heartbeats
     WHERE recorded_at >= $1 AND recorded_at <= $2 ORDER BY recorded_at ASC`,
    [new Date(rStart - 120000), new Date(rEnd)]
  )).rows;

  // Build 1-minute discrete slots across the 600-minute ruler window (15:00 to 01:00)
  const TOTAL_SLOTS = 600; // 600 minutes
  interface SlotState {
    minute: number; // 0 to 599
    timeMs: number;
    seen: boolean;
    branch: 'branch1' | 'branch2' | 'outside';
    isSession: boolean;
    isPrayer: boolean;
  }

  const slots: SlotState[] = [];
  for (let m = 0; m < TOTAL_SLOTS; m++) {
    const slotTimeMs = rStart + m * 60000;
    const isSession = sessionStartMs !== null && sessionEndMs !== null && slotTimeMs >= sessionStartMs && slotTimeMs < sessionEndMs;
    const isPrayer = prayerWindows.some(w => slotTimeMs >= w.start && slotTimeMs < w.end);

    // Check BLE presence at slotTimeMs
    let seen = false;
    let branch: 'branch1' | 'branch2' | 'outside' = 'outside';

    if (tagAddresses.length > 0) {
      // Find latest event per device within grace period
      for (const [devId, bId] of branchByDevice.entries()) {
        const ev = bleEvents
          .filter(e => e.device_id === devId && +new Date(e.recorded_at) <= slotTimeMs)
          .at(-1);

        if (ev && ev.state === 'seen') {
          const evTime = +new Date(ev.recorded_at);
          const graceMs = (ev.grace_seconds || 90) * 1000;
          if (slotTimeMs - evTime <= graceMs) {
            seen = true;
            branch = bId;
            break;
          }
        }
      }
    }

    slots.push({
      minute: m,
      timeMs: slotTimeMs,
      seen,
      branch,
      isSession,
      isPrayer,
    });
  }

  // Aggregate into contiguous segments for Ruler 1 (Status)
  // Status:
  // - 'present' (Green): seen by BLE
  // - 'prayer_absent' (Yellow): not seen, but within session AND during prayer time
  // - 'absent' (Red): not seen, within session AND outside prayer time
  // - 'off_session' (Gray): before check-in or after check-out/close
  const statusSegments: TimelineSegment[] = [];
  let curType: TimelineSegment['type'] | null = null;
  let segStartM = 0;

  const getSlotType = (s: SlotState): TimelineSegment['type'] => {
    if (s.seen) return 'present';
    if (!s.isSession) return 'off_session';
    return s.isPrayer ? 'prayer_absent' : 'absent';
  };

  const typeLabels: Record<TimelineSegment['type'], string> = {
    present: 'حاضر (بلوتوث)',
    prayer_absent: 'خارج المحل (أثناء الصلاة)',
    absent: 'غير متواجد (غياب خارج الصلاة)',
    off_session: 'خارج فترة الدوام',
  };

  for (let m = 0; m <= TOTAL_SLOTS; m++) {
    const sType = m < TOTAL_SLOTS ? getSlotType(slots[m]) : null;
    if (sType !== curType) {
      if (curType !== null) {
        const durationMin = m - segStartM;
        const segStartTime = new Date(rStart + segStartM * 60000);
        const segEndTime = new Date(rStart + m * 60000);
        statusSegments.push({
          startPercent: (segStartM / TOTAL_SLOTS) * 100,
          endPercent: (m / TOTAL_SLOTS) * 100,
          startTime: hhmm(segStartTime),
          endTime: hhmm(segEndTime),
          durationMinutes: durationMin,
          type: curType,
          label: typeLabels[curType],
        });
      }
      curType = sType;
      segStartM = m;
    }
  }

  // Aggregate into contiguous segments for Ruler 2 (Branches)
  const branchSegments: TimelineSegment[] = [];
  let curBranch: TimelineSegment['branchId'] | null = null;
  let bStartM = 0;

  const branchLabels: Record<'branch1' | 'branch2' | 'outside', string> = {
    branch1: 'المحل الأول (الرئيسي)',
    branch2: 'المحل الثاني (الجملة)',
    outside: 'خارج الفروع',
  };

  for (let m = 0; m <= TOTAL_SLOTS; m++) {
    const b = m < TOTAL_SLOTS ? slots[m].branch : null;
    if (b !== curBranch) {
      if (curBranch !== null) {
        const durationMin = m - bStartM;
        const segStartTime = new Date(rStart + bStartM * 60000);
        const segEndTime = new Date(rStart + m * 60000);
        branchSegments.push({
          startPercent: (bStartM / TOTAL_SLOTS) * 100,
          endPercent: (m / TOTAL_SLOTS) * 100,
          startTime: hhmm(segStartTime),
          endTime: hhmm(segEndTime),
          durationMinutes: durationMin,
          type: curBranch === 'outside' ? 'off_session' : 'present',
          branchId: curBranch,
          label: branchLabels[curBranch],
        });
      }
      curBranch = b;
      bStartM = m;
    }
  }

  // Calculate statistics
  let totalPresentMin = 0;
  let prayerAbsentMin = 0;
  let unexcusedAbsentMin = 0;
  let branch1Min = 0;
  let branch2Min = 0;

  for (const s of slots) {
    if (s.seen) {
      totalPresentMin++;
      if (s.branch === 'branch1') branch1Min++;
      else if (s.branch === 'branch2') branch2Min++;
    } else if (s.isSession) {
      if (s.isPrayer) prayerAbsentMin++;
      else unexcusedAbsentMin++;
    }
  }

  return {
    userId,
    userName,
    userRole,
    day,
    rulerStart: rulerStartDate.toISOString(),
    rulerEnd: rulerEndDate.toISOString(),
    shiftStart: shiftStartDate.toISOString(),
    shiftEnd: shiftEndDate.toISOString(),
    clockIn,
    clockOut,
    clockInPercent,
    clockOutPercent,
    statusSegments,
    branchSegments,
    stats: {
      totalPresentMinutes: totalPresentMin,
      totalPresentFormatted: formatDurationArabic(totalPresentMin),
      prayerAbsentMinutes: prayerAbsentMin,
      prayerAbsentFormatted: formatDurationArabic(prayerAbsentMin),
      unexcusedAbsentMinutes: unexcusedAbsentMin,
      unexcusedAbsentFormatted: formatDurationArabic(unexcusedAbsentMin),
      branch1Minutes: branch1Min,
      branch1Formatted: formatDurationArabic(branch1Min),
      branch2Minutes: branch2Min,
      branch2Formatted: formatDurationArabic(branch2Min),
      clockInFormatted: arabicClock(clockIn),
      clockOutFormatted: outLog ? arabicClock(clockOut) : (inLog ? 'لم يسجل (إغلاق إجباري 12:00 ص)' : '—'),
    },
  };
}
