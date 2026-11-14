import crypto from 'node:crypto';
import { Router } from 'express';
import { db, DEFAULT_PRIVACY, DEFAULT_APPEARANCE, DEFAULT_NOTIFICATIONS } from '../db.ts';
import { requireAuth, requireAdmin, type AuthedRequest } from '../auth.ts';
import { isUserOnline, sendToUser, sendToUsers } from '../realtime.ts';

export const appRouter = Router();

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function sanitizeProfileForViewer(row: any, viewerId: string, isFriend: boolean) {
  const privacy = safeJsonParse(row.privacy_settings, DEFAULT_PRIVACY);
  const isSelf = row.id === viewerId;

  const canSeePhoto =
    isSelf ||
    privacy.profilePhoto === 'everyone' ||
    (privacy.profilePhoto === 'friends' && isFriend);
  const canSeeBio =
    isSelf ||
    privacy.bioVisibility === 'everyone' ||
    (privacy.bioVisibility === 'friends' && isFriend);
  const canSeeOnline =
    isSelf ||
    privacy.onlineStatus === 'everyone' ||
    (privacy.onlineStatus === 'friends' && isFriend);
  const canSeeLastSeen =
    isSelf ||
    privacy.lastSeen === 'everyone' ||
    (privacy.lastSeen === 'friends' && isFriend);
  const canSeeEmail =
    isSelf ||
    privacy.emailVisibility === 'everyone' ||
    (privacy.emailVisibility === 'friends' && isFriend);
  const canSeePhone =
    isSelf ||
    (Boolean(privacy.discoverableByPhone) && isFriend);

  return {
    id: row.id,
    rikzenId: row.rikzen_id,
    fullName: row.full_name,
    avatarUrl: canSeePhoto ? row.avatar_url : null,
    bio: canSeeBio ? row.bio : null,
    phone: canSeePhone ? row.phone : null,
    email: canSeeEmail ? row.email : null,
    isOnline: canSeeOnline ? isUserOnline(row.id) || Boolean(row.is_online) : false,
    lastSeenAt: canSeeLastSeen ? row.last_seen_at : null,
    isFriend,
  };
}

function areFriends(u1: string, u2: string): boolean {
  const [a, b] = u1 < u2 ? [u1, u2] : [u2, u1];
  return Boolean(
    db.prepare('SELECT 1 FROM friendships WHERE user_one = ? AND user_two = ?').get(a, b)
  );
}

function isBlockedBetween(u1: string, u2: string): boolean {
  return Boolean(
    db
      .prepare(
        'SELECT 1 FROM blocked_users WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?)'
      )
      .get(u1, u2, u2, u1)
  );
}

function createNotification(userId: string, type: string, title: string, body: string, data: Record<string, any> = {}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO notifications (id, user_id, type, title, body, data, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
  ).run(id, userId, type, title, body, JSON.stringify(data), now);
  sendToUser(userId, 'notification:new', { id, type, title, body, data, isRead: false, createdAt: now });
}

function ensureDirectConversation(u1: string, u2: string): string {
  const existing = db
    .prepare(
      `SELECT c.id FROM conversations c
       JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = ?
       JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = ?
       WHERE c.type = 'direct'
       LIMIT 1`
    )
    .get(u1, u2) as { id: string } | undefined;
  if (existing) return existing.id;

  const convId = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO conversations (id, type, last_message_at, created_at) VALUES (?, ?, ?, ?)').run(
    convId,
    'direct',
    now,
    now
  );
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    convId,
    u1,
    now
  );
  db.prepare('INSERT INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    convId,
    u2,
    now
  );
  return convId;
}

// ----------------------------------------------------------------------------
// Profiles & Settings
// ----------------------------------------------------------------------------
appRouter.patch('/profiles/me', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { fullName, bio, avatarUrl, dateOfBirth, phone } = req.body || {};
  const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;
  if (!current) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  if (typeof avatarUrl === 'string' && (avatarUrl.startsWith('blob:') || avatarUrl.startsWith('data:'))) {
    res.status(400).json({ error: 'Temporary local image URLs cannot be saved as a profile picture.' });
    return;
  }

  const nextName = typeof fullName === 'string' && fullName.trim() ? fullName.trim().slice(0, 80) : current.full_name;
  const nextBio = typeof bio === 'string' ? bio.trim().slice(0, 220) : current.bio;
  const nextAvatar = avatarUrl === null ? null : typeof avatarUrl === 'string' ? avatarUrl : current.avatar_url;
  const nextDob = dateOfBirth === null ? null : typeof dateOfBirth === 'string' ? dateOfBirth : current.date_of_birth;
  const nextPhone = phone === null ? null : typeof phone === 'string' ? phone.trim() : current.phone;

  db.prepare(
    `UPDATE profiles SET full_name = ?, bio = ?, avatar_url = ?, date_of_birth = ?, phone = ?, updated_at = ? WHERE id = ?`
  ).run(nextName, nextBio, nextAvatar, nextDob, nextPhone, new Date().toISOString(), uid);

  const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;

  // Broadcast live profile / DP updates to friends and active conversation peers
  const friendRows = db
    .prepare('SELECT CASE WHEN user_one = ? THEN user_two ELSE user_one END AS peer_id FROM friendships WHERE user_one = ? OR user_two = ?')
    .all(uid, uid, uid) as Array<{ peer_id: string }>;
  const convPeerRows = db
    .prepare(
      `SELECT DISTINCT cm2.user_id AS peer_id
       FROM conversation_members cm1
       JOIN conversation_members cm2 ON cm2.conversation_id = cm1.conversation_id
       WHERE cm1.user_id = ? AND cm2.user_id != ?`
    )
    .all(uid, uid) as Array<{ peer_id: string }>;
  const peerIds = Array.from(new Set([...friendRows.map((r) => r.peer_id), ...convPeerRows.map((r) => r.peer_id)]));
  if (peerIds.length > 0) {
    sendToUsers(peerIds, 'profile:updated', {
      userId: uid,
      fullName: updated.full_name,
      avatarUrl: updated.avatar_url,
      bio: updated.bio,
    });
  }

  res.json({
    profile: {
      id: updated.id,
      rikzenId: updated.rikzen_id,
      email: updated.email,
      fullName: updated.full_name,
      avatarUrl: updated.avatar_url,
      bio: updated.bio,
      phone: updated.phone,
      phoneVerified: Boolean(updated.phone_verified),
      emailVerified: Boolean(updated.email_verified),
      dateOfBirth: updated.date_of_birth,
      onboardingCompleted: Boolean(updated.onboarding_completed),
      privacySettings: safeJsonParse(updated.privacy_settings, DEFAULT_PRIVACY),
      appearanceSettings: safeJsonParse(updated.appearance_settings, DEFAULT_APPEARANCE),
      notificationSettings: safeJsonParse(updated.notification_settings, DEFAULT_NOTIFICATIONS),
      storageSettings: safeJsonParse(updated.storage_settings, {}),
      accessibilitySettings: safeJsonParse(updated.accessibility_settings, {}),
    },
  });
});

appRouter.patch('/profiles/settings', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { privacySettings, appearanceSettings, notificationSettings, storageSettings, accessibilitySettings } =
    req.body || {};

  const current = db.prepare('SELECT * FROM profiles WHERE id = ?').get(uid) as any;
  if (!current) {
    res.status(404).json({ error: 'Profile not found' });
    return;
  }

  const nextPrivacy = privacySettings
    ? JSON.stringify({ ...safeJsonParse(current.privacy_settings, DEFAULT_PRIVACY), ...privacySettings })
    : current.privacy_settings;
  const nextAppearance = appearanceSettings
    ? JSON.stringify({ ...safeJsonParse(current.appearance_settings, DEFAULT_APPEARANCE), ...appearanceSettings })
    : current.appearance_settings;
  const nextNotifications = notificationSettings
    ? JSON.stringify({ ...safeJsonParse(current.notification_settings, DEFAULT_NOTIFICATIONS), ...notificationSettings })
    : current.notification_settings;
  const nextStorage = storageSettings
    ? JSON.stringify({ ...safeJsonParse(current.storage_settings, {}), ...storageSettings })
    : current.storage_settings;
  const nextAccess = accessibilitySettings
    ? JSON.stringify({ ...safeJsonParse(current.accessibility_settings, {}), ...accessibilitySettings })
    : current.accessibility_settings;

  db.prepare(
    `UPDATE profiles
     SET privacy_settings = ?, appearance_settings = ?, notification_settings = ?, storage_settings = ?, accessibility_settings = ?, updated_at = ?
     WHERE id = ?`
  ).run(nextPrivacy, nextAppearance, nextNotifications, nextStorage, nextAccess, new Date().toISOString(), uid);

  res.json({
    privacySettings: JSON.parse(nextPrivacy),
    appearanceSettings: JSON.parse(nextAppearance),
    notificationSettings: JSON.parse(nextNotifications),
    storageSettings: JSON.parse(nextStorage),
    accessibilitySettings: JSON.parse(nextAccess),
  });
});

