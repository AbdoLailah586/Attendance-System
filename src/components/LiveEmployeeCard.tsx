'use client';

import type { LiveEmployee } from '@/lib/types';
import type { StoreSettings } from '@/lib/geo';
import BlePresenceCard, { BlePresenceBadge } from './BlePresenceCard';

const clock = (value: string | null) => value
  ? new Date(value).toLocaleTimeString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit' })
  : '—';

export function observedBranch(employee: LiveEmployee) {
  if (employee.presence_source === 'ble') return employee.ble?.state === 'seen' ? employee.ble.branch_id : null;
  return employee.isOnline && !['outside', 'unknown'].includes(employee.currentStatus) ? employee.currentStatus : null;
}

export function needsPresenceReview(employee: LiveEmployee) {
  return employee.presence_source === 'ble' ? employee.ble?.state === 'not_seen' : employee.currentStatus === 'outside';
}

function GpsBadge({ employee, settings, stale }: { employee: LiveEmployee; settings: StoreSettings | null; stale: boolean }) {
  const branch = settings?.branches?.find(b => b.id === employee.currentStatus);
  const name = branch?.name || (employee.currentStatus === 'branch1' ? settings?.branch1_name : employee.currentStatus === 'branch2' ? settings?.branch2_name : null);
  if (stale) return <span className="badge badge-offline">تعذر تحديث الموقع</span>;
  if (employee.isOnline && name) return <span className="badge badge-branch1">GPS · {name}</span>;
  if (employee.currentStatus === 'outside') return <span className="badge badge-outside">GPS · خارج الفروع</span>;
  if (employee.lastDeparture) return <span className="badge badge-offline">انصرف بالكارت</span>;
  if (employee.firstArrival) return <span className="badge badge-offline">GPS غير مرصود</span>;
  return <span className="badge badge-offline">لم يسجل حضورًا</span>;
}

function GpsSummary({ employee }: { employee: LiveEmployee }) {
  return <div style={{ display: 'grid', gap: 6, fontSize: '0.85rem' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>داخل الفروع حسب GPS</span><strong>{employee.summary.totalFormatted}</strong></div>
    {employee.summary.branches.map(branch => <div key={branch.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{branch.name}</span><span>{branch.formatted}</span></div>)}
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#b91c1c' }}><span>خارج الفروع حسب GPS</span><span>{employee.summary.outsideFormatted}</span></div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#64748b' }}><span>فجوات GPS</span><span>{employee.summary.unknownFormatted}</span></div>
  </div>;
}

export default function LiveEmployeeCard({ employee, settings, stale }: { employee: LiveEmployee; settings: StoreSettings | null; stale: boolean }) {
  const ble = employee.presence_source === 'ble' ? employee.ble : null;
  return <article className="card" style={{ padding: 20, borderRadius: 16, borderColor: needsPresenceReview(employee) ? '#fecaca' : '#e2e8f0', display: 'grid', gap: 14 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
      <div><h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a' }}>{employee.user.name}</h4><small className="muted">@{employee.user.username}</small></div>
      {ble ? <BlePresenceBadge presence={ble} stale={stale} /> : <GpsBadge employee={employee} settings={settings} stale={stale} />}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem', flexWrap: 'wrap' }}>
      <span>حضور الكارت: <strong>{clock(ble?.session.firstArrival || employee.firstArrival)}</strong></span>
      <span>انصراف الكارت: <strong>{clock(ble?.session.lastDeparture || employee.lastDeparture)}</strong></span>
    </div>
    {ble ? <BlePresenceCard presence={ble} compact stale={stale} /> : <>
      <p className="muted" style={{ margin: 0 }}>المتابعة بالموقع GPS</p>
      <GpsSummary employee={employee} />
      <small className="muted">آخر قراءة GPS: {employee.minutesSincePing === null ? 'لا توجد قراءة' : employee.minutesSincePing === 0 ? 'منذ أقل من دقيقة' : `منذ ${employee.minutesSincePing} دقيقة`}</small>
    </>}
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: '0.85rem' }}><span>فترة الكارت المكتملة</span><strong>{employee.summary.cardFormatted}</strong></div>
    {ble && <details><summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#64748b' }}>بيانات GPS المسجلة اليوم</summary><div style={{ marginTop: 10 }}><GpsSummary employee={employee} /></div></details>}
    <div style={{ paddingTop: 10, borderTop: '1px solid #f1f5f9' }}><span className={`badge ${employee.punctuality.badgeClass}`} style={{ fontSize: '0.75rem' }}>{employee.punctuality.label}</span></div>
  </article>;
}
