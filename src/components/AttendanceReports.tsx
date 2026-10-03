'use client';
import { useEffect,useState } from 'react';
import { localDate } from '@/lib/time';
import { addDays,type PeriodReport,type ReportMode } from '@/lib/period-report';
import type { AppUser } from '@/lib/types';

const labels:Record<string,string>={present:'حاضر',absent:'غائب',off:'راحة أسبوعية',pending:'الشيفت لم ينتهِ',upcoming:'لم يبدأ الشيفت',unverified:'حضور غير مؤكد',untracked:'خارج فترة المتابعة'};
function clock(value:string|null){return value?new Date(value).toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'}):'—';}
export default function AttendanceReports({users,refreshKey}:{users:AppUser[];refreshKey:number}){
  const [mode,setMode]=useState<ReportMode>('daily'),[date,setDate]=useState(localDate),[start,setStart]=useState(localDate),[end,setEnd]=useState(localDate),[userId,setUserId]=useState('all');
  const [reports,setReports]=useState<PeriodReport[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[generatedAt,setGeneratedAt]=useState(''),[resetAt,setResetAt]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){setLoading(true);setError('');}});
    const params=new URLSearchParams({mode,date,start,end});if(userId!=='all')params.set('userId',userId);
    void fetch('/api/attendance/period-report?'+params,{cache:'no-store',signal:controller.signal}).then(async response=>{
      const data=await response.json();if(!response.ok)throw new Error(data.error||'تعذر تحميل التقرير');
      if(!controller.signal.aborted){setReports(data.reports);setGeneratedAt(data.generatedAt);setResetAt(data.settings.attendance_reset_at||null);}
    }).catch(e=>{if(!controller.signal.aborted){setError(e.message);setReports([]);}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[mode,date,start,end,userId,refresh,refreshKey]);
  const download=(details:boolean)=>{
    const params=new URLSearchParams({mode,date,start,end,details:String(details)});if(userId!=='all')params.set('userId',userId);
    const link=document.createElement('a');link.href='/api/attendance/export?'+params;link.download='attendance.csv';document.body.appendChild(link);link.click();link.remove();
  };
  return <section className="attendance-reports">
    <div className="card report-controls"><h3>تقارير الحضور والغياب</h3><p className="muted">تقارير فعلية بتوقيت القاهرة، مع تفاصيل كل يوم وكل فرع.</p>
      <div className="report-filters">
        <label>نوع التقرير<select className="form-input" value={mode} onChange={e=>setMode(e.target.value as ReportMode)}><option value="daily">يومي</option><option value="weekly">أسبوعي</option><option value="monthly">شهري حسب دورة الموظف</option><option value="custom">فترة مخصصة</option></select></label>
        {(mode==='daily'||mode==='monthly')&&<label>{mode==='daily'?'تاريخ اليوم':'تاريخ داخل دورة الشهر'}<input className="form-input" type="date" value={date} onInput={e=>setDate(e.currentTarget.value)} onChange={e=>setDate(e.target.value)}/></label>}
        {(mode==='weekly'||mode==='custom')&&<label>من تاريخ<input className="form-input" type="date" value={start} onInput={e=>setStart(e.currentTarget.value)} onChange={e=>setStart(e.target.value)}/></label>}
        {mode==='custom'&&<label>إلى تاريخ<input className="form-input" type="date" value={end} onInput={e=>setEnd(e.currentTarget.value)} onChange={e=>setEnd(e.target.value)}/></label>}
        <label>الموظف<select className="form-input" value={userId} onChange={e=>setUserId(e.target.value)}><option value="all">كل الموظفين</option>{users.filter(u=>u.role==='employee'||reports.some(r=>r.user.id===u.id)).map(u=><option key={u.id} value={u.id}>{u.name}{u.is_active===false?' (معطّل)':''}</option>)}</select></label>
      </div>
      {mode==='weekly'&&<p className="muted">أسبوع من {start} إلى {/^\d{4}-\d{2}-\d{2}$/.test(start)?addDays(start,6):'—'} شاملًا.</p>}
      {mode==='monthly'&&<p className="muted">بداية الدورة تُحدد في بروفايل كل موظف؛ فترة كل موظف موضحة في تقريره. يوم 29–31 يُستخدم فيه آخر يوم متاح بالشهر القصير.</p>}
      <div className="report-actions"><button className="btn btn-secondary" onClick={()=>setRefresh(n=>n+1)}>تحديث التقرير</button><button className="btn btn-primary" disabled={loading||!reports.length} onClick={()=>download(false)}>تصدير ملخص CSV</button><button className="btn btn-secondary" disabled={loading||!reports.length} onClick={()=>download(true)}>تصدير تفاصيل الأيام</button></div>
      <p className="muted">الغياب يُحسب بعد انتهاء الشيفت في أيام العمل المحددة. الأيام القادمة وما قبل بداية المتابعة لا تُحسب غيابًا. الحضور والانصراف من الكارت. وقت كل فرع والخروج من عينات GPS داخل الشيفت، وقد لا يساوي مجموعها وقت الحضور بالكارت. الشيفت المفتوح ينتظر قراءة الانصراف لاعتماد ساعاته.</p>
      {resetAt&&<p className="muted">بداية السجل الفعلي بعد التصفير: {new Date(resetAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</p>}
      {generatedAt&&!loading&&<small>آخر تحديث: {new Date(generatedAt).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'})}</small>}
    </div>
    {error&&<p role="alert" className="tracker-warning">{error}</p>}{loading?<p role="status">جاري تحميل التقرير…</p>:!reports.length&&!error?<p className="card">لا يوجد موظفون في الفترة المختارة.</p>:reports.map(r=><article className="card period-report" key={r.user.id}>
      <div className="section-title"><div><h3>{r.user.name}</h3><p className="muted">{r.user.username} · من {r.start} إلى {r.end}</p></div><span className="badge">{r.days.length} يوم في الفترة</span></div>
      <div className="metrics-grid">{[['ساعات مفتوحة تنتظر انصراف الكارت',r.summary.provisional.formatted],['أيام ينقصها انصراف',r.summary.missingCheckoutDays],['أيام الحضور',r.summary.presentDays],['أيام الغياب',r.summary.absentDays],['أيام الراحة',r.summary.offDays],['أيام التأخير',r.summary.lateDays],['الحضور المؤكد بالكارت / السجل السابق',r.summary.total.formatted],...r.summary.branches.map(b=>['الوقت في '+b.name,b.formatted]),['العمل خلال الشيفت',r.summary.regular.formatted],['الإضافي',r.summary.overtime.formatted],['خارج الفروع',r.summary.outside.formatted],['فجوات GPS',r.summary.unknown.formatted],['إجمالي التأخير',r.summary.late.formatted],['الانصراف المبكر',r.summary.earlyDeparture.formatted],['مرات الخروج',r.summary.exitCount]].map(([name,value])=><div className="metric" key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
      {(r.summary.pendingDays>0||r.summary.unverifiedDays>0)&&<p className="muted">{r.summary.pendingDays} يوم لم ينتهِ شيفته · {r.summary.unverifiedDays} يوم بحضور غير مؤكد يحتاج مراجعة</p>}
      <details className="day-details" open={mode==='daily'}><summary>تفاصيل الأيام والوصول والانصراف وحركة الفروع</summary><div className="data-table-wrapper"><table className="data-table"><thead><tr><th>التاريخ</th><th>الحالة</th><th>الشيفت</th><th>وصل</th><th>انصرف</th><th>إجمالي</th>{r.summary.branches.map(b=><th key={b.id}>{b.name}</th>)}<th>إضافي</th><th>خارج الفروع</th><th>فجوات GPS</th><th>التأخير</th><th>الخروج</th></tr></thead><tbody>{r.days.map(d=><tr key={d.date}><td>{d.date}</td><td>{labels[d.status]}</td><td>{d.policy.shift_start} — {d.policy.shift_end}</td><td>{clock(d.firstArrival)}</td><td>{clock(d.lastDeparture)}{d.missingCheckout?' · ينقص انصراف الكارت':d.missingArrival?' · قراءة تحتاج مراجعة':''}</td><td>{d.summary.totalFormatted}</td>{r.summary.branches.map(b=><td key={b.id}>{d.summary.branches.find(v=>v.id===b.id)?.formatted||'0 دقيقة'}</td>)}<td>{d.summary.overtimeFormatted}</td><td>{d.summary.outsideFormatted}</td><td>{d.summary.unknownFormatted}</td><td>{d.lateMinutes} دقيقة</td><td>{d.exitCount}</td></tr>)}</tbody></table></div>
      {r.days.filter(d=>d.timeline.length).map(d=><details key={d.date} className="day-movements"><summary>حركة {d.date}</summary>{d.timeline.map((t,i)=><div className="movement-row" key={i}><span>{t.branch_name}</span><span>{clock(t.start)} — {clock(t.end)} · {t.durationFormatted}</span></div>)}</details>)}</details>
    </article>)}
  </section>;
}