// ----------------------------------------------------------------------------
// Cross-Device User Discovery (Indexed RIKZEN ID, exact phone, permitted name)
// ----------------------------------------------------------------------------
appRouter.get('/users/search', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const q = String(req.query.q || '').trim();
  if (q.length < 2) {
    res.json({ results: [] });
    return;
  }

  const rows = db
    .prepare(
      `SELECT id, rikzen_id, full_name, avatar_url, bio, phone, phone_verified, is_online, last_seen_at, privacy_settings
       FROM profiles
       WHERE id != ? AND is_suspended = 0`
    )
    .all(uid) as any[];

  const normalizedQ = q.toUpperCase();
  const digitsQ = q.replace(/[^\d+]/g, '');

  const results: any[] = [];
  for (const row of rows) {
    if (isBlockedBetween(uid, row.id)) continue;
    const privacy = safeJsonParse(row.privacy_settings, DEFAULT_PRIVACY);
    const friend = areFriends(uid, row.id);

    const exactRikzenMatch = row.rikzen_id.toUpperCase() === normalizedQ;
    const exactPhoneMatch =
      Boolean(privacy.discoverableByPhone) &&
      Boolean(row.phone) &&
      digitsQ.length >= 6 &&
      (row.phone === q || row.phone.replace(/[^\d+]/g, '') === digitsQ);
    const nameMatch =
      Boolean(privacy.discoverableByName) &&
      row.full_name.toLowerCase().includes(q.toLowerCase());

    if (!exactRikzenMatch && !exactPhoneMatch && !nameMatch) continue;

    // Check existing friend request status
    const reqRow = db
      .prepare(
        `SELECT id, sender_id, receiver_id, status FROM friend_requests
         WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`
      )
      .get(uid, row.id, row.id, uid) as any;

    const sanitized = sanitizeProfileForViewer(row, uid, friend);
    if (exactPhoneMatch) {
      sanitized.phone = row.phone;
    }

    results.push({
      ...sanitized,
      relationship: friend
        ? 'friends'
        : reqRow
        ? reqRow.status === 'pending'
          ? reqRow.sender_id === uid
            ? 'sent'
            : 'received'
          : reqRow.status
        : 'none',
      requestId: reqRow?.id || null,
      canSendRequest: privacy.friendRequests !== 'nobody',
    });
  }

  res.json({ results: results.slice(0, 25) });
});

// ----------------------------------------------------------------------------
// Friend Requests & Friendships
// ----------------------------------------------------------------------------
appRouter.get('/friends', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;

  const friendRows = db
    .prepare(
      `SELECT p.* FROM friendships f
       JOIN profiles p ON p.id = CASE WHEN f.user_one = ? THEN f.user_two ELSE f.user_one END
       WHERE f.user_one = ? OR f.user_two = ?`
    )
    .all(uid, uid, uid) as any[];

  const friends = friendRows.map((row) => sanitizeProfileForViewer(row, uid, true));

  const requestRows = db
    .prepare(
      `SELECT fr.*,
              sp.rikzen_id AS sender_rikzen_id, sp.full_name AS sender_name, sp.avatar_url AS sender_avatar, sp.bio AS sender_bio,
              rp.rikzen_id AS receiver_rikzen_id, rp.full_name AS receiver_name, rp.avatar_url AS receiver_avatar, rp.bio AS receiver_bio
       FROM friend_requests fr
       JOIN profiles sp ON sp.id = fr.sender_id
       JOIN profiles rp ON rp.id = fr.receiver_id
       WHERE fr.sender_id = ? OR fr.receiver_id = ?
       ORDER BY fr.updated_at DESC`
    )
    .all(uid, uid) as any[];

  const blockedRows = db
    .prepare(
      `SELECT p.id, p.rikzen_id, p.full_name, p.avatar_url, b.created_at AS blocked_at
       FROM blocked_users b
       JOIN profiles p ON p.id = b.blocked_id
       WHERE b.blocker_id = ?`
    )
    .all(uid) as any[];

  res.json({
    friends,
    receivedRequests: requestRows.filter((r) => r.receiver_id === uid && r.status === 'pending'),
    sentRequests: requestRows.filter((r) => r.sender_id === uid && r.status === 'pending'),
    rejectedRequests: requestRows.filter((r) => r.status === 'rejected'),
    blockedUsers: blockedRows,
  });
});

appRouter.post('/friends/request', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { targetUserId } = req.body || {};
  if (!targetUserId || targetUserId === uid) {
    res.status(400).json({ error: 'You cannot send a friend request to yourself.' });
    return;
  }

  const target = db.prepare('SELECT * FROM profiles WHERE id = ? AND is_suspended = 0').get(targetUserId) as any;
  if (!target) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  if (isBlockedBetween(uid, targetUserId)) {
    res.status(403).json({ error: 'Unable to send request due to block settings.' });
    return;
  }

  const privacy = safeJsonParse(target.privacy_settings, DEFAULT_PRIVACY);
  if (privacy.friendRequests === 'nobody') {
    res.status(403).json({ error: 'This user is not accepting friend requests.' });
    return;
  }

  if (areFriends(uid, targetUserId)) {
    res.status(409).json({ error: 'You are already connected with this user.' });
    return;
  }

  const existing = db
    .prepare(
      `SELECT * FROM friend_requests
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)`
    )
    .get(uid, targetUserId, targetUserId, uid) as any;

  const now = new Date().toISOString();
  if (existing) {
    if (existing.status === 'pending') {
      res.status(409).json({ error: 'A friend request already exists between you two.' });
      return;
    }
    db.prepare('UPDATE friend_requests SET sender_id = ?, receiver_id = ?, status = ?, updated_at = ? WHERE id = ?').run(
      uid,
      targetUserId,
      'pending',
      now,
      existing.id
    );
  } else {
    db.prepare(
      'INSERT INTO friend_requests (id, sender_id, receiver_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(crypto.randomUUID(), uid, targetUserId, 'pending', now, now);
  }

  const sender = db.prepare('SELECT full_name, rikzen_id, avatar_url FROM profiles WHERE id = ?').get(uid) as any;
  createNotification(
    targetUserId,
    'friend_request',
    'New Friend Request',
    `${sender.full_name} (${sender.rikzen_id}) wants to connect with you.`,
    { senderId: uid }
  );
  sendToUser(targetUserId, 'friend:request', { senderId: uid, sender });
  res.json({ ok: true });
});

appRouter.post('/friends/respond', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { requestId, action } = req.body || {};
  if (!requestId || !['accept', 'reject', 'block'].includes(action)) {
    res.status(400).json({ error: 'Invalid request action.' });
    return;
  }

  const fr = db.prepare('SELECT * FROM friend_requests WHERE id = ?').get(requestId) as any;
  if (!fr || fr.receiver_id !== uid) {
    res.status(404).json({ error: 'Friend request not found.' });
    return;
  }

  const now = new Date().toISOString();
  if (action === 'accept') {
    db.prepare("UPDATE friend_requests SET status = 'accepted', updated_at = ? WHERE id = ?").run(now, requestId);
    const [u1, u2] = fr.sender_id < uid ? [fr.sender_id, uid] : [uid, fr.sender_id];
    db.prepare('INSERT OR IGNORE INTO friendships (id, user_one, user_two, created_at) VALUES (?, ?, ?, ?)').run(
      crypto.randomUUID(),
      u1,
      u2,
      now
    );
    const convId = ensureDirectConversation(uid, fr.sender_id);
    const acceptor = db.prepare('SELECT full_name, rikzen_id FROM profiles WHERE id = ?').get(uid) as any;
    createNotification(
      fr.sender_id,
      'friend_accepted',
      'Friend Request Accepted',
      `${acceptor.full_name} accepted your friend request. You can now chat!`,
      { conversationId: convId, userId: uid }
    );
    sendToUsers([uid, fr.sender_id], 'friend:accepted', { conversationId: convId, userId: uid });
    res.json({ ok: true, conversationId: convId });
    return;
  }

  if (action === 'reject') {
    db.prepare("UPDATE friend_requests SET status = 'rejected', updated_at = ? WHERE id = ?").run(now, requestId);
    res.json({ ok: true });
    return;
  }

  // block
  db.prepare("UPDATE friend_requests SET status = 'rejected', updated_at = ? WHERE id = ?").run(now, requestId);
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    uid,
    fr.sender_id,
    now
  );
  res.json({ ok: true });
});

appRouter.post('/friends/block', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { targetUserId } = req.body || {};
  if (!targetUserId || targetUserId === uid) {
    res.status(400).json({ error: 'Invalid user.' });
    return;
  }
  db.prepare('INSERT OR IGNORE INTO blocked_users (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)').run(
    uid,
    targetUserId,
    new Date().toISOString()
  );
  res.json({ ok: true });
});

appRouter.delete('/friends/block/:targetId', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM blocked_users WHERE blocker_id = ? AND blocked_id = ?').run(
    req.userId!,
    req.params.targetId
  );
  res.json({ ok: true });
});

appRouter.delete('/friends/request/:requestId', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const fr = db
    .prepare('SELECT * FROM friend_requests WHERE id = ? AND sender_id = ? AND status = ?')
    .get(req.params.requestId, uid, 'pending') as any;
  if (!fr) {
    res.status(404).json({ error: 'Pending sent request not found.' });
    return;
  }
  db.prepare('DELETE FROM friend_requests WHERE id = ?').run(fr.id);
  res.json({ ok: true });
});

