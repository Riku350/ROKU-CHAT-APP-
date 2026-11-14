import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import {
  COOKIE_NAME,
  hashPassword,
  isBackendAdmin,
  requireAuth,
  signSessionToken,
  verifyPassword,
  type AuthedRequest,
} from './server/auth.ts';
import {
  db,
  DEFAULT_APPEARANCE,
  DEFAULT_NOTIFICATIONS,
  DEFAULT_PRIVACY,
  generatePermanentRikzenId,
  getUploadsDir,
} from './server/db.ts';
import { initRealtimeServer } from './server/realtime.ts';
import { appRouter } from './server/routes/appRoutes.ts';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));
app.use(cookieParser());

const uploadsDir = getUploadsDir();
app.use('/uploads', express.static(uploadsDir));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 12);
    cb(null, `${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

function formatOwnProfile(row: any) {
  return {
    id: row.id,
    rikzenId: row.rikzen_id,
    email: row.email,
    fullName: row.full_name,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    phone: row.phone,
    phoneVerified: Boolean(row.phone_verified),
    emailVerified: Boolean(row.email_verified),
    dateOfBirth: row.date_of_birth,
    onboardingCompleted: Boolean(row.onboarding_completed),
    privacySettings: JSON.parse(row.privacy_settings),
    appearanceSettings: JSON.parse(row.appearance_settings),
    notificationSettings: JSON.parse(row.notification_settings),
    storageSettings: JSON.parse(row.storage_settings || '{}'),
    accessibilitySettings: JSON.parse(row.accessibility_settings || '{}'),
    isAdmin: isBackendAdmin(row.id),
  };
}

function detectDevice(userAgent: string): { deviceName: string; platform: string } {
  const ua = userAgent.toLowerCase();
  if (ua.includes('iphone')) return { deviceName: 'iPhone', platform: 'iOS Safari' };
  if (ua.includes('android')) return { deviceName: 'Android Device', platform: 'Android Web' };
  if (ua.includes('macintosh')) return { deviceName: 'Mac Desktop', platform: 'macOS Browser' };
  if (ua.includes('windows')) return { deviceName: 'Windows PC', platform: 'Windows Browser' };
  return { deviceName: 'Web Client', platform: 'Browser' };
}

function getCookieOptions(req: express.Request) {
  const isHttps =
    req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

// ----------------------------------------------------------------------------
// Health & Configuration Status
// ----------------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  const supabaseConfigured = Boolean(
    process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY
  );
  res.json({
    ok: true,
    supabaseConfigured,
    googleAuthConfigured: true,
    supabaseUrl: process.env.VITE_SUPABASE_URL || 'https://valhypvjykgrdtklyiim.supabase.co',
  });
});

// ----------------------------------------------------------------------------
// Authentication Routes
// ----------------------------------------------------------------------------
app.post('/api/auth/google', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken =
      req.body?.accessToken ||
      (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : '');

    if (!accessToken) {
      res.status(400).json({ error: 'Google access token is required.' });
      return;
    }

    const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!googleRes.ok) {
      res.status(401).json({ error: 'Could not verify Google account. Please sign in again.' });
      return;
    }

    const gUser = (await googleRes.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    const cleanEmail = String(gUser.email || '').trim().toLowerCase();
    if (!cleanEmail) {
      res.status(400).json({ error: 'Google account did not provide a verified email address.' });
      return;
    }

    const now = new Date().toISOString();
    let row = db.prepare('SELECT * FROM profiles WHERE email = ?').get(cleanEmail) as any;

    if (!row) {
      const uid = crypto.randomUUID();
      const rikzenId = generatePermanentRikzenId();
      const displayName = String(gUser.name || cleanEmail.split('@')[0]).trim().slice(0, 80);
      const randomPassword = crypto.randomBytes(32).toString('hex');

      db.prepare(
        `INSERT INTO profiles (
          id, rikzen_id, email, password_hash, full_name, avatar_url, email_verified, last_seen_at,
          privacy_settings, appearance_settings, notification_settings,
          onboarding_completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        uid,
        rikzenId,
        cleanEmail,
        hashPassword(randomPassword),
        displayName,
        gUser.picture || null,
        gUser.email_verified ? 1 : 1,
        now,
        JSON.stringify(DEFAULT_PRIVACY),
        JSON.stringify(DEFAULT_APPEARANCE),
        JSON.stringify(DEFAULT_NOTIFICATIONS),
        now,
        now
      );
      row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;
    } else {
      if (row.is_suspended) {
        res.status(403).json({ error: 'This account has been suspended by an administrator.' });
        return;
      }
      if (!row.avatar_url && gUser.picture) {
        db.prepare('UPDATE profiles SET avatar_url = ?, updated_at = ? WHERE id = ?').run(
          gUser.picture,
          now,
          row.id
        );
        row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(row.id) as any;
      }
    }

    const deviceId = crypto.randomUUID();
    const ua = String(req.headers['user-agent'] || '');
    const { deviceName, platform } = detectDevice(ua);
    db.prepare(
      'INSERT INTO user_devices (id, user_id, device_name, platform, user_agent, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(deviceId, row.id, deviceName, platform, ua.slice(0, 200), now, now);

    const token = signSessionToken(row.id, deviceId);
    res.cookie(COOKIE_NAME, token, getCookieOptions(req));
    res.json({ token, profile: formatOwnProfile(row) });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Failed to authenticate with Google.' });
  }
});

