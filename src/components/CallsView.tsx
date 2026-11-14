import React, { useEffect, useState } from 'react';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing, Video } from 'lucide-react';
import { apiFetch, realtime } from '../services/api';
import type { CallLogItem, PublicPeer, UserProfile } from '../types/rikzen';

interface CallsViewProps {
  me: UserProfile;
  onStartCall: (peer: { id: string; name: string; avatar: string | null }, callType: 'voice' | 'video') => void;
}

export const CallsView: React.FC<CallsViewProps> = ({ me, onStartCall }) => {
  const [calls, setCalls] = useState<CallLogItem[]>([]);
  const [friends, setFriends] = useState<PublicPeer[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const [cRes, fRes] = await Promise.all([apiFetch('/api/calls'), apiFetch('/api/friends')]);
      setCalls(cRes.calls || []);
      setFriends(fRes.friends || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const unsub = realtime.subscribe((event) => {
      if (event === 'profile:updated' || event === 'call:ended' || event === 'call:incoming' || event === 'friend:accepted') {
        load();
      }
    });
    return () => unsub();
  }, [me.avatarUrl, me.fullName]);

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white dark:bg-[#0B0B0E] p-4 sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div>
          <h2 className="font-display text-2xl font-bold">Calls</h2>
          <p className="text-xs text-slate-500 dark:text-[#9898A6] mt-0.5">
            Direct encrypted WebRTC voice and video calls with your RIKZEN connections
          </p>
        </div>

        {/* Quick Call Friends */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#9898A6] mb-3">
            Start a Call
          </h3>
          {friends.length === 0 ? (
            <div className="rounded-2xl border border-black/8 dark:border-white/10 p-5 text-sm text-slate-500 dark:text-[#9898A6]">
              Add friends first to place voice and video calls.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {friends.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 bg-slate-50 dark:bg-[#141418] p-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#09090B]">
                      {f.avatarUrl ? (
                        <img src={f.avatarUrl} alt={f.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                          {f.fullName.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{f.fullName}</p>
                      <p className="font-mono-id text-[11px] text-[#D4AF37]">{f.rikzenId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onStartCall({ id: f.id, name: f.fullName, avatar: f.avatarUrl }, 'voice')}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600/15 text-emerald-500 hover:bg-emerald-600/25"
                      aria-label={`Voice call ${f.fullName}`}
                    >
                      <Phone size={17} />
                    </button>
                    <button
                      type="button"
                      onClick={() => onStartCall({ id: f.id, name: f.fullName, avatar: f.avatarUrl }, 'video')}
                      className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25"
                      aria-label={`Video call ${f.fullName}`}
                    >
                      <Video size={17} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Call History */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-[#9898A6] mb-3">
            Recent Call History
          </h3>
          {loading ? (
            <p className="text-sm text-slate-500">Loading call history...</p>
          ) : calls.length === 0 ? (
            <p className="rounded-2xl border border-black/8 dark:border-white/10 p-6 text-center text-sm text-slate-500 dark:text-[#9898A6]">
              No calls placed yet.
            </p>
          ) : (
            <div className="divide-y divide-black/6 dark:divide-white/8 rounded-2xl border border-black/8 dark:border-white/10 bg-white dark:bg-[#141418]">
              {calls.map((c) => {
                const outgoing = c.caller_id === me.id;
                const peerName = outgoing ? c.callee_name : c.caller_name;
                const peerAvatar = outgoing ? c.callee_avatar : c.caller_avatar;
                const peerId = outgoing ? c.callee_id : c.caller_id;
                const missed = c.status === 'missed' || c.status === 'rejected';
                return (
                  <div key={c.id} className="flex items-center justify-between p-3.5">
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full border border-[#D4AF37]/30 bg-[#09090B]">
                        {peerAvatar ? (
                          <img src={peerAvatar} alt={peerName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                            {peerName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className={`text-sm font-semibold ${missed && !outgoing ? 'text-red-400' : ''}`}>
                          {peerName}
                        </p>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-[#9898A6]">
                          {missed ? (
                            <PhoneMissed size={13} className="text-red-400" />
                          ) : outgoing ? (
                            <PhoneOutgoing size={13} className="text-emerald-500" />
                          ) : (
                            <PhoneIncoming size={13} className="text-[#D4AF37]" />
                          )}
                          <span>{outgoing ? 'Outgoing' : 'Incoming'}</span>
                          <span>·</span>
                          <span>{c.call_type}</span>
                          {c.duration_seconds > 0 && (
                            <>
                              <span>·</span>
                              <span className="tabular-nums">{c.duration_seconds}s</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onStartCall({ id: peerId, name: peerName, avatar: peerAvatar }, c.call_type)}
                      className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#D4AF37]"
                      aria-label={`Call ${peerName} again`}
                    >
                      {c.call_type === 'video' ? <Video size={18} /> : <Phone size={18} />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
