'use client';
import { useCallback, useEffect, useState } from 'react';
import type { AppUser } from '@/lib/types';
import { localDate } from '@/lib/time';
import ReaderStatusPanel from './ReaderStatusPanel';

interface Device { id: string; name: string; branch_id: string; is_active: boolean; last_seen_at: string | null }
interface Card { id: number; uid: string; user_id: number; name: string }
interface Scan { id: string; card_uid: string; user_id: number | null; user_name: string | null; device_name: string; branch_id: string; recorded_at: string | null; received_at: string; status: string; event_type: string | null; shift_day: string | null; review_note: string | null }
interface ReviewAudit { id: string; admin_name: string; created_at: string; note: string; previous_data: { event_type: string | null; shift_day: string | null }; new_data: { event_type: string | null; shift_day: string | null } }
interface WifiNetwork { id: number; ssid: string; password?: string; note: string | null; is_active: boolean; created_at: string }
interface UnassignedScan { card_uid: string; last_seen: string; scan_count: number; device_name: string }
interface Data { devices: Device[]; cards: Card[]; scans: Scan[]; total: number; branches: { id: string; name: string }[]; wifi_networks?: WifiNetwork[]; unassigned_scans?: UnassignedScan[] }

const labels: Record<string, string> = {
  rapid_repeat: 'إعادة مسح سريعة / Refresh',
  after_checkout: 'Refresh بعد الانصراف',
  before_open: 'قبل فتح الحضور',
  manual_conflict: 'تعارض مع مراجعة المدير',
  shift_conflict: 'تعارض في يوم الشيفت · للمراجعة',
  pending: 'انتظار التصنيف',
  accepted: 'محفوظة',
  duplicate_action: 'قراءة إضافية لنفس الحركة',
  unknown_card: 'كارت غير مربوط',
  outside_window: 'خارج نوافذ الشيفت',
  ambiguous_window: 'نوافذ متداخلة',
  invalid_time: 'ساعة الجهاز تحتاج مراجعة',
  before_start: 'قبل بداية السجل',
  inactive_user: 'حساب معطّل أو ليس موظفًا',
  ignored: 'تجاهلها المدير'
};

