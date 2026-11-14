import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CircleDot,
  MessageSquare,
  MoreVertical,
  Phone,
  Search,
  Settings,
  ShieldCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { AdminDashboard } from './components/AdminDashboard';
import { AuthFlow } from './components/AuthFlow';
import { CallOverlay, type ActiveCallSession } from './components/CallOverlay';
import { CallsView } from './components/CallsView';
import { ChatWorkspace } from './components/ChatWorkspace';
import { CommunitiesChannelsView } from './components/CommunitiesChannelsView';
import { FindPeopleModal } from './components/FindPeopleModal';
import { SettingsDrawer } from './components/SettingsDrawer';
import { SpiderEmblem } from './components/SpiderEmblem';
import { UpdatesView } from './components/UpdatesView';
import { WelcomeSplash } from './components/WelcomeSplash';
import { onAuthStateChanged } from 'firebase/auth';
import { firebaseAuth, signOutGoogle } from './lib/firebaseAuth';
import {
  sendCallSignalFirestore,
  subscribeConversationsFirestore,
  subscribeIncomingCallsFirestore,
} from './lib/firebaseBackend';
import {
  setPresenceFirestore,
  subscribeOwnPublicProfile,
  subscribePeerProfilesFirestore,
  syncUserToFirestore,
  testConnection,
} from './lib/firestore';
import {
  apiFetch,
  isServerlessFirebaseMode,
  realtime,
  setStoredToken,
  triggerDesktopNotification,
} from './services/api';
import type { AppNotification, ChatMessage, ConversationSummary, UserProfile } from './types/rikzen';

type MainTab = 'chats' | 'updates' | 'communities' | 'calls';

