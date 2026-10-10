'use client';

import { Bluetooth, Clock, Radio } from 'lucide-react';
import type { BleUserPresence } from '@/lib/ble-types';

export const bleDuration = (seconds: number) => seconds < 60 ? `${Math.floor(seconds)} ثانية` : `${Math.floor(seconds / 3600)} س ${Math.floor(seconds % 3600 / 60)} د`;
const time = (value: string | null) => value
  ? new Date(value).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })
  : 'لا توجد قراءة';

function stateText(presence: BleUserPresence, stale: boolean) {
  if (stale) return 'تعذر تحديث الرصد';
  if (presence.state === 'seen') return `التاج مرصود${presence.branch_name ? ` · ${presence.branch_name}` : ''}`;
  if (presence.state === 'not_seen') return 'التاج غير مرصود · للمراجعة';
  if (presence.state === 'unknown') return 'الرصد غير معلوم';
  if (presence.session.state === 'waiting') return 'في انتظار حضور الكارت';
  if (presence.session.state === 'expired') return 'انتهت مهلة المتابعة';
  return 'انتهت فترة الكارت';
}

export function BlePresenceBadge({ presence, stale = false }: { presence: BleUserPresence; stale?: boolean }) {
  const state = stale ? 'unknown' : presence.state;
  const style = state === 'seen'
    ? { color: '#15803d', background: '#f0fdf4', borderColor: '#bbf7d0' }
    : state === 'not_seen'
      ? { color: '#b91c1c', background: '#fef2f2', borderColor: '#fecaca' }
      : { color: '#475569', background: '#f1f5f9', borderColor: '#cbd5e1' };
  return <span className="badge" style={{ ...style, whiteSpace: 'normal' }}><Bluetooth size={14} />{stateText(presence, stale)}</span>;
}

export default function BlePresenceCard({ presence, stale = false, compact = false }: { presence: BleUserPresence; stale?: boolean; compact?: boolean }) {
  const summary = presence.summary;
  return <section aria-label="رصد التاج بالبلوتوث" style={{ display: 'grid', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <Bluetooth size={18} color="#2563eb" /><strong>المتابعة بالتاج</strong>
      {!compact && <BlePresenceBadge presence={presence} stale={stale} />}
    </div>
    <p className="muted" style={{ margin: 0 }}>القارئ يرصد التاج أثناء فترة الكارت؛ لا يحتاج تطبيق الهاتف أو تشغيل GPS.</p>
    <div className="metrics-grid" style={{ gap: 8 }}>
      {[
        ['فترة المتابعة بالكارت', summary.session_seconds, '#0f172a'],
        ['التاج مرصود', summary.observed_seconds, '#15803d'],
        ['غير مرصود · للمراجعة', summary.not_seen_seconds, '#b91c1c'],
        ['الرصد غير معلوم', summary.unknown_seconds, '#64748b'],
      ].map(([label, value, color]) => <div className="metric" key={String(label)} style={{ padding: compact ? 8 : 12 }}>
        <span>{label}</span><strong style={{ color: String(color) }}>{bleDuration(Number(value))}</strong>
      </div>)}
    </div>
    <div style={{ display: 'grid', gap: 6, fontSize: '0.8rem', color: '#64748b' }}>
      <span><Radio size={13} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} />آخر قراءة للتاج: {time(presence.captured_at)}</span>
      {presence.session.until && <span><Clock size={13} style={{ verticalAlign: 'middle', marginInlineEnd: 4 }} />{presence.session.active ? 'نهاية المتابعة بحد أقصى' : 'نهاية فترة المتابعة'}: {time(presence.session.until)}</span>}
    </div>
    {presence.session.missing_checkout && <p className="tracker-warning" style={{ margin: 0 }}>ينقص انصراف الكارت؛ راجع الجلسة قبل اعتماد الساعات.</p>}
    {presence.truncated && <p className="tracker-warning" style={{ margin: 0 }}>تعذر حساب تفاصيل هذه الفترة كاملة؛ الوقت غير المحسوم يظهر «غير معلوم».</p>}
    {!compact && <>
      {presence.branches.length > 0 && <div style={{ display: 'grid', gap: 6 }}>
        {presence.branches.map(branch => <div key={branch.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.85rem' }}>
          <span>رصد {branch.name}</span><strong>{bleDuration(branch.observed_seconds)}</strong>
        </div>)}
        <small className="muted">تفاصيل الفروع قد تتداخل؛ إجمالي الرصد أعلاه يحتسب كل فترة مرة واحدة.</small>
      </div>}
      <p className="muted" style={{ margin: 0 }}>وجود التاج يثبت رصد الجهاز. فقده يحتاج مراجعة، وعطل القارئ يظهر وقتًا غير معلوم؛ لا تُخصم الفترات تلقائيًا.</p>
      {presence.receivers.filter(receiver => receiver.configured).map(receiver => <small key={receiver.id} style={{ color: receiver.receiver_state === 'ready' ? '#15803d' : '#64748b' }}>قارئ {receiver.branch_name}: {receiver.receiver_state === 'ready' ? 'الرصد يعمل' : receiver.receiver_state === 'fault' ? 'عطل في الرصد' : receiver.receiver_state === 'disabled' ? 'معطّل' : 'النبضات غير محدّثة'}</small>)}
    </>}
  </section>;
}
