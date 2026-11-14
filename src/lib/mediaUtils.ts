export type UploadCategory =
  | 'profile-photos'
  | 'chat-media'
  | 'chat-documents'
  | 'voice-messages'
  | 'user-status'
  | 'uploads';

export interface AudioFormatChoice {
  mimeType: string;
  ext: string;
}

export function detectSupportedAudioMime(): AudioFormatChoice | null {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null;
  }
  const candidates: AudioFormatChoice[] = [
    { mimeType: 'audio/webm;codecs=opus', ext: 'webm' },
    { mimeType: 'audio/webm', ext: 'webm' },
    { mimeType: 'audio/mp4', ext: 'm4a' },
    { mimeType: 'audio/ogg;codecs=opus', ext: 'ogg' },
    { mimeType: 'audio/aac', ext: 'aac' },
  ];
  if (typeof MediaRecorder.isTypeSupported === 'function') {
    for (const candidate of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(candidate.mimeType)) {
          return candidate;
        }
      } catch {
        // Ignore unsupported check error
      }
    }
  }
  return { mimeType: 'audio/webm', ext: 'webm' };
}

export function formatMediaDuration(seconds?: number | null): string {
  const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0 ? Math.floor(seconds) : 0;
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export async function extractVideoMetadata(
  file: File | Blob
): Promise<{ durationSeconds: number; thumbnailBlob: Blob | null }> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    return { durationSeconds: 0, thumbnailBlob: null };
  }

  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    let finished = false;
    const cleanup = (result: { durationSeconds: number; thumbnailBlob: Blob | null }) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(objectUrl);
      resolve(result);
    };

    const timer = window.setTimeout(() => {
      const dur = Number.isFinite(video.duration) ? Math.round(video.duration) : 0;
      cleanup({ durationSeconds: dur, thumbnailBlob: null });
    }, 4500);

    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : 0;
      const targetTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(1, video.duration / 2) : 0;
      try {
        video.currentTime = targetTime;
      } catch {
        cleanup({ durationSeconds: dur, thumbnailBlob: null });
      }
    };

    video.onseeked = () => {
      const dur = Number.isFinite(video.duration) ? Math.max(0, Math.round(video.duration)) : 0;
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        const scale = Math.min(1, 640 / Math.max(vw, vh));
        const width = Math.max(1, Math.round(vw * scale));
        const height = Math.max(1, Math.round(vh * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup({ durationSeconds: dur, thumbnailBlob: null });
          return;
        }
        ctx.drawImage(video, 0, 0, width, height);
        canvas.toBlob(
          (blob) => cleanup({ durationSeconds: dur, thumbnailBlob: blob }),
          'image/jpeg',
          0.78
        );
      } catch {
        cleanup({ durationSeconds: dur, thumbnailBlob: null });
      }
    };

    video.onerror = () => {
      cleanup({ durationSeconds: 0, thumbnailBlob: null });
    };

    video.src = objectUrl;
  });
}

export async function downloadMediaFile(url: string, filename?: string): Promise<void> {
  if (!url) return;
  const fallbackName =
    filename ||
    url.split('?')[0].split('/').pop() ||
    `rikzen-file-${Date.now()}`;

  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('Fetch failed');
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = fallbackName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
  } catch {
    const link = document.createElement('a');
    link.href = url;
    link.download = fallbackName;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
}