appRouter.delete('/friends/:friendId', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const fid = req.params.friendId;
  const [u1, u2] = uid < fid ? [uid, fid] : [fid, uid];
  db.prepare('DELETE FROM friendships WHERE user_one = ? AND user_two = ?').run(u1, u2);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Conversations & Real-Time Messages
// ----------------------------------------------------------------------------
function computeMessageStatus(messageId: string, senderId: string): 'sent' | 'delivered' | 'read' {
  const receipts = db
    .prepare('SELECT user_id, delivered_at, read_at FROM message_receipts WHERE message_id = ? AND user_id != ?')
    .all(messageId, senderId) as Array<{ user_id: string; delivered_at: string | null; read_at: string | null }>;
  if (receipts.length > 0 && receipts.every((r) => r.read_at)) return 'read';
  if (receipts.some((r) => r.delivered_at)) return 'delivered';
  return 'sent';
}

appRouter.get('/conversations', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const nowIso = new Date().toISOString();
  db.prepare('DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= ?').run(nowIso);

  const convRows = db
    .prepare(
      `SELECT c.*, cm.muted, cm.archived, cm.pinned, cm.marked_unread, cm.disappearing_seconds, cm.chat_theme, cm.custom_list, cm.cleared_at, cm.last_read_at
       FROM conversations c
       JOIN conversation_members cm ON cm.conversation_id = c.id
       WHERE cm.user_id = ?
       ORDER BY cm.pinned DESC, c.last_message_at DESC`
    )
    .all(uid) as any[];

  const enriched = convRows.map((conv) => {
    const lastMsg = db
      .prepare(
        `SELECT m.*, p.full_name AS sender_name FROM messages m
         JOIN profiles p ON p.id = m.sender_id
         WHERE m.conversation_id = ?
           AND (? IS NULL OR m.created_at > ?)
         ORDER BY m.created_at DESC LIMIT 1`
      )
      .get(conv.id, conv.cleared_at || null, conv.cleared_at || null) as any;

    const rawUnreadCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM messages m
           LEFT JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
           WHERE m.conversation_id = ? AND m.sender_id != ? AND mr.read_at IS NULL AND m.is_deleted = 0
             AND (? IS NULL OR m.created_at > ?)`
        )
        .get(uid, conv.id, uid, conv.cleared_at || null, conv.cleared_at || null) as { cnt: number }
    ).cnt;

    const unreadCount = conv.marked_unread && rawUnreadCount === 0 ? 1 : rawUnreadCount;
    const lastStatus = lastMsg && lastMsg.sender_id === uid ? computeMessageStatus(lastMsg.id, uid) : undefined;

    if (conv.type === 'direct') {
      const otherMember = db
        .prepare(
          `SELECT p.* FROM conversation_members cm
           JOIN profiles p ON p.id = cm.user_id
           WHERE cm.conversation_id = ? AND cm.user_id != ?
           LIMIT 1`
        )
        .get(conv.id, uid) as any;

      const friend = otherMember ? areFriends(uid, otherMember.id) : false;
      const blocked = otherMember ? isBlockedBetween(uid, otherMember.id) : false;

      return {
        id: conv.id,
        type: 'direct',
        title: otherMember?.full_name || 'RIKZEN User',
        avatarUrl: otherMember ? sanitizeProfileForViewer(otherMember, uid, friend).avatarUrl : null,
        peer: otherMember ? sanitizeProfileForViewer(otherMember, uid, friend) : null,
        isBlocked: blocked,
        muted: Boolean(conv.muted),
        archived: Boolean(conv.archived),
        pinned: Boolean(conv.pinned),
        markedUnread: Boolean(conv.marked_unread),
        disappearingSeconds: Number(conv.disappearing_seconds || 0),
        chatTheme: conv.chat_theme || null,
        customList: conv.custom_list || '',
        unreadCount,
        lastMessageAt: conv.last_message_at,
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.is_deleted ? 'This message was deleted' : lastMsg.content,
              messageType: lastMsg.message_type,
              senderId: lastMsg.sender_id,
              senderName: lastMsg.sender_name,
              status: lastStatus,
              createdAt: lastMsg.created_at,
            }
          : null,
      };
    } else {
      const group = db.prepare('SELECT * FROM groups WHERE conversation_id = ?').get(conv.id) as any;
      const memberCount = (
        db.prepare('SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ?').get(group?.id || '') as {
          cnt: number;
        }
      ).cnt;
      const myRole = (
        db
          .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
          .get(group?.id || '', uid) as { role: string } | undefined
      )?.role;

      return {
        id: conv.id,
        type: 'group',
        groupId: group?.id,
        title: group?.name || 'RIKZEN Group',
        description: group?.description || '',
        avatarUrl: group?.avatar_url || null,
        onlyAdminsMessage: Boolean(group?.only_admins_message),
        onlyAdminsEditInfo: Boolean(group?.only_admins_edit_info),
        inviteCode: group?.invite_code || null,
        myRole: myRole || 'member',
        memberCount,
        muted: Boolean(conv.muted),
        archived: Boolean(conv.archived),
        pinned: Boolean(conv.pinned),
        markedUnread: Boolean(conv.marked_unread),
        disappearingSeconds: Number(conv.disappearing_seconds || 0),
        chatTheme: conv.chat_theme || null,
        customList: conv.custom_list || '',
        unreadCount,
        lastMessageAt: conv.last_message_at,
        lastMessage: lastMsg
          ? {
              id: lastMsg.id,
              content: lastMsg.is_deleted ? 'This message was deleted' : lastMsg.content,
              messageType: lastMsg.message_type,
              senderId: lastMsg.sender_id,
              senderName: lastMsg.sender_name,
              status: lastStatus,
              createdAt: lastMsg.created_at,
            }
          : null,
      };
    }
  });

  res.json({ conversations: enriched });
});

appRouter.post('/conversations/direct', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { peerId } = req.body || {};
  if (!peerId || !areFriends(uid, peerId)) {
    res.status(403).json({ error: 'You can only start a private chat after becoming friends.' });
    return;
  }
  const conversationId = ensureDirectConversation(uid, peerId);
  res.json({ conversationId });
});

function formatMessageRow(row: any, uid: string) {
  const reactions = db
    .prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?')
    .all(row.id) as Array<{ emoji: string; user_id: string }>;

  const receipts = db
    .prepare('SELECT user_id, delivered_at, read_at FROM message_receipts WHERE message_id = ? AND user_id != ?')
    .all(row.id, row.sender_id) as Array<{ user_id: string; delivered_at: string | null; read_at: string | null }>;

  let status: 'sent' | 'delivered' | 'read' = 'sent';
  if (receipts.length > 0 && receipts.every((r) => r.read_at)) {
    status = 'read';
  } else if (receipts.some((r) => r.delivered_at)) {
    status = 'delivered';
  }

  let replyTo = null;
  if (row.reply_to_id) {
    const r = db
      .prepare(
        `SELECT m.id, m.content, m.message_type, m.is_deleted, p.full_name AS sender_name
         FROM messages m JOIN profiles p ON p.id = m.sender_id WHERE m.id = ?`
      )
      .get(row.reply_to_id) as any;
    if (r) {
      replyTo = {
        id: r.id,
        content: r.is_deleted ? 'This message was deleted' : r.content,
        messageType: r.message_type,
        senderName: r.sender_name,
      };
    }
  }

  const deletedFor = safeJsonParse<string[]>(row.deleted_for_users, []);
  const starredBy = safeJsonParse<string[]>(row.starred_by, []);
  const parsedMeta = safeJsonParse<Record<string, any>>(row.metadata, {});
  const mergedMeta: Record<string, any> = {
    ...parsedMeta,
    ...(row.media_url && !parsedMeta.fileUrl ? { fileUrl: row.media_url } : {}),
    ...(row.file_name && !parsedMeta.fileName ? { fileName: row.file_name } : {}),
    ...(row.file_size && !parsedMeta.sizeBytes ? { sizeBytes: Number(row.file_size) } : {}),
    ...(row.mime_type && !parsedMeta.mimeType ? { mimeType: row.mime_type } : {}),
    ...(row.duration !== null && row.duration !== undefined && parsedMeta.durationSeconds === undefined
      ? { durationSeconds: Number(row.duration) }
      : {}),
    ...(row.thumbnail_url && !parsedMeta.thumbnailUrl ? { thumbnailUrl: row.thumbnail_url } : {}),
  };

  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderAvatar: row.sender_avatar,
    content: row.is_deleted ? 'This message was deleted' : row.content,
    messageType: row.message_type,
    replyToId: row.reply_to_id,
    replyTo,
    forwardedFromId: row.forwarded_from_id,
    metadata: mergedMeta,
    isEdited: Boolean(row.is_edited),
    isDeleted: Boolean(row.is_deleted),
    hiddenForMe: deletedFor.includes(uid),
    isPinned: Boolean(row.is_pinned),
    isStarred: starredBy.includes(uid),
    status,
    reactions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

appRouter.get('/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const convId = req.params.id;
  const member = db
    .prepare('SELECT cleared_at FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid) as { cleared_at: string | null } | undefined;
  if (!member) {
    res.status(403).json({ error: 'Access denied to this conversation.' });
    return;
  }

  const now = new Date().toISOString();
  db.prepare('DELETE FROM messages WHERE conversation_id = ? AND expires_at IS NOT NULL AND expires_at <= ?').run(
    convId,
    now
  );

  const limit = Math.min(100, Math.max(10, Number(req.query.limit) || 60));
  const before = req.query.before ? String(req.query.before) : null;
  const clearedAt = member.cleared_at || null;

  const rows = before
    ? (db
        .prepare(
          `SELECT m.*, p.full_name AS sender_name, p.avatar_url AS sender_avatar
           FROM messages m JOIN profiles p ON p.id = m.sender_id
           WHERE m.conversation_id = ? AND m.created_at < ?
             AND (? IS NULL OR m.created_at > ?)
           ORDER BY m.created_at DESC LIMIT ?`
        )
        .all(convId, before, clearedAt, clearedAt, limit) as any[])
    : (db
        .prepare(
          `SELECT m.*, p.full_name AS sender_name, p.avatar_url AS sender_avatar
           FROM messages m JOIN profiles p ON p.id = m.sender_id
           WHERE m.conversation_id = ?
             AND (? IS NULL OR m.created_at > ?)
           ORDER BY m.created_at DESC LIMIT ?`
        )
        .all(convId, clearedAt, clearedAt, limit) as any[]);

  // Mark undelivered messages delivered & notify senders in real time
  const updateDelivered = db.prepare(
    'UPDATE message_receipts SET delivered_at = ? WHERE message_id = ? AND user_id = ? AND delivered_at IS NULL'
  );
  const deliveredBySender = new Map<string, string[]>();
  for (const r of rows) {
    if (r.sender_id !== uid) {
      const resUp = updateDelivered.run(now, r.id, uid);
      if (resUp.changes > 0) {
        const arr = deliveredBySender.get(r.sender_id) || [];
        arr.push(r.id);
        deliveredBySender.set(r.sender_id, arr);
      }
    }
  }
  for (const [senderId, messageIds] of deliveredBySender.entries()) {
    sendToUser(senderId, 'message:delivered', {
      conversationId: convId,
      receiverId: uid,
      messageIds,
    });
  }

  const formatted = rows
    .reverse()
    .map((r) => formatMessageRow(r, uid))
    .filter((m) => !m.hiddenForMe);

  res.json({ messages: formatted, hasMore: rows.length === limit });
});

appRouter.post('/conversations/:id/delivered', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const convId = req.params.id;
  const isMember = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid);
  if (!isMember) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }
  const now = new Date().toISOString();
  const pending = db
    .prepare(
      `SELECT m.id, m.sender_id FROM messages m
       JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
       WHERE m.conversation_id = ? AND m.sender_id != ? AND mr.delivered_at IS NULL`
    )
    .all(uid, convId, uid) as Array<{ id: string; sender_id: string }>;

  const markStmt = db.prepare('UPDATE message_receipts SET delivered_at = ? WHERE message_id = ? AND user_id = ?');
  const bySender = new Map<string, string[]>();
  for (const item of pending) {
    markStmt.run(now, item.id, uid);
    const arr = bySender.get(item.sender_id) || [];
    arr.push(item.id);
    bySender.set(item.sender_id, arr);
  }
  for (const [senderId, messageIds] of bySender.entries()) {
    sendToUser(senderId, 'message:delivered', {
      conversationId: convId,
      receiverId: uid,
      messageIds,
    });
  }
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/read', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const convId = req.params.id;
  const isMember = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(convId, uid);
  if (!isMember) {
    res.status(403).json({ error: 'Access denied.' });
    return;
  }

  const myProfile = db.prepare('SELECT privacy_settings FROM profiles WHERE id = ?').get(uid) as any;
  const myPrivacy = safeJsonParse(myProfile?.privacy_settings, DEFAULT_PRIVACY);
  const now = new Date().toISOString();

  db.prepare(
    'UPDATE conversation_members SET last_read_at = ?, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?'
  ).run(now, convId, uid);

  if (myPrivacy.readReceipts !== false) {
    const unread = db
      .prepare(
        `SELECT m.id, m.sender_id FROM messages m
         JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
         WHERE m.conversation_id = ? AND m.sender_id != ? AND mr.read_at IS NULL`
      )
      .all(uid, convId, uid) as Array<{ id: string; sender_id: string }>;

    const markStmt = db.prepare(
      'UPDATE message_receipts SET delivered_at = COALESCE(delivered_at, ?), read_at = ? WHERE message_id = ? AND user_id = ?'
    );
    const senders = new Set<string>();
    for (const u of unread) {
      markStmt.run(now, now, u.id, uid);
      senders.add(u.sender_id);
    }
    if (unread.length > 0) {
      sendToUsers([...senders], 'message:read', {
        conversationId: convId,
        readerId: uid,
        messageIds: unread.map((u) => u.id),
      });
    }
  }
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/messages', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const convId = req.params.id;
  const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as any;
  if (!conv) {
    res.status(404).json({ error: 'Conversation not found.' });
    return;
  }

  const members = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(convId) as Array<{ user_id: string }>;
  const memberIds = members.map((m) => m.user_id);
  if (!memberIds.includes(uid)) {
    res.status(403).json({ error: 'You are not a member of this conversation.' });
    return;
  }

  if (conv.type === 'direct') {
    const peerId = memberIds.find((id) => id !== uid);
    if (peerId && isBlockedBetween(uid, peerId)) {
      res.status(403).json({ error: 'Messaging is unavailable because a user is blocked.' });
      return;
    }
  } else {
    const group = db.prepare('SELECT * FROM groups WHERE conversation_id = ?').get(convId) as any;
    if (group?.only_admins_message) {
      const gm = db
        .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
        .get(group.id, uid) as { role: string } | undefined;
      if (!gm || !['owner', 'admin'].includes(gm.role)) {
        res.status(403).json({ error: 'Only group administrators can send messages in this group.' });
        return;
      }
    }
  }

  const { content = '', messageType = 'text', replyToId = null, forwardedFromId = null, metadata = {} } =
    req.body || {};

  if (!String(content).trim() && messageType === 'text') {
    res.status(400).json({ error: 'Message content cannot be empty.' });
    return;
  }

  const rawFileUrl = typeof metadata?.fileUrl === 'string' ? metadata.fileUrl : null;
  if (rawFileUrl && (rawFileUrl.startsWith('blob:') || rawFileUrl.startsWith('data:'))) {
    res.status(400).json({ error: 'Temporary local media URLs cannot be sent. Upload the file first.' });
    return;
  }

  const msgId = crypto.randomUUID();
  const now = new Date();
  const nowIso = now.toISOString();

  const timerRow = db
    .prepare('SELECT MAX(disappearing_seconds) AS max_sec FROM conversation_members WHERE conversation_id = ?')
    .get(convId) as { max_sec: number | null } | undefined;
  const disappearingSec = Number(timerRow?.max_sec || 0);
  const expiresAt = disappearingSec > 0 ? new Date(now.getTime() + disappearingSec * 1000).toISOString() : null;

  const cleanMeta = metadata && typeof metadata === 'object' ? metadata : {};
  const mediaUrlCol = typeof cleanMeta.fileUrl === 'string' ? cleanMeta.fileUrl : null;
  const fileNameCol = typeof cleanMeta.fileName === 'string' ? cleanMeta.fileName : null;
  const fileSizeCol = typeof cleanMeta.sizeBytes === 'number' ? Math.round(cleanMeta.sizeBytes) : null;
  const mimeTypeCol = typeof cleanMeta.mimeType === 'string' ? cleanMeta.mimeType : null;
  const durationCol =
    typeof cleanMeta.durationSeconds === 'number' ? Math.round(cleanMeta.durationSeconds) : null;
  const thumbCol =
    typeof cleanMeta.thumbnailUrl === 'string' && !cleanMeta.thumbnailUrl.startsWith('blob:')
      ? cleanMeta.thumbnailUrl
      : null;

  db.prepare(
    `INSERT INTO messages (
       id, conversation_id, sender_id, content, message_type, reply_to_id, forwarded_from_id,
       metadata, media_url, file_name, file_size, mime_type, duration, thumbnail_url,
       delivery_status, expires_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)`
  ).run(
    msgId,
    convId,
    uid,
    String(content),
    messageType,
    replyToId,
    forwardedFromId,
    JSON.stringify(cleanMeta),
    mediaUrlCol,
    fileNameCol,
    fileSizeCol,
    mimeTypeCol,
    durationCol,
    thumbCol,
    expiresAt,
    nowIso,
    nowIso
  );

  db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(nowIso, convId);
  db.prepare('UPDATE conversation_members SET marked_unread = 0 WHERE conversation_id = ? AND user_id = ?').run(
    convId,
    uid
  );

  const insertReceipt = db.prepare(
    'INSERT INTO message_receipts (message_id, user_id, delivered_at, read_at) VALUES (?, ?, ?, ?)'
  );
  for (const mId of memberIds) {
    if (mId === uid) continue;
    const deliveredAt = isUserOnline(mId) ? nowIso : null;
    insertReceipt.run(msgId, mId, deliveredAt, null);
  }

  const inserted = db
    .prepare(
      `SELECT m.*, p.full_name AS sender_name, p.avatar_url AS sender_avatar
       FROM messages m JOIN profiles p ON p.id = m.sender_id WHERE m.id = ?`
    )
    .get(msgId) as any;

  const formatted = formatMessageRow(inserted, uid);
  sendToUsers(memberIds, 'message:new', formatted);

  for (const mId of memberIds) {
    if (mId !== uid) {
      const preview =
        messageType === 'text' ? String(content).slice(0, 70) : `Sent a ${messageType}`;
      createNotification(mId, 'message', inserted.sender_name, preview, { conversationId: convId, messageId: msgId });
    }
  }

  res.status(201).json({ message: formatted });
});

appRouter.patch('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg || msg.sender_id !== uid || msg.is_deleted) {
    res.status(403).json({ error: 'Cannot edit this message.' });
    return;
  }
  const { content } = req.body || {};
  if (!String(content || '').trim()) {
    res.status(400).json({ error: 'Message cannot be empty.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('UPDATE messages SET content = ?, is_edited = 1, updated_at = ? WHERE id = ?').run(
    String(content).trim(),
    now,
    msg.id
  );
  const members = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(msg.conversation_id) as Array<{ user_id: string }>;
  sendToUsers(
    members.map((m) => m.user_id),
    'message:updated',
    { id: msg.id, conversationId: msg.conversation_id, content: String(content).trim(), isEdited: true }
  );
  res.json({ ok: true });
});

appRouter.delete('/messages/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const scope = req.query.scope === 'everyone' ? 'everyone' : 'me';
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  const isMember = db
    .prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?')
    .get(msg.conversation_id, uid);
  if (!isMember) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }

  if (scope === 'everyone') {
    if (msg.sender_id !== uid) {
      res.status(403).json({ error: 'Only the sender can delete for everyone.' });
      return;
    }
    db.prepare('UPDATE messages SET is_deleted = 1, content = ?, updated_at = ? WHERE id = ?').run(
      'This message was deleted',
      new Date().toISOString(),
      msg.id
    );
    const members = db
      .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
      .all(msg.conversation_id) as Array<{ user_id: string }>;
    sendToUsers(
      members.map((m) => m.user_id),
      'message:deleted',
      { id: msg.id, conversationId: msg.conversation_id, scope: 'everyone' }
    );
  } else {
    const arr = safeJsonParse<string[]>(msg.deleted_for_users, []);
    if (!arr.includes(uid)) arr.push(uid);
    db.prepare('UPDATE messages SET deleted_for_users = ? WHERE id = ?').run(JSON.stringify(arr), msg.id);
  }

  res.json({ ok: true });
});

appRouter.post('/messages/:id/react', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { emoji } = req.body || {};
  if (!emoji) {
    res.status(400).json({ error: 'Emoji required.' });
    return;
  }
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  const existing = db
    .prepare('SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?')
    .get(msg.id, uid, emoji) as { id: string } | undefined;

  if (existing) {
    db.prepare('DELETE FROM message_reactions WHERE id = ?').run(existing.id);
  } else {
    db.prepare('INSERT INTO message_reactions (id, message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?, ?)').run(
      crypto.randomUUID(),
      msg.id,
      uid,
      emoji,
      new Date().toISOString()
    );
  }

  const reactions = db
    .prepare('SELECT emoji, user_id FROM message_reactions WHERE message_id = ?')
    .all(msg.id);
  const members = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(msg.conversation_id) as Array<{ user_id: string }>;
  sendToUsers(
    members.map((m) => m.user_id),
    'message:reaction',
    { messageId: msg.id, conversationId: msg.conversation_id, reactions }
  );
  res.json({ reactions });
});

appRouter.post('/messages/:id/pin', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  const nextPin = msg.is_pinned ? 0 : 1;
  db.prepare('UPDATE messages SET is_pinned = ?, pinned_by = ? WHERE id = ?').run(
    nextPin,
    nextPin ? uid : null,
    msg.id
  );
  const members = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(msg.conversation_id) as Array<{ user_id: string }>;
  sendToUsers(
    members.map((m) => m.user_id),
    'message:pinned',
    { messageId: msg.id, conversationId: msg.conversation_id, isPinned: Boolean(nextPin) }
  );
  res.json({ isPinned: Boolean(nextPin) });
});

appRouter.post('/messages/:id/star', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id) as any;
  if (!msg) {
    res.status(404).json({ error: 'Message not found.' });
    return;
  }
  const arr = safeJsonParse<string[]>(msg.starred_by, []);
  const idx = arr.indexOf(uid);
  if (idx > -1) arr.splice(idx, 1);
  else arr.push(uid);
  db.prepare('UPDATE messages SET starred_by = ? WHERE id = ?').run(JSON.stringify(arr), msg.id);
  res.json({ isStarred: idx === -1 });
});

appRouter.post('/conversations/:id/mute', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { muted } = req.body || {};
  db.prepare('UPDATE conversation_members SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(
    muted ? 1 : 0,
    req.params.id,
    uid
  );
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/archive', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { archived } = req.body || {};
  db.prepare('UPDATE conversation_members SET archived = ? WHERE conversation_id = ? AND user_id = ?').run(
    archived ? 1 : 0,
    req.params.id,
    uid
  );
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/pin', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { pinned } = req.body || {};
  db.prepare('UPDATE conversation_members SET pinned = ? WHERE conversation_id = ? AND user_id = ?').run(
    pinned ? 1 : 0,
    req.params.id,
    uid
  );
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/unread', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { unread = true } = req.body || {};
  db.prepare('UPDATE conversation_members SET marked_unread = ? WHERE conversation_id = ? AND user_id = ?').run(
    unread ? 1 : 0,
    req.params.id,
    uid
  );
  res.json({ ok: true });
});

appRouter.post('/conversations/:id/disappearing', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const seconds = Math.max(0, Number(req.body?.seconds || 0));
  db.prepare('UPDATE conversation_members SET disappearing_seconds = ? WHERE conversation_id = ?').run(
    seconds,
    req.params.id
  );
  const members = db
    .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
    .all(req.params.id) as Array<{ user_id: string }>;
  sendToUsers(
    members.map((m) => m.user_id),
    'conversation:refresh',
    { conversationId: req.params.id, updatedBy: uid }
  );
  res.json({ ok: true, disappearingSeconds: seconds });
});

appRouter.post('/conversations/:id/theme', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { chatTheme = null } = req.body || {};
  db.prepare('UPDATE conversation_members SET chat_theme = ? WHERE conversation_id = ? AND user_id = ?').run(
    chatTheme,
    req.params.id,
    uid
  );
  res.json({ ok: true, chatTheme });
});

appRouter.post('/conversations/:id/list', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const listName = String(req.body?.listName || '').trim().slice(0, 64);
  db.prepare('UPDATE conversation_members SET custom_list = ? WHERE conversation_id = ? AND user_id = ?').run(
    listName,
    req.params.id,
    uid
  );
  res.json({ ok: true, customList: listName });
});

appRouter.post('/conversations/:id/clear', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const now = new Date().toISOString();
  db.prepare('UPDATE conversation_members SET cleared_at = ?, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?').run(
    now,
    req.params.id,
    uid
  );
  res.json({ ok: true, clearedAt: now });
});

appRouter.delete('/conversations/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE conversation_members SET cleared_at = ?, archived = 1, pinned = 0, marked_unread = 0 WHERE conversation_id = ? AND user_id = ?'
  ).run(now, req.params.id, uid);
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Groups
// ----------------------------------------------------------------------------
appRouter.post('/groups', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { name, description = '', avatarUrl = null, memberIds = [] } = req.body || {};
  if (!String(name || '').trim()) {
    res.status(400).json({ error: 'Group name is required.' });
    return;
  }

  const now = new Date().toISOString();
  const convId = crypto.randomUUID();
  const groupId = crypto.randomUUID();

  db.prepare('INSERT INTO conversations (id, type, group_id, last_message_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
    convId,
    'group',
    groupId,
    now,
    now
  );
  db.prepare(
    'INSERT INTO groups (id, conversation_id, name, description, avatar_url, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(groupId, convId, String(name).trim(), String(description), avatarUrl, uid, now);

  const uniqueMembers = Array.from(new Set([uid, ...(Array.isArray(memberIds) ? memberIds : [])]));
  for (const mId of uniqueMembers) {
    if (mId !== uid && !areFriends(uid, mId)) continue;
    db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
      convId,
      mId,
      now
    );
    db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
      groupId,
      mId,
      mId === uid ? 'owner' : 'member',
      now
    );
    if (mId !== uid) {
      createNotification(mId, 'group', 'Added to Group', `You were added to "${String(name).trim()}"`, {
        conversationId: convId,
        groupId,
      });
    }
  }

  sendToUsers(uniqueMembers, 'conversation:refresh', { conversationId: convId });
  res.status(201).json({ groupId, conversationId: convId });
});

appRouter.get('/groups/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }
  const isMember = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, uid);
  if (!isMember) {
    res.status(403).json({ error: 'Forbidden.' });
    return;
  }
  const members = db
    .prepare(
      `SELECT gm.role, gm.joined_at, p.id, p.rikzen_id, p.full_name, p.avatar_url, p.bio
       FROM group_members gm JOIN profiles p ON p.id = gm.user_id
       WHERE gm.group_id = ?`
    )
    .all(group.id);
  res.json({ group, members });
});

appRouter.patch('/groups/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const gm = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!gm || !['owner', 'admin'].includes(gm.role)) {
    res.status(403).json({ error: 'Only group administrators can update group settings.' });
    return;
  }
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  const { name, description, avatarUrl, onlyAdminsMessage, onlyAdminsEditInfo } = req.body || {};
  db.prepare(
    `UPDATE groups SET name = ?, description = ?, avatar_url = ?, only_admins_message = ?, only_admins_edit_info = ? WHERE id = ?`
  ).run(
    name ? String(name).trim() : group.name,
    typeof description === 'string' ? description : group.description,
    avatarUrl !== undefined ? avatarUrl : group.avatar_url,
    onlyAdminsMessage !== undefined ? (onlyAdminsMessage ? 1 : 0) : group.only_admins_message,
    onlyAdminsEditInfo !== undefined ? (onlyAdminsEditInfo ? 1 : 0) : group.only_admins_edit_info,
    group.id
  );
  res.json({ ok: true });
});

appRouter.post('/groups/:id/members', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const gm = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!gm || !['owner', 'admin'].includes(gm.role)) {
    res.status(403).json({ error: 'Only group administrators can add members.' });
    return;
  }
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  const { userId } = req.body || {};
  if (!userId || !areFriends(uid, userId)) {
    res.status(400).json({ error: 'You can only add connected friends.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
    group.id,
    userId,
    'member',
    now
  );
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    group.conversation_id,
    userId,
    now
  );
  sendToUser(userId, 'conversation:refresh', { conversationId: group.conversation_id });
  res.json({ ok: true });
});

appRouter.patch('/groups/:id/members/:userId', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const gm = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!gm || !['owner', 'admin'].includes(gm.role)) {
    res.status(403).json({ error: 'Admin permission required.' });
    return;
  }
  const { role } = req.body || {};
  if (!['admin', 'member'].includes(role)) {
    res.status(400).json({ error: 'Invalid role.' });
    return;
  }
  db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ? AND role != ?').run(
    role,
    req.params.id,
    req.params.userId,
    'owner'
  );
  res.json({ ok: true });
});

appRouter.delete('/groups/:id/members/:userId', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const targetId = req.params.userId;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }
  if (targetId !== uid) {
    const gm = db
      .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
      .get(group.id, uid) as { role: string } | undefined;
    if (!gm || !['owner', 'admin'].includes(gm.role)) {
      res.status(403).json({ error: 'Only admins can remove other members.' });
      return;
    }
  }
  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(group.id, targetId);
  db.prepare('DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?').run(
    group.conversation_id,
    targetId
  );
  res.json({ ok: true });
});

appRouter.get('/groups/:id/invite', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const gm = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!gm) {
    res.status(403).json({ error: 'Only group members can view the invite link.' });
    return;
  }
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }
  let code = group.invite_code;
  if (!code || req.query.reset === '1') {
    code = `RKZ-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?').run(code, group.id);
  }
  res.json({ inviteCode: code });
});

appRouter.post('/groups/join/:code', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const code = String(req.params.code || '').trim().toUpperCase();
  const group = db.prepare('SELECT * FROM groups WHERE UPPER(invite_code) = ?').get(code) as any;
  if (!group) {
    res.status(404).json({ error: 'Invalid or expired group invite code.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
    group.id,
    uid,
    'member',
    now
  );
  db.prepare('INSERT OR IGNORE INTO conversation_members (conversation_id, user_id, joined_at) VALUES (?, ?, ?)').run(
    group.conversation_id,
    uid,
    now
  );
  res.json({ ok: true, conversationId: group.conversation_id, groupId: group.id });
});

appRouter.delete('/groups/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id) as any;
  if (!group) {
    res.status(404).json({ error: 'Group not found.' });
    return;
  }
  const gm = db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(group.id, uid) as { role: string } | undefined;
  if (!gm || gm.role !== 'owner') {
    res.status(403).json({ error: 'Only the group owner can delete this group.' });
    return;
  }
  const members = db
    .prepare('SELECT user_id FROM group_members WHERE group_id = ?')
    .all(group.id) as Array<{ user_id: string }>;
  db.prepare('DELETE FROM groups WHERE id = ?').run(group.id);
  if (group.conversation_id) {
    db.prepare('DELETE FROM conversations WHERE id = ?').run(group.conversation_id);
  }
  sendToUsers(
    members.map((m) => m.user_id),
    'conversation:refresh',
    { deletedGroupId: group.id }
  );
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Statuses / Updates (24h auto expiration)
// ----------------------------------------------------------------------------
appRouter.get('/statuses', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const now = new Date().toISOString();

  // Clean up expired statuses automatically
  db.prepare('DELETE FROM statuses WHERE expires_at <= ?').run(now);

  const friendIds = (
    db
      .prepare(
        `SELECT CASE WHEN user_one = ? THEN user_two ELSE user_one END AS fid
         FROM friendships WHERE user_one = ? OR user_two = ?`
      )
      .all(uid, uid, uid) as Array<{ fid: string }>
  ).map((r) => r.fid);

  const allowedUserIds = [uid, ...friendIds];
  const placeholders = allowedUserIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT s.*, p.full_name AS author_name, p.avatar_url AS author_avatar, p.rikzen_id AS author_rikzen_id
       FROM statuses s
       JOIN profiles p ON p.id = s.user_id
       WHERE s.expires_at > ? AND (s.user_id IN (${placeholders}) OR s.privacy = 'everyone')
       ORDER BY s.created_at DESC`
    )
    .all(now, ...allowedUserIds) as any[];

  const enriched = rows
    .filter((row) => !isBlockedBetween(uid, row.user_id))
    .map((row) => {
      const mutedBy = safeJsonParse<string[]>(row.muted_by, []);
      const views = db
        .prepare(
          `SELECT sv.*, p.full_name, p.avatar_url, p.rikzen_id
           FROM status_views sv JOIN profiles p ON p.id = sv.viewer_id
           WHERE sv.status_id = ? ORDER BY sv.viewed_at DESC`
        )
        .all(row.id) as any[];
      const viewedByMe = views.some((v) => v.viewer_id === uid);
      return {
        id: row.id,
        userId: row.user_id,
        authorName: row.author_name,
        authorAvatar: row.author_avatar,
        authorRikzenId: row.author_rikzen_id,
        mediaType: row.media_type,
        content: row.content,
        mediaUrl: row.media_url,
        caption: row.caption,
        backgroundColor: row.background_color,
        fontStyle: (row.font_style as 'sans' | 'serif' | 'bold' | 'mono') || 'sans',
        durationSeconds: row.duration ? Number(row.duration) : undefined,
        thumbnailUrl: row.thumbnail_url || null,
        privacy: row.privacy || 'friends',
        isMuted: mutedBy.includes(uid),
        viewedByMe,
        viewCount: views.length,
        viewers: row.user_id === uid ? views : [],
        expiresAt: row.expires_at,
        createdAt: row.created_at,
      };
    });

  res.json({ statuses: enriched });
});

appRouter.post('/statuses', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const {
    mediaType = 'text',
    content = '',
    mediaUrl = null,
    caption = '',
    backgroundColor = '#141418',
    fontStyle = 'sans',
    durationSeconds = null,
    thumbnailUrl = null,
    privacy = 'friends',
  } = req.body || {};

  if (typeof mediaUrl === 'string' && (mediaUrl.startsWith('blob:') || mediaUrl.startsWith('data:'))) {
    res.status(400).json({ error: 'Temporary local media URLs cannot be published.' });
    return;
  }

  const safeType = mediaType === 'image' || mediaType === 'video' ? mediaType : 'text';
  if (safeType === 'text' && !String(content || '').trim()) {
    res.status(400).json({ error: 'Please write text for your status.' });
    return;
  }
  if (safeType !== 'text' && !mediaUrl) {
    res.status(400).json({ error: 'Uploaded media URL is required for photo/video status.' });
    return;
  }

  const safeFontStyle = ['sans', 'serif', 'bold', 'mono'].includes(fontStyle) ? fontStyle : 'sans';
  const safePrivacy = privacy === 'everyone' ? 'everyone' : 'friends';
  const id = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO statuses (id, user_id, media_type, content, media_url, caption, background_color, font_style, duration, thumbnail_url, privacy, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    uid,
    safeType,
    String(content || ''),
    mediaUrl || null,
    String(caption || ''),
    String(backgroundColor || '#141418'),
    safeFontStyle,
    typeof durationSeconds === 'number' ? Math.round(durationSeconds) : null,
    thumbnailUrl && typeof thumbnailUrl === 'string' && !thumbnailUrl.startsWith('blob:') ? thumbnailUrl : null,
    safePrivacy,
    expiresAt,
    now.toISOString()
  );

  const audienceRows =
    safePrivacy === 'everyone'
      ? (db.prepare('SELECT id AS peer_id FROM profiles WHERE id != ? AND is_suspended = 0').all(uid) as Array<{
          peer_id: string;
        }>)
      : (db
          .prepare(
            'SELECT CASE WHEN user_one = ? THEN user_two ELSE user_one END AS peer_id FROM friendships WHERE user_one = ? OR user_two = ?'
          )
          .all(uid, uid, uid) as Array<{ peer_id: string }>);
  sendToUsers(
    [uid, ...audienceRows.map((r) => r.peer_id)],
    'status:new',
    { id, userId: uid }
  );

  res.status(201).json({ id, expiresAt });
});

appRouter.post('/statuses/:id/view', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { reaction = null } = req.body || {};
  const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id) as any;
  if (!status) {
    res.status(404).json({ error: 'Status expired or not found.' });
    return;
  }
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO status_views (status_id, viewer_id, reaction, viewed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(status_id, viewer_id) DO UPDATE SET reaction = COALESCE(excluded.reaction, status_views.reaction), viewed_at = excluded.viewed_at`
  ).run(status.id, uid, reaction, now);

  if (status.user_id !== uid) {
    sendToUser(status.user_id, 'status:viewed', { statusId: status.id, viewerId: uid, reaction });
  }
  if (reaction && status.user_id !== uid) {
    const viewer = db.prepare('SELECT full_name FROM profiles WHERE id = ?').get(uid) as { full_name: string };
    createNotification(
      status.user_id,
      'status',
      'Status Reaction',
      `${viewer.full_name} reacted ${reaction} to your status.`
    );
  }
  res.json({ ok: true });
});

appRouter.post('/statuses/:id/mute', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const status = db.prepare('SELECT * FROM statuses WHERE id = ?').get(req.params.id) as any;
  if (!status) {
    res.status(404).json({ error: 'Status not found.' });
    return;
  }
  const muted = safeJsonParse<string[]>(status.muted_by, []);
  const idx = muted.indexOf(uid);
  if (idx > -1) muted.splice(idx, 1);
  else muted.push(uid);
  db.prepare('UPDATE statuses SET muted_by = ? WHERE id = ?').run(JSON.stringify(muted), status.id);
  res.json({ ok: true });
});

