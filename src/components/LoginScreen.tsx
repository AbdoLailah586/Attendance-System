'use client';

import React, { useState } from 'react';
import { Shield, User, KeyRound, Lock, AlertCircle, CheckCircle, Store, Smartphone } from 'lucide-react';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [roleTab, setRoleTab] = useState<'admin' | 'employee'>('employee');
  const [username, setUsername] = useState('emp1');
  const [password, setPassword] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleTabChange = (tab: 'admin' | 'employee') => {
    setRoleTab(tab);
    setError(null);
    if (tab === 'admin') {
      setUsername('admin');
      setPassword('admin123');
    } else {
      setUsername('emp1');
      setPassword('123456');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'فشل تسجيل الدخول');
      }

      onLoginSuccess(data.user);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemo = (u: string, p: string, tab: 'admin' | 'employee') => {
    setRoleTab(tab);
    setUsername(u);
    setPassword(p);
  };

  return (
    <div
      style={{
        minHeight: 'calc(100vh - 70px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
        background: 'linear-gradient(180deg, #f8fafc 0%, #edf2f7 100%)',
      }}
    >
      <div
        className="card"
        style={{
          maxWidth: '460px',
          width: '100%',
          padding: '32px 28px',
          borderRadius: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.02)',
        }}
      >
        {/* Header Icon & Title */}
        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '20px',
              background: 'linear-gradient(135deg, #2563eb, #60a5fa)',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 8px 16px rgba(37, 99, 235, 0.25)',
              marginBottom: '16px',
            }}
          >
            <Store size={32} />
          </div>
          <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#0f172a', marginBottom: '6px' }}>
            نظام الحضور الجغرافي الذكي
          </h2>
          <p style={{ fontSize: '0.9rem', color: '#64748b' }}>
            تتبع الحضور والانصراف بين الفرعين بدقة كل 60 ثانية
          </p>
        </div>

        {/* Role Toggle Tabs */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px',
            background: '#f1f5f9',
            padding: '5px',
            borderRadius: '14px',
            marginBottom: '24px',
          }}
        >
          <button
            type="button"
            onClick={() => handleTabChange('employee')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: '0.92rem',
              transition: 'all 0.2s',
              background: roleTab === 'employee' ? '#ffffff' : 'transparent',
              color: roleTab === 'employee' ? '#059669' : '#64748b',
              boxShadow: roleTab === 'employee' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <User size={18} />
            <span>دخول موظف</span>
          </button>

          <button
            type="button"
            onClick={() => handleTabChange('admin')}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px',
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontWeight: 700,
              fontSize: '0.92rem',
              transition: 'all 0.2s',
              background: roleTab === 'admin' ? '#ffffff' : 'transparent',
              color: roleTab === 'admin' ? '#2563eb' : '#64748b',
              boxShadow: roleTab === 'admin' ? '0 2px 4px rgba(0,0,0,0.06)' : 'none',
            }}
          >
            <Shield size={18} />
            <span>دخول المدير</span>
          </button>
        </div>

        {error && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              background: '#fef2f2',
              color: '#dc2626',
              padding: '12px 14px',
              borderRadius: '10px',
              fontSize: '0.875rem',
              marginBottom: '18px',
              border: '1px solid #fecaca',
            }}
          >
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">اسم المستخدم</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="أدخل اسم المستخدم..."
                required
                style={{ paddingRight: '40px' }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              >
                <User size={18} />
              </div>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label className="form-label">كلمة المرور</label>
            <div style={{ position: 'relative' }}>
              <input
                type="password"
                className="form-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="أدخل كلمة المرور..."
                required
                style={{ paddingRight: '40px' }}
              />
              <div
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                }}
              >
                <Lock size={18} />
              </div>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            style={{
              width: '100%',
              background: roleTab === 'admin' ? '#2563eb' : '#059669',
              borderColor: roleTab === 'admin' ? '#2563eb' : '#059669',
            }}
          >
            {loading ? 'جاري التحقق...' : roleTab === 'admin' ? 'دخول لوحة تحكم المدير' : 'تسجيل الدخول وبدء التتبع'}
          </button>
        </form>

        {/* Quick Demo Switcher */}
        <div
          style={{
            marginTop: '28px',
            paddingTop: '20px',
            borderTop: '1px solid #e2e8f0',
          }}
        >
          <p
            style={{
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#64748b',
              marginBottom: '10px',
              textAlign: 'center',
            }}
          >
            ⚡ تجربة سريعة بنقرة واحدة (حسابات جاهزة):
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button
              type="button"
              onClick={() => handleQuickDemo('admin', 'admin123', 'admin')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #bfdbfe',
                background: '#eff6ff',
                color: '#1e40af',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Shield size={15} />
                <span>حساب المدير (admin / admin123)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#2563eb' }}>تعيين ↵</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemo('emp1', '123456', 'employee')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #a7f3d0',
                background: '#ecfdf5',
                color: '#065f46',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={15} />
                <span>موظف 1: أحمد محمود (emp1 / 123456)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#059669' }}>تعيين ↵</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemo('emp2', '123456', 'employee')}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
                fontSize: '0.85rem',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: 600,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <User size={15} />
                <span>موظف 2: محمد علي (emp2 / 123456)</span>
              </div>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>تعيين ↵</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
