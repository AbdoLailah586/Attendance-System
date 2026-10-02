import crypto from 'crypto';
import { NextRequest } from 'next/server';

const SECRET_KEY = process.env.JWT_SECRET || 'attendance-system-secret-key-2026-secure';

export interface UserSession {
  id: number;
  username: string;
  name: string;
  role: 'admin' | 'employee';
}

// Simple and robust HMAC-based token implementation
export function createToken(payload: UserSession): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + 60 * 60 * 24 * 30, // 30 days session
    })
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', SECRET_KEY)
    .update(`${header}.${body}`)
    .digest('base64url');

  return `${header}.${body}.${signature}`;
}

export function verifyToken(token: string): UserSession | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac('sha256', SECRET_KEY)
      .update(`${header}.${body}`)
      .digest('base64url');

    if (signature !== expectedSig) return null;

    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (data.exp && data.exp < now) return null;

    return {
      id: data.id,
      username: data.username,
      name: data.name,
      role: data.role,
    };
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): UserSession | null {
  const authHeader = req.headers.get('authorization');
  let token: string | null = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    token = req.cookies.get('auth_token')?.value || null;
  }

  if (!token) return null;
  return verifyToken(token);
}
