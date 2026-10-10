'use client';

import React from 'react';
import { User, LogOut, Shield, Store } from 'lucide-react';

interface NavbarProps {
  user: {
    id: number;
    username: string;
    name: string;
    role: 'admin' | 'employee';
  } | null;
  onLogout: () => void;
  branch1Name?: string;
  branch2Name?: string;
}

export default function Navbar({ user, onLogout }: NavbarProps) {
  return (
    <header
      style={{
        background: '#ffffff',
        borderBottom: '1px solid #e2e8f0',
        padding: '12px 20px',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)',
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        {/* App Title & Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #2563eb, #3b82f6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 10px rgba(37, 99, 235, 0.25)',
            }}
          >
            <Store size={22} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
              نظام الحضور والانصراف
            </h1>
            <p style={{ fontSize: '0.8rem', color: '#64748b' }}>
              حضور بالكارت ومتابعة أثناء الشيفت
            </p>
          </div>
        </div>

        {/* User profile & actions */}
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 14px',
                background: '#f8fafc',
                borderRadius: '9999px',
                border: '1px solid #e2e8f0',
              }}
            >
              {user.role === 'admin' ? (
                <Shield size={16} color="#2563eb" />
              ) : (
                <User size={16} color="#059669" />
              )}
              <span style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' }}>
                {user.name}
              </span>
              <span
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 8px',
                  borderRadius: '9999px',
                  background: user.role === 'admin' ? '#eff6ff' : '#ecfdf5',
                  color: user.role === 'admin' ? '#2563eb' : '#059669',
                  fontWeight: 700,
                }}
              >
                {user.role === 'admin' ? 'مدير النظام' : 'موظف'}
              </span>
            </div>

            <button
              onClick={onLogout}
              className="btn btn-secondary btn-sm"
              title="تسجيل الخروج"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={16} />
              <span>خروج</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
