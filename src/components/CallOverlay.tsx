import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, RefreshCw, Video, VideoOff } from 'lucide-react';
import { realtime } from '../services/api';

export interface ActiveCallSession {
  callId: string;
  peerId: string;
  peerName: string;
  peerAvatar: string | null;
  callType: 'voice' | 'video';
  direction: 'outgoing' | 'incoming';
  status: 'ringing' | 'connected';
}

interface CallOverlayProps {
  call: ActiveCallSession;
  onUpdateStatus: (status: 'connected') => void;
  onClose: () => void;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({ call, onUpdateStatus, onClose }) => {
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.callType === 'voice');
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [elapsed, setElapsed] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);

  const cleanupMedia = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  };

  const setupPeerConnection = async (isCaller: boolean) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: call.callType === 'video' ? { facingMode } : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current && call.callType === 'video') {
        localVideoRef.current.srcObject = stream;
      }

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.ontrack = (event) => {
        const [remoteStream] = event.streams;
        if (!remoteStream) return;
        if (remoteVideoRef.current && call.callType === 'video') {
          remoteVideoRef.current.srcObject = remoteStream;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
        }
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          realtime.send('webrtc:ice-candidate', {
            targetUserId: call.peerId,
            callId: call.callId,
            data: event.candidate.toJSON(),
          });
        }
      };

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        realtime.send('webrtc:offer', {
          targetUserId: call.peerId,
          callId: call.callId,
          data: offer,
        });
      }

      return pc;
    } catch (err: any) {
      setMediaError(err?.message || 'Microphone or camera permission is required for calls.');
      return null;
    }
  };

  useEffect(() => {
    if (call.direction === 'outgoing') {
      realtime.send('call:invite', {
        callId: call.callId,
        calleeId: call.peerId,
        callType: call.callType,
      });
    }

    const unsub = realtime.subscribe(async (event, payload) => {
      if (payload?.callId && payload.callId !== call.callId) return;

      if (event === 'call:accept') {
        onUpdateStatus('connected');
        await setupPeerConnection(true);
      } else if (event === 'call:reject' || event === 'call:end') {
        cleanupMedia();
        onClose();
      } else if (event === 'webrtc:offer') {
        const pc = pcRef.current || (await setupPeerConnection(false));
        if (!pc) return;
        await pc.setRemoteDescription(new RTCSessionDescription(payload.data));
        for (const c of pendingCandidates.current) {
          await pc.addIceCandidate(new RTCIceCandidate(c));
        }
        pendingCandidates.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        realtime.send('webrtc:answer', {
          targetUserId: call.peerId,
          callId: call.callId,
          data: answer,
        });
      } else if (event === 'webrtc:answer') {
        if (pcRef.current && payload.data) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(payload.data));
        }
      } else if (event === 'webrtc:ice-candidate') {
        if (payload.data) {
          if (pcRef.current && pcRef.current.remoteDescription) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(payload.data));
          } else {
            pendingCandidates.current.push(payload.data);
          }
        }
      }
    });

    return () => {
      unsub();
      cleanupMedia();
    };
  }, [call.callId]);

  useEffect(() => {
    if (call.status !== 'connected') return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [call.status]);

  const handleAcceptIncoming = async () => {
    onUpdateStatus('connected');
    await setupPeerConnection(false);
    realtime.send('call:accept', {
      targetUserId: call.peerId,
      callId: call.callId,
    });
  };

  const handleRejectOrEnd = () => {
    const evt = call.direction === 'incoming' && call.status === 'ringing' ? 'call:reject' : 'call:end';
    realtime.send(evt, {
      targetUserId: call.peerId,
      callId: call.callId,
    });
    cleanupMedia();
    onClose();
  };

  const toggleMic = () => {
    const next = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMicMuted(next);
  };

  const toggleCamera = () => {
    const next = !camOff;
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = !next;
    });
    setCamOff(next);
  };

  const switchCamera = async () => {
    if (call.callType !== 'video') return;
    const nextFacing = facingMode === 'user' ? 'environment' : 'user';
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
      });
      const newTrack = newStream.getVideoTracks()[0];
      const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
      if (sender && newTrack) {
        await sender.replaceTrack(newTrack);
      }
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;
      }
      setFacingMode(nextFacing);
    } catch {
      setMediaError('Unable to switch camera on this device.');
    }
  };

  const fmtTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#09090B]/95 p-6 text-white backdrop-blur-md">
      <audio ref={remoteAudioRef} autoPlay />

      {/* Top info */}
      <div className="mt-6 text-center">
        <p className="text-xs uppercase tracking-[0.22em] text-[#D4AF37]">
          RIKZEN {call.callType === 'video' ? 'Video Call' : 'Voice Call'}
        </p>
        <h2 className="mt-2 font-display text-2xl font-bold">{call.peerName}</h2>
        <p className="mt-1 text-sm tabular-nums text-[#9898A6]">
          {call.status === 'connected'
            ? fmtTime(elapsed)
            : call.direction === 'incoming'
            ? 'Incoming call...'
            : 'Ringing...'}
        </p>
        {mediaError && (
          <p className="mt-3 max-w-sm rounded-xl border border-red-500/30 bg-red-500/15 px-4 py-2 text-xs text-red-300">
            {mediaError}
          </p>
        )}
      </div>

      {/* Video Stage or Avatar */}
      <div className="relative flex w-full max-w-3xl flex-1 items-center justify-center my-6">
        {call.callType === 'video' && call.status === 'connected' ? (
          <div className="relative h-full max-h-[540px] w-full overflow-hidden rounded-3xl border border-[#D4AF37]/25 bg-black">
            <video ref={remoteVideoRef} autoPlay playsInline className="h-full w-full object-cover" />
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              className="absolute bottom-4 right-4 h-36 w-28 rounded-2xl border border-[#D4AF37]/50 bg-[#111115] object-cover shadow-xl"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className="h-36 w-36 overflow-hidden rounded-full border-2 border-[#D4AF37] shadow-[0_0_50px_rgba(212,175,55,0.2)]">
              {call.peerAvatar ? (
                <img src={call.peerAvatar} alt={call.peerName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-[#18181D] font-display text-5xl font-bold text-[#D4AF37]">
                  {call.peerName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mb-6 flex items-center gap-4">
        {call.direction === 'incoming' && call.status === 'ringing' ? (
          <>
            <button
              type="button"
              onClick={handleRejectOrEnd}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-500"
              aria-label="Reject call"
            >
              <PhoneOff size={24} />
            </button>
            <button
              type="button"
              onClick={handleAcceptIncoming}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-600 text-white shadow-lg hover:bg-emerald-500"
              aria-label="Accept call"
            >
              <Phone size={24} />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={toggleMic}
              className={`flex h-14 w-14 items-center justify-center rounded-full border transition ${
                micMuted ? 'border-red-500/40 bg-red-500/20 text-red-300' : 'border-white/15 bg-white/10 text-white'
              }`}
              aria-label={micMuted ? 'Unmute microphone' : 'Mute microphone'}
            >
              {micMuted ? <MicOff size={20} /> : <Mic size={20} />}
            </button>

            {call.callType === 'video' && (
              <>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`flex h-14 w-14 items-center justify-center rounded-full border transition ${
                    camOff ? 'border-red-500/40 bg-red-500/20 text-red-300' : 'border-white/15 bg-white/10 text-white'
                  }`}
                  aria-label={camOff ? 'Enable camera' : 'Disable camera'}
                >
                  {camOff ? <VideoOff size={20} /> : <Video size={20} />}
                </button>
                <button
                  type="button"
                  onClick={switchCamera}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white"
                  aria-label="Switch camera"
                >
                  <RefreshCw size={20} />
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleRejectOrEnd}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white shadow-lg hover:bg-red-500"
              aria-label="End call"
            >
              <PhoneOff size={22} />
            </button>
          </>
        )}
      </div>
    </div>
  );
};