export default function NfcManager({ users }: { users: AppUser[] }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [audit, setAudit] = useState<ReviewAudit[]>([]);

  // Devices & Card Assignment Form
  const [deviceName, setDeviceName] = useState('');
  const [branch, setBranch] = useState('branch1');
  const [uid, setUid] = useState('');
  const [employee, setEmployee] = useState('');
  const [secret, setSecret] = useState<{ device_id: string; token: string } | null>(null);
  const [selected, setSelected] = useState<Scan | null>(null);
  const [review, setReview] = useState({ user_id: '', event_type: 'clock_in', shift_day: localDate(), recorded_at: '', note: '' });

  // Quick Card Search & Transfer State
  const [cardSearch, setCardSearch] = useState('');
  const [transferringCardUid, setTransferringCardUid] = useState<string | null>(null);
  const [transferTargetUser, setTransferTargetUser] = useState('');
  const [pendingTransferPrompt, setPendingTransferPrompt] = useState<{ uid: string; currentOwner: string; targetUserId: number; targetUserName: string } | null>(null);

  // Wi-Fi Management Form
  const [newWifiSsid, setNewWifiSsid] = useState('');
  const [newWifiPassword, setNewWifiPassword] = useState('');
  const [newWifiNote, setNewWifiNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/nfc/admin?page=${page}&review=${reviewOnly}`, { cache: 'no-store' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [page, reviewOnly]);

  useEffect(() => {
    queueMicrotask(() => void load());
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const action = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    setSuccessMsg('');
    try {
      const r = await fetch('/api/nfc/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (!r.ok) {
        if (r.status === 409 && d.is_assigned && body.action === 'assign_card') {
          const targetEmp = users.find(u => u.id === Number(body.user_id));
          setPendingTransferPrompt({
            uid: String(body.uid),
            currentOwner: d.current_owner,
            targetUserId: Number(body.user_id),
            targetUserName: targetEmp?.name || 'الموظف المختار'
          });
        }
        throw new Error(d.error);
      }
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const handleTransfer = async (cardUidToTransfer: string, newUserId: number) => {
    const res = await action({ action: 'transfer_card', uid: cardUidToTransfer, new_user_id: newUserId });
    if (res) {
      const newEmp = users.find(u => u.id === newUserId);
      setSuccessMsg(`تم نقل ملكية الكارت ${cardUidToTransfer} بنجاح إلى الموظف ${newEmp?.name || ''}`);
      setTransferringCardUid(null);
      setTransferTargetUser('');
      setPendingTransferPrompt(null);
      setUid('');
    }
  };

  const time = (v: string | null) => v ? new Date(v).toLocaleString('ar-EG', { timeZone: 'Africa/Cairo' }) : 'توقيت غير معلوم';

  const activeEmployees = users.filter(u => u.role === 'employee' && u.is_active !== false);
  const filteredCards = (data?.cards || []).filter(c =>
    !cardSearch ||
    c.name.toLowerCase().includes(cardSearch.toLowerCase()) ||
    c.uid.toLowerCase().includes(cardSearch.toLowerCase())
  );

  return (
    <section className="attendance-reports">
      <ReaderStatusPanel />

      {/* Global Success / Error Alerts */}
      {successMsg && <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac', color: '#166534', padding: '12px 16px', marginBottom: 16 }}><strong>✓ {successMsg}</strong></div>}
      {error && <p role="alert" className="tracker-warning" style={{ marginBottom: 16 }}>{error}</p>}

      {/* Unassigned Cards Fast-Action Bar */}
      {data?.unassigned_scans && data.unassigned_scans.length > 0 && (
        <div className="card" style={{ border: '2px dashed #3b82f6', background: '#eff6ff', padding: 18, marginBottom: 16 }}>
          <div className="section-title">
            <h3 style={{ color: '#1e40af', margin: 0 }}>⚡ كروت تم مسحها بالقارئ حديثًا ولم تُربط بموظف</h3>
            <span style={{ fontSize: '0.85rem', color: '#3b82f6' }}>اضغط على أي كارت لربطه فورًا</span>
          </div>
          <p className="muted" style={{ margin: '6px 0 12px 0' }}>هذه الكروت تم تمريرها على القارئ ولم يتعرف عليها النظام. يمكنك ربطها بموظف بضغطة زر دون الحاجة لكتابة كود الكارت يدويًا:</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {data.unassigned_scans.map(s => (
              <div key={s.card_uid} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#ffffff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 12px', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
                <span>كارت: <code style={{ fontWeight: 'bold', color: '#1e3a8a' }}>{s.card_uid}</code></span>
                <small className="muted">({s.device_name} · {time(s.last_seen)})</small>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    setUid(s.card_uid);
                    setSuccessMsg(`تم اختيار الكارت ${s.card_uid} للربط، اختر الموظف واضغط ربط.`);
                  }}
                >
                  ➕ ربط بموظف
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Card Assignment & Transfer Section */}
      <div className="card">
        <h3>ربط ونقل ملكية الكروت</h3>
        <p className="muted">مرّر الكارت أولًا على القارئ أو أدخل رقمه، ثم اختر الموظف. في حال كان الكارت مرتبطًا بموظف آخر، يمكنك نقله مباشرة دون الحاجة لإلغاء الربط يدويًا.</p>

        {/* Transfer Confirmation Dialog */}
        {pendingTransferPrompt && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <h4 style={{ color: '#92400e', margin: '0 0 8px 0' }}>⚠️ تأكيد نقل ملكية الكارت</h4>
            <p style={{ margin: '0 0 12px 0', color: '#78350f' }}>
              الكارت <code>{pendingTransferPrompt.uid}</code> مسجل حاليًا باسم <strong>{pendingTransferPrompt.currentOwner}</strong>. هل تريد تحويل ملكيته إلى <strong>{pendingTransferPrompt.targetUserName}</strong>؟
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => void handleTransfer(pendingTransferPrompt.uid, pendingTransferPrompt.targetUserId)}
              >
                ✓ نعم، انقل ملكية الكارت الآن
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => setPendingTransferPrompt(null)}
              >
                إلغاء
              </button>
            </div>
          </div>
        )}

        <form onSubmit={async e => {
          e.preventDefault();
          const r = await action({ action: 'assign_card', uid, user_id: Number(employee) });
          if (r) {
            const empName = users.find(u => u.id === Number(employee))?.name;
            setSuccessMsg(`تم ربط الكارت ${uid} بنجاح بالموظف ${empName || ''}`);
            setUid('');
            setEmployee('');
          }
        }}>
          <div className="report-filters">
            <label>
              رقم الكارت UID
              <input
                className="form-input"
                value={uid}
                onChange={e => setUid(e.target.value)}
                required
                placeholder="مثال: 0F12345678"
              />
            </label>
            <label>
              الموظف
              <select
                className="form-input"
                value={employee}
                onChange={e => setEmployee(e.target.value)}
                required
              >
                <option value="">اختر الموظف</option>
                {activeEmployees.map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>ربط الكارت</button>
        </form>

        {/* Existing Assigned Cards List with Transfer Options */}
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            <h4 style={{ margin: 0 }}>الكروت المربوطة حاليًا ({filteredCards.length} كارت)</h4>
            <input
              type="search"
              className="form-input"
              style={{ maxWidth: 260 }}
              placeholder="بحث باسم الموظف أو رقم الكارت..."
              value={cardSearch}
              onChange={e => setCardSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            {filteredCards.map(c => (
              <div key={c.id} className="movement-row" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, padding: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <div>
                    <strong>{c.name}</strong> · كود الكارت: <code style={{ fontSize: '0.95rem', fontWeight: 600 }}>{c.uid}</code>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      disabled={busy}
                      onClick={() => {
                        if (transferringCardUid === c.uid) {
                          setTransferringCardUid(null);
                        } else {
                          setTransferringCardUid(c.uid);
                          setTransferTargetUser('');
                        }
                      }}
                    >
                      {transferringCardUid === c.uid ? 'إلغاء النقل' : '🔄 نقل لموظف آخر'}
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ color: '#b91c1c' }}
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`هل أنت متأكد من إلغاء ربط كارت ${c.name} (${c.uid})؟`)) {
                          void action({ action: 'revoke_card', id: c.id });
                        }
                      }}
                    >
                      إلغاء الربط / مفقود
                    </button>
                  </div>
                </div>

                {/* Inline Transfer Picker */}
                {transferringCardUid === c.uid && (
                  <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 6, padding: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>تحويل الكارت <code>{c.uid}</code> إلى:</span>
                    <select
                      className="form-input"
                      style={{ maxWidth: 220, padding: '4px 8px' }}
                      value={transferTargetUser}
                      onChange={e => setTransferTargetUser(e.target.value)}
                    >
                      <option value="">اختر الموظف الجديد</option>
                      {activeEmployees.filter(u => u.id !== c.user_id).map(u => (
                        <option key={u.id} value={u.id}>{u.name}</option>
                      ))}
                    </select>
                    <button
                      className="btn btn-primary btn-sm"
                      disabled={busy || !transferTargetUser}
                      onClick={() => void handleTransfer(c.uid, Number(transferTargetUser))}
                    >
                      تأكيد النقل فورًا
                    </button>
                  </div>
                )}
              </div>
            ))}
            {filteredCards.length === 0 && <p className="muted">لا توجد كروت مطابقة للبحث.</p>}
          </div>
        </div>
      </div>

      {/* Wi-Fi Networks Management Section */}
      <div className="card">
        <div className="section-title">
          <h3>شبكات Wi-Fi لقارئات الحضور (مزامنة تلقائية)</h3>
          <span className="badge" style={{ background: '#dbeafe', color: '#1e40af', padding: '4px 8px', borderRadius: 6, fontSize: '0.8rem' }}>ميزة جديدة</span>
        </div>
        <p className="muted">
          أي شبكة تضيفها هنا تُرسل تلقائيًا لجميع أجهزة ESP32 بمجرد اتصالها بالإنترنت وتُحفظ داخل ذاكرة الـ ESP32 الدائمة (NVS).
          يبحث الجهاز تلقائيًا عن الشبكات المتاحة ويتصل بأي شبكة منها دون الحاجة لإعادة رفع الكود أو تعديله عند نقل الجهاز بين الفروع أو المنزل.
        </p>

        {/* Existing Wi-Fi Networks List */}
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}>
          {data?.wifi_networks?.map(w => (
            <div key={w.id} className="movement-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: 8 }}>
              <div>
                <strong style={{ fontSize: '1rem' }}>📶 {w.ssid}</strong>
                {w.note && <span className="muted" style={{ marginRight: 8 }}>· {w.note}</span>}
                <span style={{ marginRight: 8, fontSize: '0.8rem', color: w.is_active ? '#15803d' : '#94a3b8' }}>
                  ({w.is_active ? 'نشطة' : 'معطلة'})
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void action({ action: 'toggle_wifi', id: w.id, is_active: !w.is_active })}
                >
                  {w.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ color: '#b91c1c' }}
                  disabled={busy}
                  onClick={() => {
                    if (confirm(`حذف شبكة Wi-Fi "${w.ssid}" من القارئات؟`)) {
                      void action({ action: 'delete_wifi', id: w.id });
                    }
                  }}
                >
                  حذف
                </button>
              </div>
            </div>
          ))}
          {(!data?.wifi_networks || data.wifi_networks.length === 0) && (
            <p className="muted">لا توجد شبكات Wi-Fi مسجلة.</p>
          )}
        </div>

        {/* Add Wi-Fi Form */}
        <form onSubmit={async e => {
          e.preventDefault();
          const res = await action({
            action: 'add_wifi',
            ssid: newWifiSsid,
            password: newWifiPassword,
            note: newWifiNote
          });
          if (res) {
            setSuccessMsg(`تمت إضافة شبكة Wi-Fi "${newWifiSsid}" بنجاح وستُرسل للقارئات تلقائيًا.`);
            setNewWifiSsid('');
            setNewWifiPassword('');
            setNewWifiNote('');
          }
        }}>
          <div className="report-filters">
            <label>
              اسم الشبكة (SSID)
              <input
                className="form-input"
                value={newWifiSsid}
                onChange={e => setNewWifiSsid(e.target.value)}
                required
                maxLength={32}
                placeholder="مثال: 3bdo أو JOESTORE"
                dir="ltr"
              />
            </label>
            <label>
              كلمة المرور (Password)
              <input
                className="form-input"
                type="password"
                value={newWifiPassword}
                onChange={e => setNewWifiPassword(e.target.value)}
                maxLength={63}
                placeholder="اتركها فارغة إذا كانت شبكة مفتوحة"
                dir="ltr"
              />
            </label>
            <label>
              ملاحظة توضيحية
              <input
                className="form-input"
                value={newWifiNote}
                onChange={e => setNewWifiNote(e.target.value)}
                placeholder="مثال: هوتسبوت المنزل، الفرع الثاني..."
              />
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>إضافة شبكة Wi-Fi للقارئات</button>
        </form>
      </div>

      {/* Reader Devices Section */}
      <div className="card">
        <h3>قارئات الفروع (أجهزة ESP32)</h3>
        <p className="muted">كل فرع: قارئ RC522 + ESP32 + Wi‑Fi. كل قراءة تُحفظ بوقت التقاطها ووقت وصولها. الحضور والانصراف بالكارت.</p>

        <form onSubmit={async e => {
          e.preventDefault();
          const result = await action({ action: 'create_device', name: deviceName, branch_id: branch });
          if (result) {
            setSecret(result);
            setDeviceName('');
          }
        }}>
          <div className="report-filters">
            <label>
              اسم القارئ
              <input className="form-input" value={deviceName} onChange={e => setDeviceName(e.target.value)} required maxLength={100} />
            </label>
            <label>
              فرع القارئ
              <select className="form-input" value={branch} onChange={e => setBranch(e.target.value)}>
                {data?.branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          </div>
          <button className="btn btn-primary" disabled={busy}>إضافة قارئ وإصدار مفتاحه</button>
        </form>

        {secret && (
          <div className="tracker-warning" style={{ marginTop: 16 }}>
            <h4>إعداد القارئ — المفتاح يظهر مرة واحدة</h4>
            <p>انسخ القيم إلى attendance-config.h على ESP32. المفتاح خاص بهذا القارئ؛ لا تشاركه مع الموظفين.</p>
            <label>DEVICE_ID<input className="form-input" readOnly value={secret.device_id} /></label>
            <label>DEVICE_TOKEN<input className="form-input" readOnly type="password" value={secret.token} /></label>
            <button className="btn btn-secondary" onClick={() => void navigator.clipboard.writeText(`DEVICE_ID=${secret.device_id}\nDEVICE_TOKEN=${secret.token}`)}>نسخ إعدادات القارئ</button>
            <button className="btn btn-secondary" onClick={() => setSecret(null)}>إخفاء</button>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          {data?.devices.map(d => (
            <div className="movement-row" key={d.id}>
              <div>
                <strong>{d.name}</strong>
                <p>{data.branches.find(b => b.id === d.branch_id)?.name || d.branch_id} · {d.is_active ? 'مفعّل' : 'معطّل'} · آخر اتصال: {d.last_seen_at ? time(d.last_seen_at) : 'لم يتصل بعد'}</p>
              </div>
              <div>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void action({ action: 'device_active', id: d.id, is_active: !d.is_active })}>
                  {d.is_active ? 'تعطيل' : 'تفعيل'}
                </button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={async () => {
                  const r = await action({ action: 'rotate_device', id: d.id });
                  if (r) setSecret(r);
                }}>
                  إصدار مفتاح بديل
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scans Log Table */}
      <div className="card">
        <div className="section-title">
          <h3>كل قراءات الكروت</h3>
          <button className="btn btn-secondary" onClick={() => void load()}>تحديث</button>
        </div>
        <label>
          <input type="checkbox" checked={reviewOnly} onChange={e => { setReviewOnly(e.target.checked); setPage(1); }} /> قراءات تحتاج مراجعة فقط
        </label>
        <div className="data-table-wrapper" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>الموظف / الكارت</th>
                <th>القارئ</th>
                <th>وقت القراءة</th>
                <th>وصل للسيرفر</th>
                <th>الحركة</th>
                <th>الحالة</th>
                <th>الإدارة</th>
              </tr>
            </thead>
            <tbody>
              {data?.scans.map(s => (
                <tr key={s.id}>
                  <td>{s.user_name || 'غير مربوط'}<br /><code>{s.card_uid}</code></td>
                  <td>{s.device_name}</td>
                  <td>{time(s.recorded_at)}</td>
                  <td>{time(s.received_at)}</td>
                  <td>{s.event_type === 'clock_in' ? 'حضور' : s.event_type === 'clock_out' ? 'انصراف' : s.event_type === 'refresh' ? 'حركة / Refresh' : '—'}<br />{s.shift_day}</td>
                  <td>{labels[s.status] || s.status}{s.review_note && <p>{s.review_note}</p>}</td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => {
                      setSelected(s);
                      setAudit([]);
                      void fetch('/api/nfc/admin?scanId=' + s.id).then(r => r.json()).then(d => setAudit(d.history || []));
                      setReview({ user_id: String(s.user_id || ''), event_type: s.event_type || 'clock_in', shift_day: s.shift_day || localDate(), recorded_at: s.recorded_at || '', note: '' });
                    }}>
                      مراجعة
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setUid(s.card_uid)}>
                      استخدام رقم الكارت
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && !data.scans.length && <p>لا توجد قراءات في السجل.</p>}
        <div className="report-actions">
          <button className="btn btn-secondary" disabled={page === 1} onClick={() => setPage(p => p - 1)}>السابق</button>
          <span>صفحة {page} · {data?.total || 0} قراءة</span>
          <button className="btn btn-secondary" disabled={page * 100 >= (data?.total || 0)} onClick={() => setPage(p => p + 1)}>التالي</button>
        </div>
      </div>

      {/* Review Modal */}
      {selected && (
        <div className="modal-overlay">
          <section className="modal employee-editor" role="dialog" aria-modal="true" aria-labelledby="scan-review-title">
            <h3 id="scan-review-title">مراجعة قراءة {selected.card_uid}</h3>
            {audit.length > 0 && (
              <details>
                <summary>تاريخ تعديلات القراءة</summary>
                {audit.map(a => (
                  <p key={a.id}>{a.admin_name} · {time(a.created_at)} · {a.note}<br />{a.previous_data.event_type || 'غير مصنفة'} → {a.new_data.event_type || 'تجاهل'} · {a.new_data.shift_day}</p>
                ))}
              </details>
            )}
            <form onSubmit={async e => {
              e.preventDefault();
              const r = await action({ action: 'review_scan', id: selected.id, ...review, user_id: Number(review.user_id), ...(review.recorded_at ? { recorded_at: review.recorded_at } : {}) });
              if (r) setSelected(null);
            }}>
              <div className="report-filters">
                <label>
                  الموظف
                  <select className="form-input" value={review.user_id} onChange={e => setReview({ ...review, user_id: e.target.value })} required={review.event_type !== 'ignored'}>
                    <option value="">اختر الموظف</option>
                    {users.map(u => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  نوع القراءة
                  <select className="form-input" value={review.event_type} onChange={e => setReview({ ...review, event_type: e.target.value })}>
                    <option value="clock_in">حضور</option>
                    <option value="clock_out">انصراف</option>
                    <option value="ignored">تجاهل القراءة</option>
                  </select>
                </label>
                <label>يوم بداية الشيفت<input className="form-input" type="date" value={review.shift_day} onChange={e => setReview({ ...review, shift_day: e.target.value })} /></label>
                <label>وقت القراءة UTC (لتصحيح الساعة)<input className="form-input" value={review.recorded_at} placeholder="2026-10-03T09:00:00Z" onChange={e => setReview({ ...review, recorded_at: e.target.value })} /></label>
                <label>سبب التعديل<input className="form-input" required maxLength={1000} value={review.note} onChange={e => setReview({ ...review, note: e.target.value })} /></label>
              </div>
              <p className="muted">التعديل يحدّث التقرير ويحفظ من عدّله والسبب في سجل مراجعة خاص.</p>
              {error && <p role="alert">{error}</p>}
              <div className="report-actions">
                <button className="btn btn-primary" disabled={busy}>اعتماد التعديل</button>
                <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>إغلاق</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </section>
  );
}
