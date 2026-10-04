'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {MapPin,RefreshCw,ShieldCheck} from 'lucide-react';
import {pendingEvents,saveEvent,syncEvents} from '@/lib/offline';
import {verifiedBranchLocation,type StoreSettings} from '@/lib/geo';
import {inTrackingWindow,type TrackingWindow} from '@/lib/tracking-window';
import type {AttendanceReport} from '@/lib/attendance';
import type {AppUser} from '@/lib/types';
export default function EmployeeTracker({user}:{user:AppUser}){
  const [report,setReport]=useState<AttendanceReport|null>(null),[settings,setSettings]=useState<StoreSettings|null>(null),[windows,setWindows]=useState<TrackingWindow[]>([]);
  const [enabled,setEnabled]=useState(false),[tracking,setTracking]=useState(false),[queued,setQueued]=useState(0),[message,setMessage]=useState(''),[ready,setReady]=useState(false),[now,setNow]=useState(0);
  const [position,setPosition]=useState<{lat:number;lng:number;accuracy:number}|null>(null);
  const saving=useRef(false),lastSaved=useRef(0);
  const key=`attendance-gps-consent-${user.id}`;
  const refresh=useCallback(async()=>{
    try{
      setQueued((await pendingEvents(user.id)).length);
      if(!navigator.onLine)return;
      await syncEvents(user.id);setQueued((await pendingEvents(user.id)).length);
      const [r,s]=await Promise.all([fetch('/api/attendance/report',{cache:'no-store'}),fetch('/api/attendance/tracking-window',{cache:'no-store'})]);
      if(!r.ok||!s.ok)throw new Error('تعذر تحديث الحضور أو مواعيد المتابعة');
      const data=await r.json(),schedule=await s.json();setReport(data.reports?.[0]||null);setSettings(data.settings);setWindows(schedule.windows);
      localStorage.setItem(`attendance-gps-cache-${user.id}`,JSON.stringify({report:data.reports?.[0],settings:data.settings,windows:schedule.windows}));
    }catch(e){setMessage((e as Error).message+'؛ الأحداث المحفوظة تنتظر المزامنة');}
  },[user.id]);
  useEffect(()=>{
    queueMicrotask(()=>{setEnabled(localStorage.getItem(key)==='true');try{const c=JSON.parse(localStorage.getItem(`attendance-gps-cache-${user.id}`)||'null');if(c){setReport(c.report);setSettings(c.settings);setWindows(c.windows||[]);}}catch{}setReady(true);void refresh();});
    const timer=setInterval(()=>void refresh(),30000);window.addEventListener('online',refresh);
    return()=>{clearInterval(timer);window.removeEventListener('online',refresh);};
  },[key,user.id,refresh]);
  useEffect(()=>{
    if(!ready)return;
    let watch:number|undefined;
    const stop=()=>{if(watch!==undefined){navigator.geolocation?.clearWatch(watch);watch=undefined;}setTracking(false);setPosition(null);};
    const check=()=>{
      setNow(Date.now());
      if(!enabled||!inTrackingWindow(windows)){stop();return;}
      if(watch!==undefined)return;
      if(!navigator.geolocation){setMessage('الجهاز لا يدعم الموقع');return;}
      watch=navigator.geolocation.watchPosition(fix=>{
        if(!inTrackingWindow(windows)){stop();return;}
        if(saving.current||Date.now()-lastSaved.current<Math.max(15,settings?.ping_interval_secs||60)*1000)return;
        const geo={lat:fix.coords.latitude,lng:fix.coords.longitude,accuracy:fix.coords.accuracy};setPosition(geo);saving.current=true;
        void saveEvent({user_id:user.id,event_type:'ping',recorded_at:new Date().toISOString(),...geo}).then(()=>{lastSaved.current=Date.now();setMessage('تم حفظ الموقع داخل وقت الشيفت');return refresh();}).catch(()=>setMessage('تعذر الحفظ؛ راجع مساحة التخزين')).finally(()=>{saving.current=false;});
      },()=>setMessage('اسمح بالموقع الدقيق وشغّل GPS؛ الحضور بالكارت لا يتأثر'),{enableHighAccuracy:true,maximumAge:0,timeout:20000});
      setTracking(true);
    };
    check();const timer=setInterval(check,1000);return()=>{clearInterval(timer);if(watch!==undefined)navigator.geolocation?.clearWatch(watch);};
  },[ready,enabled,windows,settings?.ping_interval_secs,user.id,refresh]);
  const geo=position&&settings?verifiedBranchLocation(position.lat,position.lng,position.accuracy,settings):null;
  const current=windows.find(w=>now>=w.start&&now<w.end),next=windows.find(w=>w.start>now);
  return <div className="app-container employee-app"><div className="tracker-greeting"><div><p className="eyebrow">الحضور بالكارت · بتوقيت القاهرة</p><h2>مرحبًا، {user.name}</h2></div><ShieldCheck/></div>
    <section className="card shift-card"><h2>سجّل الحضور والانصراف بكارتك في الفرع</h2><p>زر التتبع لا يسجل حضورًا أو انصرافًا. قراءة الكارت هي السجل الأساسي، وGPS للتحقق من الوجود بين حضور الكارت وانصرافه أو الحد الأقصى.</p><p><MapPin size={18}/>{tracking?geo?.branch_name||'التقاط الموقع بعد حضور الكارت':'جمع الموقع متوقف'}</p>
      <button className="btn btn-primary" disabled={!ready} onClick={()=>{const value=!enabled;setEnabled(value);localStorage.setItem(key,String(value));setMessage(value?'المتابعة جاهزة؛ GPS يبدأ بعد حضور الكارت':'تم إيقاف جمع الموقع؛ الحضور والانصراف بالكارت');}}>{enabled?'إيقاف متابعة الموقع':'تجهيز متابعة الموقع بعد حضور الكارت'}</button>
      <button className="btn btn-secondary" onClick={()=>void refresh()}><RefreshCw size={16}/>مزامنة وتحديث</button>
      <p className="muted">{current?'نهاية متابعة الموقع: '+new Date(current.end).toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo'}):next?'جلسة حضور مسجلة تبدأ: '+new Date(next.start).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}):'GPS ينتظر حضور الكارت؛ اتصل بالإنترنت لتحديث حالة القارئ'}</p><p>{queued} تحديثات موقع بانتظار المزامنة</p>{message&&<p role="status">{message}</p>}
    </section><section className="card"><h3>ملخص الحضور بالكارت</h3><p>{report?.punctuality.message}</p>{report?.missingCheckout&&<p className="tracker-warning">ينقص انصراف الكارت؛ {report.provisionalMinutes} دقيقة مبدئية تنتظر اعتماد الانصراف.</p>}<div className="metrics-grid">{[['فترة الكارت المكتملة',report?.summary.cardFormatted],['داخل الفروع حسب GPS',report?.summary.totalFormatted],['الإضافي داخل الفروع',report?.summary.overtimeFormatted],['خروج أثناء الشيفت',report?.summary.outsideFormatted],['فجوات GPS',report?.summary.unknownFormatted]].map(([label,value])=><div className="metric" key={label}><span>{label}</span><strong>{value||'—'}</strong></div>)}</div></section><p className="tracker-note">المتصفح يجمع الموقع أثناء فتحه. للتتبع مع قفل الشاشة استخدم تطبيق الهاتف المحدّث. قبل حضور الكارت وبعد الانصراف أو الحد الأقصى يتوقف GPS حتى لو المتابعة مفعّلة.</p></div>;
}
