'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, Play, Square, RefreshCw, Wifi, WifiOff, Clock, ShieldCheck } from 'lucide-react';
import { verifiedBranchLocation, StoreSettings } from '@/lib/geo';
import { EventType, pendingEvents, saveEvent, syncEvents } from '@/lib/offline';
import { buildReport } from '@/lib/attendance';

type PersonalReport = ReturnType<typeof buildReport>;
interface Props { user: { id: number; name: string; username: string; shift_start?: string; shift_end?: string } }
export default function EmployeeTracker({ user }: Props) {
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [report, setReport] = useState<PersonalReport | null>(null);
  const [onDuty, setOnDuty] = useState(false);
  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [queued, setQueued] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [syncError, setSyncError] = useState('');
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const capturing = useRef(false);
  const duty = useRef(false);
  const storageKey = `attendance-duty-${user.id}`;
  const refresh = useCallback(async () => {
    const response = await fetch('/api/attendance/report', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('تعذر تحديث التقرير');
    const data = await response.json();
    const reset=data.settings?.attendance_reset_at;
    if(reset&&localStorage.getItem(`attendance-reset-${user.id}`)!==reset){
      duty.current=false;setOnDuty(false);localStorage.setItem(storageKey,'false');
      localStorage.setItem(`attendance-reset-${user.id}`,reset);
      setPosition(null);setLastSaved(null);setMessage('الإدارة بدأت سجل حضور جديد؛ ابدأ الشيفت لتسجيل حضورك الفعلي');
    }
    setSettings(data.settings); setReport(data.reports?.[0] || null);
    localStorage.setItem(`attendance-summary-${user.id}`, JSON.stringify(data));
    return data;
  }, [user.id,storageKey]);
  const sync = useCallback(async () => {
    try {
      setQueued((await pendingEvents(user.id)).length);
      if (!navigator.onLine) return;
      await syncEvents(user.id);
      setSyncError('');
      setQueued((await pendingEvents(user.id)).length);
      await refresh();
    } catch (error) { setSyncError(error instanceof Error ? error.message : 'الأحداث محفوظة؛ المزامنة مؤجلة'); }
  }, [user.id, refresh]);
  useEffect(() => {
    let mounted = true;
    const boot = async () => {
      setOnline(navigator.onLine);
      try {
        const cached = localStorage.getItem(`attendance-summary-${user.id}`);
        if (cached) { const data = JSON.parse(cached); setSettings(data.settings); setReport(data.reports?.[0] || null); }
        const queue = await pendingEvents(user.id);
        setQueued(queue.length);
        const stored = localStorage.getItem(storageKey);
        let active = stored === 'true';
        if (stored === null && navigator.onLine) { const data = await refresh(); active = Boolean(data.reports?.[0]?.onDuty); }
        // A queued clock-out takes priority over an older server state.
        const lastControl = queue.filter(e => e.event_type !== 'ping').at(-1);
        if (lastControl) active = lastControl.event_type === 'clock_in';
        if (mounted) { duty.current = active; setOnDuty(active); setReady(true); }
        await sync();
        if (navigator.storage?.persist) void navigator.storage.persist();
      } catch (error) { if (mounted) { setMessage(error instanceof Error ? error.message : 'تعذر تحميل الحضور'); setReady(true); } }
    };
    void boot();
    const connection = () => { setOnline(navigator.onLine); if (navigator.onLine) void sync(); };
    window.addEventListener('online', connection); window.addEventListener('offline', connection);
    const timer = setInterval(() => void sync(), 30000);
    return () => { mounted = false; clearInterval(timer); window.removeEventListener('online', connection); window.removeEventListener('offline', connection); };
  }, [user.id, storageKey, refresh, sync]);
  const capture = useCallback(async (type: EventType) => {
    if (capturing.current || (type === 'ping' && !duty.current)) return;
    capturing.current = true; setBusy(true); setMessage('');
    try {
      let location: { lat: number; lng: number; accuracy: number } | null = null;
      if (type !== 'clock_out') {
        const fix = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error('الجهاز لا يدعم الموقع'));
          navigator.geolocation.getCurrentPosition(resolve, () => reject(new Error('شغّل GPS واسمح بالوصول للموقع ثم حاول مرة أخرى')), { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
        });
        location = { lat: fix.coords.latitude, lng: fix.coords.longitude, accuracy: fix.coords.accuracy };
      }
      const saved = await saveEvent({ user_id: user.id, recorded_at: new Date().toISOString(), event_type: type, lat: location?.lat ?? null, lng: location?.lng ?? null, accuracy: location?.accuracy ?? null });
      if (location) setPosition(location);
      setLastSaved(saved.recorded_at);
      if (type !== 'ping') {
        duty.current = type === 'clock_in'; setOnDuty(duty.current);
        localStorage.setItem(storageKey, String(duty.current));
      }
      setMessage(type === 'clock_in' ? 'تم حفظ بدء الشيفت على الهاتف' : type === 'clock_out' ? 'تم حفظ الانصراف وإيقاف التتبع' : 'تم حفظ الموقع على الهاتف');
      await sync();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'تعذر حفظ الحدث؛ حاول مرة أخرى'); }
    finally { capturing.current = false; setBusy(false); }
  }, [user.id, storageKey, sync]);
  useEffect(() => {
    if (!ready || !onDuty) return;
    // Resuming a page only records a ping; it never creates a second clock-in.
    const timer = setInterval(() => void capture('ping'), Math.max(15, settings?.ping_interval_secs || 60) * 1000);
    const visible = () => { if (document.visibilityState === 'visible') void capture('ping'); };
    document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [ready, onDuty, settings?.ping_interval_secs, capture]);
  const geo = position && settings ? verifiedBranchLocation(position.lat, position.lng, position.accuracy, settings) : null;
  const locationName = geo?.branch_name || 'لم يتم التقاط الموقع بعد';
  const metrics = report ? [
    ['حضور داخل الفروع', report.summary.totalFormatted], ['عمل خلال الشيفت', report.summary.regularFormatted],
    ['إضافي بعد الشيفت', report.summary.overtimeFormatted], ['خارج الفروع', report.summary.outsideFormatted],
    ['فجوات التتبع', report.summary.unknownFormatted], ['عدد مرات الخروج', String(report.exitCount)],
  ] : [];
  return <div className="app-container employee-app">
    <div className="tracker-greeting"><div><p className="eyebrow">الحضور الذكي · بتوقيت القاهرة</p><h2>مرحبًا، {user.name}</h2><p className="muted">الشيفت: {user.shift_start || '10:00'} — {user.shift_end || '22:00'}</p></div><ShieldCheck size={30} color="#0f766e" /></div>
    <div className={`connection-banner ${online ? '' : 'offline'}`}><span>{online ? <Wifi size={18}/> : <WifiOff size={18}/>} {online ? 'متصل بالإنترنت' : 'بدون إنترنت · التسجيل مستمر على الهاتف'}</span><strong>{queued} أحداث بانتظار المزامنة</strong></div>
    <section className="card shift-card"><p className="eyebrow">حالة الشيفت</p><h1>{onDuty ? 'الشيفت شغّال' : 'جاهز تبدأ يومك؟'}</h1><p className="location-label"><MapPin size={20}/>{locationName}</p>
      <button className={`btn shift-button ${onDuty ? 'stop' : ''}`} disabled={!ready || busy} onClick={() => void capture(onDuty ? 'clock_out' : 'clock_in')}>{onDuty ? <Square size={20}/> : <Play size={20}/>} {busy ? 'جاري الحفظ…' : onDuty ? 'إنهاء الشيفت وتسجيل انصراف' : 'بدء الشيفت وتسجيل حضور'}</button>
      <button className="btn btn-secondary" disabled={!onDuty || busy} onClick={() => void capture('ping')}><RefreshCw size={16}/>تحديث موقعي</button>
      <p className="muted">{position ? `دقة GPS: ±${Math.round(position.accuracy)} متر` : 'الحضور يبدأ بعد التقاط موقعك وحفظ الحدث'}</p>
      {lastSaved && <p className="muted">آخر حفظ محلي: {new Date(lastSaved).toLocaleTimeString('ar-EG', {timeZone:'Africa/Cairo'})}</p>}
      {message && <p role="status" className="tracker-message">{message}</p>}
      {syncError && <p role="alert" className="tracker-warning">{syncError} · {queued ? 'الأحداث ما زالت محفوظة على الهاتف' : ''}</p>}
    </section>
    <section className="card"><div className="section-title"><h3><Clock size={19}/> ملخص اليوم</h3><button className="btn btn-secondary btn-sm" onClick={() => void sync()}><RefreshCw size={15}/>مزامنة</button></div>
      {report && <p className={`badge ${report.punctuality.badgeClass}`}>{report.punctuality.message}</p>}
      <div className="metrics-grid">{metrics.map(([name,value]) => <div className="metric" key={name}><span>{name}</span><strong>{value}</strong></div>)}</div>
      {report?.timeline.map((interval, i) => <div className="movement-row" key={i}><span>{interval.branch_name}</span><span>{new Date(interval.start).toLocaleTimeString('ar-EG',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit'})} · {interval.durationFormatted}</span></div>)}
      {queued > 0 && <p className="muted">الملخص يعرض ما وصل للسيرفر؛ الأحداث المحفوظة تظهر بعد المزامنة.</p>}
    </section>
    <p className="tracker-note">نسخة المتصفح تسجل الموقع أثناء فتحها. للتتبع مع قفل الشاشة استخدم تطبيق الهاتف واسمح بالموقع أثناء الشيفت. انقطاع GPS يظهر كفجوة تتبع.</p>
  </div>;
}
