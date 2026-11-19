'use client';

import { useState, useEffect, useCallback } from 'react';
import type { AppUser } from '@/lib/types';
import type { StoreRouter, EmployeeWifiDevice } from '@/lib/wifi-presence';

export default function WifiPresenceManager({ users }: { users: AppUser[] }) {
  const [routers, setRouters] = useState<StoreRouter[]>([]);
  const [devices, setDevices] = useState<EmployeeWifiDevice[]>([]);
  const [recentSightings, setRecentSightings] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Form states
  const [selectedUserId, setSelectedUserId] = useState('');
  const [macAddress, setMacAddress] = useState('');
  const [deviceName, setDeviceName] = useState('');

  // Router credentials edit states
  const [editingRouter, setEditingRouter] = useState<StoreRouter | null>(null);
  const [routerPassword, setRouterPassword] = useState('');
  const [pollResult, setPollResult] = useState<any>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/wifi-presence', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setRouters(data.routers || []);
      setDevices(data.devices || []);
      setRecentSightings(data.recentSightings || []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر تحميل بيانات الواي فاي');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleRegisterDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUserId || !macAddress.trim()) return;
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/wifi-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register_device',
          user_id: selectedUserId,
          mac_address: macAddress.trim(),
          device_name: deviceName.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage(data.message || 'تم ربط الجهاز بنجاح!');
      setMacAddress('');
      setDeviceName('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر ربط الجهاز');
    }
  };

  const handleSaveRouter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRouter) return;
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/wifi-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_router',
          id: editingRouter.id,
          branch_id: editingRouter.branch_id,
          name: editingRouter.name,
          model: editingRouter.model,
          ip_address: editingRouter.ip_address,
          username: editingRouter.username,
          password: routerPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMessage('تم حفظ إعدادات الراوتر بنجاح!');
      setEditingRouter(null);
      setRouterPassword('');
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'تعذر حفظ الراوتر');
    }
  };

  const handlePollRouter = async (routerId: number) => {
    setMessage(''); setError(''); setPollResult(null);
    try {
      const res = await fetch('/api/wifi-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'poll_router', router_id: routerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPollResult(data);
      setMessage(`تم الفحص بنجاح! تم العثور على ${data.clientsCount} جهاز متصل بالراوتر (${data.matchedEmployees} موظف).`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل فحص الراوتر');
    }
  };

  const handleRemoveDevice = async (id: number) => {
    if (!confirm('هل تريد حذف هذا الجهاز؟')) return;
    try {
      const res = await fetch('/api/wifi-presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_device', id }),
      });
      await res.json();
      await loadData();
    } catch (err) {
      setError('تعذر الحذف');
    }
  };

  return (
    <section style={{ display: 'grid', gap: 16 }}>
      <div className="card" style={{ padding: 20 }}>
        <div className="section-title">
          <h3>📶 تتبع الحضور عبر واي فاي المحل (Wi-Fi Presence)</h3>
          <button className="btn btn-secondary btn-sm" onClick={() => void loadData()} disabled={loading}>
            {loading ? 'جاري التحميل...' : 'تحديث'}
          </button>
        </div>
        <p style={{ color: '#475569' }}>
          هذا النظام يتيح لك الاستغناء عن تاجات البلوتوث وتتبع تواجد الموظفين عبر اتصال هواتفهم بشبكة الواي فاي في المحل مباشرة. 
          بمجرد إدخال يوزر وباسورد الراوتر لكل فرع، يقوم النظام بفحص قائمة الأجهزة المتصلة وتحديد حضور وانصراف الموظف بدقة.
        </p>
        {message && <p role="status" style={{ color: '#16a34a', fontWeight: 700 }}>{message}</p>}
        {error && <p role="alert" style={{ color: '#dc2626', fontWeight: 700 }}>{error}</p>}
      </div>

      {/* Routers Section */}
      <div className="card" style={{ padding: 20 }}>
        <h3>أجهزة الراوتر في الفروع</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 12 }}>
          {routers.map(router => (
            <div key={router.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#f8fafc' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <strong style={{ fontSize: 14, color: '#1e3a8a' }}>{router.name}</strong>
                <span style={{ fontSize: 11, color: '#64748b' }}>{router.branch_id === 'branch1' ? 'الفرع الرئيسي' : 'فرع الجملة'}</span>
              </div>
              <div style={{ margin: '8px 0', fontSize: 12, color: '#334155' }}>
                <div>عنوان IP: <code dir="ltr">{router.ip_address}</code></div>
                <div>المستخدم: <code dir="ltr">{router.username}</code></div>
                <div>الحالة: <span style={{ fontWeight: 600 }}>{router.last_status || 'لم يتم الفحص بعد'}</span></div>
                {router.last_polled_at && <div style={{ fontSize: 11, color: '#64748b' }}>آخر فحص: {router.last_polled_at}</div>}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => { setEditingRouter(router); setRouterPassword(''); }}>
                  تعديل البيانات
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void handlePollRouter(router.id)}>
                  ⚡ فحص الأجهزة المتصلة الآن
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Edit Router Modal / Box */}
        {editingRouter && (
          <form onSubmit={handleSaveRouter} style={{ marginTop: 16, padding: 16, border: '2px solid #3b82f6', borderRadius: 10, background: '#eff6ff' }}>
            <h4 style={{ margin: '0 0 10px', color: '#1e40af' }}>تعديل بيانات {editingRouter.name}</h4>
            <div className="metrics-grid">
              <label>عنوان IP للراوتر
                <input className="form-input" dir="ltr" required value={editingRouter.ip_address} onChange={e => setEditingRouter({ ...editingRouter, ip_address: e.target.value })} />
              </label>
              <label>اسم المستخدم (User)
                <input className="form-input" dir="ltr" required value={editingRouter.username} onChange={e => setEditingRouter({ ...editingRouter, username: e.target.value })} />
              </label>
              <label>كلمة مرور الأدمن (Password)
                <input className="form-input" type="password" dir="ltr" placeholder="اتركه فارغاً للإبقاء على القديم" value={routerPassword} onChange={e => setRouterPassword(e.target.value)} />
              </label>
              <label>نوع الراوتر
                <select className="form-input" value={editingRouter.model} onChange={e => setEditingRouter({ ...editingRouter, model: e.target.value })}>
                  <option value="generic">راوتر عام / تلقائي (Generic Auto)</option>
                  <option value="tplink">تي بي لينك (TP-Link)</option>
                  <option value="zte">زد تي إي / وي (ZTE / WE VDSL)</option>
                  <option value="huawei">هواوي (Huawei DG8045 / VDSL)</option>
                  <option value="keenetic">كينيتيك (Keenetic)</option>
                </select>
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="submit" className="btn btn-primary">حفظ بيانات الراوتر</button>
              <button type="button" className="btn btn-secondary" onClick={() => setEditingRouter(null)}>إلغاء</button>
            </div>
          </form>
        )}

        {/* Poll Results */}
        {pollResult && (
          <div style={{ marginTop: 14, padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <strong>الأجهزة المكتشفة على الراوتر:</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {pollResult.clients.map((c: any) => (
                <button
                  key={c.mac}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setMacAddress(c.mac)}
                  title="اضغط لنسخ هذا الماك لربطه بموظف"
                >
                  <span dir="ltr"><strong>{c.mac}</strong></span> {c.ip && `(${c.ip})`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Employee Devices Section */}
      <div className="card" style={{ padding: 20 }}>
        <h3>ربط هواتف الموظفين (Phone MAC Registration)</h3>
        <form onSubmit={handleRegisterDevice} style={{ marginTop: 12 }}>
          <div className="metrics-grid">
            <label>الموظف
              <select className="form-input" required value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                <option value="">اختار الموظف</option>
                {users.filter(u => u.role === 'employee' && u.is_active !== false).map(u => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </label>
            <label>عنوان ماك واي فاي الهاتف (MAC Address)
              <input
                className="form-input"
                dir="ltr"
                required
                placeholder="28:BB:B2:1E:48:F5"
                value={macAddress}
                onChange={e => setMacAddress(e.target.value)}
              />
            </label>
            <label>وصف الجهاز (اختياري)
              <input
                className="form-input"
                placeholder="مثلاً: سامسونج جالكسي S23"
                value={deviceName}
                onChange={e => setDeviceName(e.target.value)}
              />
            </label>
          </div>
          <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>
            ربط الهاتف بالموظف
          </button>
        </form>

        {/* Devices Table */}
        <div style={{ marginTop: 18 }}>
          <h4>قائمة الهواتف المسجلة حالياً</h4>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>الموظف</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>عنوان MAC</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>نوع الجهاز</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right' }}>آخر ظهور</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center' }}>إجراء</th>
                </tr>
              </thead>
              <tbody>
                {devices.map(dev => (
                  <tr key={dev.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{dev.user_name}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', direction: 'ltr', textAlign: 'right' }}>{dev.mac_address}</td>
                    <td style={{ padding: '8px 12px', color: '#64748b' }}>{dev.device_name || '—'}</td>
                    <td style={{ padding: '8px 12px', color: dev.last_seen_at ? '#15803d' : '#94a3b8' }}>
                      {dev.last_seen_at ? `${dev.last_seen_at} (${dev.last_branch === 'branch2' ? 'فرع الجملة' : 'الفرع الرئيسي'})` : 'لم يتم رصده بعد'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => void handleRemoveDevice(dev.id)}>
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
                {devices.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: 14, textAlign: 'center', color: '#94a3b8' }}>
                      لا توجد هواتف مسجلة حالياً. قم بإضافة ماك هاتف الموظف أعلاه.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
