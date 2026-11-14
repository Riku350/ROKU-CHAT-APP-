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

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp', 'svg',
  'mp4', 'webm', 'mov', 'm4v', '3gp',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus', 'flac',
  'pdf', 'doc', 'docx', 'txt', 'csv', 'rtf', 'zip', 'xls', 'xlsx', 'ppt', 'pptx',
]);

export function validateUploadFile(file: File | Blob, filename = 'upload.bin'): void {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('File size exceeds the 25 MB limit.');
  }
  const mime = (file.type || '').toLowerCase();
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const mimeOk =
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime === 'application/pdf' ||
    mime.includes('word') ||
    mime.includes('document') ||
    mime.includes('spreadsheet') ||
    mime.includes('presentation') ||
    mime === 'text/plain' ||
    mime === 'text/csv' ||
    mime === 'application/zip' ||
    mime === 'application/octet-stream' ||
    mime === '';
  if (!mimeOk && !ALLOWED_UPLOAD_EXTS.has(ext)) {
    throw new Error(`Unsupported file format (${ext || mime}).`);
  }
}

export async function uploadMediaFile(
  file: File | Blob,
  filename = 'upload.bin',
  onProgress?: (percent: number) => void
): Promise<{
  fileUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}> {
  validateUploadFile(file, filename);

  if (serverlessFirebaseMode) {
    return uploadFileToFirebaseStorage(file, filename, onProgress);
  }

  const form = new FormData();
  form.append('file', file, filename);
  const token = getStoredToken();

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads', true);
    xhr.withCredentials = true;
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && onProgress) {
        onProgress(Math.min(99, Math.round((evt.loaded / evt.total) * 100)));
      }
    };

    xhr.onload = async () => {
      const contentType = xhr.getResponseHeader('content-type') || '';
      if (xhr.status === 404 || !contentType.includes('application/json')) {
        serverlessFirebaseMode = true;
        try {
          const fbRes = await uploadFileToFirebaseStorage(file, filename, onProgress);
          resolve(fbRes);
        } catch (fbErr) {
          reject(fbErr);
        }
        return;
      }

      let data: any = {};
      try {
        data = JSON.parse(xhr.responseText || '{}');
      } catch {
        data = {};
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(data.error || `Upload failed (${xhr.status})`));
        return;
      }
      onProgress?.(100);
      resolve(data);
    };

    xhr.onerror = async () => {
      if (serverlessFirebaseMode) {
        try {
          const fbRes = await uploadFileToFirebaseStorage(file, filename, onProgress);
          resolve(fbRes);
        } catch (fbErr) {
          reject(fbErr);
        }
        return;
      }
      reject(new Error('Network error while uploading file.'));
    };

    xhr.send(form);
  });
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
