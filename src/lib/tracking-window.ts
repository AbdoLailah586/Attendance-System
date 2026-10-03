import {addDays,policyOn,type EmployeePolicy} from './period-report';
import {localDate,shiftWindow} from './time';
import type {AppUser} from './types';
export interface TrackingWindow {day:string;start:number;end:number}
export function scheduleWindows(user:AppUser,policies:EmployeePolicy[],now=new Date()):TrackingWindow[]{
  const day=localDate(now),windows:TrackingWindow[]=[];
  for(let i=-1;i<7;i++){
    const date=addDays(day,i),p=policyOn(user,policies,date);
    if(user.is_active===false||user.role!=='employee'||!p.is_active||p.role!=='employee'||date<(user.attendance_start_date||'1900-01-01')||!p.work_days.includes(new Date(date+'T12:00:00Z').getUTCDay()))continue;
    const shift=shiftWindow(date,p.shift_start,p.shift_end);
    windows.push({day:date,start:+shift.start,end:+shift.end});
  }
  return windows;
}
export const inTrackingWindow=(windows:TrackingWindow[],time=Date.now())=>windows.some(w=>time>=w.start&&time<w.end);