appRouter.delete('/statuses/:id', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  db.prepare('DELETE FROM statuses WHERE id = ? AND user_id = ?').run(req.params.id, uid);
  const friendRows = db
    .prepare(
      'SELECT CASE WHEN user_one = ? THEN user_two ELSE user_one END AS peer_id FROM friendships WHERE user_one = ? OR user_two = ?'
    )
    .all(uid, uid, uid) as Array<{ peer_id: string }>;
  sendToUsers(
    [uid, ...friendRows.map((r) => r.peer_id)],
    'status:deleted',
    { id: req.params.id, userId: uid }
  );
  res.json({ ok: true });
});

// ----------------------------------------------------------------------------
// Communities & Channels
// ----------------------------------------------------------------------------
appRouter.get('/communities', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const rows = db.prepare('SELECT * FROM communities ORDER BY created_at DESC').all() as any[];
  const communities = rows.map((c) => {
    const members = db
      .prepare('SELECT user_id, role FROM community_members WHERE community_id = ?')
      .all(c.id) as Array<{ user_id: string; role: string }>;
    const announcements = db
      .prepare(
        `SELECT ca.*, p.full_name AS author_name FROM community_announcements ca
         JOIN profiles p ON p.id = ca.author_id
         WHERE ca.community_id = ? ORDER BY ca.created_at DESC LIMIT 15`
      )
      .all(c.id);
    const linkedIds = safeJsonParse<string[]>(c.linked_group_ids, []);
    const linkedGroups =
      linkedIds.length > 0
        ? db
            .prepare(`SELECT id, name, description, avatar_url FROM groups WHERE id IN (${linkedIds.map(() => '?').join(',')})`)
            .all(...linkedIds)
        : [];
    const myMembership = members.find((m) => m.user_id === uid);
    return {
      ...c,
      memberCount: members.length,
      isMember: Boolean(myMembership),
      myRole: myMembership?.role || null,
      linkedGroups,
      announcements,
    };
  });
  res.json({ communities });
});

