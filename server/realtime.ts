import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { verifySessionToken, COOKIE_NAME } from './auth.ts';
import { db } from './db.ts';

interface AuthedSocket extends WebSocket {
  userId?: string;
  deviceId?: string;
  isAlive?: boolean;
}

const userSockets = new Map<string, Set<AuthedSocket>>();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const k = part.slice(0, idx).trim();
      const v = decodeURIComponent(part.slice(idx + 1).trim());
      result[k] = v;
    }
  }
  return result;
}

export function sendToUser(userId: string, event: string, payload: unknown): void {
  const sockets = userSockets.get(userId);
  if (!sockets || sockets.size === 0) return;
  const serialized = JSON.stringify({ event, payload });
  for (const sock of sockets) {
    if (sock.readyState === WebSocket.OPEN) {
      sock.send(serialized);
    }
  }
}

export function sendToUsers(userIds: string[], event: string, payload: unknown): void {
  const unique = new Set(userIds);
  for (const uid of unique) {
    sendToUser(uid, event, payload);
  }
}

export function isUserOnline(userId: string): boolean {
  const sockets = userSockets.get(userId);
  return Boolean(sockets && sockets.size > 0);
}

function broadcastPresence(userId: string, isOnline: boolean): void {
  const friendRows = db
    .prepare(
      `SELECT CASE WHEN user_one = ? THEN user_two ELSE user_one END AS friend_id
       FROM friendships WHERE user_one = ? OR user_two = ?`
    )
    .all(userId, userId, userId) as Array<{ friend_id: string }>;

  const lastSeenAt = new Date().toISOString();
  db.prepare('UPDATE profiles SET is_online = ?, last_seen_at = ? WHERE id = ?').run(
    isOnline ? 1 : 0,
    lastSeenAt,
    userId
  );

  const profile = db
    .prepare('SELECT privacy_settings FROM profiles WHERE id = ?')
    .get(userId) as { privacy_settings: string } | undefined;
  let onlinePrivacy = 'everyone';
  try {
    const parsed = JSON.parse(profile?.privacy_settings || '{}');
    onlinePrivacy = parsed.onlineStatus || 'everyone';
  } catch {
    onlinePrivacy = 'everyone';
  }

  if (onlinePrivacy === 'nobody') return;

  sendToUsers(
    friendRows.map((r) => r.friend_id),
    'presence:update',
    { userId, isOnline, lastSeenAt }
  );
}

export function initRealtimeServer(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: AuthedSocket, req) => {
    const url = new URL(req.url || '/ws', 'http://localhost');
    const queryToken = url.searchParams.get('token') || undefined;
    const cookies = parseCookies(req.headers.cookie);
    const token = queryToken || cookies[COOKIE_NAME];
    const session = verifySessionToken(token);

    if (!session) {
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.userId = session.uid;
    ws.deviceId = session.deviceId;
    ws.isAlive = true;

    if (!userSockets.has(session.uid)) {
      userSockets.set(session.uid, new Set());
    }
    const set = userSockets.get(session.uid)!;
    const wasOffline = set.size === 0;
    set.add(ws);

    if (wasOffline) {
      broadcastPresence(session.uid, true);
    }

    ws.send(JSON.stringify({ event: 'ws:ready', payload: { userId: session.uid } }));

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { event: string; payload: Record<string, any> };
        const uid = ws.userId;
        if (!uid) return;

        switch (msg.event) {
          case 'typing:start':
          case 'typing:stop': {
            const { conversationId } = msg.payload || {};
            if (!conversationId) return;
            const members = db
              .prepare('SELECT user_id FROM conversation_members WHERE conversation_id = ?')
              .all(conversationId) as Array<{ user_id: string }>;
            const memberIds = members.map((m) => m.user_id);
            if (!memberIds.includes(uid)) return;
            sendToUsers(
              memberIds.filter((id) => id !== uid),
              msg.event,
              { conversationId, userId: uid }
            );
            break;
          }

          // WebRTC Signaling Relay (server-validated caller/callee)
          case 'call:invite': {
            const { callId, calleeId, callType } = msg.payload || {};
            if (!callId || !calleeId) return;
            const caller = db
              .prepare('SELECT id, full_name, rikzen_id, avatar_url FROM profiles WHERE id = ?')
              .get(uid);
            sendToUser(calleeId, 'call:incoming', {
              callId,
              callerId: uid,
              caller,
              callType: callType === 'video' ? 'video' : 'voice',
            });
            break;
          }

          case 'call:accept':
          case 'call:reject':
          case 'call:end':
          case 'webrtc:offer':
          case 'webrtc:answer':
          case 'webrtc:ice-candidate': {
            const { targetUserId, callId, data } = msg.payload || {};
            if (!targetUserId) return;
            if (msg.event === 'call:accept' && callId) {
              db.prepare("UPDATE calls SET status = 'connected' WHERE id = ?").run(callId);
            } else if (msg.event === 'call:reject' && callId) {
              db.prepare("UPDATE calls SET status = 'rejected', ended_at = ? WHERE id = ?").run(
                new Date().toISOString(),
                callId
              );
            } else if (msg.event === 'call:end' && callId) {
              const callRow = db
                .prepare('SELECT started_at, status FROM calls WHERE id = ?')
                .get(callId) as { started_at: string; status: string } | undefined;
              const nowIso = new Date().toISOString();
              const dur =
                callRow && callRow.status === 'connected'
                  ? Math.max(1, Math.round((Date.now() - new Date(callRow.started_at).getTime()) / 1000))
                  : 0;
              const nextStatus = callRow?.status === 'ringing' ? 'missed' : 'ended';
              db.prepare('UPDATE calls SET status = ?, ended_at = ?, duration_seconds = ? WHERE id = ?').run(
                nextStatus,
                nowIso,
                dur,
                callId
              );
            }
            sendToUser(targetUserId, msg.event, {
              fromUserId: uid,
              callId,
              data,
            });
            break;
          }

          default:
            break;
        }
      } catch {
        // Ignore malformed WS payloads
      }
    });

    ws.on('close', () => {
      if (!ws.userId) return;
      const sockets = userSockets.get(ws.userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          userSockets.delete(ws.userId);
          broadcastPresence(ws.userId, false);
        }
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients as Set<AuthedSocket>) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
  }, 25000);

  wss.on('close', () => clearInterval(heartbeat));
  return wss;
}
