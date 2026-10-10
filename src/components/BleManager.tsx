'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AppUser } from '@/lib/types';
import { localDate } from '@/lib/time';

type Observation = { device_id: string; branch_name: string; state: 'seen' | 'not_seen' | 'unknown'; in_card_session: boolean; last_observation: string | null; rssi: number | null };
type Tag = { id: number; address: string; user_id: number; name: string; grace_seconds: number; observations: Observation[] };
type Device = { id: string; name: string; branch_name: string; receiver_state: 'ready' | 'fault' | 'stale' | 'disabled'; last_heartbeat: string | null };
type Log = { id: string; state: 'seen' | 'not_seen'; tag_address: string; recorded_at: string; received_at: string; user_name: string | null; branch_name: string; status: string; rssi: number | null };
type Report = { user_id: number; user_name: string; device_id: string; device_name: string; branch_name: string; observed_seconds: number; not_seen_seconds: number; unknown_seconds: number; session_seconds: number };
type Data = { tags: Tag[]; devices: Device[]; logs: Log[]; total: number; page: number; reports: Report[]; truncated: boolean;
  unknown_tags: { tag_address: string; recorded_at: string; branch_name: string }[] };

const dateTime = (value: string | null) => value ? new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : 'لا توجد قراءة';
const duration = (seconds: number) => `${Math.floor(seconds / 3600)} س ${Math.floor(seconds % 3600 / 60)} د`;
const labels = { seen: 'مرصود', not_seen: 'غير مرصود · للمراجعة', unknown: 'غير معلوم' };
const healthLabels = { ready: 'يعمل', fault: 'عطل في الرصد', stale: 'الاتصال غير محدّث', disabled: 'معطّل' };
const colors = { seen: '#15803d', not_seen: '#b91c1c', unknown: '#64748b' };