appRouter.post('/communities', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { name, description = '', avatarUrl = null } = req.body || {};
  if (!String(name || '').trim()) {
    res.status(400).json({ error: 'Community name is required.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO communities (id, name, description, avatar_url, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, String(name).trim(), String(description), avatarUrl, uid, now);
  db.prepare('INSERT INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
    id,
    uid,
    'owner',
    now
  );
  res.status(201).json({ id });
});

appRouter.post('/communities/:id/join', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('INSERT OR IGNORE INTO community_members (community_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)').run(
    req.params.id,
    req.userId!,
    'member',
    new Date().toISOString()
  );
  res.json({ ok: true });
});

appRouter.post('/communities/:id/link-group', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const cm = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!cm || !['owner', 'admin'].includes(cm.role)) {
    res.status(403).json({ error: 'Only community admins can add groups.' });
    return;
  }
  const comm = db.prepare('SELECT linked_group_ids FROM communities WHERE id = ?').get(req.params.id) as any;
  const linked = safeJsonParse<string[]>(comm?.linked_group_ids, []);
  const { groupId } = req.body || {};
  if (groupId && !linked.includes(groupId)) linked.push(groupId);
  db.prepare('UPDATE communities SET linked_group_ids = ? WHERE id = ?').run(JSON.stringify(linked), req.params.id);
  res.json({ ok: true });
});

