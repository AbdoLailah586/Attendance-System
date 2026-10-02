'use client';
import { useCallback, useEffect, useState } from 'react';
import { localDate } from '@/lib/time';
interface Log { id:number; name:string; username:string; branch_id:string; event_type:string; timestamp:string; received_at:string; lat:number|null; lng:number|null; accuracy:number|null }
export default function AttendanceLogViewer() {
  const [date,setDate]=useState(localDate());
  const [page,setPage]=useState(1);
  const [logs,setLogs]=useState<Log[]>([]);
  const [total,setTotal]=useState(0);
  const [error,setError]=useState('');
  const load=useCallback(async () => {
    try { const res=await fetch(`/api/attendance/logs?date=${date}&page=${page}`); const data=await res.json(); if(!res.ok)throw new Error(data.error); setLogs(data.logs);setTotal(data.total);setError(''); }
    catch(e){setError(e instanceof Error?e.message:'تعذر تحميل السجل');}
  },[date,page]);
  useEffect(()=>{let mounted=true;fetch(`/api/attendance/logs?date=${date}&page=${page}`).then(async res=>{const data=await res.json();if(!res.ok)throw new Error(data.error);if(mounted){setLogs(data.logs);setTotal(data.total);setError('');}}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[date,page]);
  const time=(value:string)=>new Date(value).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'});
  return <section className="card"><div className="section-title"><h3>سجل الحضور والحركة · بتوقيت القاهرة</h3><input aria-label="تاريخ السجل" type="date" className="form-input" style={{maxWidth:180}} value={date} onChange={e=>{setDate(e.target.value);setPage(1);}}/><button className="btn btn-secondary" onClick={()=>void load()}>تحديث</button></div>
    <p className="muted">وقت الحدث هو وقت التقاطه على الجهاز، ووقت الاستلام يوضح الأحداث التي وصلت بعد انقطاع النت.</p>{error&&<p role="alert">{error}</p>}
    <div style={{overflowX:'auto'}}><table className="data-table"><thead><tr><th>الموظف</th><th>الحدث</th><th>الفرع</th><th>وقت الحدث</th><th>وصل للسيرفر</th><th>GPS</th></tr></thead><tbody>{logs.map(log=><tr key={log.id}><td>{log.name}<br/><small>{log.username}</small></td><td>{log.event_type==='clock_in'?'بدء شيفت':log.event_type==='clock_out'?'انصراف':'تحديث موقع'}</td><td>{log.branch_id}</td><td>{time(log.timestamp)}</td><td>{time(log.received_at)}</td><td>{log.lat==null?'—':`${log.lat.toFixed(5)}, ${log.lng?.toFixed(5)} · ±${Math.round(log.accuracy||0)}م`}</td></tr>)}</tbody></table></div>
    <div className="section-title"><button className="btn btn-secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>السابق</button><span>صفحة {page} · {total} أحداث</span><button className="btn btn-secondary" disabled={logs.length<100||page*100>=total} onClick={()=>setPage(p=>p+1)}>التالي</button></div>
  </section>;
}
