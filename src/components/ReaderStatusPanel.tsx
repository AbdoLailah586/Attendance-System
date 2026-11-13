'use client';

import { useEffect, useState } from 'react';
import { BLE_PING_SECONDS, type AdminReaderStatus, type BleReaderPing, type ReaderDiagnostics } from '@/lib/ble-types';
import { TIME_ZONE } from '@/lib/time';

const connections = { connected: 'تواصل حديث مع السيرفر', stale: 'التواصل منقطع', never_seen: 'لم يتصل بعد', disabled: 'معطّل' };
const receiverLabels = { ready: 'يعمل', fault: 'أبلغ عن عطل', stale: 'الحالة غير محدّثة', disabled: 'معطّل' };
const resets: Record<string, string> = {
  power_on: 'تشغيل الكهرباء', external: 'إعادة تشغيل خارجية', software: 'إعادة تشغيل من البرنامج',
  panic: 'عطل في البرنامج', watchdog: 'إعادة تشغيل بعد تعليق', brownout: 'هبوط جهد', other: 'غير معروف',
};
const formatTime = (value: string | null) => value ? new Date(value).toLocaleString('ar-EG', { timeZone: TIME_ZONE }) : 'لا يوجد';
const yesNo = (value: boolean) => value ? 'جاهز' : 'يحتاج فحص';
const httpStatus = (code: number) => code > 0 ? `HTTP ${code}` : `خطأ اتصال (${code})`;

function PingDiagnostics({ data }: { data: ReaderDiagnostics }) {
  const upload = data.nfc_upload_http === null ? 'لم يُرفع كارت منذ التشغيل' :
    data.nfc_upload_ack ? `السيرفر أكد استلام آخر دفعة · ${formatTime(data.nfc_last_ack_at)}` :
      `آخر دفعة لم تتأكد بالكامل · ${httpStatus(data.nfc_upload_http)}`;
  return <ul style={{ paddingInlineStart: '1.25rem' }}>
    <li>مسار رفع الكروت {data.nfc_probe_ack ? 'رد على طلب الاختبار' : `فشل في الاختبار · ${httpStatus(data.nfc_probe_http)}`}</li>
    <li>{upload}</li>
    <li>في انتظار الرفع {data.nfc_queued} قراءة كارت و{data.ble_queued} حدث بلوتوث</li>
    <li>قارئ الكروت {yesNo(data.rc522_ready)} · البلوتوث {yesNo(data.ble_ready)} · التخزين {yesNo(data.storage_ready)} · الساعة {yesNo(data.clock_ready)}</li>
    <li>إشارة الواي فاي {data.rssi_dbm === null ? 'غير متاحة' : <bdi>{data.rssi_dbm} dBm</bdi>} · مرات الفصل منذ التشغيل {data.wifi_disconnects}{data.wifi_disconnects > 0 && ` · آخر كود فصل ${data.wifi_last_reason}`}</li>
    <li>الإصدار <bdi>{data.firmware}</bdi> · شغّال من {Math.floor(data.uptime_seconds / 60)} دقيقة و{data.uptime_seconds % 60} ثانية · سبب آخر تشغيل {resets[data.reset_reason] ?? 'غير معروف'}</li>
  </ul>;
}

function PingResult({ reader }: { reader: AdminReaderStatus }) {
  const ping = reader.ping;
  if (!ping) return null;
  const heardSinceStart = reader.last_seen_at && Date.parse(reader.last_seen_at) >= Date.parse(ping.started_at);
  if (ping.state === 'pending') return <p role="status">مستني رد Pong لمدة تصل إلى {BLE_PING_SECONDS / 60} دقيقة…</p>;
  if (ping.state === 'timed_out') return <p role="status" style={{ color: '#b45309' }}>
    مفيش رد Pong خلال المهلة · {formatTime(ping.expires_at)}. {heardSinceStart
      ? 'القارئ تواصل مع السيرفر بعد بدء الاختبار. راجع دعم إصدار القارئ للاختبار.'
      : 'لو القارئ فقد الاتصال، سبب الانقطاع يحتاج فحص في الفرع.'}
  </p>;
  return <>
    <p role="status" style={{ color: '#15803d' }}>وصل رد Pong · {formatTime(ping.pong_at)}</p>
    {ping.diagnostics ? <PingDiagnostics data={ping.diagnostics} /> : <p>الإصدار 1.4.6 يدعم إرسال تفاصيل التشخيص مع الرد.</p>}
  </>;
}

export default function ReaderStatusPanel() {
  const [readers, setReaders] = useState<AdminReaderStatus[] | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [starting, setStarting] = useState<string | null>(null);
  const [startError, setStartError] = useState<{ id: string; message: string } | null>(null);
  const pending = readers?.some(reader => reader.ping?.state === 'pending') ?? false;

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const response = await fetch('/api/ble/ping', { cache: 'no-store', signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (!controller.signal.aborted) { setReaders(result.readers); setError(''); }
      } catch {
        if (!controller.signal.aborted) setError('تعذر تحديث حالة القارئات. البيانات المعروضة من آخر تحديث ناجح.');
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void load(), pending ? 3000 : 15000);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, refresh]);

  async function start(id: string) {
    setStarting(id);
    setStartError(null);
    try {
      const response = await fetch('/api/ble/ping', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_id: id }), signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      const ping: BleReaderPing = await response.json();
      setReaders(current => current?.map(reader => reader.id === id ? { ...reader, ping } : reader) ?? null);
      setRefresh(current => current + 1);
    } catch (failure) {
      setStartError({ id, message: failure instanceof Error && failure.name === 'Error' ? failure.message : 'تعذر بدء اختبار الاتصال' });
    } finally {
      setStarting(null);
    }
  }

  return <section className="card" style={{ padding: 20 }} aria-label="حالة قارئات الفروع">
    <div className="section-title">
      <h3>حالة قارئات الفروع</h3>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRefresh(current => current + 1)}>تحديث الحالة</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!readers && !error && <p role="status">جاري تحميل حالة القارئات…</p>}
    {readers?.length === 0 && <p>مفيش قارئات مسجّلة.</p>}
    <div className="metrics-grid">
      {readers?.map(reader => <article key={reader.id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
        <strong>{reader.name} · {reader.branch_name}</strong>
        <p style={{ color: reader.connection === 'connected' ? '#15803d' : '#92400e' }}>{connections[reader.connection]}</p>
        <p>آخر تواصل {formatTime(reader.last_seen_at)}<br />
          آخر كارت وصل {formatTime(reader.last_scan_at)}<br />
          البلوتوث {receiverLabels[reader.receiver_state]} · آخر نبضة {formatTime(reader.last_heartbeat_at)}</p>
        <button type="button" className="btn btn-primary btn-sm" disabled={starting !== null || reader.connection === 'disabled' || reader.ping?.state === 'pending'} onClick={() => void start(reader.id)}>
          {starting === reader.id ? 'جاري الإرسال…' : 'إرسال Ping'}
        </button>
        {startError?.id === reader.id && <p role="alert">{startError.message}</p>}
        <PingResult reader={reader} />
      </article>)}
    </div>
  </section>;
}