appRouter.post('/communities/:id/announcements', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const cm = db
    .prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!cm || !['owner', 'admin'].includes(cm.role)) {
    res.status(403).json({ error: 'Only community admins can post announcements.' });
    return;
  }
  const { content } = req.body || {};
  if (!String(content || '').trim()) {
    res.status(400).json({ error: 'Announcement text is required.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO community_announcements (id, community_id, author_id, content, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.params.id, uid, String(content).trim(), new Date().toISOString());
  res.status(201).json({ id });
});

appRouter.get('/channels', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const rows = db.prepare('SELECT * FROM channels ORDER BY created_at DESC').all() as any[];
  const channels = rows.map((ch) => {
    const followers = db
      .prepare('SELECT user_id, role FROM channel_followers WHERE channel_id = ?')
      .all(ch.id) as Array<{ user_id: string; role: string }>;
    const posts = db
      .prepare(
        `SELECT cp.*, p.full_name AS author_name FROM channel_posts cp
         JOIN profiles p ON p.id = cp.author_id
         WHERE cp.channel_id = ? ORDER BY cp.created_at DESC LIMIT 20`
      )
      .all(ch.id)
      .map((p: any) => ({ ...p, reactions: safeJsonParse(p.reactions, {}) }));
    const me = followers.find((f) => f.user_id === uid);
    return {
      ...ch,
      isVerified: Boolean(ch.is_verified),
      followerCount: followers.length,
      isFollowing: Boolean(me),
      isAdmin: ch.owner_id === uid || me?.role === 'admin',
      posts,
    };
  });
  res.json({ channels });
});

