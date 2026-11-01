'use client';

import React, { useState, useEffect } from 'react';
import { Bell, Send, Smartphone, RefreshCw, CheckCircle2, AlertCircle, MessageCircle, FileText } from 'lucide-react';

interface DeviceItem {
  id: number;
  user_id: number;
  platform: string;
  updated_at: string;
  token_preview: string;
}

export default function AdminPushTester() {
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendingWp, setSendingWp] = useState(false);
  const [title, setTitle] = useState('إشعار تجريبي من إدارة جو ستور 🚀');
  const [body, setBody] = useState('تجربة وصول الإشعار عبر Firebase — يصلك والموبايل مقفول تماماً!');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [wpResult, setWpResult] = useState<{ success: boolean; message: string } | null>(null);

  const fetchDevices = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/test-push');
      if (res.ok) {
        const data = await res.json();
        setDevices(data.devices || []);
      }
    } catch (err) {
      console.error('Failed to fetch devices', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setResult(null);
    try {
      const res = await fetch('/api/admin/test-push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({
          success: data.sent > 0,
          message: data.message || `تم إرسال الإشعار بنجاح إلى ${data.sent} جهاز`,
        });
        fetchDevices();
      } else {
        setResult({
          success: false,
          message: data.error || 'تعذر إرسال الإشعار التجريبي',
        });
      }
    } catch (err: unknown) {
      setResult({
        success: false,
        message: err instanceof Error ? err.message : 'حدث خطأ في الاتصال بالسيرفر',
      });
    } finally {
      setSending(false);
    }
  };

  const handleSendWhatsAppReport = async () => {
    setSendingWp(true);
    setWpResult(null);
    try {
      const res = await fetch('/api/admin/test-whatsapp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullReport: true }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setWpResult({
          success: true,
          message: data.message || 'تم إرسال تقرير اليوم بنجاح إلى الواتساب مع رابط الـ PDF',
        });
      } else {
        setWpResult({
          success: false,
          message: data.error || data.message || 'تعذر إرسال التقرير إلى الواتساب',
        });
      }
    } catch (err: unknown) {
      setWpResult({
        success: false,
        message: err instanceof Error ? err.message : 'حدث خطأ في الاتصال بخدمة الواتساب',
      });
    } finally {
      setSendingWp(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        padding: '24px',
        borderTop: '4px solid #3b82f6',
        marginTop: '24px',
        background: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 className="card-title" style={{ color: '#2563eb', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Bell size={22} />
          <span>إرسال إشعار تجريبي لهواتف المديرين (FCM Push)</span>
        </h3>

        <button
          type="button"
          onClick={fetchDevices}
          disabled={loading}
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          <span>تحديث الأجهزة</span>
        </button>
      </div>

      <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '16px', lineHeight: 1.6 }}>
        يمكنك من هنا إرسال إشعار اختبار فوري لجميع هواتف المديرين المسجلة.
        الإشعار يرسل عبر سيرفرات <strong>Google Firebase</strong> ويصل إلى الموبايل حتى لو كان تطبيق الإدارة مقفولاً وممسوحاً من شاشة التطبيقات المفتوحة (Swipe Kill).
      </p>

      {/* Devices Status Badge */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          background: devices.length > 0 ? '#eff6ff' : '#fef3c7',
          border: `1px solid ${devices.length > 0 ? '#bfdbfe' : '#fde68a'}`,
          borderRadius: '10px',
          marginBottom: '20px',
        }}
      >
        <Smartphone size={20} color={devices.length > 0 ? '#2563eb' : '#d97706'} />
        <div style={{ fontSize: '0.9rem' }}>
          <strong>الأجهزة المسجلة حالياً: </strong>
          {devices.length > 0 ? (
            <span style={{ color: '#1d4ed8' }}>{devices.length} هاتف مسجل يستقبل الإشعارات المباشرة</span>
          ) : (
            <span style={{ color: '#b45309' }}>لا توجد أجهزة مسجلة؛ افتح تطبيق الإدارة على الموبايل وسجل الدخول ليتم تسجيل الجهاز تلقائياً.</span>
          )}
        </div>
      </div>

      {result && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 18px',
            borderRadius: '12px',
            marginBottom: '20px',
            fontWeight: 600,
            fontSize: '0.95rem',
            background: result.success ? '#ecfdf5' : '#fef2f2',
            color: result.success ? '#059669' : '#dc2626',
            border: `1px solid ${result.success ? '#a7f3d0' : '#fecaca'}`,
          }}
        >
          {result.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
          <span>{result.message}</span>
        </div>
      )}

      <form onSubmit={handleSendTest}>
        <div style={{ marginBottom: '14px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#374151' }}>
            عنوان الإشعار
          </label>
          <input
            type="text"
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db' }}
          />
        </div>

        <div style={{ marginBottom: '18px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '6px', color: '#374151' }}>
            نص الرسالة
          </label>
          <textarea
            className="input"
            rows={2}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #d1d5db' }}
          />
        </div>

        <button
          type="submit"
          disabled={sending || devices.length === 0}
          className="btn btn-primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            fontSize: '1rem',
            fontWeight: 700,
            backgroundColor: devices.length === 0 ? '#9ca3af' : '#2563eb',
            borderColor: devices.length === 0 ? '#9ca3af' : '#2563eb',
            cursor: devices.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          <Send size={18} />
          <span>{sending ? 'جاري الإرسال عبر Firebase...' : 'إرسال إشعار تجريبي الآن لجميع هواتف المديرين'}</span>
        </button>
      </form>

      {/* WhatsApp Daily Report Section */}
      <div
        style={{
          marginTop: '32px',
          paddingTop: '24px',
          borderTop: '1px solid #e5e7eb',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <MessageCircle size={22} color="#16a34a" />
          <h4 style={{ margin: 0, color: '#15803d', fontSize: '1.1rem', fontWeight: 700 }}>
            إرسال تقرير الحضور اليومي عبر الواتساب (WhatsApp CRM)
          </h4>
        </div>

        <p className="muted" style={{ fontSize: '0.9rem', marginBottom: '16px', lineHeight: 1.6 }}>
          يتم إرسال هذا التقرير تلقائياً كل يوم الساعة <strong>1:00 صباحاً (بتوقيت القاهرة)</strong> مع ملخص كامل لحضور وانصراف الموظفين ورابط مباشر لتحميل ملف الـ PDF إلى هاتف المدير رقم (<strong>01099930530</strong>).
        </p>

        {wpResult && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              padding: '14px 18px',
              borderRadius: '12px',
              marginBottom: '16px',
              fontWeight: 600,
              fontSize: '0.95rem',
              background: wpResult.success ? '#ecfdf5' : '#fef2f2',
              color: wpResult.success ? '#059669' : '#dc2626',
              border: `1px solid ${wpResult.success ? '#a7f3d0' : '#fecaca'}`,
            }}
          >
            {wpResult.success ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
            <span>{wpResult.message}</span>
          </div>
        )}

        <button
          type="button"
          onClick={handleSendWhatsAppReport}
          disabled={sendingWp}
          className="btn"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '12px 24px',
            fontSize: '1rem',
            fontWeight: 700,
            backgroundColor: '#16a34a',
            borderColor: '#16a34a',
            color: '#ffffff',
            borderRadius: '8px',
            cursor: sendingWp ? 'wait' : 'pointer',
          }}
        >
          <FileText size={18} />
          <span>{sendingWp ? 'جاري إرسال التقرير على الواتساب...' : 'تجربة إرسال تقرير اليوم الآن على واتساب المدير (01099930530)'}</span>
        </button>
      </div>
    </div>
  );
}
