import { evaluatePunctuality, formatDurationArabic, StoreSettings } from './geo';
import { shiftWindow } from './time';
import { localDate } from './time';

function shiftDay(log:AttendanceLog){return typeof log.shift_day==='string'?log.shift_day.slice(0,10):log.shift_day?localDate(new Date(log.shift_day)):null;}

export interface AttendanceLog {
  id: number; timestamp: string | Date; branch_id: string; event_type: string;
  lat?: number; lng?: number; accuracy?: number; received_at?: string; client_event_id?: string;
  tracking_deadline?:string|Date; source?: string; shift_day?: string | Date; nfc_scan_id?: number;
}
export interface AttendanceReport {
  attendanceSource:string;missingCheckout:boolean;missingArrival:boolean;provisionalMinutes:number;
  hasLogs:boolean;logCount:number;firstArrival:string|null;lastDeparture:string|null;onDuty:boolean;exitCount:number;
  punctuality:ReturnType<typeof evaluatePunctuality>;
  summary:{cardMinutes:number;cardFormatted:string;totalMinutes:number;totalFormatted:string;branch1Minutes:number;branch1Formatted:string;branch2Minutes:number;branch2Formatted:string;outsideMinutes:number;outsideFormatted:string;unknownMinutes:number;unknownFormatted:string;regularMinutes:number;regularFormatted:string;overtimeMinutes:number;overtimeFormatted:string;earlyDepartureMinutes:number;earlyDepartureFormatted:string;branches:{id:string;name:string;minutes:number;formatted:string}[]};
  timeline:{branch_id:string;branch_name:string;start:string;end:string;durationMinutes:number;durationFormatted:string}[];
}

export function buildReport(
  user: { shift_start?: string; shift_end?: string }, logs: AttendanceLog[], settings: StoreSettings,
  day: string, rangeStart: Date, rangeEnd: Date, now = new Date(),
):AttendanceReport {
  const shift = shiftWindow(day, user.shift_start || settings.shift_start_time, user.shift_end || settings.shift_end_time);
  const usesCard=settings.attendance_mode==='nfc'&&(!settings.nfc_enabled_at||day>=localDate(new Date(settings.nfc_enabled_at)));
  if(usesCard||logs.some(l=>l.source==='nfc'&&shiftDay(l)===day))return cardReport(user,logs,settings,day,shift,now);
  const cutoff = Math.min(now.getTime(), rangeEnd.getTime());
  const gapLimit = Math.max(180, settings.ping_interval_secs * 3) * 1000;
  const totals: Record<string, number> = { branch1: 0, branch2: 0, outside: 0, unknown: 0 };
  const timeline: { branch_id: string; branch_name: string; start: string; end: string; durationMinutes: number; durationFormatted: string }[] = [];
  let firstArrival: string | null = null;
  let lastDeparture: string | null = null;
  let onDuty = false;
  let regular = 0, overtime = 0, exitCount = 0;
  let previousBranch: string | null = null;
  const names: Record<string, string> = {
    branch1: settings.branch1_name, branch2: settings.branch2_name,
    outside: 'خارج الفروع', unknown: 'فجوة تتبع / موقع غير دقيق',
    ...Object.fromEntries((settings.branches || []).map(b => [b.id, b.name])),
  };
  const inside = (branch: string) => branch !== 'outside' && branch !== 'unknown';
  const add = (branch: string, start: number, end: number) => {
    start = Math.max(start, rangeStart.getTime()); end = Math.min(end, cutoff);
    if (end <= start) return;
    const minutes = (end - start) / 60000;
    totals[branch] = (totals[branch] || 0) + minutes;
    if (inside(branch)) {
      regular += Math.max(0, Math.min(end, shift.end.getTime()) - Math.max(start, shift.start.getTime())) / 60000;
      overtime += Math.max(0, end - Math.max(start, shift.end.getTime())) / 60000;
    }
    const previous = timeline.at(-1);
    if (previous?.branch_id === branch && Date.parse(previous.end) === start) {
      previous.end = new Date(end).toISOString();
      previous.durationMinutes += minutes;
      previous.durationFormatted = formatDurationArabic(previous.durationMinutes);
    } else timeline.push({ branch_id: branch, branch_name: names[branch] || branch, start: new Date(start).toISOString(), end: new Date(end).toISOString(), durationMinutes: minutes, durationFormatted: formatDurationArabic(minutes) });
  };
  const sorted = [...logs].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime() || a.id - b.id);
  for (let i = 0; i < sorted.length; i++) {
    const log = sorted[i];
    const t = new Date(log.timestamp).getTime();
    if (t > cutoff) break;
    if (log.event_type === 'clock_out') {
      if (onDuty) lastDeparture = new Date(t).toISOString();
      onDuty = false; previousBranch = null;
      continue;
    }
    if (log.event_type === 'clock_in') onDuty = true;
    // Legacy pings have no client ID; keep historical records readable.
    if (!log.client_event_id && log.event_type === 'ping') onDuty = true;
    if (!onDuty) continue;
    if (t >= rangeStart.getTime() && inside(log.branch_id) && !firstArrival) firstArrival = new Date(t).toISOString();
    if (previousBranch && inside(previousBranch) && log.branch_id === 'outside') {
      exitCount++; lastDeparture = new Date(t).toISOString();
    }
    if (inside(log.branch_id)) lastDeparture = null;
    previousBranch = log.branch_id;
    const end = Math.min(sorted[i + 1] ? new Date(sorted[i + 1].timestamp).getTime() : cutoff, cutoff);
    const evidenceEnd = Math.min(end, t + gapLimit);
    add(log.branch_id, t, evidenceEnd);
    // Missing samples are visible and never paid as confirmed presence.
    add('unknown', evidenceEnd, end);
  }
  const total = Object.entries(totals).filter(([key]) => inside(key)).reduce((sum, [,value]) => sum + value, 0);
  const minutes = (value: number) => Math.round(value);
  const earlyDeparture = !onDuty && lastDeparture ? Math.max(0, (shift.end.getTime() - Date.parse(lastDeparture)) / 60000) : 0;
  return {
    attendanceSource:'gps',missingCheckout:false,missingArrival:false,provisionalMinutes:0,
    hasLogs: logs.some(l => new Date(l.timestamp) >= rangeStart), logCount: logs.length,
    firstArrival, lastDeparture, onDuty, exitCount,
    punctuality: evaluatePunctuality(firstArrival, user.shift_start || settings.shift_start_time, settings.grace_period_mins, shift.start),
    summary: {
      cardMinutes:0,cardFormatted:formatDurationArabic(0),totalMinutes: minutes(total), totalFormatted: formatDurationArabic(total),
      branch1Minutes: minutes(totals.branch1), branch1Formatted: formatDurationArabic(totals.branch1),
      branch2Minutes: minutes(totals.branch2), branch2Formatted: formatDurationArabic(totals.branch2),
      outsideMinutes: minutes(totals.outside), outsideFormatted: formatDurationArabic(totals.outside),
      unknownMinutes: minutes(totals.unknown), unknownFormatted: formatDurationArabic(totals.unknown),
      regularMinutes: minutes(regular), regularFormatted: formatDurationArabic(regular),
      overtimeMinutes: minutes(overtime), overtimeFormatted: formatDurationArabic(overtime),
      earlyDepartureMinutes: minutes(earlyDeparture), earlyDepartureFormatted: formatDurationArabic(earlyDeparture),
      branches: Object.entries(totals).filter(([key]) => inside(key)).map(([id, value]) => ({ id, name: names[id] || id, minutes: minutes(value), formatted: formatDurationArabic(value) })),
    }, timeline,
  };
}

