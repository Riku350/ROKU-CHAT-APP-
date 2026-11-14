import React, { useEffect, useRef, useState } from 'react';
import {
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneOff,
  PictureInPicture2,
  RefreshCw,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  sendCallSignalFirestore,
  subscribeCallSignalFirestore,
} from '../lib/firebaseBackend';
import { apiFetch, isServerlessFirebaseMode, realtime } from '../services/api';

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
  myUid: string;
  call: ActiveCallSession;
  onUpdateStatus: (status: 'connected') => void;
  onClose: () => void;
}

function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  const turnUrl = import.meta.env.VITE_TURN_URL;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: import.meta.env.VITE_TURN_USERNAME || undefined,
      credential: import.meta.env.VITE_TURN_CREDENTIAL || undefined,
    });
  }
  return servers;
}

export const CallOverlay: React.FC<CallOverlayProps> = ({
  myUid,
  call,
  onUpdateStatus,
  onClose,
}) => {
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(call.callType === 'voice');
  const [speakerOn, setSpeakerOn] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [elapsed, setElapsed] = useState(0);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingCandidates = useRef<RTCIceCandidateInit[]>([]);
  const elapsedRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  const cleanupMedia = () => {
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  };

  const closeWithMessage = (note: string | null) => {
    if (closedRef.current) return;
    closedRef.current = true;
    cleanupMedia();
    if (note) {
      setStatusNote(note);
      window.setTimeout(onClose, 1100);
    } else {
      onClose();
    }
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

      const pc = new RTCPeerConnection({ iceServers: getIceServers() });
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
        if (!event.candidate) return;
        const candJson = event.candidate.toJSON();
        if (isServerlessFirebaseMode()) {
          sendCallSignalFirestore(call.callId, { candidate: candJson });
        } else {
          realtime.send('webrtc:ice-candidate', {
            targetUserId: call.peerId,
            callId: call.callId,
            data: candJson,
          });
        }
      };

      if (isCaller) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (isServerlessFirebaseMode()) {
          await sendCallSignalFirestore(call.callId, {
            offerSdp: JSON.stringify(offer),
          });
        } else {
          realtime.send('webrtc:offer', {
            targetUserId: call.peerId,
            callId: call.callId,
            data: offer,
          });
        }
      }

      return pc;
    } catch (err: any) {
      setMediaError(err?.message || 'Microphone or camera permission is required for calls.');
      return null;
    }
  };

  const handleRemoteOffer = async (offer: RTCSessionDescriptionInit) => {
    const pc = pcRef.current || (await setupPeerConnection(false));
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    for (const c of pendingCandidates.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    }
    pendingCandidates.current = [];
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    if (isServerlessFirebaseMode()) {
      await sendCallSignalFirestore(call.callId, {
        answerSdp: JSON.stringify(answer),
      });
    } else {
      realtime.send('webrtc:answer', {
        targetUserId: call.peerId,
        callId: call.callId,
        data: answer,
      });
    }
  };

  const handleRemoteAnswer = async (answer: RTCSessionDescriptionInit) => {
    if (pcRef.current && !pcRef.current.currentRemoteDescription) {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      for (const c of pendingCandidates.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(c));
      }
      pendingCandidates.current = [];
    }
  };

  const handleRemoteCandidate = async (candidate: RTCIceCandidateInit) => {
    if (pcRef.current && pcRef.current.remoteDescription) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    } else {
      pendingCandidates.current.push(candidate);
    }
  };

  useEffect(() => {
    if (call.direction === 'outgoing' && !isServerlessFirebaseMode()) {
      realtime.send('call:invite', {
        callId: call.callId,
        calleeId: call.peerId,
        callType: call.callType,
      });
    }

    const unsubWs = realtime.subscribe(async (event, payload) => {
      if (payload?.callId && payload.callId !== call.callId) return;

      if (event === 'call:accept') {
        onUpdateStatus('connected');
        await setupPeerConnection(true);
      } else if (event === 'call:busy') {
        apiFetch(`/api/calls/${call.callId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'busy' }),
        }).catch(() => {});
        closeWithMessage('User is busy on another call');
      } else if (event === 'call:reject') {
        apiFetch(`/api/calls/${call.callId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'rejected' }),
        }).catch(() => {});
        closeWithMessage('Call declined');
      } else if (event === 'call:end') {
        closeWithMessage(null);
      } else if (event === 'webrtc:offer' && payload.data) {
        await handleRemoteOffer(payload.data);
      } else if (event === 'webrtc:answer' && payload.data) {
        await handleRemoteAnswer(payload.data);
      } else if (event === 'webrtc:ice-candidate' && payload.data) {
        await handleRemoteCandidate(payload.data);
      }
    });

    let unsubFb = () => {};
    if (isServerlessFirebaseMode()) {
      unsubFb = subscribeCallSignalFirestore(call.callId, myUid, {
        onStatus: async (st) => {
          if (st === 'connected' && call.direction === 'outgoing' && call.status === 'ringing') {
            onUpdateStatus('connected');
            await setupPeerConnection(true);
          } else if (st === 'busy') {
            closeWithMessage('User is busy on another call');
          } else if (st === 'rejected') {
            closeWithMessage('Call declined');
          } else if (st === 'ended' || st === 'missed') {
            closeWithMessage(null);
          }
        },
        onOffer: (sdp) => {
          handleRemoteOffer(sdp);
        },
        onAnswer: (sdp) => {
          handleRemoteAnswer(sdp);
        },
        onCandidate: (cand) => {
          handleRemoteCandidate(cand);
        },
      });
    }

    return () => {
      unsubWs();
      unsubFb();
      cleanupMedia();
    };
  }, [call.callId]);

  // 45-second unanswered ring timeout -> Missed call
  useEffect(() => {
    if (call.status !== 'ringing') return;
    const t = window.setTimeout(() => {
      if (isServerlessFirebaseMode()) {
        sendCallSignalFirestore(call.callId, { status: 'missed' });
      } else {
        apiFetch(`/api/calls/${call.callId}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: 'missed' }),
        }).catch(() => {});
        realtime.send('call:end', { targetUserId: call.peerId, callId: call.callId });
      }
      closeWithMessage('No answer');
    }, 45_000);
    return () => clearTimeout(t);
  }, [call.status, call.callId]);

  useEffect(() => {
    if (call.status !== 'connected') return;
    const t = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [call.status]);

  const handleAcceptIncoming = async () => {
    onUpdateStatus('connected');
    await setupPeerConnection(false);
    if (isServerlessFirebaseMode()) {
      await sendCallSignalFirestore(call.callId, { status: 'connected' });
    } else {
      realtime.send('call:accept', {
        targetUserId: call.peerId,
        callId: call.callId,
      });
    }
  };

  const handleRejectOrEnd = () => {
    const isIncomingRinging = call.direction === 'incoming' && call.status === 'ringing';
    const nextStatus = isIncomingRinging ? 'rejected' : elapsedRef.current > 0 ? 'ended' : 'missed';

    if (isServerlessFirebaseMode()) {
      sendCallSignalFirestore(call.callId, {
        status: nextStatus,
        durationSeconds: elapsedRef.current,
      });
    } else {
      realtime.send(isIncomingRinging ? 'call:reject' : 'call:end', {
        targetUserId: call.peerId,
        callId: call.callId,
      });
      apiFetch(`/api/calls/${call.callId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: nextStatus, durationSeconds: elapsedRef.current }),
      }).catch(() => {});
    }
    closeWithMessage(null);
  };

  const toggleMic = () => {
    const next = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
    setMicMuted(next);
  };

  const toggleSpeaker = () => {
    const next = !speakerOn;
    setSpeakerOn(next);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = !next;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.muted = !next;
    }
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

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const togglePiP = async () => {
    if (!remoteVideoRef.current || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture().catch(() => {});
    } else {
      await remoteVideoRef.current.requestPictureInPicture().catch(() => {});
    }
  };

  const fmtTime = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#09090B]/95 p-6 text-white backdrop-blur-md"
    >
      <audio ref={remoteAudioRef} autoPlay />

      {/* Top info & screen mode buttons */}
      <div className="mt-4 flex w-full max-w-3xl items-start justify-between">
        <div className="w-20" />
        <div className="text-center">
          <p className="text-xs uppercase tracking-[0.22em] text-[#D4AF37]">
            RIKZEN {call.callType === 'video' ? 'Video Call' : 'Voice Call'}
          </p>
          <h2 className="mt-2 font-display text-2xl font-bold">{call.peerName}</h2>
          <p className="mt-1 text-sm tabular-nums text-[#9898A6]">
            {statusNote
              ? statusNote
              : call.status === 'connected'
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
        <div className="flex w-20 justify-end gap-1.5">
          {call.callType === 'video' && call.status === 'connected' && document.pictureInPictureEnabled && (
            <button
              type="button"
              onClick={togglePiP}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white"
              title="Picture-in-Picture"
            >
              <PictureInPicture2 size={16} />
            </button>
          )}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-white"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>
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
      <div className="mb-6 flex flex-wrap items-center justify-center gap-3 sm:gap-4">
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

            <button
              type="button"
              onClick={toggleSpeaker}
              className={`flex h-14 w-14 items-center justify-center rounded-full border transition ${
                speakerOn ? 'border-[#D4AF37]/50 bg-[#D4AF37]/20 text-[#F5E6B3]' : 'border-white/15 bg-white/10 text-white'
              }`}
              aria-label={speakerOn ? 'Mute speaker' : 'Enable speaker'}
            >
              {speakerOn ? <Volume2 size={20} /> : <VolumeX size={20} />}
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
