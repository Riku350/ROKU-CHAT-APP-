import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');
const SESSION_SECRET = process.env.RIKZEN_SESSION_SECRET || EPHEMERAL_SECRET;
export const COOKIE_NAME = 'rikzen_session';

export interface SessionPayload {
  uid: string;
  deviceId: string;
  iat: number;
  exp: number;
}

export interface AuthedRequest extends Request {
  userId?: string;
  deviceId?: string;
  isAdmin?: boolean;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function signSessionToken(uid: string, deviceId: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    uid,
    deviceId,
    iat: now,
    exp: now + 60 * 60 * 24 * 30, // 30 days persistent session
  };
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionToken(token: string | undefined): SessionPayload | null {
  if (!token || !token.includes('.')) return null;
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.uid || !payload.deviceId || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    const device = db
      .prepare('SELECT id FROM user_devices WHERE id = ? AND user_id = ?')
      .get(payload.deviceId, payload.uid);
    if (!device) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isBackendAdmin(userId: string): boolean {
  const roleRow = db.prepare('SELECT role FROM admin_roles WHERE user_id = ?').get(userId) as
    | { role: string }
    | undefined;
  if (roleRow) return true;

  const allowedEmails = (process.env.RIKZEN_ADMIN_EMAILS || 'phonedata9955@gmail.com')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const profile = db.prepare('SELECT email FROM profiles WHERE id = ?').get(userId) as
    | { email: string }
    | undefined;
  if (profile && allowedEmails.includes(profile.email.toLowerCase())) {
    db.prepare(
      'INSERT OR IGNORE INTO admin_roles (user_id, role, granted_at) VALUES (?, ?, ?)'
    ).run(userId, 'owner', new Date().toISOString());
    return true;
  }
  return false;
}

export function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return undefined;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  const payload = verifySessionToken(token);
  if (!payload) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const user = db
    .prepare('SELECT id, is_suspended FROM profiles WHERE id = ?')
    .get(payload.uid) as { id: string; is_suspended: number } | undefined;
  if (!user) {
    res.status(401).json({ error: 'Account no longer exists' });
    return;
  }
  if (user.is_suspended) {
    res.status(403).json({ error: 'This account has been suspended by an administrator.' });
    return;
  }

  db.prepare('UPDATE user_devices SET last_active_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    payload.deviceId
  );

  req.userId = payload.uid;
  req.deviceId = payload.deviceId;
  req.isAdmin = isBackendAdmin(payload.uid);
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.userId || !isBackendAdmin(req.userId)) {
    res.status(403).json({ error: 'Administrator access denied' });
    return;
  }
  next();
}
