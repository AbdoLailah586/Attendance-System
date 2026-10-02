import type { buildReport, AttendanceLog } from './attendance';
export interface AppUser { id:number; username:string; name:string; role:'admin'|'employee'; phone?:string; shift_start?:string; shift_end?:string; is_active?:boolean }
export type DailyReport = ReturnType<typeof buildReport> & { user: AppUser };
export type LiveEmployee = DailyReport & { isOnline:boolean; minutesSincePing:number|null; currentStatus:string; latestLog:(AttendanceLog & {distance_branch1?:number;distance_branch2?:number})|null };
