import { handleFirebaseApiFallback, uploadFileToFirebaseStorage } from '../lib/firebaseBackend';

const TOKEN_KEY = 'rikzen_auth_token';
const UNSENT_QUEUE_KEY = 'rikzen_unsent_queue';

let serverlessFirebaseMode = false;

export function isServerlessFirebaseMode(): boolean {
  return serverlessFirebaseMode;
}

export function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  if (serverlessFirebaseMode) {
    return handleFirebaseApiFallback<T>(path, options);
  }

  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (!(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  try {
    res = await fetch(path, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    serverlessFirebaseMode = true;
    return handleFirebaseApiFallback<T>(path, options);
  }

  const contentType = res.headers.get('content-type') || '';
  if (res.status === 404 || !contentType.includes('application/json')) {
    serverlessFirebaseMode = true;
    return handleFirebaseApiFallback<T>(path, options);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/register') {
      setStoredToken(null);
    }
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data as T;
}

export async function uploadMediaFile(file: File | Blob, filename = 'upload.bin'): Promise<{
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  if (serverlessFirebaseMode) {
    return uploadFileToFirebaseStorage(file, filename);
  }
  const form = new FormData();
  form.append('file', file, filename);
  try {
    const token = getStoredToken();
    const headers = new Headers();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const res = await fetch('/api/uploads', {
      method: 'POST',
      body: form,
      headers,
      credentials: 'include',
    });
    const contentType = res.headers.get('content-type') || '';
    if (res.status === 404 || !contentType.includes('application/json')) {
      serverlessFirebaseMode = true;
      return uploadFileToFirebaseStorage(file, filename);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || `Upload failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (serverlessFirebaseMode) {
      return uploadFileToFirebaseStorage(file, filename);
    }
    throw err;
  }
}

export interface QueuedUnsentMessage {
  tempId: string;
  conversationId: string;
  content: string;
  messageType: string;
  replyToId?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
}

export function getUnsentQueue(): QueuedUnsentMessage[] {
  try {
    const raw = localStorage.getItem(UNSENT_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueUnsentMessage(item: QueuedUnsentMessage): void {
  const queue = getUnsentQueue();
  queue.push(item);
  localStorage.setItem(UNSENT_QUEUE_KEY, JSON.stringify(queue));
}

export function removeUnsentMessage(tempId: string): void {
  const queue = getUnsentQueue().filter((q) => q.tempId !== tempId);
  localStorage.setItem(UNSENT_QUEUE_KEY, JSON.stringify(queue));
}

export function clearRikzenLocalCache(): void {
  try {
    localStorage.removeItem(UNSENT_QUEUE_KEY);
  } catch {
    // ignore
  }
}

export type RealtimeListener = (event: string, payload: any) => void;

export class RikzenRealtimeClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<RealtimeListener>();
  private reconnectTimer: number | null = null;
  private closedManually = false;

  connect(): void {
    if (serverlessFirebaseMode) {
      return;
    }
    this.closedManually = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = getStoredToken();
    const qs = token ? `?token=${encodeURIComponent(token)}` : '';
    const url = `${protocol}//${window.location.host}/ws${qs}`;

    const socket = new WebSocket(url);
    this.ws = socket;

    socket.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        for (const fn of this.listeners) {
          fn(parsed.event, parsed.payload);
        }
      } catch {
        // Ignore malformed
      }
    };

    socket.onclose = () => {
      this.ws = null;
      if (!this.closedManually && !serverlessFirebaseMode) {
        this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
      }
    };
  }

  disconnect(): void {
    this.closedManually = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  send(event: string, payload: Record<string, any>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event, payload }));
    }
  }

  subscribe(fn: RealtimeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const realtime = new RikzenRealtimeClient();

export function triggerDesktopNotification(title: string, body: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted' && document.hidden) {
    try {
      new Notification(title, { body });
    } catch {
      // Ignore if blocked by platform
    }
  }
}
