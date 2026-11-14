import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'rikzen.db');
export const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    rikzen_id TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    bio TEXT NOT NULL DEFAULT 'Hey there! I am using RIKZEN CHAT.',
    phone TEXT,
    phone_verified INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 1,
    date_of_birth TEXT,
    is_suspended INTEGER NOT NULL DEFAULT 0,
    is_online INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT NOT NULL,
    privacy_settings TEXT NOT NULL,
    appearance_settings TEXT NOT NULL,
    notification_settings TEXT NOT NULL,
    storage_settings TEXT NOT NULL DEFAULT '{"autoDownloadImages":true,"autoDownloadVideo":false,"autoDownloadDocs":true}',
    accessibility_settings TEXT NOT NULL DEFAULT '{"reducedMotion":false,"highContrast":false,"appLanguage":"en"}',
    onboarding_completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_profiles_rikzen_id ON profiles (rikzen_id);
  CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles (phone);
  CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS friend_requests (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    receiver_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(sender_id, receiver_id)
  );

  CREATE INDEX IF NOT EXISTS idx_fr_receiver ON friend_requests (receiver_id, status);
  CREATE INDEX IF NOT EXISTS idx_fr_sender ON friend_requests (sender_id, status);

  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    user_one TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    user_two TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    UNIQUE(user_one, user_two)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct', 'group')),
    group_id TEXT,
    last_message_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    muted INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    last_read_at TEXT,
    joined_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'text',
    reply_to_id TEXT,
    forwarded_from_id TEXT,
    metadata TEXT NOT NULL DEFAULT '{}',
    is_edited INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    deleted_for_users TEXT NOT NULL DEFAULT '[]',
    is_pinned INTEGER NOT NULL DEFAULT 0,
    pinned_by TEXT,
    starred_by TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);

  CREATE TABLE IF NOT EXISTS message_receipts (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    delivered_at TEXT,
    read_at TEXT,
    PRIMARY KEY (message_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS message_reactions (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    emoji TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(message_id, user_id, emoji)
  );

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    uploader_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_url TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS groups (
    id TEXT PRIMARY KEY,
    conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_by TEXT NOT NULL REFERENCES profiles(id),
    only_admins_message INTEGER NOT NULL DEFAULT 0,
    only_admins_edit_info INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS group_members (
    group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (group_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS statuses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL DEFAULT 'text',
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    caption TEXT NOT NULL DEFAULT '',
    background_color TEXT NOT NULL DEFAULT '#141418',
    muted_by TEXT NOT NULL DEFAULT '[]',
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS status_views (
    status_id TEXT NOT NULL REFERENCES statuses(id) ON DELETE CASCADE,
    viewer_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    reaction TEXT,
    viewed_at TEXT NOT NULL,
    PRIMARY KEY (status_id, viewer_id)
  );

  CREATE TABLE IF NOT EXISTS channels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    is_verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channel_followers (
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'follower' CHECK (role IN ('admin', 'follower')),
    followed_at TEXT NOT NULL,
    PRIMARY KEY (channel_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS channel_posts (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    media_url TEXT,
    media_type TEXT NOT NULL DEFAULT 'text',
    reactions TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS communities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    linked_group_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS community_members (
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TEXT NOT NULL,
    PRIMARY KEY (community_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS community_announcements (
    id TEXT PRIMARY KEY,
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS calls (
    id TEXT PRIMARY KEY,
    caller_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    callee_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    call_type TEXT NOT NULL CHECK (call_type IN ('voice', 'video')),
    status TEXT NOT NULL DEFAULT 'ringing',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    duration_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    blocked_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (blocker_id, blocked_id)
  );

  CREATE TABLE IF NOT EXISTS user_devices (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL,
    user_agent TEXT NOT NULL DEFAULT '',
    last_active_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    reporter_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS admin_roles (
    user_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin',
    granted_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('conversation_members', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('conversation_members', 'marked_unread', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('conversation_members', 'disappearing_seconds', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('conversation_members', 'chat_theme', 'TEXT');
ensureColumn('conversation_members', 'custom_list', "TEXT NOT NULL DEFAULT ''");
ensureColumn('conversation_members', 'cleared_at', 'TEXT');
ensureColumn('groups', 'invite_code', 'TEXT');
ensureColumn('messages', 'expires_at', 'TEXT');
ensureColumn('messages', 'media_url', 'TEXT');
ensureColumn('messages', 'file_name', 'TEXT');
ensureColumn('messages', 'file_size', 'INTEGER');
ensureColumn('messages', 'mime_type', 'TEXT');
ensureColumn('messages', 'duration', 'INTEGER');
ensureColumn('messages', 'thumbnail_url', 'TEXT');
ensureColumn('messages', 'delivery_status', "TEXT NOT NULL DEFAULT 'sent'");
ensureColumn('statuses', 'privacy', "TEXT NOT NULL DEFAULT 'friends'");
ensureColumn('statuses', 'font_style', "TEXT NOT NULL DEFAULT 'sans'");
ensureColumn('statuses', 'duration', 'INTEGER');
ensureColumn('statuses', 'thumbnail_url', 'TEXT');
ensureColumn('attachments', 'bucket_name', 'TEXT');
ensureColumn('attachments', 'storage_path', 'TEXT');
ensureColumn('attachments', 'thumbnail_url', 'TEXT');
ensureColumn('attachments', 'duration', 'INTEGER');

export const DEFAULT_PRIVACY = {
  lastSeen: 'friends',
  onlineStatus: 'everyone',
  profilePhoto: 'everyone',
  bioVisibility: 'everyone',
  readReceipts: true,
  friendRequests: 'everyone',
  discoverableByPhone: true,
  discoverableByName: true,
  emailVisibility: 'nobody',
};

export const DEFAULT_APPEARANCE = {
  theme: 'dark',
  wallpaper: 'obsidian-web',
  accentColor: 'gold',
  fontSize: 'medium',
  bubbleStyle: 'rounded',
};

export const DEFAULT_NOTIFICATIONS = {
  messages: true,
  friendRequests: true,
  groups: true,
  calls: true,
  statuses: true,
  sound: true,
  vibration: true,
};

export function generatePermanentRikzenId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const checkStmt = db.prepare('SELECT 1 FROM profiles WHERE rikzen_id = ?');
  for (;;) {
    let suffix = '';
    for (let i = 0; i < 6; i++) {
      suffix += chars[Math.floor(Math.random() * chars.length)];
    }
    const candidate = `RIKZEN-${suffix}`;
    if (!checkStmt.get(candidate)) {
      return candidate;
    }
  }
}

export function getUploadsDir(): string {
  return UPLOADS_DIR;
}