// Card attendance and sampled GPS evidence are deliberately calculated separately.
function cardReport(user:{shift_start?:string;shift_end?:string},logs:AttendanceLog[],settings:StoreSettings,day:string,shift:{start:Date;end:Date},now:Date):AttendanceReport{
  const cards=logs.filter(l=>l.source==='nfc'&&shiftDay(l)===day&&new Date(l.timestamp)<=now).sort((a,b)=>+new Date(a.timestamp)-+new Date(b.timestamp)||a.id-b.id);
  const arrival=cards.find(l=>l.event_type==='clock_in'),departure=cards.find(l=>l.event_type==='clock_out');
  const firstArrival=arrival?new Date(arrival.timestamp).toISOString():null,lastDeparture=departure?new Date(departure.timestamp).toISOString():null;
  const start=arrival?+new Date(arrival.timestamp):+shift.start;
  const deadline=arrival?.tracking_deadline?+new Date(arrival.tracking_deadline):start+(settings.max_tracking_hours??12)*3600000;
  const end=departure?+new Date(departure.timestamp):Math.min(+now,deadline);
  const from=start,to=Math.max(from,Math.min(end,deadline,+now));
  const gps=logs.filter(l=>l.event_type==='ping'&&l.source!=='nfc'&&+new Date(l.timestamp)>=from&&+new Date(l.timestamp)<to);
  const controls:AttendanceLog[]=arrival?[{id:-2,timestamp:new Date(from),branch_id:'unknown',event_type:'clock_in',client_event_id:'gps-evidence'},...gps,{id:Number.MAX_SAFE_INTEGER,timestamp:new Date(to),branch_id:'unknown',event_type:'clock_out',client_event_id:'gps-evidence'}]:[];
  const evidence=buildReport(user,controls,{...settings,attendance_mode:'gps'},day,new Date(from),new Date(to),now);
  const validPair=Boolean(arrival&&departure&&end>=start);
  const total=validPair?(end-start)/60000:0;

  const early=validPair?Math.max(0,(+shift.end-end)/60000):0;
  return {...evidence,attendanceSource:'nfc',hasLogs:cards.length>0||gps.length>0,logCount:cards.length+gps.length,
    firstArrival,lastDeparture,onDuty:Boolean(arrival&&!departure&&+now<deadline),
    missingCheckout:Boolean(arrival&&!departure),missingArrival:Boolean(departure&&!arrival)||Boolean(arrival&&departure&&end<start),
    provisionalMinutes:arrival&&!departure?Math.round(Math.max(0,end-start)/60000):0,
    punctuality:evaluatePunctuality(firstArrival,user.shift_start||settings.shift_start_time,settings.grace_period_mins,shift.start),
    summary:{...evidence.summary,cardMinutes:Math.round(total),cardFormatted:formatDurationArabic(total),earlyDepartureMinutes:Math.round(early),earlyDepartureFormatted:formatDurationArabic(early)},
  };
}