export default function BleManager({ users }: { users: AppUser[] }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const [fromDay, setFromDay] = useState(localDate), [toDay, setToDay] = useState(localDate), [page, setPage] = useState(1);
  const [address, setAddress] = useState(''), [userId, setUserId] = useState(''), [grace, setGrace] = useState(90);
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`/api/ble/admin?from_day=${fromDay}&to_day=${toDay}&page=${page}`, { cache: 'no-store', signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'تعذر تحميل البلوتوث');
      if (!signal?.aborted) { setData(result); setError(''); }
    } catch (failure) { if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'تعذر تحميل البلوتوث'); }
  }, [fromDay, toDay, page]);
  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const refresh = async () => { if (running) return; running = true; try { await load(controller.signal); } finally { running = false; } };
    void refresh(); const timer = setInterval(() => void refresh(), 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [load]);
  const change = async (body: object) => {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/ble/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage('تم الحفظ؛ إعداد القارئ يتحدث تلقائيًا. السجلات السابقة تحتفظ بربطها وقت القراءة.'); await load(); return true;
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : 'تعذر الحفظ'); return false; }
    finally { setBusy(false); }
  };
  return <section style={{ display: 'grid', gap: 16 }}>
    <div className="card" style={{ padding: 20 }}>
      <div className="section-title"><h3>رصد التاج بالبلوتوث · تجربة عملية</h3><button className="btn btn-secondary" onClick={() => void load()}>تحديث</button></div>
      <p>رصد الإشارة أثناء الفترة بين حضور الكارت والانصراف أو الحد الأقصى. الكروت تظل مصدر الحضور والانصراف، والتجربة الحالية تدعم حتى 3 تاجات لكل قارئ.</p>
      <p style={{ color: '#92400e' }}>وجود التاج لا يثبت وجود صاحبه. فقد الإشارة يظهر للمراجعة، وعطل القارئ أو انقطاع اتصاله يظهر «غير معلوم». هذه الفترات لا تُخصم تلقائيًا من الأجر.</p>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      <div className="metrics-grid">{data?.devices.map(device => <div key={device.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
        <strong>{device.name} · {device.branch_name}</strong><p style={{ color: device.receiver_state === 'ready' ? '#15803d' : '#b91c1c' }}>{healthLabels[device.receiver_state]}</p>
        <small>آخر نبضة: {dateTime(device.last_heartbeat)}</small>
      </div>)}</div>
    </div>
    <div className="card" style={{ padding: 20 }}>
      <h3>ربط التاج بموظف</h3>
      <p className="muted">الربط يبدأ الآن؛ القراءات القديمة غير المعروفة تظل تشخيصية ولا تُنسب بأثر رجعي.</p>
      {data?.unknown_tags.length ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBlock: 12 }}>{data.unknown_tags.map(tag => <button key={tag.tag_address} className="btn btn-secondary btn-sm" onClick={() => setAddress(tag.tag_address)}>
        تاج غير مربوط: <span dir="ltr">{tag.tag_address}</span> · {tag.branch_name}
      </button>)}</div> : null}
      <form onSubmit={event => { event.preventDefault(); void change({ action: 'assign_tag', address, user_id: Number(userId), grace_seconds: grace }); }}>
        <div className="metrics-grid">
          <label>عنوان التاج<input className="form-input" dir="ltr" required value={address} onChange={e => setAddress(e.target.value)} placeholder="AA:BB:CC:DD:EE:FF" /></label>
          <label>الموظف<select className="form-input" required value={userId} onChange={e => setUserId(e.target.value)}><option value="">اختار الموظف</option>{users.filter(u => u.role === 'employee' && u.is_active !== false).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label>مهلة فقد الإشارة بالثواني<input className="form-input" type="number" min={60} max={600} required value={grace} onChange={e => setGrace(Number(e.target.value))} /></label>
        </div><button className="btn btn-primary" disabled={busy}>ربط التاج</button>
      </form>{message && <p role="status">{message}</p>}
    </div>
    {data?.tags.map(tag => <article key={tag.id} className="card" style={{ padding: 20 }}>
      <div className="section-title"><h3>{tag.name} · <span dir="ltr">{tag.address}</span></h3><button className="btn btn-secondary" disabled={busy} onClick={() => { if (confirm(`إلغاء ربط التاج مع ${tag.name} مع الاحتفاظ بالتاريخ؟`)) void change({ action: 'revoke_tag', id: tag.id }); }}>إلغاء الربط</button></div>
      <div className="metrics-grid">{tag.observations.map(observation => <div key={observation.device_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
        <strong>{observation.branch_name}</strong><p style={{ color: colors[observation.state] }}>{labels[observation.state]}{!observation.in_card_session && ' · خارج فترة الكارت'}</p>
        <small>{dateTime(observation.last_observation)}{observation.rssi !== null && ` · قوة الإشارة ${observation.rssi}`}</small>
      </div>)}</div>
      <form style={{ display: 'flex', gap: 8, alignItems: 'end', marginTop: 12 }} onSubmit={event => {
        event.preventDefault(); const value = Number(new FormData(event.currentTarget).get('grace'));
        void change({ action: 'set_grace', id: tag.id, grace_seconds: value });
      }}><label>مهلة فقد الإشارة<input key={`${tag.id}-${tag.grace_seconds}`} name="grace" className="form-input" type="number" min={60} max={600} required defaultValue={tag.grace_seconds} /></label><button className="btn btn-secondary" disabled={busy}>حفظ المهلة</button></form>
    </article>)}
    <div className="card" style={{ padding: 20 }}>
      <h3>فترات الرصد أثناء الشيفت</h3>
      <div className="metrics-grid"><label>من يوم<input className="form-input" type="date" value={fromDay} onChange={e => { setFromDay(e.target.value); setPage(1); }} /></label><label>حتى يوم<input className="form-input" type="date" value={toDay} onChange={e => { setToDay(e.target.value); setPage(1); }} /></label></div>
      <p className="muted">كل صف يخص رصد جهاز فرع واحد داخل فترة الكارت؛ لا تجمع أوقات الفرعين لأنها قد تتداخل. «غير مرصود» يعني فقد رصد التاج، ولا يثبت غياب الموظف.</p>
      {data?.truncated && <p role="alert">الفترة كبيرة جدًا على حجم البيانات الحالي. التقرير يعرض وقتًا غير معلوم؛ اختار فترة أقصر للحصول على التفاصيل.</p>}
      <div style={{ display: 'grid', gap: 12 }}>{data?.reports.map(report => <div key={`${report.user_id}-${report.device_id}`} style={{ padding: 14, border: '1px solid #e2e8f0', borderRadius: 12 }}>
        <strong>{report.user_name} · {report.branch_name} · {report.device_name}</strong><p>فترة الكارت: {duration(report.session_seconds)}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}><span style={{ color: colors.seen }}>مرصود: {duration(report.observed_seconds)}</span><span style={{ color: colors.not_seen }}>غير مرصود للمراجعة: {duration(report.not_seen_seconds)}</span><span style={{ color: colors.unknown }}>غير معلوم: {duration(report.unknown_seconds)}</span></div>
      </div>)}{data && !data.reports.length && <p>لا توجد فترة كارت لموظف مربوط بتاج في الفترة المختارة.</p>}</div>
    </div>
    <div className="card" style={{ padding: 20 }}>
      <h3>قراءات البلوتوث التشخيصية</h3><p className="muted">القراءة محفوظة بوقت التقاطها ووقت وصولها، حتى لو التاج غير مربوط أو خارج فترة الشيفت.</p>
      <div style={{ display: 'grid', gap: 10 }}>{data?.logs.map(log => <div key={log.id} style={{ padding: 12, border: '1px solid #e2e8f0', borderRadius: 10 }}>
        <strong style={{ color: colors[log.state] }}>{log.user_name || (log.status === 'outside_session' ? 'تشخيص خارج فترة الكارت' : 'تاج غير معروف')} · {labels[log.state]}</strong><p>{log.branch_name} · <span dir="ltr">{log.tag_address}</span>{log.rssi !== null && ` · قوة الإشارة ${log.rssi}`}</p>
        <small>الالتقاط: {dateTime(log.recorded_at)} · الوصول: {dateTime(log.received_at)}</small>
      </div>)}{data && !data.logs.length && <p>لا توجد قراءات في الفترة المختارة.</p>}</div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 16 }}><button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>السابق</button><span>صفحة {page} · {data?.total || 0} قراءة</span><button className="btn btn-secondary" disabled={!data || page * 100 >= data.total} onClick={() => setPage(n => n + 1)}>التالي</button></div>
    </div>
  </section>;
}