app.post('/api/auth/register', (req, res) => {
  const { email, password, fullName = '' } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes('@') || String(password || '').length < 6) {
    res.status(400).json({ error: 'Valid email and password (min 6 characters) are required.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(cleanEmail);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists. Please log in.' });
    return;
  }

  const uid = crypto.randomUUID();
  const rikzenId = generatePermanentRikzenId();
  const now = new Date().toISOString();
  const displayName = String(fullName).trim() || cleanEmail.split('@')[0];

  db.prepare(
    `INSERT INTO profiles (
      id, rikzen_id, email, password_hash, full_name, last_seen_at,
      privacy_settings, appearance_settings, notification_settings,
      onboarding_completed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    uid,
    rikzenId,
    cleanEmail,
    hashPassword(String(password)),
    displayName,
    now,
    JSON.stringify(DEFAULT_PRIVACY),
    JSON.stringify(DEFAULT_APPEARANCE),
    JSON.stringify(DEFAULT_NOTIFICATIONS),
    now,
    now
  );

  const deviceId = crypto.randomUUID();
  const ua = String(req.headers['user-agent'] || '');
  const { deviceName, platform } = detectDevice(ua);
  db.prepare(
    'INSERT INTO user_devices (id, user_id, device_name, platform, user_agent, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(deviceId, uid, deviceName, platform, ua.slice(0, 200), now, now);

  const token = signSessionToken(uid, deviceId);
  res.cookie(COOKIE_NAME, token, getCookieOptions(req));

  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;
  res.status(201).json({ token, profile: formatOwnProfile(row) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const row = db.prepare('SELECT * FROM profiles WHERE email = ?').get(cleanEmail) as any;

  if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }
  if (row.is_suspended) {
    res.status(403).json({ error: 'This account has been suspended by an administrator.' });
    return;
  }

  const now = new Date().toISOString();
  const deviceId = crypto.randomUUID();
  const ua = String(req.headers['user-agent'] || '');
  const { deviceName, platform } = detectDevice(ua);
  db.prepare(
    'INSERT INTO user_devices (id, user_id, device_name, platform, user_agent, last_active_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(deviceId, row.id, deviceName, platform, ua.slice(0, 200), now, now);

  const token = signSessionToken(row.id, deviceId);
  res.cookie(COOKIE_NAME, token, getCookieOptions(req));

  res.json({ token, profile: formatOwnProfile(row) });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  if (req.deviceId) {
    db.prepare('DELETE FROM user_devices WHERE id = ? AND user_id = ?').run(req.deviceId, req.userId!);
  }
  const opts = getCookieOptions(req);
  res.clearCookie(COOKIE_NAME, { path: '/', sameSite: opts.sameSite, secure: opts.secure });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req: AuthedRequest, res) => {
  const row = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.userId!) as any;
  if (!row) {
    res.status(404).json({ error: 'Account not found.' });
    return;
  }
  res.json({ profile: formatOwnProfile(row) });
});

app.post('/api/auth/complete-onboarding', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { fullName, phone, bio, dateOfBirth, avatarUrl } = req.body || {};
  if (!String(fullName || '').trim()) {
    res.status(400).json({ error: 'Full name is required.' });
    return;
  }
  const now = new Date().toISOString();
  const cleanPhone = phone ? String(phone).trim() : null;
  db.prepare(
    `UPDATE profiles
     SET full_name = ?, phone = ?, phone_verified = ?, bio = ?, date_of_birth = ?, avatar_url = ?, onboarding_completed = 1, updated_at = ?
     WHERE id = ?`
  ).run(
    String(fullName).trim().slice(0, 80),
    cleanPhone,
    cleanPhone ? 1 : 0,
    String(bio || 'Hey there! I am using RIKZEN CHAT.').trim().slice(0, 220),
    dateOfBirth || null,
    avatarUrl || null,
    now,
    uid
  );
  const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;
  res.json({ profile: formatOwnProfile(updated) });
});

app.post('/api/auth/forgot-password', (req, res) => {
  const cleanEmail = String(req.body?.email || '').trim().toLowerCase();
  const row = db.prepare('SELECT id FROM profiles WHERE email = ?').get(cleanEmail) as { id: string } | undefined;
  if (!row) {
    res.json({ ok: true, message: 'If an account matches that email, a reset token has been issued.' });
    return;
  }
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO password_resets (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)').run(
    token,
    row.id,
    expiresAt
  );
  res.json({
    ok: true,
    resetCode: token,
    message: 'Reset code generated. Enter it below to set a new password.',
  });
});

app.post('/api/auth/reset-password', (req, res) => {
  const { resetCode, newPassword } = req.body || {};
  if (!resetCode || String(newPassword || '').length < 6) {
    res.status(400).json({ error: 'Valid reset code and new password (min 6 chars) required.' });
    return;
  }
  const row = db
    .prepare('SELECT * FROM password_resets WHERE token = ? AND used = 0')
    .get(String(resetCode).trim().toUpperCase()) as any;
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: 'Invalid or expired reset code.' });
    return;
  }
  db.prepare('UPDATE profiles SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(String(newPassword)),
    new Date().toISOString(),
    row.user_id
  );
  db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(row.token);
  res.json({ ok: true });
});

app.post('/api/auth/change-password', requireAuth, (req: AuthedRequest, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM profiles WHERE id = ?').get(req.userId!) as any;
  if (!row || !verifyPassword(String(currentPassword || ''), row.password_hash)) {
    res.status(401).json({ error: 'Current password is incorrect.' });
    return;
  }
  if (String(newPassword || '').length < 6) {
    res.status(400).json({ error: 'New password must be at least 6 characters.' });
    return;
  }
  db.prepare('UPDATE profiles SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(String(newPassword)),
    new Date().toISOString(),
    req.userId!
  );
  res.json({ ok: true });
});

app.post('/api/auth/change-email', requireAuth, (req: AuthedRequest, res) => {
  const newEmail = String(req.body?.newEmail || '').trim().toLowerCase();
  if (!newEmail.includes('@')) {
    res.status(400).json({ error: 'Valid email address required.' });
    return;
  }
  const taken = db.prepare('SELECT id FROM profiles WHERE email = ? AND id != ?').get(newEmail, req.userId!);
  if (taken) {
    res.status(409).json({ error: 'That email is already in use.' });
    return;
  }
  db.prepare('UPDATE profiles SET email = ?, email_verified = 1, updated_at = ? WHERE id = ?').run(
    newEmail,
    new Date().toISOString(),
    req.userId!
  );
  res.json({ ok: true, email: newEmail });
});

app.post('/api/auth/change-phone', requireAuth, (req: AuthedRequest, res) => {
  const newPhone = String(req.body?.newPhone || '').trim();
  db.prepare('UPDATE profiles SET phone = ?, phone_verified = ?, updated_at = ? WHERE id = ?').run(
    newPhone || null,
    newPhone ? 1 : 0,
    new Date().toISOString(),
    req.userId!
  );
  res.json({ ok: true, phone: newPhone || null });
});

app.delete('/api/auth/account', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM profiles WHERE id = ?').run(req.userId!);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Media Upload Route
// ----------------------------------------------------------------------------
app.post('/api/uploads', requireAuth, upload.single('file'), (req: AuthedRequest, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded.' });
    return;
  }
  const fileUrl = `/uploads/${req.file.filename}`;
  db.prepare(
    'INSERT INTO attachments (id, uploader_id, file_name, file_url, mime_type, size_bytes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    crypto.randomUUID(),
    req.userId!,
    req.file.originalname,
    fileUrl,
    req.file.mimetype,
    req.file.size,
    new Date().toISOString()
  );
  res.status(201).json({
    fileUrl,
    fileName: req.file.originalname,
    mimeType: req.file.mimetype,
    sizeBytes: req.file.size,
  });
});

app.use('/api', appRouter);

// ----------------------------------------------------------------------------
// Start HTTP + WebSocket Server & Mount Vite / Dist
// ----------------------------------------------------------------------------
async function bootstrap() {
  const server = http.createServer(app);
  initRealtimeServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`RIKZEN CHAT server running on http://0.0.0.0:${PORT}`);
  });
}

bootstrap();
