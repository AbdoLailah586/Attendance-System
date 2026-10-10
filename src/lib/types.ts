import type { buildReport, AttendanceLog } from './attendance';
import type { BleUserPresence } from './ble-types';
export interface AppUser { attendance_open_time?:string|null; checkout_open_time?:string|null; max_tracking_hours?:number|null; nfc_in_before?:number; nfc_in_after?:number; nfc_out_before?:number; nfc_out_after?:number; id:number; username:string; name:string; role:'admin'|'employee'; phone?:string; shift_start?:string; shift_end?:string; is_active?:boolean; work_days?:number[]; cycle_start_day?:number; attendance_start_date?:string; created_at?:string; grace_period_mins?:number }
export type DailyReport = ReturnType<typeof buildReport> & { user: AppUser };
export type LiveEmployee = DailyReport & { isOnline:boolean; minutesSincePing:number|null; currentStatus:string; latestLog:(AttendanceLog & {distance_branch1?:number;distance_branch2?:number})|null; presence_source?:'ble'|'gps'; ble?:BleUserPresence|null };
