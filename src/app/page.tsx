'use client';

import React, { useState, useEffect } from 'react';
import Navbar from '@/components/Navbar';
import LoginScreen from '@/components/LoginScreen';
import AdminDashboard from '@/components/AdminDashboard';
import EmployeeTracker from '@/components/EmployeeTracker';
import { pendingEvents } from '@/lib/offline';
import type { AppUser } from '@/lib/types';

export default function Home() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionMessage, setSessionMessage] = useState('');

  // Check existing session
  const checkSession = async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
          if (data.user.role === 'employee') localStorage.setItem('attendance-offline-user', JSON.stringify(data.user));
        } else {
          setCurrentUser(null);
        }
      } else {
        if (res.status >= 500) throw new Error('Server unavailable');
        localStorage.removeItem('attendance-offline-user');
        setCurrentUser(null);
      }
    } catch {
      const cached = localStorage.getItem('attendance-offline-user');
      setCurrentUser(cached ? JSON.parse(cached) : null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    queueMicrotask(() => void checkSession());
  }, []);

  const handleLogout = async () => {
    try {
      if (currentUser?.role === 'employee') {
        if (localStorage.getItem(`attendance-duty-${currentUser.id}`) === 'true') {
          setSessionMessage('سجل انصرافك قبل تسجيل الخروج حتى لا يتوقف التتبع أثناء الشيفت'); return;
        }
        if ((await pendingEvents(currentUser.id)).length) {
          setSessionMessage('وصل الهاتف بالإنترنت وزامن الأحداث قبل تسجيل الخروج'); return;
        }
      }
      await fetch('/api/auth/logout', { method: 'POST' });
      localStorage.removeItem('attendance-offline-user');
      setCurrentUser(null);
    } catch {
      setCurrentUser(null);
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          background: 'var(--bg-page)',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            border: '4px solid #e2e8f0',
            borderTopColor: '#2563eb',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ color: '#64748b', fontSize: '0.95rem', fontWeight: 600 }}>
          جاري تهيئة نظام الحضور الجغرافي...
        </p>
        <style jsx>{`
          @keyframes spin {
            to {
              transform: rotate(360deg);
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar user={currentUser} onLogout={handleLogout} />
      {sessionMessage && <p role="alert" className="tracker-warning" style={{margin:16}}>{sessionMessage}</p>}

      <main style={{ flex: 1, paddingBottom: '40px' }}>
        {!currentUser ? (
          <LoginScreen onLoginSuccess={(u) => { setCurrentUser(u); setSessionMessage(''); if (u.role === 'employee') localStorage.setItem('attendance-offline-user', JSON.stringify(u)); }} />
        ) : currentUser.role === 'admin' ? (
          <AdminDashboard user={currentUser} />
        ) : (
          <EmployeeTracker user={currentUser} />
        )}
      </main>
    </div>
  );
}
