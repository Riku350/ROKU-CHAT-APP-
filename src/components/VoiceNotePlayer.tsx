import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Pause, Play } from 'lucide-react';
import { downloadMediaFile, formatMediaDuration } from '../lib/mediaUtils';

interface VoiceNotePlayerProps {
  src: string;
  durationSeconds?: number;
  fileName?: string;
  mimeType?: string;
  compact?: boolean;
  onDownload?: () => void;
}

const WAVEFORM_BARS = [32, 54, 42, 78, 92, 60, 44, 70, 88, 52, 38, 66, 84, 58, 40, 74, 62, 48, 80, 56, 36, 64, 48, 34];

export const VoiceNotePlayer: React.FC<VoiceNotePlayerProps> = ({
  src,
  durationSeconds,
  fileName,
  mimeType,
  compact = false,
  onDownload,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number>(
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setErrorMsg(null);
    setDuration(
      typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
        ? durationSeconds
        : 0
    );
  }, [src, durationSeconds]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleLoaded = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const handleTime = () => {
      setCurrentTime(audio.currentTime || 0);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        setDuration(audio.duration);
      }
    };
    const handleEnded = () => {
      setPlaying(false);
      setCurrentTime(0);
    };
    const handleError = () => {
      setPlaying(false);
      setErrorMsg('Audio unavailable');
    };

    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('durationchange', handleLoaded);
    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('durationchange', handleLoaded);
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [src]);

  const togglePlay = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    setErrorMsg(null);
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setErrorMsg('Tap again to play');
    }
  };

  const handleSeek = (ratio: number) => {
    const audio = audioRef.current;
    const total = duration > 0 ? duration : Number.isFinite(audio?.duration) ? audio!.duration : 0;
    if (!audio || !total) return;
    const next = Math.max(0, Math.min(total, ratio * total));
    audio.currentTime = next;
    setCurrentTime(next);
  };

  const progressRatio = useMemo(() => {
    if (!duration || duration <= 0) return 0;
    return Math.max(0, Math.min(1, currentTime / duration));
  }, [currentTime, duration]);

  const activeBars = Math.round(progressRatio * WAVEFORM_BARS.length);

  return (
    <div className={`flex items-center gap-2.5 ${compact ? 'min-w-[190px]' : 'min-w-[225px] max-w-[300px]'}`}>
      <audio ref={audioRef} preload="metadata" playsInline className="hidden">
        <source src={src} type={mimeType || undefined} />
      </audio>

      <button
        type="button"
        onClick={togglePlay}
        title={playing ? 'Pause voice note' : 'Play voice note'}
        className="w-9 h-9 rounded-full bg-[#D4AF37] text-[#0B0B0E] flex items-center justify-center shrink-0 hover:bg-[#E8C868] transition-colors cursor-pointer shadow-sm"
      >
        {playing ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          role="slider"
          aria-label="Audio seek progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progressRatio * 100)}
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
            handleSeek(ratio);
          }}
          className="h-6 flex items-center gap-[3px] cursor-pointer select-none"
        >
          {WAVEFORM_BARS.map((height, idx) => (
            <span
              key={idx}
              style={{ height: `${Math.max(22, height)}%` }}
              className={`flex-1 rounded-full transition-colors ${
                idx < activeBars ? 'bg-[#D4AF37]' : 'bg-[#7A7A86]/50'
              }`}
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-[#9A9AA6] tabular-nums mt-0.5">
          <span>{errorMsg || formatMediaDuration(playing || currentTime > 0 ? currentTime : duration)}</span>
          {duration > 0 && !errorMsg && (playing || currentTime > 0) && (
            <span>{formatMediaDuration(duration)}</span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => (onDownload ? onDownload() : downloadMediaFile(src, fileName || `voice-${Date.now()}.webm`))}
        title="Download audio"
        className="w-7 h-7 rounded-full border border-[#2B2B33] text-[#9A9AA6] hover:text-[#D4AF37] hover:border-[#D4AF37]/50 flex items-center justify-center shrink-0 cursor-pointer transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