appRouter.post('/channels', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { name, description = '', avatarUrl = null } = req.body || {};
  if (!String(name || '').trim()) {
    res.status(400).json({ error: 'Channel name is required.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO channels (id, name, description, avatar_url, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    String(name).trim(),
    String(description),
    avatarUrl,
    uid,
    now
  );
  db.prepare('INSERT INTO channel_followers (channel_id, user_id, role, followed_at) VALUES (?, ?, ?, ?)').run(
    id,
    uid,
    'admin',
    now
  );
  res.status(201).json({ id });
});

appRouter.post('/channels/:id/follow', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const existing = db
    .prepare('SELECT role FROM channel_followers WHERE channel_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (existing) {
    if (existing.role === 'admin') {
      res.status(400).json({ error: 'Channel owners cannot unfollow their own channel.' });
      return;
    }
    db.prepare('DELETE FROM channel_followers WHERE channel_id = ? AND user_id = ?').run(req.params.id, uid);
    res.json({ following: false });
  } else {
    db.prepare('INSERT INTO channel_followers (channel_id, user_id, role, followed_at) VALUES (?, ?, ?, ?)').run(
      req.params.id,
      uid,
      'follower',
      new Date().toISOString()
    );
    res.json({ following: true });
  }
});

appRouter.post('/channels/:id/posts', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const ch = db.prepare('SELECT owner_id FROM channels WHERE id = ?').get(req.params.id) as any;
  const cf = db
    .prepare('SELECT role FROM channel_followers WHERE channel_id = ? AND user_id = ?')
    .get(req.params.id, uid) as { role: string } | undefined;
  if (!ch || (ch.owner_id !== uid && cf?.role !== 'admin')) {
    res.status(403).json({ error: 'Only authorized channel administrators can publish updates.' });
    return;
  }
  const { content = '', mediaUrl = null, mediaType = 'text' } = req.body || {};
  const id = crypto.randomUUID();
  db.prepare(
    'INSERT INTO channel_posts (id, channel_id, author_id, content, media_url, media_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.id, uid, String(content), mediaUrl, mediaType, new Date().toISOString());
  res.status(201).json({ id });
});

