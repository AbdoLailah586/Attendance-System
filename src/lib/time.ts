export const TIME_ZONE = 'Africa/Cairo';

export function localDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Resolve wall-clock times against IANA timezone rules, including Egypt's DST.
export function cairoTime(day: string, time = '00:00'): Date {
  const wall = Date.parse(`${day}T${time}:00Z`);
  let value = wall;
  for (let i = 0; i < 4; i++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(value));
    const p = Object.fromEntries(parts.map(part => [part.type, part.value]));
    const represented = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const correction = wall - represented;
    if (!correction) break;
    value += correction;
  }
  return new Date(value);
}

export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
}

export function shiftWindow(day: string, start: string, end: string) {
  return { start: cairoTime(day, start), end: cairoTime(end <= start ? nextDay(day) : day, end) };
}

export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day;
}
