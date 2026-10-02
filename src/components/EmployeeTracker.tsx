'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  MapPin,
  Clock,
  Compass,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Volume2,
  VolumeX,
  Play,
  Square,
  ShieldAlert,
  Sparkles,
  Info,
  Calendar,
} from 'lucide-react';
import { formatDurationArabic } from '@/lib/geo';

interface EmployeeTrackerProps {
  user: {
    id: number;
    username: string;
    name: string;
    shift_start?: string;
    shift_end?: string;
  };
}

export default function EmployeeTracker({ user }: EmployeeTrackerProps) {
  const [currentLocation, setCurrentLocation] = useState<{
    lat: number;
    lng: number;
    accuracy: number;
  } | null>(null);

  const [geoStatus, setGeoStatus] = useState<'idle' | 'tracking' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeBranch, setActiveBranch] = useState<'branch1' | 'branch2' | 'outside' | null>(null);
  const [distances, setDistances] = useState<{ d1: number; d2: number } | null>(null);
  const [lastPingTime, setLastPingTime] = useState<Date | null>(null);
  const [secondsUntilPing, setSecondsUntilPing] = useState(60);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isClockedIn, setIsClockedIn] = useState(true);
  const [todaySummary, setTodaySummary] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  // Audio tone generator using Web Audio API
  const playChime = (type: 'enter' | 'leave' | 'ping') => {
    if (!soundEnabled || typeof window === 'undefined') return;
    try {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'enter') {
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1); // A5
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'leave') {
        osc.frequency.setValueAtTime(659.25, ctx.currentTime); // E5
        osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1); // A4
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.start();
        osc.stop(ctx.currentTime + 0.35);
      } else {
        // ping
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.05, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch {
      // ignore audio errors
    }
  };

  // Fetch settings & today's summary
  const fetchSummary = async () => {
    try {
      setLoadingSummary(true);
      const res = await fetch(`/api/attendance/report?userId=${user.id}`);
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        if (data.reports && data.reports.length > 0) {
          setTodaySummary(data.reports[0]);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSummary(false);
    }
  };

  useEffect(() => {
    fetchSummary();
  }, [user.id]);

  // Send ping to backend
  const sendPing = async (lat: number, lng: number, accuracy: number, eventType: string = 'ping') => {
    try {
      const res = await fetch('/api/attendance/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat,
          lng,
          accuracy,
          event_type: eventType,
        }),
      });

      if (!res.ok) {
        throw new Error('فشل إرسال نبضة الحضور');
      }

      const data = await res.json();
      const prevBranch = activeBranch;
      const newBranch = data.location.branch_id;

      setActiveBranch(newBranch);
      setDistances({
        d1: data.location.distance1,
        d2: data.location.distance2,
      });
      setLastPingTime(new Date());
      setSecondsUntilPing(data.settings?.ping_interval_secs || 60);

      if (prevBranch && prevBranch !== newBranch) {
        if (newBranch === 'branch1' || newBranch === 'branch2') {
          playChime('enter');
        } else {
          playChime('leave');
        }
      } else {
        playChime('ping');
      }

      fetchSummary();
    } catch (err: any) {
      console.error('Ping error:', err);
    }
  };

  // Acquire current location
  const performLocationCheck = (eventType: string = 'ping') => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setGeoStatus('error');
      setErrorMessage('خدمة تحديد المواقع (GPS) غير مدعومة في هذا المتصفح');
      return;
    }

    setGeoStatus('tracking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        setCurrentLocation({ lat: latitude, lng: longitude, accuracy });
        setErrorMessage(null);
        sendPing(latitude, longitude, accuracy, eventType);
      },
      (err) => {
        console.warn('Geolocation error:', err);
        setGeoStatus('error');
        if (err.code === 1) {
          setErrorMessage('يرجى السماح بالوصول للموقع الجغرافي (GPS) لتسجيل الحضور');
        } else {
          setErrorMessage('تعذر التقاط الموقع بدقة، يرجى التأكد من تشغيل الـ GPS');
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 10000,
      }
    );
  };

  // 60-second ping interval & countdown timer
  useEffect(() => {
    if (!isClockedIn) return;

    // Initial check
    performLocationCheck('clock_in');

    const countdown = setInterval(() => {
      setSecondsUntilPing((prev) => {
        if (prev <= 1) {
          performLocationCheck('ping');
          return 60;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(countdown);
  }, [isClockedIn]);

  // Test simulation helper
  const simulateLocation = (type: 'branch1' | 'branch2' | 'outside') => {
    if (!settings) return;
    let lat = settings.branch1_lat;
    let lng = settings.branch1_lng;

    if (type === 'branch2') {
      lat = settings.branch2_lat;
      lng = settings.branch2_lng;
    } else if (type === 'outside') {
      lat = settings.branch1_lat + 0.003;
      lng = settings.branch1_lng + 0.003;
    }

    setCurrentLocation({ lat, lng, accuracy: 3.5 });
    sendPing(lat, lng, 3.5, 'ping');
  };

  return (
    <div className="app-container" style={{ maxWidth: '640px' }}>
      {/* Employee Greeting & Shift Target */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#0f172a' }}>
            مرحباً، {user.name} 👋
          </h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b' }}>
            الشيفت: {user.shift_start || '10:00'} ص - {user.shift_end || '10:00'} م
          </p>
        </div>

        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="btn btn-secondary btn-sm"
          style={{ padding: '8px 12px', borderRadius: '10px' }}
          title={soundEnabled ? 'كتم الإشعارات الصوتية' : 'تفعيل الإشعارات الصوتية'}
        >
          {soundEnabled ? <Volume2 size={18} color="#059669" /> : <VolumeX size={18} color="#94a3b8" />}
          <span style={{ fontSize: '0.8rem' }}>{soundEnabled ? 'الصوت مفعّل' : 'صامت'}</span>
        </button>
      </div>

      {/* Main Status Hero Card */}
      <div
        className="card"
        style={{
          borderWidth: '2px',
          borderColor:
            activeBranch === 'branch1'
              ? 'var(--branch1-border)'
              : activeBranch === 'branch2'
              ? 'var(--branch2-border)'
              : activeBranch === 'outside'
              ? 'var(--outside-border)'
              : '#e2e8f0',
          background:
            activeBranch === 'branch1'
              ? 'linear-gradient(180deg, #ffffff 0%, #f0fdf4 100%)'
              : activeBranch === 'branch2'
              ? 'linear-gradient(180deg, #ffffff 0%, #f5f3ff 100%)'
              : activeBranch === 'outside'
              ? 'linear-gradient(180deg, #ffffff 0%, #fffbeb 100%)'
              : '#ffffff',
          borderRadius: '24px',
          padding: '24px',
          marginBottom: '20px',
          textAlign: 'center',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
        }}
      >
        {/* Branch Status Badge */}
        <div style={{ marginBottom: '16px' }}>
          {activeBranch === 'branch1' ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '9999px',
                background: '#ecfdf5',
                color: '#059669',
                border: '1px solid #a7f3d0',
                fontWeight: 800,
                fontSize: '1.05rem',
              }}
            >
              <span className="pulse-dot online" />
              <span>أنت الآن داخل: {settings?.branch1_name || 'المحل الأول'}</span>
            </div>
          ) : activeBranch === 'branch2' ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '9999px',
                background: '#eef2ff',
                color: '#4f46e5',
                border: '1px solid #c7d2fe',
                fontWeight: 800,
                fontSize: '1.05rem',
              }}
            >
              <span className="pulse-dot online" />
              <span>أنت الآن داخل: {settings?.branch2_name || 'المحل الثاني'}</span>
            </div>
          ) : activeBranch === 'outside' ? (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '9999px',
                background: '#fffbeb',
                color: '#d97706',
                border: '1px solid #fde68a',
                fontWeight: 800,
                fontSize: '1.05rem',
              }}
            >
              <AlertTriangle size={18} />
              <span>أنت حالياً خارج نطاق المحلين</span>
            </div>
          ) : (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                borderRadius: '9999px',
                background: '#f1f5f9',
                color: '#64748b',
                border: '1px solid #cbd5e1',
                fontWeight: 700,
                fontSize: '1rem',
              }}
            >
              <Compass size={18} />
              <span>جاري تحديد موقعك الجغرافي...</span>
            </div>
          )}
        </div>

        {/* Distances to both branches */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            margin: '20px 0',
          }}
        >
          <div
            style={{
              padding: '12px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>
              {settings?.branch1_name || 'المحل الأول'}
            </span>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#059669' }}>
              {distances ? `${distances.d1} متر` : '--'}
            </div>
            <span style={{ fontSize: '0.725rem', color: '#94a3b8' }}>
              النطاق المسموح: {settings?.branch1_radius || 40} م
            </span>
          </div>

          <div
            style={{
              padding: '12px',
              borderRadius: '14px',
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            }}
          >
            <span style={{ fontSize: '0.8rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>
              {settings?.branch2_name || 'المحل الثاني'}
            </span>
            <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#4f46e5' }}>
              {distances ? `${distances.d2} متر` : '--'}
            </div>
            <span style={{ fontSize: '0.725rem', color: '#94a3b8' }}>
              النطاق المسموح: {settings?.branch2_radius || 40} م
            </span>
          </div>
        </div>

        {/* 60-Second Countdown Meter */}
        <div
          style={{
            background: '#ffffff',
            borderRadius: '14px',
            padding: '12px 16px',
            border: '1px solid #e2e8f0',
            marginBottom: '16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.825rem',
              color: '#64748b',
              marginBottom: '8px',
            }}
          >
            <span>التحديث التلقائي للموقع (كل 60 ثانية)</span>
            <span style={{ fontWeight: 700, color: '#2563eb' }}>
              متبقي: {secondsUntilPing} ثانية
            </span>
          </div>
          <div
            style={{
              height: '6px',
              background: '#f1f5f9',
              borderRadius: '9999px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${((60 - secondsUntilPing) / 60) * 100}%`,
                background: 'linear-gradient(90deg, #3b82f6, #2563eb)',
                transition: 'width 1s linear',
              }}
            />
          </div>
        </div>

        {/* GPS accuracy & time info */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.8rem',
            color: '#64748b',
          }}
        >
          <span>
            دقة الـ GPS:{' '}
            <strong style={{ color: '#0f172a' }}>
              {currentLocation ? `± ${Math.round(currentLocation.accuracy)} متر` : 'غير متوفر'}
            </strong>
          </span>
          <span>
            آخر تسجيل:{' '}
            <strong style={{ color: '#0f172a' }}>
              {lastPingTime ? lastPingTime.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '--'}
            </strong>
          </span>
        </div>

        {errorMessage && (
          <div
            style={{
              marginTop: '16px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textAlign: 'right',
            }}
          >
            <ShieldAlert size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
          <button
            onClick={() => performLocationCheck('ping')}
            className="btn btn-secondary"
            style={{ flex: 1, padding: '12px' }}
          >
            <RefreshCw size={16} />
            <span>تحديث موقعي الآن</span>
          </button>

          <button
            onClick={() => {
              if (isClockedIn) {
                performLocationCheck('clock_out');
                setIsClockedIn(false);
              } else {
                setIsClockedIn(true);
                performLocationCheck('clock_in');
              }
            }}
            className="btn"
            style={{
              flex: 1,
              padding: '12px',
              background: isClockedIn ? '#dc2626' : '#059669',
              color: '#ffffff',
            }}
          >
            {isClockedIn ? (
              <>
                <Square size={16} />
                <span>تسجيل انصراف</span>
              </>
            ) : (
              <>
                <Play size={16} />
                <span>تسجيل حضور</span>
              </>
            )}
          </button>
        </div>

        {/* Test Simulation Controls */}
        <div
          style={{
            marginTop: '20px',
            paddingTop: '16px',
            borderTop: '1px dashed #cbd5e1',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '0.75rem',
              color: '#64748b',
              marginBottom: '10px',
            }}
          >
            <Sparkles size={14} color="#6366f1" />
            <span>محاكاة تجريبية لتغيير موقعك (للتجربة والفحص السريع):</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={() => simulateLocation('branch1')}
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: '0.75rem', color: '#059669', borderColor: '#a7f3d0' }}
            >
              🟢 داخل المحل الأول
            </button>
            <button
              type="button"
              onClick={() => simulateLocation('branch2')}
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: '0.75rem', color: '#4f46e5', borderColor: '#c7d2fe' }}
            >
              🔵 داخل المحل الثاني
            </button>
            <button
              type="button"
              onClick={() => simulateLocation('outside')}
              className="btn btn-secondary btn-sm"
              style={{ flex: 1, fontSize: '0.75rem', color: '#d97706', borderColor: '#fde68a' }}
            >
              🟠 خارج المحلين
            </button>
          </div>
        </div>
      </div>

      {/* Today's Stats & Summary Card */}
      <div className="card" style={{ borderRadius: '20px', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h3 className="card-title" style={{ fontSize: '1.05rem', margin: 0 }}>
            <Calendar size={18} color="#2563eb" />
            <span>ملخص حضورك وساعات عملك اليوم</span>
          </h3>
          <button
            onClick={fetchSummary}
            className="btn btn-secondary btn-sm"
            style={{ padding: '4px 8px' }}
            title="تحديث الإحصائيات"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {todaySummary ? (
          <div>
            {/* Punctuality Badge */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: '#f8fafc',
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                marginBottom: '16px',
              }}
            >
              <div>
                <span style={{ fontSize: '0.775rem', color: '#64748b', display: 'block' }}>
                  وقت أول وصول للمحل:
                </span>
                <strong style={{ fontSize: '0.95rem', color: '#0f172a' }}>
                  {todaySummary.firstArrival
                    ? new Date(todaySummary.firstArrival).toLocaleTimeString('ar-EG', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'لم يبدأ بعد'}
                </strong>
              </div>

              <span className={`badge ${todaySummary.punctuality.badgeClass}`}>
                {todaySummary.punctuality.label}
              </span>
            </div>

            {/* Hours Breakdown */}
            <div className="grid-3" style={{ gap: '10px', marginBottom: '16px' }}>
              <div
                style={{
                  background: '#f8fafc',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid #e2e8f0',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginBottom: '4px' }}>
                  إجمالي الحضور
                </span>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f172a' }}>
                  {todaySummary.summary.totalFormatted}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--branch1-bg)',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--branch1-border)',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: '#059669', display: 'block', marginBottom: '4px' }}>
                  المحل الأول
                </span>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#059669' }}>
                  {todaySummary.summary.branch1Formatted}
                </div>
              </div>

              <div
                style={{
                  background: 'var(--branch2-bg)',
                  padding: '12px',
                  borderRadius: '12px',
                  border: '1px solid var(--branch2-border)',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: '#4f46e5', display: 'block', marginBottom: '4px' }}>
                  المحل الثاني
                </span>
                <div style={{ fontSize: '1.05rem', fontWeight: 800, color: '#4f46e5' }}>
                  {todaySummary.summary.branch2Formatted}
                </div>
              </div>
            </div>

            {/* Timeline track if available */}
            {todaySummary.timeline && todaySummary.timeline.length > 0 && (
              <div>
                <span style={{ fontSize: '0.775rem', color: '#64748b', display: 'block', marginBottom: '6px' }}>
                  سجل التنقل بين الفرعين اليوم:
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {todaySummary.timeline.map((item: any, idx: number) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.8rem',
                        padding: '6px 10px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        borderRight: `4px solid ${
                          item.branch_id === 'branch1'
                            ? '#059669'
                            : item.branch_id === 'branch2'
                            ? '#4f46e5'
                            : '#f59e0b'
                        }`,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{item.branch_name}</span>
                      <span style={{ color: '#64748b' }}>
                        {new Date(item.start).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} -{' '}
                        {new Date(item.end).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })} ({item.durationFormatted})
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: '0.9rem' }}>
            جاري تحميل إحصائيات حضورك اليوم...
          </div>
        )}
      </div>
    </div>
  );
}
