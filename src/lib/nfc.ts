import { createHash } from 'crypto';
import { addDays, policyOn, type EmployeePolicy } from './period-report';
import { localDate, shiftWindow } from './time';
import type { AppUser } from './types';

export interface NfcWindows { nfc_in_before?:number; nfc_in_after?:number; nfc_out_before?:number; nfc_out_after?:number }
export const NFC_DEFAULTS = {nfc_in_before:60,nfc_in_after:120,nfc_out_before:60,nfc_out_after:180};
export const tokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function cardUid(value:unknown):string|null {
  if(typeof value!=='string')return null;
  const uid=value.replace(/[:\s-]/g,'').toUpperCase();
  return /^(?:[0-9A-F]{8}|[0-9A-F]{10}|[0-9A-F]{14}|[0-9A-F]{20})$/.test(uid)?uid:null;
}
export const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
export function classifyScan(user:AppUser,policies:EmployeePolicy[],timestamp:Date){
  const candidates:{event_type:'clock_in'|'clock_out';shift_day:string}[]=[];
  const day=localDate(timestamp),time=+timestamp;
  for(let delta=-2;delta<=1;delta++){
    const date=addDays(day,delta),p=policyOn(user,policies,date);
    if(!p.is_active||p.role!=='employee'||!p.work_days.includes(new Date(date+'T12:00:00Z').getUTCDay())||date<(user.attendance_start_date||'1900-01-01'))continue;
    const shift=shiftWindow(date,p.shift_start,p.shift_end);
    if(time>=+shift.start-(p.nfc_in_before??60)*60000&&time<=+shift.start+(p.nfc_in_after??120)*60000)candidates.push({event_type:'clock_in',shift_day:date});
    if(time>=+shift.end-(p.nfc_out_before??60)*60000&&time<=+shift.end+(p.nfc_out_after??180)*60000)candidates.push({event_type:'clock_out',shift_day:date});
  }
  return candidates.length===1?{status:'accepted',...candidates[0]}:{status:candidates.length?'ambiguous_window':'outside_window',event_type:null,shift_day:null};
}
