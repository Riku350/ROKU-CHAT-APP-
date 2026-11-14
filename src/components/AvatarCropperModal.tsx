import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, RotateCcw, Trash2, X, ZoomIn } from 'lucide-react';
import { uploadMediaFile } from '../services/api';

interface AvatarCropperModalProps {
  currentAvatarUrl: string | null;
  onSave: (newAvatarUrl: string | null) => Promise<void> | void;
  onClose: () => void;
}

export const AvatarCropperModal: React.FC<AvatarCropperModalProps> = ({
  currentAvatarUrl,
  onSave,
  onClose,
}) => {
  const [sourceUrl, setSourceUrl] = useState<string | null>(currentAvatarUrl);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
  };

  useEffect(() => {
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    setUploadError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Camera access is not supported in this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 640 } },
      });
      streamRef.current = stream;
      setCameraActive(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 60);
    } catch (err: any) {
      setCameraError(err?.message || 'Camera permission denied or unavailable.');
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current) return;
    const v = videoRef.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth || 480;
    c.height = v.videoHeight || 480;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.92);
    setSourceUrl(dataUrl);
    setDirty(true);
    setUploadError(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    stopCamera();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    const reader = new FileReader();
    reader.onload = () => {
      setSourceUrl(String(reader.result));
      setDirty(true);
      setZoom(1);
      setOffset({ x: 0, y: 0 });
    };
    reader.onerror = () => {
      setUploadError('Could not read selected image file.');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleConfirmSave = async () => {
    setUploadError(null);
    setUploadProgress(0);
    setSaving(true);
    try {
      if (!sourceUrl) {
        await onSave(null);
        onClose();
        return;
      }

      if (!dirty && currentAvatarUrl && sourceUrl === currentAvatarUrl && zoom === 1 && offset.x === 0 && offset.y === 0) {
        await onSave(currentAvatarUrl);
        onClose();
        return;
      }

      let uploadedUrl = sourceUrl;
      if (imgRef.current && imgRef.current.naturalWidth > 0) {
        const canvas = document.createElement('canvas');
        const size = 400;
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const img = imgRef.current;
          const baseScale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
          const finalScale = baseScale * zoom;
          const drawW = img.naturalWidth * finalScale;
          const drawH = img.naturalHeight * finalScale;
          const factor = size / 240;
          const dx = (size - drawW) / 2 + offset.x * factor;
          const dy = (size - drawH) / 2 + offset.y * factor;
          ctx.fillStyle = '#09090B';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, dx, dy, drawW, drawH);

          let blob: Blob | null = null;
          try {
            blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.9)
            );
          } catch {
            throw new Error('Please choose a photo from Gallery or Camera to crop and save.');
          }

          if (!blob) {
            throw new Error('Failed to prepare cropped image.');
          }
          const uploaded = await uploadMediaFile(
            blob,
            `avatar-${Date.now()}.jpg`,
            (pct) => setUploadProgress(pct),
            'profile-photos'
          );
          uploadedUrl = uploaded.fileUrl;
        }
      } else if (sourceUrl.startsWith('data:') || sourceUrl.startsWith('blob:')) {
        throw new Error('Selected photo is still loading. Please try again.');
      }

      await onSave(uploadedUrl);
      onClose();
    } catch (err: any) {
      setUploadError(err?.message || 'Failed to upload profile picture. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-6 text-[#F5F5F7] shadow-2xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <h3 className="font-display text-lg font-semibold">Profile Picture</h3>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[#9898A6] hover:bg-white/5 hover:text-white cursor-pointer"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-5 flex flex-col items-center">
          {cameraActive ? (
            <div className="relative flex flex-col items-center gap-3">
              <div className="h-60 w-60 overflow-hidden rounded-full border-2 border-[#D4AF37]">
                <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="min-h-[44px] rounded-xl bg-[#D4AF37] px-5 py-2 text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B] cursor-pointer"
                >
                  Capture Photo
                </button>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="min-h-[44px] rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/5 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div
                className="relative h-60 w-60 cursor-grab overflow-hidden rounded-full border-2 border-[#D4AF37]/60 bg-[#09090B] active:cursor-grabbing"
                onPointerDown={(e) => {
                  if (!sourceUrl) return;
                  setDragging(true);
                  setDirty(true);
                  dragStart.current = { x: e.clientX - offset.x, y: e.clientY - offset.y };
                }}
                onPointerMove={(e) => {
                  if (!dragging) return;
                  setOffset({ x: e.clientX - dragStart.current.x, y: e.clientY - dragStart.current.y });
                }}
                onPointerUp={() => setDragging(false)}
                onPointerLeave={() => setDragging(false)}
              >
                {sourceUrl ? (
                  <img
                    ref={imgRef}
                    src={sourceUrl}
                    alt="Avatar crop preview"
                    crossOrigin={sourceUrl.startsWith('data:') ? undefined : 'anonymous'}
                    referrerPolicy="no-referrer"
                    draggable={false}
                    className="pointer-events-none h-full w-full object-cover"
                    style={{
                      transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
                      transformOrigin: 'center center',
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center text-xs text-[#9898A6]">
                    <ImagePlus size={32} className="mb-2 text-[#D4AF37]/70" />
                    <span>No picture selected</span>
                  </div>
                )}
              </div>

              {sourceUrl && (
                <div className="mt-4 flex w-full items-center gap-3 px-2">
                  <ZoomIn size={16} className="text-[#D4AF37]" />
                  <input
                    type="range"
                    min={1}
                    max={2.6}
                    step={0.05}
                    value={zoom}
                    onChange={(e) => {
                      setZoom(Number(e.target.value));
                      setDirty(true);
                    }}
                    className="w-full accent-[#D4AF37]"
                    aria-label="Zoom avatar"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setZoom(1);
                      setOffset({ x: 0, y: 0 });
                    }}
                    className="min-h-[40px] rounded-lg px-2 text-xs text-[#9898A6] hover:text-white cursor-pointer"
                  >
                    <RotateCcw size={15} />
                  </button>
                </div>
              )}
            </>
          )}

          {(cameraError || uploadError) && (
            <div className="mt-3 w-full rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-center text-xs text-red-300">
              {cameraError || uploadError}
            </div>
          )}

          {saving && uploadProgress > 0 && (
            <div className="mt-3 w-full">
              <div className="flex justify-between text-[11px] text-[#9898A6] mb-1">
                <span>Uploading photo...</span>
                <span>{uploadProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-[#D4AF37] transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="mt-5 grid w-full grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/5 px-3 text-xs font-medium hover:border-[#D4AF37]/40 hover:bg-white/10 cursor-pointer"
            >
              <ImagePlus size={15} />
              <span>Gallery</span>
            </button>
            <button
              type="button"
              onClick={startCamera}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-white/12 bg-white/5 px-3 text-xs font-medium hover:border-[#D4AF37]/40 hover:bg-white/10 cursor-pointer"
            >
              <Camera size={15} />
              <span>Camera</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setSourceUrl(null);
                setDirty(true);
                setUploadError(null);
              }}
              className="flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-red-500/25 bg-red-500/10 px-3 text-xs font-medium text-red-300 hover:bg-red-500/20 cursor-pointer"
            >
              <Trash2 size={15} />
              <span>Remove</span>
            </button>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={handleConfirmSave}
            className="mt-5 flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-[#09090B] transition hover:bg-[#E5C76B] disabled:opacity-50 cursor-pointer"
          >
            <Check size={16} />
            <span>{saving ? 'Saving Picture...' : sourceUrl ? 'Save Profile Picture' : 'Remove Profile Picture'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