export default function App() {
  // Always plays 5s welcome intro on fresh load / page reload without clearing auth session
  const [splashDone, setSplashDone] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [me, setMe] = useState<UserProfile | null>(null);

  const [activeTab, setActiveTab] = useState<MainTab>('chats');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  const [findPeopleOpen, setFindPeopleOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const [activeCall, setActiveCall] = useState<ActiveCallSession | null>(null);
  const activeConvIdRef = useRef<string | null>(null);
  const activeCallRef = useRef<ActiveCallSession | null>(null);
  const seenMsgIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeConvIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  // Sync Appearance Settings (Light/Dark/System & Font Size) onto <html>
  useEffect(() => {
    const html = document.documentElement;
    const theme = me?.appearanceSettings?.theme || 'dark';
    const applyTheme = () => {
      if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        html.classList.toggle('dark', prefersDark);
      } else {
        html.classList.toggle('dark', theme === 'dark');
      }
    };
    applyTheme();

    const fontScaleMap = { small: '0.92', medium: '1', large: '1.08' };
    const fKey = me?.appearanceSettings?.fontSize || 'medium';
    html.style.setProperty('--rikzen-font-scale', fontScaleMap[fKey] || '1');
  }, [me?.appearanceSettings]);

  const loadConversations = useCallback(async () => {
    try {
      const data = await apiFetch('/api/conversations');
      setConversations(data.conversations || []);
    } catch {
      // ignore
    }
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const data = await apiFetch('/api/notifications');
      setNotifications(data.notifications || []);
    } catch {
      // ignore
    }
  }, []);

  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);

  // Test Firestore connectivity on boot & track Firebase Auth readiness
  useEffect(() => {
    testConnection();
    const unsubAuth = onAuthStateChanged(firebaseAuth, (fbUser) => {
      setFirebaseUid(fbUser && fbUser.emailVerified ? fbUser.uid : null);
      setFirebaseReady(true);
    });
    return () => unsubAuth();
  }, []);

  // Sync RIKZEN profile to Firestore when both Firebase Auth and backend profile are ready
  useEffect(() => {
    if (!firebaseReady || !firebaseUid || !me) return;
    syncUserToFirestore(me).catch((err) => {
      console.error('Firestore profile sync failed:', err);
    });
    const unsubProfile = subscribeOwnPublicProfile(firebaseUid, () => {
      // Keeps live Firestore listener active while authenticated
    });
    return () => unsubProfile();
  }, [
    firebaseReady,
    firebaseUid,
    me?.id,
    me?.fullName,
    me?.bio,
    me?.avatarUrl,
    me?.onboardingCompleted,
    me?.phone,
    me?.dateOfBirth,
    me?.appearanceSettings?.theme,
    me?.appearanceSettings?.wallpaper,
    me?.privacySettings?.lastSeen,
    me?.privacySettings?.onlineStatus,
    me?.privacySettings?.readReceipts,
    me?.privacySettings?.profilePhoto,
  ]);

  // Restore session silently in parallel with WelcomeSplash
  useEffect(() => {
    apiFetch<{ profile: UserProfile }>('/api/auth/me')
      .then((res) => {
        setMe(res.profile);
      })
      .catch(() => {
        setMe(null);
      })
      .finally(() => {
        setAuthChecked(true);
      });
  }, []);

  // Keep Firebase online presence live when app is open/hidden/closed
  useEffect(() => {
    if (!firebaseReady || !firebaseUid || !me?.onboardingCompleted) return;
    setPresenceFirestore(true).catch(() => {});

    const onVisibility = () => {
      setPresenceFirestore(document.visibilityState === 'visible').catch(() => {});
    };
    const onPageHide = () => {
      setPresenceFirestore(false).catch(() => {});
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onPageHide);
    };
  }, [firebaseReady, firebaseUid, me?.onboardingCompleted]);

  // Subscribe live to peers' online/offline status in Firebase serverless mode
  const peerIdsKey = conversations
    .map((c) => c.peer?.id || '')
    .filter(Boolean)
    .sort()
    .join(',');

  useEffect(() => {
    if (!firebaseReady || !firebaseUid || !isServerlessFirebaseMode() || !peerIdsKey) return;
    const peerIds = peerIdsKey.split(',').filter(Boolean);
    const unsub = subscribePeerProfilesFirestore(peerIds, (uid, snap) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.peer && c.peer.id === uid
            ? {
                ...c,
                ...(snap.fullName ? { title: snap.fullName } : {}),
                ...(snap.avatarUrl !== undefined ? { avatarUrl: snap.avatarUrl } : {}),
                peer: {
                  ...c.peer,
                  ...(snap.fullName ? { fullName: snap.fullName } : {}),
                  ...(snap.avatarUrl !== undefined ? { avatarUrl: snap.avatarUrl } : {}),
                  ...(snap.bio !== undefined ? { bio: snap.bio } : {}),
                  isOnline: snap.isOnline,
                  lastSeenAt: snap.updatedAt || c.peer.lastSeenAt,
                  typingInConversationId: snap.typingInConversationId,
                  typingActivity: snap.typingActivity,
                },
              }
            : c
        )
      );
    });
    return () => unsub();
  }, [firebaseReady, firebaseUid, peerIdsKey]);

  // Live Firestore conversations & incoming calls in serverless Firebase mode
  useEffect(() => {
    if (!firebaseReady || !firebaseUid || !me?.onboardingCompleted || !isServerlessFirebaseMode()) return;

    const unsubConvs = subscribeConversationsFirestore(me.id, (list) => {
      setConversations(list);
      for (const c of list) {
        const last = c.lastMessage;
        if (last && last.senderId !== me.id) {
          if (last.status === 'sent' && !seenMsgIdsRef.current.has(`deliv:${last.id}`)) {
            seenMsgIdsRef.current.add(`deliv:${last.id}`);
            apiFetch(`/api/conversations/${c.id}/delivered`, { method: 'POST' }).catch(() => {});
          }
          const isViewingHere =
            activeConvIdRef.current === c.id && document.visibilityState === 'visible';
          if (isViewingHere && c.unreadCount > 0) {
            apiFetch(`/api/conversations/${c.id}/read`, { method: 'POST' }).catch(() => {});
          } else if (
            !isViewingHere &&
            !seenMsgIdsRef.current.has(`notif:${last.id}`) &&
            Date.now() - new Date(last.createdAt).getTime() < 20_000
          ) {
            seenMsgIdsRef.current.add(`notif:${last.id}`);
            if (!c.muted) {
              triggerDesktopNotification(c.title || 'New message', last.content || 'New message');
            }
          }
        }
      }
    });

    const unsubCalls = subscribeIncomingCallsFirestore(me.id, (incoming) => {
      if (activeCallRef.current) {
        sendCallSignalFirestore(incoming.callId, { status: 'busy' }).catch(() => {});
        return;
      }
      setActiveCall({
        callId: incoming.callId,
        peerId: incoming.fromUserId,
        peerName: incoming.fromName,
        peerAvatar: incoming.fromAvatar,
        callType: incoming.callType,
        direction: 'incoming',
        status: 'ringing',
      });
      triggerDesktopNotification(
        `Incoming ${incoming.callType} call`,
        `${incoming.fromName} is calling you on RIKZEN CHAT`
      );
    });

    return () => {
      unsubConvs();
      unsubCalls();
    };
  }, [firebaseReady, firebaseUid, me?.id, me?.onboardingCompleted]);

  // Mark active conversation read ONLY when actively opened and browser tab is visible
  useEffect(() => {
    if (!me?.onboardingCompleted || !activeConversationId) return;
    const markVisibleRead = () => {
      if (document.visibilityState !== 'visible') return;
      apiFetch(`/api/conversations/${activeConversationId}/read`, { method: 'POST' })
        .then(() => {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeConversationId ? { ...c, unreadCount: 0, markedUnread: false } : c
            )
          );
        })
        .catch(() => {});
    };
    markVisibleRead();
    document.addEventListener('visibilitychange', markVisibleRead);
    return () => document.removeEventListener('visibilitychange', markVisibleRead);
  }, [me?.onboardingCompleted, activeConversationId]);

  // Connect WebSocket & load workspace when authenticated & onboarded
  useEffect(() => {
    if (!me || !me.onboardingCompleted) return;
    realtime.connect();
    loadConversations();
    loadNotifications();

    const unsub = realtime.subscribe((event, payload) => {
      if (event === 'notification:new') {
        const notif = payload as AppNotification;
        setNotifications((prev) => [notif, ...prev]);
        triggerDesktopNotification(notif.title, notif.body);
      } else if (event === 'profile:updated') {
        setConversations((prev) =>
          prev.map((c) =>
            c.peer && c.peer.id === payload.userId
              ? {
                  ...c,
                  ...(payload.fullName ? { title: payload.fullName } : {}),
                  ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
                  peer: {
                    ...c.peer,
                    ...(payload.fullName ? { fullName: payload.fullName } : {}),
                    ...(payload.avatarUrl !== undefined ? { avatarUrl: payload.avatarUrl } : {}),
                    ...(payload.bio !== undefined ? { bio: payload.bio } : {}),
                  },
                }
              : c
          )
        );
      } else if (event === 'presence:update') {
        setConversations((prev) =>
          prev.map((c) =>
            c.peer && c.peer.id === payload.userId
              ? {
                  ...c,
                  peer: {
                    ...c.peer,
                    isOnline: Boolean(payload.isOnline),
                    lastSeenAt: payload.lastSeenAt || c.peer.lastSeenAt,
                  },
                }
              : c
          )
        );
      } else if (
        event === 'typing:start' ||
        event === 'typing:stop' ||
        event === 'recording:start' ||
        event === 'recording:stop'
      ) {
        const act =
          event === 'typing:start'
            ? 'typing'
            : event === 'recording:start'
            ? 'recording'
            : 'idle';
        setConversations((prev) =>
          prev.map((c) =>
            c.peer && c.peer.id === payload.userId
              ? {
                  ...c,
                  peer: {
                    ...c.peer,
                    typingInConversationId: act === 'idle' ? null : payload.conversationId,
                    typingActivity: act,
                  },
                }
              : c
          )
        );
      } else if (event === 'message:new') {
        const msg = payload as ChatMessage;
        if (msg.senderId !== me.id) {
          realtime.send('message:delivered', {
            messageId: msg.id,
            conversationId: msg.conversationId,
          });
          const isViewing =
            activeConvIdRef.current === msg.conversationId && document.visibilityState === 'visible';
          if (isViewing) {
            apiFetch(`/api/conversations/${msg.conversationId}/read`, { method: 'POST' }).catch(() => {});
          } else {
            triggerDesktopNotification('New message', msg.content || `Sent ${msg.messageType}`);
          }
        }
        loadConversations();
      } else if (event === 'message:delivered' || event === 'message:read' || event === 'message:deleted') {
        loadConversations();
      } else if (event === 'call:incoming') {
        if (activeCallRef.current) {
          realtime.send('call:busy', { targetUserId: payload.callerId, callId: payload.callId });
          apiFetch(`/api/calls/${payload.callId}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: 'busy' }),
          }).catch(() => {});
          return;
        }
        setActiveCall({
          callId: payload.callId,
          peerId: payload.callerId,
          peerName: payload.caller?.full_name || 'RIKZEN User',
          peerAvatar: payload.caller?.avatar_url || null,
          callType: payload.callType || 'voice',
          direction: 'incoming',
          status: 'ringing',
        });
        triggerDesktopNotification(
          `Incoming ${payload.callType === 'video' ? 'video' : 'voice'} call`,
          `${payload.caller?.full_name || 'RIKZEN User'} is calling you`
        );
      }
    });

    return () => {
      unsub();
      realtime.disconnect();
    };
  }, [me?.id, me?.onboardingCompleted, loadConversations, loadNotifications]);

  const handleLogout = async () => {
    await setPresenceFirestore(false).catch(() => {});
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    await signOutGoogle();
    setStoredToken(null);
    realtime.disconnect();
    setMe(null);
    setSettingsOpen(false);
    setAdminOpen(false);
    setActiveConversationId(null);
    setConversations([]);
  };

  const handleStartCall = async (
    peer: { id: string; name: string; avatar: string | null },
    callType: 'voice' | 'video'
  ) => {
    try {
      const res = await apiFetch<{ callId: string }>('/api/calls', {
        method: 'POST',
        body: JSON.stringify({ calleeId: peer.id, callType }),
      });
      setActiveCall({
        callId: res.callId,
        peerId: peer.id,
        peerName: peer.name,
        peerAvatar: peer.avatar,
        callType,
        direction: 'outgoing',
        status: 'ringing',
      });
    } catch {
      // ignore
    }
  };

  const handleReplyStatusInChat = async (peerId: string, text: string) => {
    const res = await apiFetch<{ conversationId: string }>('/api/conversations/direct', {
      method: 'POST',
      body: JSON.stringify({ peerId }),
    });
    await apiFetch(`/api/conversations/${res.conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content: text, messageType: 'text' }),
    });
    await loadConversations();
    setActiveTab('chats');
    setActiveConversationId(res.conversationId);
  };

  const unreadNotifications = notifications.filter((n) => !n.isRead).length;
  const totalUnreadChats = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  if (!splashDone) {
    return <WelcomeSplash onComplete={() => setSplashDone(true)} />;
  }

  if (!authChecked) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#09090B] text-[#F5E6B3]">
        <SpiderEmblem size={42} />
      </div>
    );
  }

  if (!me || !me.onboardingCompleted) {
    return (
      <AuthFlow
        initialProfile={me}
        onAuthenticated={(profile) => {
          setMe(profile);
        }}
      />
    );
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col md:flex-row overflow-hidden bg-white dark:bg-[#09090B] text-slate-900 dark:text-[#F5F5F7]">
      {/* Desktop Slim Navigation Rail */}
      <nav className="hidden md:flex w-[72px] shrink-0 flex-col items-center justify-between border-r border-black/10 dark:border-[#D4AF37]/15 bg-slate-100 dark:bg-[#0B0B0E] py-4">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('chats')}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/30 bg-[#111115]"
            title="RIKZEN CHAT"
          >
            <SpiderEmblem size={26} />
          </button>

          <div className="mt-4 flex flex-col items-center gap-2">
            {[
              { id: 'chats' as MainTab, icon: MessageSquare, label: 'Chats', badge: totalUnreadChats },
              { id: 'updates' as MainTab, icon: CircleDot, label: 'Updates', badge: 0 },
              { id: 'communities' as MainTab, icon: Users, label: 'Communities', badge: 0 },
              { id: 'calls' as MainTab, icon: Phone, label: 'Calls', badge: 0 },
            ].map((item) => {
              const Icon = item.icon;
              const active = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                  className={`relative flex h-12 w-12 items-center justify-center rounded-xl transition ${
                    active
                      ? 'bg-[#D4AF37] text-[#09090B]'
                      : 'text-slate-500 dark:text-[#9898A6] hover:bg-black/5 dark:hover:bg-white/8 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Icon size={20} />
                  {item.badge > 0 && (
                    <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1 text-[10px] font-bold text-[#09090B] tabular-nums">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={() => setFindPeopleOpen(true)}
            title="Find People"
            className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 dark:text-[#9898A6] hover:bg-black/5 dark:hover:bg-white/8"
          >
            <UserPlus size={20} />
          </button>
          <button
            type="button"
            onClick={() => setNotificationsOpen(!notificationsOpen)}
            title="Notifications"
            className="relative flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 dark:text-[#9898A6] hover:bg-black/5 dark:hover:bg-white/8"
          >
            <Bell size={20} />
            {unreadNotifications > 0 && (
              <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#D4AF37]" />
            )}
          </button>
          {me.isAdmin && (
            <button
              type="button"
              onClick={() => setAdminOpen(true)}
              title="Admin Dashboard"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-[#D4AF37] hover:bg-[#D4AF37]/15"
            >
              <ShieldCheck size={20} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            title="Settings & Profile"
            className="h-11 w-11 overflow-hidden rounded-full border-2 border-[#D4AF37]/60"
          >
            {me.avatarUrl ? (
              <img src={me.avatarUrl} alt={me.fullName} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-[#18181D] text-xs font-bold text-[#D4AF37]">
                {me.fullName.charAt(0).toUpperCase()}
              </div>
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Top Bar (hidden when inside an active mobile chat) */}
      {!(activeTab === 'chats' && activeConversationId) && (
        <header className="flex md:hidden h-13 shrink-0 items-center justify-between border-b border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] px-4">
          <div className="flex items-center gap-2.5">
            <SpiderEmblem size={24} />
            <span className="font-display text-base font-bold tracking-[0.12em] text-[#B8891F] dark:text-[#F5E6B3] whitespace-nowrap">
              RIKZEN CHAT
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setFindPeopleOpen(true)}
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              aria-label="Search people"
            >
              <Search size={19} />
            </button>
            <button
              type="button"
              onClick={() => setNotificationsOpen(!notificationsOpen)}
              className="relative flex h-10 w-10 items-center justify-center rounded-xl"
              aria-label="Notifications"
            >
              <Bell size={19} />
              {unreadNotifications > 0 && (
                <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-[#D4AF37]" />
              )}
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="flex h-10 w-10 items-center justify-center rounded-xl"
              aria-label="Menu"
            >
              <MoreVertical size={19} />
            </button>
          </div>
        </header>
      )}

      {/* Mobile Three-Dot Menu */}
      {mobileMenuOpen && (
        <div className="fixed right-3 top-14 z-50 w-52 rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-1.5 shadow-2xl text-sm md:hidden">
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setFindPeopleOpen(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
          >
            <UserPlus size={16} /> Find People / New Chat
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileMenuOpen(false);
              setSettingsOpen(true);
            }}
            className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
          >
            <Settings size={16} /> Profile & Settings
          </button>
          {me.isAdmin && (
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setAdminOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[#D4AF37] hover:bg-white/10"
            >
              <ShieldCheck size={16} /> Admin Console
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden">
        {activeTab === 'chats' && (
          <ChatWorkspace
            me={me}
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={setActiveConversationId}
            onRefreshConversations={loadConversations}
            onOpenFindPeople={() => setFindPeopleOpen(true)}
            onStartCall={handleStartCall}
          />
        )}
        {activeTab === 'updates' && (
          <UpdatesView me={me} onReplyInChat={handleReplyStatusInChat} />
        )}
        {activeTab === 'communities' && (
          <CommunitiesChannelsView conversations={conversations} />
        )}
        {activeTab === 'calls' && <CallsView me={me} onStartCall={handleStartCall} />}
      </main>

      {/* Mobile Bottom 4-Tab Bar (hidden when inside an active mobile chat) */}
      {!(activeTab === 'chats' && activeConversationId) && (
        <nav className="grid md:hidden grid-cols-4 h-15 shrink-0 border-t border-black/10 dark:border-white/10 bg-white/95 dark:bg-[#111115]/95 backdrop-blur-md pb-safe">
          {[
            { id: 'chats' as MainTab, label: 'CHATS', icon: MessageSquare, badge: totalUnreadChats },
            { id: 'updates' as MainTab, label: 'UPDATES', icon: CircleDot, badge: 0 },
            { id: 'communities' as MainTab, label: 'COMMUNITIES', icon: Users, badge: 0 },
            { id: 'calls' as MainTab, label: 'CALLS', icon: Phone, badge: 0 },
          ].map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`relative flex flex-col items-center justify-center gap-0.5 ${
                  active ? 'text-[#B8891F] dark:text-[#D4AF37]' : 'text-slate-500 dark:text-[#9898A6]'
                }`}
              >
                <Icon size={20} />
                <span className="text-[10px] font-semibold tracking-wider">{t.label}</span>
                {t.badge > 0 && (
                  <span className="absolute top-1.5 right-6 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#22C55E] px-1 text-[9px] font-bold text-[#09090B]">
                    {t.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      )}

      {/* Notifications Popover */}
      {notificationsOpen && (
        <div className="fixed right-4 top-16 md:left-20 md:top-auto md:bottom-16 z-50 w-80 rounded-2xl border border-black/10 dark:border-[#D4AF37]/25 bg-white dark:bg-[#141418] p-4 shadow-2xl">
          <div className="flex items-center justify-between pb-2 border-b border-black/10 dark:border-white/10">
            <h4 className="font-display text-sm font-bold">Notifications</h4>
            <button
              type="button"
              onClick={async () => {
                await apiFetch('/api/notifications/read-all', { method: 'POST' });
                setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
              }}
              className="text-xs text-[#D4AF37] hover:underline"
            >
              Mark all read
            </button>
          </div>
          <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500 dark:text-[#9898A6]">
                No notifications yet.
              </p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-2.5 text-xs ${
                    n.isRead
                      ? 'border-black/5 dark:border-white/5 opacity-70'
                      : 'border-[#D4AF37]/30 bg-[#D4AF37]/5'
                  }`}
                >
                  <p className="font-semibold">{n.title}</p>
                  <p className="mt-0.5 text-slate-500 dark:text-[#9898A6]">{n.body}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Modals & Drawers */}
      {findPeopleOpen && (
        <FindPeopleModal
          me={me}
          onClose={() => setFindPeopleOpen(false)}
          onStartChat={(convId) => {
            setActiveTab('chats');
            setActiveConversationId(convId);
          }}
          onRefreshData={loadConversations}
        />
      )}

      {settingsOpen && (
        <SettingsDrawer
          me={me}
          onProfileUpdated={(updated) => setMe(updated)}
          onLogout={handleLogout}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {adminOpen && me.isAdmin && <AdminDashboard onClose={() => setAdminOpen(false)} />}

      {activeCall && (
        <CallOverlay
          myUid={me.id}
          call={activeCall}
          onUpdateStatus={(status) => setActiveCall((c) => (c ? { ...c, status } : null))}
          onClose={() => setActiveCall(null)}
        />
      )}
    </div>
  );
}
