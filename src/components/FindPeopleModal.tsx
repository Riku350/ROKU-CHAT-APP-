import React, { useEffect, useState } from 'react';
import {
  Ban,
  Check,
  Copy,
  MessageSquare,
  Search,
  Share2,
  ShieldAlert,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from 'lucide-react';
import { apiFetch } from '../services/api';
import type { FriendRequestItem, PublicPeer, UserProfile } from '../types/rikzen';

interface FindPeopleModalProps {
  me: UserProfile;
  onClose: () => void;
  onStartChat: (conversationId: string) => void;
  onRefreshData: () => void;
}

type PeopleTab = 'discover' | 'received' | 'sent' | 'friends' | 'rejected' | 'blocked';

export const FindPeopleModal: React.FC<FindPeopleModalProps> = ({
  me,
  onClose,
  onStartChat,
  onRefreshData,
}) => {
  const [tab, setTab] = useState<PeopleTab>('discover');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PublicPeer[]>([]);
  const [friends, setFriends] = useState<PublicPeer[]>([]);
  const [received, setReceived] = useState<FriendRequestItem[]>([]);
  const [sent, setSent] = useState<FriendRequestItem[]>([]);
  const [rejected, setRejected] = useState<FriendRequestItem[]>([]);
  const [blocked, setBlocked] = useState<any[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const loadFriendsData = async () => {
    try {
      const data = await apiFetch('/api/friends');
      setFriends(data.friends || []);
      setReceived(data.receivedRequests || []);
      setSent(data.sentRequests || []);
      setRejected(data.rejectedRequests || []);
      setBlocked(data.blockedUsers || []);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadFriendsData();
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    setStatusMsg(null);
    try {
      const data = await apiFetch<{ results: PublicPeer[] }>(
        `/api/users/search?q=${encodeURIComponent(query.trim())}`
      );
      setResults(data.results || []);
    } catch (err: any) {
      setStatusMsg(err.message);
    } finally {
      setSearching(false);
    }
  };

  const sendRequest = async (targetUserId: string) => {
    setStatusMsg(null);
    try {
      await apiFetch('/api/friends/request', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
      });
      setStatusMsg('Friend request sent.');
      await Promise.all([handleSearch(), loadFriendsData()]);
      onRefreshData();
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  const respondRequest = async (requestId: string, action: 'accept' | 'reject' | 'block') => {
    setStatusMsg(null);
    try {
      const res = await apiFetch('/api/friends/respond', {
        method: 'POST',
        body: JSON.stringify({ requestId, action }),
      });
      await loadFriendsData();
      onRefreshData();
      if (action === 'accept' && res.conversationId) {
        setStatusMsg('Friend request accepted! Personal chat unlocked.');
      }
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  const openChatWithFriend = async (peerId: string) => {
    try {
      const res = await apiFetch<{ conversationId: string }>('/api/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ peerId }),
      });
      onRefreshData();
      onStartChat(res.conversationId);
      onClose();
    } catch (err: any) {
      setStatusMsg(err.message);
    }
  };

  const unblockUser = async (targetId: string) => {
    await apiFetch(`/api/friends/block/${targetId}`, { method: 'DELETE' });
    await loadFriendsData();
    onRefreshData();
  };

  const removeFriend = async (friendId: string) => {
    await apiFetch(`/api/friends/${friendId}`, { method: 'DELETE' });
    await loadFriendsData();
    onRefreshData();
  };

  const copyMyId = async () => {
    try {
      await navigator.clipboard.writeText(me.rikzenId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // ignore
    }
  };

  const shareMyId = async () => {
    const shareText = `Connect with me on RIKZEN CHAT! My RIKZEN ID: ${me.rikzenId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'RIKZEN CHAT ID', text: shareText });
        return;
      } catch {
        // fallback to copy
      }
    }
    await copyMyId();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-5 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#D4AF37]/25 bg-white dark:bg-[#111115] text-slate-900 dark:text-[#F5F5F7] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 dark:border-white/10 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold">Find People & Friend Requests</h2>
            <p className="text-xs text-slate-500 dark:text-[#9898A6]">
              Search by RIKZEN ID, verified phone number, or permitted display name
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* My RIKZEN ID Share Card */}
        <div className="mx-5 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D4AF37]/30 bg-amber-50/50 dark:bg-[#09090B] px-4 py-3">
          <div>
            <p className="text-[11px] text-slate-500 dark:text-[#9898A6]">Your Permanent RIKZEN ID</p>
            <p className="font-mono-id text-sm font-semibold text-[#B8891F] dark:text-[#F5E6B3]">
              {me.rikzenId}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={copyMyId}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-black/10 dark:border-white/10 px-3 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
            >
              {copiedId ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              <span>{copiedId ? 'Copied' : 'Copy ID'}</span>
            </button>
            <button
              type="button"
              onClick={shareMyId}
              className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B]"
            >
              <Share2 size={14} />
              <span>Share ID</span>
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="mx-5 mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {[
            { id: 'discover', label: 'Find People' },
            { id: 'received', label: `Received (${received.length})` },
            { id: 'sent', label: `Sent (${sent.length})` },
            { id: 'friends', label: `Friends (${friends.length})` },
            { id: 'rejected', label: 'Rejected' },
            { id: 'blocked', label: 'Blocked' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id as PeopleTab)}
              className={`min-h-[40px] whitespace-nowrap shrink-0 rounded-lg px-3.5 text-xs font-medium transition ${
                tab === t.id
                  ? 'bg-[#D4AF37] text-[#09090B] font-semibold'
                  : 'bg-black/5 dark:bg-white/5 text-slate-600 dark:text-[#9898A6] hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {statusMsg && (
          <div className="mx-5 mt-3 rounded-xl border border-[#D4AF37]/30 bg-[#D4AF37]/10 px-4 py-2.5 text-xs text-[#B8891F] dark:text-[#F5E6B3]">
            {statusMsg}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === 'discover' && (
            <div>
              <form onSubmit={handleSearch} className="flex gap-2">
                <div className="relative flex-1">
                  <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Enter RIKZEN-XXXXXX, exact phone, or name..."
                    className="h-11 w-full rounded-xl border border-black/10 dark:border-white/10 bg-slate-50 dark:bg-[#09090B] pl-10 pr-4 text-sm focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  disabled={searching}
                  className="min-h-[44px] whitespace-nowrap rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B]"
                >
                  {searching ? 'Searching...' : 'Search'}
                </button>
              </form>

              <div className="mt-5 space-y-3">
                {results.length === 0 && query.trim().length >= 2 && !searching && (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-[#9898A6]">
                    No matching discoverable users found for &ldquo;{query}&rdquo;.
                  </p>
                )}
                {results.length === 0 && query.trim().length < 2 && (
                  <p className="py-8 text-center text-sm text-slate-500 dark:text-[#9898A6]">
                    Enter a friend&apos;s permanent RIKZEN ID (e.g. RIKZEN-RK7M92) to connect across any device.
                  </p>
                )}
                {results.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#09090B]">
                        {u.avatarUrl ? (
                          <img src={u.avatarUrl} alt={u.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-display text-base font-bold text-[#D4AF37]">
                            {u.fullName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-sm">{u.fullName}</p>
                        <p className="font-mono-id text-xs text-[#B8891F] dark:text-[#D4AF37]">{u.rikzenId}</p>
                        {u.bio && <p className="truncate text-xs text-slate-500 dark:text-[#9898A6] mt-0.5">{u.bio}</p>}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {u.relationship === 'friends' ? (
                        <button
                          type="button"
                          onClick={() => openChatWithFriend(u.id)}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-500"
                        >
                          <MessageSquare size={14} />
                          <span>Message</span>
                        </button>
                      ) : u.relationship === 'sent' ? (
                        <span className="text-xs font-medium text-slate-500 dark:text-[#9898A6]">Request Pending</span>
                      ) : u.relationship === 'received' && u.requestId ? (
                        <button
                          type="button"
                          onClick={() => respondRequest(u.requestId!, 'accept')}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 text-xs font-semibold text-[#09090B]"
                        >
                          <UserCheck size={14} />
                          <span>Accept</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={!u.canSendRequest}
                          onClick={() => sendRequest(u.id)}
                          className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B] disabled:opacity-40"
                        >
                          <UserPlus size={14} />
                          <span>{u.canSendRequest ? 'Add Friend' : 'Restricted'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'received' && (
            <div className="space-y-3">
              {received.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#9898A6]">No pending incoming requests.</p>
              ) : (
                received.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-11 w-11 overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#09090B]">
                        {r.sender_avatar ? (
                          <img src={r.sender_avatar} alt={r.sender_name} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                            {r.sender_name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div>
                        <p className="font-semibold text-sm">{r.sender_name}</p>
                        <p className="font-mono-id text-xs text-[#D4AF37]">{r.sender_rikzen_id}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => respondRequest(r.id, 'accept')}
                        className="min-h-[40px] rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => respondRequest(r.id, 'reject')}
                        className="min-h-[40px] rounded-lg border border-black/10 dark:border-white/15 px-3 text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => respondRequest(r.id, 'block')}
                        className="min-h-[40px] rounded-lg border border-red-500/30 bg-red-500/10 px-3 text-xs font-medium text-red-400 hover:bg-red-500/20"
                      >
                        Block
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'sent' && (
            <div className="space-y-3">
              {sent.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#9898A6]">No pending sent requests.</p>
              ) : (
                sent.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">{r.receiver_name}</p>
                      <p className="font-mono-id text-xs text-[#D4AF37]">{r.receiver_rikzen_id}</p>
                    </div>
                    <span className="text-xs text-slate-500 dark:text-[#9898A6]">Pending Acceptance</span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'friends' && (
            <div className="space-y-3">
              {friends.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#9898A6]">
                  You have not added any friends yet. Search by RIKZEN ID to connect!
                </p>
              ) : (
                friends.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#09090B]">
                        {f.avatarUrl ? (
                          <img src={f.avatarUrl} alt={f.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                            {f.fullName.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-sm">{f.fullName}</p>
                        <p className="font-mono-id text-xs text-[#D4AF37]">{f.rikzenId}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => openChatWithFriend(f.id)}
                        className="flex min-h-[40px] items-center gap-1.5 rounded-lg bg-[#D4AF37] px-3 text-xs font-semibold text-[#09090B]"
                      >
                        <MessageSquare size={14} />
                        <span>Chat</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => removeFriend(f.id)}
                        className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-red-400"
                        title="Remove friend"
                      >
                        <UserMinus size={15} />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'rejected' && (
            <div className="space-y-3">
              {rejected.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#9898A6]">No rejected requests.</p>
              ) : (
                rejected.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div>
                      <p className="font-semibold text-sm">
                        {r.sender_id === me.id ? r.receiver_name : r.sender_name}
                      </p>
                      <p className="font-mono-id text-xs text-slate-400">
                        {r.sender_id === me.id ? r.receiver_rikzen_id : r.sender_rikzen_id}
                      </p>
                    </div>
                    <span className="text-xs text-red-400">Rejected</span>
                  </div>
                ))
              )}
            </div>
          )}

          {tab === 'blocked' && (
            <div className="space-y-3">
              {blocked.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-500 dark:text-[#9898A6]">No blocked users.</p>
              ) : (
                blocked.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between rounded-xl border border-black/8 dark:border-white/10 bg-slate-50/70 dark:bg-[#18181D] p-3.5"
                  >
                    <div className="flex items-center gap-3">
                      <ShieldAlert size={18} className="text-red-400" />
                      <div>
                        <p className="font-semibold text-sm">{b.full_name}</p>
                        <p className="font-mono-id text-xs text-slate-400">{b.rikzen_id}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => unblockUser(b.id)}
                      className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 text-xs font-medium hover:bg-white/5"
                    >
                      <Ban size={14} />
                      <span>Unblock</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
