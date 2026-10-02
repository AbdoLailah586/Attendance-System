import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { query } from './db';

function secretKey() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET must be configured');
  return process.env.JWT_SECRET;
}

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
    .createHmac('sha256', secretKey())
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
      .createHmac('sha256', secretKey())
      .update(`${header}.${body}`)
      .digest('base64url');

    const supplied = Buffer.from(signature), expected = Buffer.from(expectedSig);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;

    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(data.exp) || data.exp <= now || !Number.isInteger(data.id) || !['admin', 'employee'].includes(data.role)) return null;

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

export async function getActiveSession(req: NextRequest): Promise<UserSession | null> {
  const session = getSessionFromRequest(req);
  if (!session) return null;
  const result = await query<UserSession>('SELECT id, username, name, role FROM users WHERE id=$1 AND is_active=TRUE', [session.id]);
  return result.rows[0] || null;
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
