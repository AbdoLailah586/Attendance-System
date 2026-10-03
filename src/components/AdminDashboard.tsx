'use client';

import React, { useState, useEffect } from 'react';
import {
  Radar,
  BarChart3,
  Users,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Pencil,
  LocateFixed,
  Check,
} from 'lucide-react';
import AttendanceMap from './AttendanceMap';
import AttendanceLogViewer from './AttendanceLogViewer';
import BranchManager from './BranchManager';
import AttendanceReports from './AttendanceReports';
import NfcManager from './NfcManager';
import EmployeeEditor from './EmployeeEditor';
import type { EmployeePolicy } from '@/lib/period-report';
import type { AppUser, LiveEmployee } from '@/lib/types';
import type { StoreSettings } from '@/lib/geo';

interface AdminDashboardProps {
  user: AppUser;
}

export default function AdminDashboard({}: AdminDashboardProps) {
  const [activeTab, setActiveTab] = useState<'live' | 'reports' | 'settings' | 'users' | 'logs' | 'nfc'>('live');

  // Live data
  const [liveData, setLiveData] = useState<LiveEmployee[]>([]);
  const [settings, setSettings] = useState<StoreSettings | null>(null);
  const [loadingLive, setLoadingLive] = useState(false);
  const [autoRefresh] = useState(true);

  const [reportRefresh,setReportRefresh]=useState(0);
  const [editingUser,setEditingUser]=useState<AppUser|null>(null);
  const [policies,setPolicies]=useState<EmployeePolicy[]>([]);

  // Users data
  const [usersList, setUsersList] = useState<AppUser[]>([]);
  const [, setLoadingUsers] = useState(false);
  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUserData, setNewUserData] = useState({
    name: '',
    username: '',
    password: '',
    phone: '',
    shift_start: '10:00',
    shift_end: '22:00',
  });
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Settings form data
  const [settingsForm, setSettingsForm] = useState<StoreSettings>({
    id: 'main',
    branch1_name: '',
    branch1_lat: 30.0444,
    branch1_lng: 31.2357,
    branch1_radius: 40,
    branch2_name: '',
    branch2_lat: 30.0448,
    branch2_lng: 31.2362,
    branch2_radius: 40,
    shift_start_time: '10:00',
    shift_end_time: '22:00',
    grace_period_mins: 30,
    ping_interval_secs: 60,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsSuccessMsg, setSettingsSuccessMsg] = useState<string | null>(null);


  // Fetch live radar data
  const fetchLiveData = async () => {
    try {

      const res = await fetch('/api/attendance/live');
      if (res.ok) {
        const data = await res.json();
        setLiveData(data.employees || []);
        if (data.settings) {
          setSettings(data.settings);
          setSettingsForm(data.settings);
        }
      }
    } catch (err) {
      console.error('Fetch live error:', err);
    } finally {
      setLoadingLive(false);
    }
  };

  // Fetch users list
  const fetchUsers = async () => {
    try {

      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsersList(data.users || []);
        setPolicies(data.policies || []);
      }
    } catch (err) {
      console.error('Fetch users error:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Initial load
  useEffect(() => {
    queueMicrotask(() => { void fetchLiveData(); void fetchUsers(); });
  }, []);

  // Auto refresh interval for live tab
  useEffect(() => {
    if (!autoRefresh || activeTab !== 'live') return;
    const interval = setInterval(() => {
      fetchLiveData();
    }, 15000); // 15 seconds
    return () => clearInterval(interval);
  }, [autoRefresh, activeTab]);

  // Add User
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUserData),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      alert('تم إنشاء حساب الموظف بنجاح');
      setShowAddUserModal(false);
      setNewUserData({
        name: '',
        username: '',
        password: '',
        phone: '',
        shift_start: '10:00',
        shift_end: '22:00',
      });
      fetchUsers();
      fetchLiveData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء إضافة الموظف');
    }
  };

  // Delete User
  const handleDeleteUser = async (id: number, name: string) => {
    if (!confirm(`هل تريد تعطيل حساب الموظف: ${name} مع الاحتفاظ بسجلاته؟`)) return;
    try {
      const res = await fetch(`/api/users?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        fetchUsers();
        fetchLiveData();
      } else {
        const data = await res.json();
        alert(data.error);
      }
    } catch {
      alert('حدث خطأ أثناء حذف الموظف');
    }
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsSuccessMsg(null);

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setSettings(data.settings);
      setSettingsSuccessMsg('تم حفظ وتحديث إعدادات الفروع والشيفتات بنجاح!');
      setTimeout(() => setSettingsSuccessMsg(null), 4000);
      fetchLiveData();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الإعدادات');
    } finally {
      setSavingSettings(false);
    }
  };

  // Use current GPS location for Branch
  const captureCurrentLocationForBranch = (branch: 'branch1' | 'branch2') => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      alert('خدمة الـ GPS غير مدعومة في جهازك');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (branch === 'branch1') {
          setSettingsForm((prev: StoreSettings) => ({ ...prev, branch1_lat: latitude, branch1_lng: longitude }));
        } else {
          setSettingsForm((prev: StoreSettings) => ({ ...prev, branch2_lat: latitude, branch2_lng: longitude }));
        }
        alert(`تم التقاط إحداثيات موقعك الحالي بنجاح لـ ${branch === 'branch1' ? 'المحل الأول' : 'المحل الثاني'}`);
      },
      () => {
        alert('تعذر جلب موقعك الحالي. تأكد من تفعيل الـ GPS والسماح للمتصفح بالوصول.');
      },
      { enableHighAccuracy: true }
    );
  };

  // Copy credentials helper
  const copyCredentials = (u: string, id: number) => {
    const text = `نظام الحضور: ${window.location.origin}\nالمستخدم: ${u}\nاطلب كلمة المرور من المدير عند إنشاء حسابك`;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2500);
  };

  return (
    <div className="app-container">
      {/* Top Header & Actions */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '14px',
          marginBottom: '20px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a' }}>
            لوحة تحكم إدارة الحضور والفروع
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b' }}>
            متابعة حية للموظفين، تقارير بالساعة والدقيقة، وإعدادات جغرافية
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>


          <button
            onClick={() => {
              if (activeTab === 'live') fetchLiveData();
              if (activeTab === 'reports') setReportRefresh(n=>n+1);
              if (activeTab === 'users') fetchUsers();
            }}
            className="btn btn-secondary btn-sm"
          >
            <RefreshCw size={16} className={loadingLive ? 'spin' : ''} />
            <span>تحديث</span>
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="tab-list">
        <button className={`tab-button ${activeTab === 'nfc' ? 'active' : ''}`} onClick={() => setActiveTab('nfc')}>الكروت وقارئات الفروع</button>
        <button className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>كل سجلات الحضور والحركة</button>
        <button
          className={`tab-button ${activeTab === 'live' ? 'active' : ''}`}
          onClick={() => setActiveTab('live')}
        >
          <Radar size={18} />
          <span>المتابعة الحية والخريطة</span>
          <span
            style={{
              padding: '2px 8px',
              borderRadius: '9999px',
              background: activeTab === 'live' ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
              fontSize: '0.75rem',
            }}
          >
            {liveData.length} موظفين
          </span>
        </button>

        <button
          className={`tab-button ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <BarChart3 size={18} />
          <span>التقارير وساعات العمل</span>
        </button>

        <button
          className={`tab-button ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <MapPin size={18} />
          <span>إعدادات الفروع والشيفتات</span>
        </button>

        <button
          className={`tab-button ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          <Users size={18} />
          <span>إدارة حسابات الموظفين</span>
        </button>
      </div>

      {/* TAB 1: LIVE RADAR & MAP */}
      {activeTab === 'nfc' && <NfcManager users={usersList} />}
      {activeTab === 'logs' && <AttendanceLogViewer />}
      {activeTab === 'settings' && <BranchManager onSaved={fetchLiveData} />}
      {activeTab === 'live' && (
        <div>
          {/* Branch summary stats bar */}
          <div className="grid-4" style={{ marginBottom: '20px' }}>
            <div className="card" style={{ padding: '16px', borderTop: '4px solid #059669' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                المتواجدون في {settings?.branch1_name || 'المحل الأول'}
              </span>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#059669', marginTop: '4px' }}>
                {liveData.filter((e) => e.currentStatus === 'branch1').length} موظف
              </div>
            </div>

            <div className="card" style={{ padding: '16px', borderTop: '4px solid #4f46e5' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                المتواجدون في {settings?.branch2_name || 'المحل الثاني'}
              </span>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#4f46e5', marginTop: '4px' }}>
                {liveData.filter((e) => e.currentStatus === 'branch2').length} موظف
              </div>
            </div>

            <div className="card" style={{ padding: '16px', borderTop: '4px solid #d97706' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>خارج نطاق المحلين</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#d97706', marginTop: '4px' }}>
                {liveData.filter((e) => e.currentStatus === 'outside').length} موظف
              </div>
            </div>

            <div className="card" style={{ padding: '16px', borderTop: '4px solid #94a3b8' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>غير متصل / لم يبدأ</span>
              <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#64748b', marginTop: '4px' }}>
                {liveData.filter((e) => e.currentStatus === 'offline' || e.currentStatus === 'not_started').length} موظف
              </div>
            </div>
          </div>

          {/* Interactive Map */}
          {settings && (
            <div className="card" style={{ padding: '16px', marginBottom: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MapPin size={20} color="#2563eb" />
                  <strong style={{ fontSize: '1.05rem', color: '#0f172a' }}>
                    الخريطة الحية ونطاقات الفروع
                  </strong>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.8rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#059669' }} />
                    {settings.branch1_name} ({settings.branch1_radius}م)
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#4f46e5' }} />
                    {settings.branch2_name} ({settings.branch2_radius}م)
                  </span>
                </div>
              </div>

              <AttendanceMap
                branches={settings?.branches}
                branch1={{
                  name: settings.branch1_name,
                  lat: settings.branch1_lat,
                  lng: settings.branch1_lng,
                  radius: settings.branch1_radius,
                }}
                branch2={{
                  name: settings.branch2_name,
                  lat: settings.branch2_lat,
                  lng: settings.branch2_lng,
                  radius: settings.branch2_radius,
                }}
                employees={liveData.map((e) => ({
                  id: e.user.id,
                  name: e.user.name,
                  lat: e.latestLog?.lat ?? NaN,
                  lng: e.latestLog?.lng ?? NaN,
                  branch_id: e.currentStatus,
                  isOnline: e.isOnline,
                  distance1: e.latestLog?.distance_branch1 ?? 0,
                  distance2: e.latestLog?.distance_branch2 ?? 0,
                }))}
                height="380px"
              />
            </div>
          )}

          {/* Live Employees Cards */}
          <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '14px' }}>
            حالة الموظفين اللحظية الآن (تحديث كل 60 ثانية)
          </h3>

          <div className="grid-3" style={{ gap: '16px' }}>
            {liveData.map((emp) => (
              <div
                key={emp.user.id}
                className="card"
                style={{
                  padding: '20px',
                  borderRadius: '16px',
                  borderWidth: '1.5px',
                  borderColor:
                    emp.currentStatus === 'branch1'
                      ? 'var(--branch1-border)'
                      : emp.currentStatus === 'branch2'
                      ? 'var(--branch2-border)'
                      : emp.currentStatus === 'outside'
                      ? 'var(--outside-border)'
                      : 'var(--border-color)',
                }}
              >
                {/* Employee Header */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '14px',
                  }}
                >
                  <div>
                    <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#0f172a', marginBottom: '2px' }}>
                      {emp.user.name}
                    </h4>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                      @{emp.user.username} {emp.user.phone ? `• ${emp.user.phone}` : ''}
                    </span>
                  </div>

                  {emp.currentStatus === 'branch1' ? (
                    <span className="badge badge-branch1">
                      <span className="pulse-dot online" />
                      <span>{settings?.branch1_name || 'المحل الأول'}</span>
                    </span>
                  ) : emp.currentStatus === 'branch2' ? (
                    <span className="badge badge-branch2">
                      <span className="pulse-dot online" />
                      <span>{settings?.branch2_name || 'المحل الثاني'}</span>
                    </span>
                  ) : emp.currentStatus === 'outside' ? (
                    <span className="badge badge-outside">
                      <AlertTriangle size={14} />
                      <span>خارج المحلين</span>
                    </span>
                  ) : settings?.branches?.some(b=>b.id===emp.currentStatus) ? (
                    <span className="badge badge-branch1">{settings.branches.find(b=>b.id===emp.currentStatus)?.name}</span>
                  ) : emp.currentStatus === 'clocked_out' ? (
                    <span className="badge badge-offline">انتهى الشيفت</span>
                  ) : emp.currentStatus === 'unknown' ? (
                    <span className="badge badge-outside">موقع غير مؤكد</span>
                  ) : (
                    <span className="badge badge-offline">
                      <span className="pulse-dot offline" />
                      <span>غير متصل</span>
                    </span>
                  )}
                </div>

                {/* Distances & Last Ping */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    padding: '10px',
                    background: '#f8fafc',
                    borderRadius: '10px',
                    marginBottom: '12px',
                    fontSize: '0.8rem',
                  }}
                >
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>المحل 1:</span>
                    <strong style={{ color: '#059669' }}>
                      {emp.latestLog?.distance_branch1 !== undefined
                        ? `${Math.round(emp.latestLog.distance_branch1)} م`
                        : '--'}
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: '#64748b', display: 'block' }}>المحل 2:</span>
                    <strong style={{ color: '#4f46e5' }}>
                      {emp.latestLog?.distance_branch2 !== undefined
                        ? `${Math.round(emp.latestLog.distance_branch2)} م`
                        : '--'}
                    </strong>
                  </div>
                </div>

                {/* Today's Duration Summary */}
                <div style={{ fontSize: '0.85rem', marginBottom: '10px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#64748b' }}>إجمالي الحضور اليوم:</span>
                    <strong style={{ color: '#0f172a' }}>{emp.summary.totalFormatted}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ color: '#059669' }}>في المحل الأول:</span>
                    <span>{emp.summary.branch1Formatted}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#4f46e5' }}>في المحل الثاني:</span>
                    <span>{emp.summary.branch2Formatted}</span>
                  </div>
                </div>

                {/* Punctuality and Last Ping time */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingTop: '10px',
                    borderTop: '1px solid #f1f5f9',
                    fontSize: '0.75rem',
                    color: '#94a3b8',
                  }}
                >
                  <span className={`badge ${emp.punctuality.badgeClass}`} style={{ fontSize: '0.75rem', padding: '2px 8px' }}>
                    {emp.punctuality.label}
                  </span>

                  <span>
                    {emp.minutesSincePing !== null
                      ? emp.minutesSincePing === 0
                        ? 'الآن (منذ ثوانٍ)'
                        : `منذ ${emp.minutesSincePing} دقيقة`
                      : 'لا يوجد نبضات اليوم'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'reports' && <AttendanceReports users={usersList} refreshKey={reportRefresh} />}

      {/* TAB 3: SETTINGS & GEOFENCING */}
      {activeTab === 'settings' && (
        <div>
          <form onSubmit={handleSaveSettings}>
            {settingsSuccessMsg && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  background: '#ecfdf5',
                  color: '#059669',
                  padding: '14px 18px',
                  borderRadius: '12px',
                  border: '1px solid #a7f3d0',
                  marginBottom: '20px',
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={20} />
                <span>{settingsSuccessMsg}</span>
              </div>
            )}

            <div className="grid-2" style={{ marginBottom: '24px' }}>
              {/* Branch 1 Settings */}
              <div
                className="card"
                style={{
                  padding: '24px',
                  borderTop: '4px solid #059669',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 className="card-title" style={{ color: '#059669', margin: 0 }}>
                    <MapPin size={20} />
                    <span>المحل الأول (الفرع الرئيسي)</span>
                  </h3>

                  <button
                    type="button"
                    onClick={() => captureCurrentLocationForBranch('branch1')}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', color: '#059669', borderColor: '#a7f3d0' }}
                  >
                    <LocateFixed size={14} />
                    <span>استخدام موقعي الحالي</span>
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">اسم الفرع الأول</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settingsForm.branch1_name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, branch1_name: e.target.value })}
                    required
                  />
                </div>

                <div className="grid-2" style={{ gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">خط العرض (Latitude)</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={settingsForm.branch1_lat}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch1_lat: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">خط الطول (Longitude)</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={settingsForm.branch1_lng}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch1_lng: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">نطاق المحل بالمتر (Radius)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="range"
                      min="10"
                      max="150"
                      value={settingsForm.branch1_radius}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch1_radius: parseInt(e.target.value, 10) })
                      }
                      style={{ flex: 1 }}
                    />
                    <strong style={{ width: '60px', color: '#059669' }}>
                      {settingsForm.branch1_radius} متر
                    </strong>
                  </div>
                </div>
              </div>

              {/* Branch 2 Settings */}
              <div
                className="card"
                style={{
                  padding: '24px',
                  borderTop: '4px solid #4f46e5',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <h3 className="card-title" style={{ color: '#4f46e5', margin: 0 }}>
                    <MapPin size={20} />
                    <span>المحل الثاني (الفرع الإضافي)</span>
                  </h3>

                  <button
                    type="button"
                    onClick={() => captureCurrentLocationForBranch('branch2')}
                    className="btn btn-secondary btn-sm"
                    style={{ fontSize: '0.8rem', color: '#4f46e5', borderColor: '#c7d2fe' }}
                  >
                    <LocateFixed size={14} />
                    <span>استخدام موقعي الحالي</span>
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">اسم الفرع الثاني</label>
                  <input
                    type="text"
                    className="form-input"
                    value={settingsForm.branch2_name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, branch2_name: e.target.value })}
                    required
                  />
                </div>

                <div className="grid-2" style={{ gap: '12px' }}>
                  <div className="form-group">
                    <label className="form-label">خط العرض (Latitude)</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={settingsForm.branch2_lat}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch2_lat: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">خط الطول (Longitude)</label>
                    <input
                      type="number"
                      step="any"
                      className="form-input"
                      value={settingsForm.branch2_lng}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch2_lng: parseFloat(e.target.value) })
                      }
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">نطاق المحل بالمتر (Radius)</label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input
                      type="range"
                      min="10"
                      max="150"
                      value={settingsForm.branch2_radius}
                      onChange={(e) =>
                        setSettingsForm({ ...settingsForm, branch2_radius: parseInt(e.target.value, 10) })
                      }
                      style={{ flex: 1 }}
                    />
                    <strong style={{ width: '60px', color: '#4f46e5' }}>
                      {settingsForm.branch2_radius} متر
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            {/* Shift Rules & Timing */}
            <div className="card" style={{ padding: '24px', marginBottom: '24px' }}>
              <h3 className="card-title" style={{ marginBottom: '16px' }}>
                <Clock size={20} color="#2563eb" />
                <span>القواعد الافتراضية للحسابات الجديدة ومعدل التحديث</span>
              </h3>

              <div className="grid-3">
                <div className="form-group">
                  <label className="form-label">ميعاد بداية الشيفت (مثال: 10:00 صباحاً)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={settingsForm.shift_start_time}
                    onChange={(e) => setSettingsForm({ ...settingsForm, shift_start_time: e.target.value })}
                    required
                  />
                  <small style={{ color: '#64748b' }}>أي حضور قبل هذا الوقت يُسجل كـ &quot;حضور مبكر&quot;</small>
                </div>

                <div className="form-group">
                  <label className="form-label">فترة السماح للحضور الطبيعي (بالدقائق)</label>
                  <input
                    type="number"
                    min="0"
                    max="120"
                    className="form-input"
                    value={settingsForm.grace_period_mins}
                    onChange={(e) =>
                      setSettingsForm({ ...settingsForm, grace_period_mins: parseInt(e.target.value, 10) })
                    }
                    required
                  />
                  <small style={{ color: '#64748b' }}>
                    الحضور بين {settingsForm.shift_start_time} وحتى{' '}
                    {settingsForm.grace_period_mins} دقيقة بعدها يُعتبر &quot;في الميعاد&quot;، وما بعده &quot;حضور متأخر&quot;
                  </small>
                </div>

                <div className="form-group">
                  <label className="form-label">ميعاد نهاية الشيفت (مثال: 22:00 مساءً)</label>
                  <input
                    type="time"
                    className="form-input"
                    value={settingsForm.shift_end_time}
                    onChange={(e) => setSettingsForm({ ...settingsForm, shift_end_time: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '12px', maxWidth: '340px' }}>
                <label className="form-label">معدل الفحص وتحديث الموقع (بالثواني)</label>
                <input
                  type="number"
                  min="15"
                  max="300"
                  className="form-input"
                  value={settingsForm.ping_interval_secs}
                  onChange={(e) =>
                    setSettingsForm({ ...settingsForm, ping_interval_secs: parseInt(e.target.value, 10) })
                  }
                  required
                />
                <small style={{ color: '#64748b' }}>الافتراضي والموصى به هو 60 ثانية</small>
              </div>
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="btn btn-primary btn-lg"
              style={{ width: '100%', maxWidth: '300px' }}
            >
              {savingSettings ? 'جاري الحفظ...' : 'حفظ الإعدادات الجغرافية'}
            </button>
          </form>
        </div>
      )}

      {/* TAB 4: EMPLOYEES MANAGEMENT */}
      {activeTab === 'users' && (
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '18px',
            }}
          >
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a' }}>
                حسابات الموظفين ومسؤولي الفروع
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
                يمكنك إنشاء حساب لكل موظف وتزويده ببيانات الدخول ليفتح من هاتفه
              </p>
            </div>

            <button
              onClick={() => {setNewUserData({...newUserData,shift_start:settings?.shift_start_time||'10:00',shift_end:settings?.shift_end_time||'22:00'});setShowAddUserModal(true);}}
              className="btn btn-primary btn-sm"
              style={{ padding: '10px 16px' }}
            >
              <Plus size={16} />
              <span>إضافة موظف جديد</span>
            </button>
          </div>

          <div className="data-table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>اسم الموظف</th>
                  <th>اسم المستخدم</th>
                  <th>كلمة المرور</th>
                  <th>رقم الهاتف</th>
                  <th>الشيفت</th>
                  <th>الحالة</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {usersList.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '8px',
                            background: u.role === 'admin' ? '#eff6ff' : '#ecfdf5',
                            color: u.role === 'admin' ? '#2563eb' : '#059669',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                          }}
                        >
                          {u.name.charAt(0)}
                        </div>
                        <div>
                          <strong>{u.name}</strong>
                          {u.role === 'admin' && (
                            <span
                              style={{
                                marginRight: '6px',
                                fontSize: '0.75rem',
                                color: '#2563eb',
                                fontWeight: 700,
                              }}
                            >
                              (المدير)
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        {u.username}
                      </code>
                    </td>
                    <td>
                      <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                        كلمة مرور محمية
                      </code>
                    </td>
                    <td>{u.phone || '--'}</td>
                    <td>
                      {u.shift_start || '10:00'} - {u.shift_end || '22:00'}
                    </td>
                    <td>
                      <span className={`badge ${u.is_active ? 'badge-branch1' : 'badge-offline'}`}>
                        {u.is_active ? 'نشط' : 'معطل'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="btn btn-secondary btn-sm" title={`تعديل بروفايل ${u.name}`} onClick={()=>setEditingUser(u)}><Pencil size={14}/>تعديل</button>
                        {u.role !== 'admin' && (
                          <>
                            <button
                              onClick={() => copyCredentials(u.username, u.id)}
                              className="btn btn-secondary btn-sm"
                              title="نسخ بيانات الدخول لإرسالها بالواتساب"
                              style={{ padding: '4px 8px' }}
                            >
                              {copiedId === u.id ? <Check size={14} color="#059669" /> : <Copy size={14} />}
                              <span>{copiedId === u.id ? 'تم النسخ' : 'نسخ الدخول'}</span>
                            </button>

                            <button
                              onClick={() => handleDeleteUser(u.id, u.name)}
                              className="btn btn-danger btn-sm"
                              style={{ padding: '4px 8px' }}
                              title="تعطيل الموظف مع الاحتفاظ بالسجلات"
                            >
                              <Trash2 size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editingUser && <EmployeeEditor key={editingUser.id} user={editingUser} policies={policies} onClose={()=>setEditingUser(null)} onSaved={()=>{void fetchUsers();void fetchLiveData();setReportRefresh(n=>n+1);}} />}
      {/* Add User Modal */}
      {showAddUserModal && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
              إضافة موظف جديد للنظام
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '20px' }}>
              سيتم إنشاء حساب يمكن للموظف استخدامه على هاتفه المحمول لتسجيل الحضور الجغرافي
            </p>

            <form onSubmit={handleAddUser}>
              <div className="form-group">
                <label className="form-label">الاسم الكامل للموظف</label>
                <input
                  type="text"
                  className="form-input"
                  value={newUserData.name}
                  onChange={(e) => setNewUserData({ ...newUserData, name: e.target.value })}
                  placeholder="مثال: حسام الدين خالد"
                  required
                />
              </div>

              <div className="grid-2">
                <div className="form-group">
                  <label className="form-label">اسم المستخدم (للدخول)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newUserData.username}
                    onChange={(e) => setNewUserData({ ...newUserData, username: e.target.value })}
                    placeholder="مثال: hossam"
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">كلمة المرور</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newUserData.password}
                    onChange={(e) => setNewUserData({ ...newUserData, password: e.target.value })}
                    placeholder="مثال: 123456"
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">رقم الهاتف (اختياري)</label>
                <input
                  type="text"
                  className="form-input"
                  value={newUserData.phone}
                  onChange={(e) => setNewUserData({ ...newUserData, phone: e.target.value })}
                  placeholder="مثال: 01012345678"
                />
              </div>

              <div className="grid-2" style={{ marginBottom: '24px' }}>
                <div className="form-group">
                  <label className="form-label">بداية الشيفت</label>
                  <input
                    type="time"
                    className="form-input"
                    value={newUserData.shift_start}
                    onChange={(e) => setNewUserData({ ...newUserData, shift_start: e.target.value })}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">نهاية الشيفت</label>
                  <input
                    type="time"
                    className="form-input"
                    value={newUserData.shift_end}
                    onChange={(e) => setNewUserData({ ...newUserData, shift_end: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => setShowAddUserModal(false)}
                  className="btn btn-secondary"
                >
                  إلغاء
                </button>
                <button type="submit" className="btn btn-primary">
                  إنشاء الحساب
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
