'use client';
import {useEffect,useState} from 'react';
import type {DayCloseData} from '@/lib/day-close-report';
const clock=(value:string|null)=>value?new Date(value).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}):'—';
const duration=(seconds=0)=>`${Math.floor(seconds/3600)} س ${Math.floor(seconds%3600/60)} د`;
export default function DayCloseReport(){
  const [date,setDate]=useState(''),[employee,setEmployee]=useState(''),[data,setData]=useState<DayCloseData|null>(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0);
  useEffect(()=>{const c=new AbortController();setData(null);const load=async()=>{try{const r=await fetch('/api/attendance/day-close'+(date?'?date='+date:''),{cache:'no-store',signal:c.signal});const d=await r.json();if(!r.ok)throw new Error(d.error);setData(d);setError('');}catch(e){if(!c.signal.aborted)setError((e as Error).message);}};void load();const t=setInterval(()=>void load(),60000);return()=>{c.abort();clearInterval(t);};},[date,refresh]);
  const reports=data?.reports.filter(r=>!employee||r.user.id===Number(employee))||[];
  const totals=reports.reduce((s,r)=>({seen:s.seen+(r.ble_summary?.observed_seconds||0),lost:s.lost+(r.ble_summary?.not_seen_seconds||0),unknown:s.unknown+(r.ble_summary?.unknown_seconds||0)}),{seen:0,lost:0,unknown:0});
  return <section aria-label="التقرير اليومي للموظفين">
    <div className="card"><div className="section-title"><h3>التقرير اليومي للموظفين</h3><button className="btn btn-secondary" onClick={()=>setRefresh(n=>n+1)}>تحديث التقرير</button></div>
      <p className="muted">الحضور والانصراف بالكارت. التاج يرصد التواجد أثناء جلسة الحضور؛ فقده لا يغلق الشيفت ولا يثبت غياب صاحبه.</p>
      <div className="report-filters"><label>يوم العمل<input type="date" className="form-input" value={date==='current'?data?.businessDay||'':date||data?.businessDay||''} onChange={e=>setDate(e.target.value)}/></label><label>الموظف<select className="form-input" value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">كل الموظفين</option>{data?.reports.map(r=><option key={r.user.id} value={r.user.id}>{r.user.name}</option>)}</select></label></div>
      <div className="report-actions"><button className="btn btn-secondary" onClick={()=>setDate('current')}>يوم العمل الحالي</button><button className="btn btn-secondary" onClick={()=>setDate('')}>آخر يوم مكتمل</button></div>
      {error&&<p role="alert" className="tracker-warning">{error}</p>}{!data&&!error&&<p role="status">جاري تحميل التقرير…</p>}
      {data&&<><p>يوم {data.businessDay} · بداية يوم العمل {data.boundary} · آخر تحديث {clock(data.generatedAt)}</p><div className="grid-3"><div><strong>{duration(totals.seen)}</strong><p>إجمالي وقت التاجات المرصودة</p></div><div style={{color:'#b91c1c'}}><strong>{duration(totals.lost)}</strong><p>غير مرصود · للمراجعة</p></div><div><strong>{duration(totals.unknown)}</strong><p>الرصد غير معلوم</p></div></div></>}
    </div>
    {reports.map(r=><article className="card" key={r.user.id}>
      <div className="section-title"><h3>{r.user.name} <small>({r.user.username})</small></h3><strong>{r.lastDeparture?'انصراف بالكارت':r.firstArrival?(r.onDuty?'جلسة الحضور مفتوحة':'لم يسجل انصرافًا'):'لم يسجل حضورًا'}</strong></div>
      <p className="muted">الشيفت المحدد: {clock(r.scheduledShiftStart)} ← {clock(r.scheduledShiftEnd)}</p>
      <div className="grid-3"><div><small>حضور الكارت</small><p><strong>{clock(r.firstArrival)}</strong></p></div><div><small>انصراف الكارت</small><p><strong>{r.lastDeparture?clock(r.lastDeparture):'لم يسجل انصرافًا'}</strong></p></div><div><small>آخر ظهور للتاج</small><p><strong>{clock(r.lastTagSeen)}</strong></p></div></div>
      <div className="grid-3"><div><small>التاج مرصود داخل نطاق الفروع</small><p><strong>{duration(r.ble_summary?.observed_seconds)}</strong></p></div><div style={{color:'#b91c1c'}}><small>التاج غير مرصود · يحتاج مراجعة</small><p><strong>{duration(r.ble_summary?.not_seen_seconds)}</strong></p></div><div><small>الرصد غير معلوم / اتصال القارئ</small><p><strong>{duration(r.ble_summary?.unknown_seconds)}</strong></p></div></div>
      <p>فترة متابعة الكارت: {duration(r.ble_summary?.session_seconds)} · فترة الكارت المكتملة: {r.summary.cardFormatted}{r.provisionalMinutes>0?` · فترة مفتوحة ${Math.round(r.provisionalMinutes)} دقيقة`:''}</p>
      {!!r.ble_branches?.length&&<details><summary>تفاصيل الرصد في كل فرع</summary>{r.ble_branches.map(b=><p key={b.id}>{b.name}: مرصود {duration(b.observed_seconds)} · غير مرصود {duration(b.not_seen_seconds)} · غير معلوم {duration(b.unknown_seconds)}</p>)}<small>إجمالي الفروع لا يحسب الفترة المتداخلة مرتين.</small></details>}
      <details><summary>المواعيد والمراجعة</summary><p>فتح الحضور: {clock(r.attendanceOpen)} · فتح الانصراف: {clock(r.checkoutOpen)}</p><p>{r.missingCheckout?'انصراف ناقص؛ توقفت المتابعة عند الحد المحدد ولم نختلق وقت انصراف.':r.firstArrival&&!r.lastDeparture?'لم تصل قراءة انصراف؛ آخر ظهور للتاج ليس انصرافًا رسميًا.':'أوقات الكارت مأخوذة من القراءات الفعلية.'}</p><p>الأوقات غير المرصودة وغير المعلومة تُراجع قبل الحساب.</p>{r.ble_truncated&&<p role="alert">بيانات الرصد محدودة؛ راجع الفترة قبل اعتماد التقرير.</p>}</details>
      {!!r.summary.totalMinutes&&<details><summary>سجل GPS السابق</summary><p>داخل الفروع {r.summary.totalFormatted} · خارج الفروع {r.summary.outsideFormatted} · غير معلوم {r.summary.unknownFormatted}</p></details>}
    </article>)}
    {data&&!reports.length&&<p className="card">لا توجد بيانات موظفين لهذا الاختيار.</p>}
  </section>;
}