appRouter.post('/channels/posts/:postId/react', requireAuth, (req: AuthedRequest, res) => {
  const { emoji } = req.body || {};
  const post = db.prepare('SELECT reactions FROM channel_posts WHERE id = ?').get(req.params.postId) as any;
  if (!post || !emoji) {
    res.status(404).json({ error: 'Post not found.' });
    return;
  }
  const map = safeJsonParse<Record<string, number>>(post.reactions, {});
  map[emoji] = (map[emoji] || 0) + 1;
  db.prepare('UPDATE channel_posts SET reactions = ? WHERE id = ?').run(JSON.stringify(map), req.params.postId);
  res.json({ reactions: map });
});

// ----------------------------------------------------------------------------
// Calls, Notifications, Devices, Reports, Broadcasts
// ----------------------------------------------------------------------------
appRouter.post('/calls', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { calleeId, callType = 'voice' } = req.body || {};
  if (!calleeId || !areFriends(uid, calleeId)) {
    res.status(403).json({ error: 'Calls are available between connected friends.' });
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO calls (id, caller_id, callee_id, call_type, status, started_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    uid,
    calleeId,
    callType === 'video' ? 'video' : 'voice',
    'ringing',
    now
  );
  const caller = db.prepare('SELECT full_name FROM profiles WHERE id = ?').get(uid) as { full_name: string };
  createNotification(calleeId, 'call', `Incoming ${callType} call`, `${caller.full_name} is calling you on RIKZEN CHAT`, {
    callId: id,
    callerId: uid,
    callType,
  });
  res.status(201).json({ callId: id });
});

appRouter.post('/calls/:id/status', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(req.params.id) as any;
  if (!call || (call.caller_id !== uid && call.callee_id !== uid)) {
    res.status(404).json({ error: 'Call record not found.' });
    return;
  }
  const { status, durationSeconds } = req.body || {};
  if (!['ringing', 'connected', 'ended', 'missed', 'rejected', 'busy'].includes(status)) {
    res.status(400).json({ error: 'Invalid call status.' });
    return;
  }
  const endedAt = ['ended', 'missed', 'rejected', 'busy'].includes(status) ? new Date().toISOString() : null;
  db.prepare('UPDATE calls SET status = ?, ended_at = COALESCE(?, ended_at), duration_seconds = COALESCE(?, duration_seconds) WHERE id = ?').run(
    status,
    endedAt,
    typeof durationSeconds === 'number' ? durationSeconds : null,
    call.id
  );
  res.json({ ok: true });
});

appRouter.get('/calls', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const rows = db
    .prepare(
      `SELECT c.*,
              caller.full_name AS caller_name, caller.avatar_url AS caller_avatar, caller.rikzen_id AS caller_rikzen_id,
              callee.full_name AS callee_name, callee.avatar_url AS callee_avatar, callee.rikzen_id AS callee_rikzen_id
       FROM calls c
       JOIN profiles caller ON caller.id = c.caller_id
       JOIN profiles callee ON callee.id = c.callee_id
       WHERE c.caller_id = ? OR c.callee_id = ?
       ORDER BY c.started_at DESC LIMIT 50`
    )
    .all(uid, uid);
  res.json({ calls: rows });
});

appRouter.get('/notifications', requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
    .all(req.userId!) as any[];
  res.json({
    notifications: rows.map((n) => ({ ...n, data: safeJsonParse(n.data, {}), isRead: Boolean(n.is_read) })),
  });
});

appRouter.post('/notifications/read-all', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId!);
  res.json({ ok: true });
});

appRouter.get('/devices', requireAuth, (req: AuthedRequest, res) => {
  const devices = db
    .prepare('SELECT id, device_name, platform, last_active_at, created_at FROM user_devices WHERE user_id = ? ORDER BY last_active_at DESC')
    .all(req.userId!)
    .map((d: any) => ({ ...d, isCurrent: d.id === req.deviceId }));
  res.json({ devices });
});

appRouter.delete('/devices/:deviceId', requireAuth, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM user_devices WHERE id = ? AND user_id = ?').run(req.params.deviceId, req.userId!);
  res.json({ ok: true });
});

appRouter.post('/reports', requireAuth, (req: AuthedRequest, res) => {
  const { targetType, targetId, reason } = req.body || {};
  if (!targetType || !targetId || !String(reason || '').trim()) {
    res.status(400).json({ error: 'Report details are required.' });
    return;
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO reports (id, reporter_id, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id,
    req.userId!,
    targetType,
    targetId,
    String(reason).trim(),
    new Date().toISOString()
  );
  res.status(201).json({ id });
});

appRouter.post('/broadcasts', requireAuth, (req: AuthedRequest, res) => {
  const uid = req.userId!;
  const { recipientIds = [], content = '' } = req.body || {};
  if (!Array.isArray(recipientIds) || recipientIds.length === 0 || !String(content).trim()) {
    res.status(400).json({ error: 'Select at least one friend and enter a broadcast message.' });
    return;
  }
  const now = new Date().toISOString();
  const sender = db.prepare('SELECT full_name, avatar_url FROM profiles WHERE id = ?').get(uid) as any;
  let sentCount = 0;

  for (const rid of recipientIds) {
    if (!areFriends(uid, rid) || isBlockedBetween(uid, rid)) continue;
    const convId = ensureDirectConversation(uid, rid);
    const msgId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO messages (id, conversation_id, sender_id, content, message_type, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'text', '{"broadcast":true}', ?, ?)`
    ).run(msgId, convId, uid, String(content).trim(), now, now);
    db.prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(now, convId);
    db.prepare('INSERT INTO message_receipts (message_id, user_id, delivered_at) VALUES (?, ?, ?)').run(
      msgId,
      rid,
      isUserOnline(rid) ? now : null
    );
    const row = db
      .prepare('SELECT m.*, p.full_name AS sender_name, p.avatar_url AS sender_avatar FROM messages m JOIN profiles p ON p.id = m.sender_id WHERE m.id = ?')
      .get(msgId);
    sendToUsers([uid, rid], 'message:new', formatMessageRow(row, uid));
    sentCount++;
  }
  res.json({ sentCount });
});

// ----------------------------------------------------------------------------
// Server-Verified Admin Dashboard
// ----------------------------------------------------------------------------
appRouter.get('/admin/overview', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const totalUsers = (db.prepare('SELECT COUNT(*) AS cnt FROM profiles').get() as { cnt: number }).cnt;
  const activeUsers = (db.prepare('SELECT COUNT(*) AS cnt FROM profiles WHERE is_online = 1').get() as { cnt: number }).cnt;
  const totalMessages = (db.prepare('SELECT COUNT(*) AS cnt FROM messages').get() as { cnt: number }).cnt;
  const totalGroups = (db.prepare('SELECT COUNT(*) AS cnt FROM groups').get() as { cnt: number }).cnt;
  const totalChannels = (db.prepare('SELECT COUNT(*) AS cnt FROM channels').get() as { cnt: number }).cnt;

  const users = db
    .prepare(
      'SELECT id, rikzen_id, email, full_name, avatar_url, is_suspended, is_online, last_seen_at, created_at FROM profiles ORDER BY created_at DESC LIMIT 100'
    )
    .all();

  const reports = db
    .prepare(
      `SELECT r.*, p.full_name AS reporter_name, p.rikzen_id AS reporter_rikzen_id
       FROM reports r JOIN profiles p ON p.id = r.reporter_id ORDER BY r.created_at DESC LIMIT 100`
    )
    .all();

  const groups = db.prepare('SELECT id, name, description, created_at FROM groups ORDER BY created_at DESC LIMIT 50').all();
  const channels = db.prepare('SELECT id, name, description, is_verified, created_at FROM channels ORDER BY created_at DESC LIMIT 50').all();
  const settings = db.prepare('SELECT key, value FROM app_settings').all();

  res.json({
    stats: { totalUsers, activeUsers, totalMessages, totalGroups, totalChannels },
    users,
    reports,
    groups,
    channels,
    settings,
  });
});

appRouter.patch('/admin/users/:id/suspend', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { suspended } = req.body || {};
  if (req.params.id === req.userId) {
    res.status(400).json({ error: 'Cannot suspend your own admin account.' });
    return;
  }
  db.prepare('UPDATE profiles SET is_suspended = ? WHERE id = ?').run(suspended ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

appRouter.patch('/admin/reports/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { status } = req.body || {};
  if (!['open', 'reviewed', 'resolved', 'dismissed'].includes(status)) {
    res.status(400).json({ error: 'Invalid status.' });
    return;
  }
  db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

appRouter.delete('/admin/groups/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

appRouter.delete('/admin/channels/:id', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

appRouter.patch('/admin/settings', requireAuth, requireAdmin, (req: AuthedRequest, res) => {
  const { key, value } = req.body || {};
  if (!key) {
    res.status(400).json({ error: 'Setting key required.' });
    return;
  }
  db.prepare(
    'INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  ).run(String(key), String(value ?? ''), new Date().toISOString());
  res.json({ ok: true });
});
