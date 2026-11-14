import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Ban,
  Check,
  CheckCheck,
  ChevronLeft,
  Copy,
  Download,
  FileText,
  Flag,
  Forward,
  Image as ImageIcon,
  Info,
  MapPin,
  Menu,
  Mic,
  MoreVertical,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Star,
  Trash2,
  UserPlus,
  Users,
  Video,
  VolumeX,
  X,
} from 'lucide-react';
import { subscribeDirectMessagesFirestore } from '../lib/firebaseBackend';
import {
  apiFetch,
  enqueueUnsentMessage,
  getUnsentQueue,
  isServerlessFirebaseMode,
  realtime,
  removeUnsentMessage,
  uploadMediaFile,
} from '../services/api';
import type { ChatMessage, ConversationSummary, UserProfile } from '../types/rikzen';
import { CreateGroupModal, GroupManageModal } from './GroupModals';

interface ChatWorkspaceProps {
  me: UserProfile;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onRefreshConversations: () => Promise<void>;
  onOpenFindPeople: () => void;
  onStartCall: (peer: { id: string; name: string; avatar: string | null }, callType: 'voice' | 'video') => void;
}

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '✨'];
const PICKER_EMOJIS = [
  '😀', '😂', '🥰', '😍', '🤩', '😎', '🤔', '🙌',
  '👏', '👍', '❤️', '🔥', '✨', '🎉', '🙏', '🤝',
  '💯', '🚀', '💬', '🎧', '📸', '📍', '⚡', '🕷️',
];

export const ChatWorkspace: React.FC<ChatWorkspaceProps> = ({
  me,
  conversations,
  activeConversationId,
  onSelectConversation,
  onRefreshConversations,
  onOpenFindPeople,
  onStartCall,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [listFilter, setListFilter] = useState<'all' | 'unread' | 'groups' | 'archived'>('all');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<ChatMessage | null>(null);
  const [activeMsgMenuId, setActiveMsgMenuId] = useState<string | null>(null);

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);

  const [typingUsers, setTypingUsers] = useState<Record<string, boolean>>({});
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadAccept, setUploadAccept] = useState('*/*');
  const [uploadKind, setUploadKind] = useState<'image' | 'video' | 'document' | 'audio'>('document');

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  // Load messages when active conversation changes
  const loadMessages = async (convId: string, before?: string) => {
    if (!before) setLoadingMsgs(true);
    try {
      const qs = before ? `?limit=50&before=${encodeURIComponent(before)}` : '?limit=50';
      const data = await apiFetch<{ messages: ChatMessage[]; hasMore: boolean }>(
        `/api/conversations/${convId}/messages${qs}`
      );
      if (before) {
        setMessages((prev) => [...data.messages, ...prev]);
      } else {
        setMessages(data.messages || []);
        apiFetch(`/api/conversations/${convId}/read`, { method: 'POST' })
          .then(() => onRefreshConversations())
          .catch(() => {});
        window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      }
      setHasMore(Boolean(data.hasMore));
    } catch {
      // ignore
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }
    setInfoPanelOpen(false);
    setChatSearchOpen(false);
    setChatSearchQuery('');

    if (isServerlessFirebaseMode()) {
      setLoadingMsgs(true);
      const unsub = subscribeDirectMessagesFirestore(activeConversationId, me.id, (msgs) => {
        setMessages(msgs);
        setLoadingMsgs(false);
        window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
      });
      return () => unsub();
    }

    loadMessages(activeConversationId);
  }, [activeConversationId, me.id]);

  // Flush offline queued messages on reconnect
  const flushOfflineQueue = async () => {
    const queue = getUnsentQueue();
    if (queue.length === 0) return;
    for (const item of queue) {
      try {
        await apiFetch(`/api/conversations/${item.conversationId}/messages`, {
          method: 'POST',
          body: JSON.stringify({
            content: item.content,
            messageType: item.messageType,
            replyToId: item.replyToId || null,
            metadata: item.metadata || {},
          }),
        });
        removeUnsentMessage(item.tempId);
      } catch {
        break;
      }
    }
    if (activeConversationId) loadMessages(activeConversationId);
    onRefreshConversations();
  };

  // WebSocket live message, receipt, reaction, typing listener
  useEffect(() => {
    const unsub = realtime.subscribe((event, payload) => {
      if (event === 'ws:ready') {
        flushOfflineQueue();
      } else if (event === 'message:new') {
        const msg = payload as ChatMessage;
        onRefreshConversations();
        if (msg.conversationId === activeConversationId) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.senderId !== me.id) {
            apiFetch(`/api/conversations/${msg.conversationId}/read`, { method: 'POST' }).catch(() => {});
          }
          window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
        }
      } else if (event === 'message:read') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              payload.messageIds?.includes(m.id) ? { ...m, status: 'read' } : m
            )
          );
        }
      } else if (event === 'message:updated') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.id ? { ...m, content: payload.content, isEdited: true } : m
            )
          );
        }
      } else if (event === 'message:deleted') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.id
                ? { ...m, isDeleted: true, content: 'This message was deleted' }
                : m
            )
          );
        }
      } else if (event === 'message:reaction') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.messageId ? { ...m, reactions: payload.reactions } : m
            )
          );
        }
      } else if (event === 'message:pinned') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === payload.messageId ? { ...m, isPinned: payload.isPinned } : m
            )
          );
        }
      } else if (event === 'typing:start') {
        if (payload.conversationId === activeConversationId && payload.userId !== me.id) {
          setTypingUsers((prev) => ({ ...prev, [payload.userId]: true }));
        }
      } else if (event === 'typing:stop') {
        if (payload.conversationId === activeConversationId) {
          setTypingUsers((prev) => ({ ...prev, [payload.userId]: false }));
        }
      } else if (event === 'presence:update' || event === 'conversation:refresh' || event === 'friend:accepted') {
        onRefreshConversations();
      }
    });

    return () => {
      unsub();
    };
  }, [activeConversationId, me.id]);

  const emitTyping = (text: string) => {
    setComposerText(text);
    if (!activeConversationId) return;
    realtime.send('typing:start', { conversationId: activeConversationId });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      realtime.send('typing:stop', { conversationId: activeConversationId });
    }, 1600);
  };

  const sendMessage = async (
    content: string,
    messageType: ChatMessage['messageType'] = 'text',
    metadata: Record<string, any> = {}
  ) => {
    if (!activeConversationId) return;

    if (editingMsg) {
      await apiFetch(`/api/messages/${editingMsg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content }),
      });
      setEditingMsg(null);
      setComposerText('');
      return;
    }

    const tempId = `local-${Date.now()}`;
    const optimistic: ChatMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: me.id,
      senderName: me.fullName,
      senderAvatar: me.avatarUrl,
      content,
      messageType,
      replyToId: replyTo?.id || null,
      replyTo: replyTo
        ? {
            id: replyTo.id,
            content: replyTo.content,
            messageType: replyTo.messageType,
            senderName: replyTo.senderName,
          }
        : null,
      forwardedFromId: null,
      metadata,
      isEdited: false,
      isDeleted: false,
      isPinned: false,
      isStarred: false,
      status: 'sent',
      reactions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pendingLocal: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setComposerText('');
    setReplyTo(null);
    realtime.send('typing:stop', { conversationId: activeConversationId });
    window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);

    try {
      const res = await apiFetch<{ message: ChatMessage }>(
        `/api/conversations/${activeConversationId}/messages`,
        {
          method: 'POST',
          body: JSON.stringify({
            content,
            messageType,
            replyToId: optimistic.replyToId,
            metadata,
          }),
        }
      );
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === res.message.id)
          ? withoutTemp
          : [...withoutTemp, res.message];
      });
      onRefreshConversations();
    } catch {
      enqueueUnsentMessage({
        tempId,
        conversationId: activeConversationId,
        content,
        messageType,
        replyToId: optimistic.replyToId,
        metadata,
        createdAt: optimistic.createdAt,
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !activeConversationId) return;
    setAttachOpen(false);
    try {
      const uploaded = await uploadMediaFile(file, file.name);
      await sendMessage(uploaded.fileName, uploadKind, {
        fileUrl: uploaded.fileUrl,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
      });
    } catch (err) {
      console.error(err);
    }
  };

  const triggerPickMedia = (kind: 'image' | 'video' | 'document' | 'audio') => {
    setUploadKind(kind);
    const acceptMap = {
      image: 'image/*',
      video: 'video/*',
      audio: 'audio/*',
      document: '.pdf,.doc,.docx,.txt,.csv,.zip,*/*',
    };
    setUploadAccept(acceptMap[kind]);
    window.setTimeout(() => fileInputRef.current?.click(), 30);
  };

  const shareLocation = () => {
    setAttachOpen(false);
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        await sendMessage(`Shared location (${latitude.toFixed(4)}, ${longitude.toFixed(4)})`, 'location', {
          latitude,
          longitude,
        });
      },
      () => {
        // permission denied
      }
    );
  };

  const startVoiceRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        if (blob.size > 0) {
          const uploaded = await uploadMediaFile(blob, `voice-${Date.now()}.webm`);
          await sendMessage('Voice message', 'voice', {
            fileUrl: uploaded.fileUrl,
            durationSeconds: recordingSeconds,
          });
        }
        setRecordingSeconds(0);
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = window.setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch {
      // mic denied
    }
  };

  const stopVoiceRecording = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      if (listFilter === 'archived' && !c.archived) return false;
      if (listFilter !== 'archived' && c.archived) return false;
      if (listFilter === 'unread' && c.unreadCount === 0) return false;
      if (listFilter === 'groups' && c.type !== 'group') return false;
      if (!searchTerm.trim()) return true;
      const q = searchTerm.toLowerCase();
      return (
        c.title.toLowerCase().includes(q) ||
        (c.peer?.rikzenId || '').toLowerCase().includes(q) ||
        (c.lastMessage?.content || '').toLowerCase().includes(q)
      );
    });
  }, [conversations, listFilter, searchTerm]);

  const displayedMessages = useMemo(() => {
    if (!chatSearchQuery.trim()) return messages;
    const q = chatSearchQuery.toLowerCase();
    return messages.filter((m) => m.content.toLowerCase().includes(q));
  }, [messages, chatSearchQuery]);

  const pinnedMessage = useMemo(() => messages.find((m) => m.isPinned), [messages]);
  const isPeerTyping = Object.values(typingUsers).some(Boolean);

  const wallpaperBg = () => {
    const wp = me.appearanceSettings?.wallpaper || 'obsidian-web';
    if (wp === 'obsidian-web') {
      return {
        backgroundImage: `linear-gradient(rgba(9,9,11,0.72), rgba(9,9,11,0.82)), url('/src/assets/images/rikzen_chat_wallpaper_1794652829386.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    if (wp === 'emerald-silk') {
      return { background: 'radial-gradient(circle at top right, rgba(21,128,61,0.16), transparent 60%)' };
    }
    if (wp === 'champagne-mist') {
      return { background: 'radial-gradient(circle at top left, rgba(212,175,55,0.14), transparent 60%)' };
    }
    return {};
  };

  const formatDateGroup = (iso: string) => {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Today';
    const yest = new Date(today);
    yest.setDate(today.getDate() - 1);
    if (d.toDateString() === yest.toDateString()) return 'Yesterday';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-white dark:bg-[#09090B]">
      {/* Left Conversation List */}
      <aside
        className={`${
          activeConversationId ? 'hidden md:flex' : 'flex'
        } w-full md:w-[340px] lg:w-[360px] shrink-0 flex-col border-r border-black/10 dark:border-[#D4AF37]/15 bg-slate-50/70 dark:bg-[#0E0E12]`}
      >
        {/* List Header & Search */}
        <div className="p-3.5 space-y-3 border-b border-black/8 dark:border-white/8">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">Chats</h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenFindPeople}
                className="flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[#D4AF37]/15 px-3 text-xs font-semibold text-[#B8891F] dark:text-[#F5E6B3] hover:bg-[#D4AF37]/25"
                title="Find people by RIKZEN ID"
              >
                <UserPlus size={15} />
                <span>Add</span>
              </button>
              <button
                type="button"
                onClick={() => setCreateGroupOpen(true)}
                className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-black/10 dark:border-white/10 hover:border-[#D4AF37]"
                title="New Group"
                aria-label="Create new group"
              >
                <Users size={16} />
              </button>
            </div>
          </div>

          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search people, messages and RIKZEN IDs"
              className="h-10 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#16161B] pl-9 pr-3 text-xs focus:border-[#D4AF37] focus:outline-none"
            />
          </div>

          <div className="flex gap-1 overflow-x-auto">
            {(['all', 'unread', 'groups', 'archived'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setListFilter(f)}
                className={`min-h-[34px] rounded-lg px-3 text-xs font-medium capitalize transition ${
                  listFilter === f
                    ? 'bg-[#D4AF37] text-[#09090B] font-semibold'
                    : 'bg-black/5 dark:bg-white/5 text-slate-600 dark:text-[#9898A6]'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {/* Conversations */}
        <div className="flex-1 overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <p className="text-sm font-medium text-slate-500 dark:text-[#9898A6]">
                No conversations yet
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-[#9898A6]/80">
                Search for a friend using their permanent RIKZEN ID to start chatting.
              </p>
              <button
                type="button"
                onClick={onOpenFindPeople}
                className="mt-4 min-h-[42px] rounded-xl bg-[#D4AF37] px-4 text-xs font-semibold text-[#09090B]"
              >
                Find People
              </button>
            </div>
          ) : (
            filteredConversations.map((c) => {
              const selected = c.id === activeConversationId;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelectConversation(c.id)}
                  className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition ${
                    selected
                      ? 'bg-[#D4AF37]/15 dark:bg-[#D4AF37]/12'
                      : 'hover:bg-black/3 dark:hover:bg-white/4'
                  }`}
                >
                  <div className="relative h-12 w-12 shrink-0">
                    <div className="h-full w-full overflow-hidden rounded-full border border-[#D4AF37]/30 bg-[#141418]">
                      {c.avatarUrl ? (
                        <img src={c.avatarUrl} alt={c.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center font-display text-base font-bold text-[#D4AF37]">
                          {c.title.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    {c.type === 'direct' && c.peer?.isOnline && (
                      <span
                        className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white dark:border-[#0E0E12] bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.85)]"
                        aria-label="Online"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="truncate text-sm font-semibold">{c.title}</p>
                        {c.type === 'direct' && c.peer?.isOnline && (
                          <span className="shrink-0 text-[11px] font-semibold text-[#22C55E]">
                            Online
                          </span>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] tabular-nums text-slate-400">
                        {c.lastMessage
                          ? new Date(c.lastMessage.createdAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })
                          : ''}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">
                        {c.lastMessage
                          ? c.lastMessage.messageType === 'text'
                            ? c.lastMessage.content
                            : `Sent ${c.lastMessage.messageType}`
                          : c.type === 'group'
                          ? `${c.memberCount} members`
                          : 'Connected · Say hello'}
                      </p>
                      {c.unreadCount > 0 && (
                        <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#22C55E] px-1.5 text-[11px] font-bold tabular-nums text-[#09090B]">
                          {c.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Pane */}
      <section
        className={`${
          activeConversationId ? 'flex' : 'hidden md:flex'
        } flex-1 flex-col overflow-hidden bg-slate-100 dark:bg-[#09090B]`}
      >
        {!activeConv ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-[#D4AF37]/30 bg-[#111115]">
              <img
                src="/src/assets/images/rikzen_spider_emblem_1794652828706.jpg"
                alt="RIKZEN CHAT"
                referrerPolicy="no-referrer"
                className="h-16 w-16 rounded-full object-cover"
              />
            </div>
            <h2 className="mt-5 font-display text-2xl font-bold text-slate-900 dark:text-[#F5E6B3]">
              RIKZEN CHAT
            </h2>
            <p className="mt-1.5 max-w-sm text-sm text-slate-500 dark:text-[#9898A6]">
              Select a conversation or connect with friends using your permanent RIKZEN ID.
            </p>
            <button
              type="button"
              onClick={onOpenFindPeople}
              className="mt-5 flex min-h-[44px] items-center gap-2 rounded-xl bg-[#D4AF37] px-5 text-xs font-semibold text-[#09090B]"
            >
              <UserPlus size={16} />
              <span>Find People by RIKZEN ID</span>
            </button>
          </div>
        ) : (
          <>
            {/* Chat Header */}
            <header className="flex items-center justify-between border-b border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] px-3 sm:px-5 py-3">
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectConversation(null)}
                  className="flex md:hidden h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Back to chats"
                >
                  <ChevronLeft size={22} />
                </button>
                <div className="relative h-10 w-10 shrink-0">
                  <div className="h-full w-full overflow-hidden rounded-full border border-[#D4AF37]/40 bg-[#09090B]">
                    {activeConv.avatarUrl ? (
                      <img src={activeConv.avatarUrl} alt={activeConv.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center font-bold text-[#D4AF37]">
                        {activeConv.title.charAt(0).toUpperCase()}
                      </div>
                    )}
                  </div>
                  {activeConv.type === 'direct' && activeConv.peer?.isOnline && (
                    <span
                      className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-[#111115] bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.85)]"
                      aria-label="Online"
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-sm">{activeConv.title}</h3>
                  <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">
                    {isPeerTyping ? (
                      <span className="text-[#22C55E] font-semibold">typing...</span>
                    ) : activeConv.type === 'group' ? (
                      `${activeConv.memberCount} members`
                    ) : activeConv.peer?.isOnline ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#22C55E]">
                        <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
                        Online
                      </span>
                    ) : activeConv.peer?.lastSeenAt ? (
                      `Last seen ${new Date(activeConv.peer.lastSeenAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    ) : (
                      activeConv.peer?.rikzenId || 'RIKZEN Connection'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1">
                {activeConv.type === 'direct' && activeConv.peer && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onStartCall(
                          { id: activeConv.peer!.id, name: activeConv.title, avatar: activeConv.avatarUrl },
                          'voice'
                        )
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#D4AF37]"
                      aria-label="Voice call"
                    >
                      <Phone size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onStartCall(
                          { id: activeConv.peer!.id, name: activeConv.title, avatar: activeConv.avatarUrl },
                          'video'
                        )
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#D4AF37]"
                      aria-label="Video call"
                    >
                      <Video size={18} />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => setChatSearchOpen(!chatSearchOpen)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Search chat history"
                >
                  <Search size={18} />
                </button>
                <button
                  type="button"
                  onClick={() => setInfoPanelOpen(!infoPanelOpen)}
                  className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Conversation info"
                >
                  <Info size={18} />
                </button>
              </div>
            </header>

            {/* In-chat Search Bar */}
            {chatSearchOpen && (
              <div className="flex items-center gap-2 border-b border-black/10 dark:border-white/10 bg-white dark:bg-[#141418] px-4 py-2">
                <Search size={15} className="text-slate-400" />
                <input
                  type="text"
                  autoFocus
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder="Search messages in this chat..."
                  className="h-9 flex-1 bg-transparent text-sm focus:outline-none"
                />
                <button type="button" onClick={() => { setChatSearchOpen(false); setChatSearchQuery(''); }}>
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Pinned Message Banner */}
            {pinnedMessage && (
              <div className="flex items-center justify-between border-b border-[#D4AF37]/25 bg-[#D4AF37]/10 px-4 py-2 text-xs">
                <div className="flex items-center gap-2 truncate">
                  <Pin size={13} className="text-[#D4AF37] shrink-0" />
                  <span className="truncate font-medium">Pinned: {pinnedMessage.content}</span>
                </div>
              </div>
            )}

            {/* Message Feed */}
            <div
              className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 space-y-2.5"
              style={me.appearanceSettings?.theme === 'dark' ? wallpaperBg() : {}}
            >
              {hasMore && (
                <div className="flex justify-center pb-2">
                  <button
                    type="button"
                    onClick={() => messages[0] && loadMessages(activeConv.id, messages[0].createdAt)}
                    className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 text-xs text-white"
                  >
                    Load older messages
                  </button>
                </div>
              )}

              {loadingMsgs ? (
                <div className="py-12 text-center text-sm text-slate-500">Loading messages...</div>
              ) : displayedMessages.length === 0 ? (
                <div className="py-16 text-center text-sm text-slate-500 dark:text-[#9898A6]">
                  No messages yet. Start the conversation below!
                </div>
              ) : (
                displayedMessages.map((msg, idx) => {
                  const mine = msg.senderId === me.id;
                  const prevDate = idx > 0 ? formatDateGroup(displayedMessages[idx - 1].createdAt) : null;
                  const currDate = formatDateGroup(msg.createdAt);
                  const showDateHeader = currDate !== prevDate;

                  // Group reactions by emoji
                  const reactionCounts = msg.reactions.reduce<Record<string, number>>((acc, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {});

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateHeader && (
                        <div className="my-3 flex justify-center">
                          <span className="text-[11px] font-medium text-slate-500 dark:text-[#9898A6] bg-white/80 dark:bg-[#141418]/90 px-3 py-1 rounded-lg border border-black/5 dark:border-white/10">
                            {currDate}
                          </span>
                        </div>
                      )}

                      <div className={`group flex ${mine ? 'justify-end' : 'justify-start'}`}>
                        <div className={`relative max-w-[82%] sm:max-w-[68%]`}>
                          <div
                            className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${
                              mine
                                ? 'bg-[#1F1A0E] text-[#F5F5F7] border border-[#D4AF37]/30 rounded-br-sm'
                                : 'bg-white dark:bg-[#16161C] text-slate-900 dark:text-[#F5F5F7] border border-black/8 dark:border-white/8 rounded-bl-sm'
                            }`}
                          >
                            {activeConv.type === 'group' && !mine && (
                              <p className="mb-1 text-[11px] font-semibold text-[#D4AF37]">{msg.senderName}</p>
                            )}

                            {msg.replyTo && (
                              <div className="mb-2 rounded-lg bg-black/15 dark:bg-black/35 px-2.5 py-1.5 text-xs border-l-2 border-[#D4AF37]">
                                <p className="font-semibold text-[#D4AF37]">{msg.replyTo.senderName}</p>
                                <p className="truncate opacity-80">{msg.replyTo.content}</p>
                              </div>
                            )}

                            {/* Media Renderers */}
                            {!msg.isDeleted && msg.messageType === 'image' && msg.metadata?.fileUrl && (
                              <div className="mb-1.5 space-y-1">
                                <img
                                  src={msg.metadata.fileUrl}
                                  alt={msg.content}
                                  className="max-h-72 rounded-xl object-cover"
                                />
                                <a
                                  href={msg.metadata.fileUrl}
                                  download={msg.metadata.fileName || 'image'}
                                  className="inline-flex items-center gap-1 text-[11px] text-[#D4AF37] hover:underline"
                                >
                                  <Download size={12} /> Download photo
                                </a>
                              </div>
                            )}

                            {!msg.isDeleted && msg.messageType === 'video' && msg.metadata?.fileUrl && (
                              <video src={msg.metadata.fileUrl} controls className="mb-1.5 max-h-72 rounded-xl" />
                            )}

                            {!msg.isDeleted &&
                              (msg.messageType === 'voice' || msg.messageType === 'audio') &&
                              msg.metadata?.fileUrl && (
                                <audio src={msg.metadata.fileUrl} controls className="mb-1 max-w-full" />
                              )}

                            {!msg.isDeleted && msg.messageType === 'document' && msg.metadata?.fileUrl && (
                              <a
                                href={msg.metadata.fileUrl}
                                download={msg.metadata.fileName || msg.content}
                                className="mb-1.5 flex items-center gap-2.5 rounded-xl bg-black/15 dark:bg-black/35 p-2.5 text-xs hover:bg-black/25"
                              >
                                <FileText size={18} className="text-[#D4AF37]" />
                                <span className="truncate flex-1">{msg.metadata.fileName || msg.content}</span>
                                <Download size={14} />
                              </a>
                            )}

                            {!msg.isDeleted && msg.messageType === 'location' && msg.metadata?.latitude && (
                              <a
                                href={`https://maps.google.com/?q=${msg.metadata.latitude},${msg.metadata.longitude}`}
                                target="_blank"
                                rel="noreferrer"
                                className="mb-1 flex items-center gap-2 rounded-xl bg-emerald-600/15 p-2.5 text-xs text-emerald-400 hover:underline"
                              >
                                <MapPin size={15} />
                                <span>
                                  Location: {Number(msg.metadata.latitude).toFixed(4)},{' '}
                                  {Number(msg.metadata.longitude).toFixed(4)}
                                </span>
                              </a>
                            )}

                            {(msg.messageType === 'text' || msg.isDeleted) && (
                              <p
                                className={`text-sm leading-relaxed whitespace-pre-wrap break-words ${
                                  msg.isDeleted ? 'italic opacity-60' : ''
                                }`}
                              >
                                {msg.content}
                              </p>
                            )}

                            {/* Footer: Timestamp + Ticks */}
                            <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] opacity-70 tabular-nums">
                              {msg.isStarred && <Star size={10} className="fill-[#D4AF37] text-[#D4AF37]" />}
                              {msg.isEdited && <span>edited</span>}
                              <span>
                                {new Date(msg.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {mine && !msg.isDeleted && (
                                <span>
                                  {msg.pendingLocal ? (
                                    <Check size={12} className="opacity-50" />
                                  ) : msg.status === 'read' ? (
                                    <CheckCheck size={13} className="text-[#38BDF8]" />
                                  ) : msg.status === 'delivered' ? (
                                    <CheckCheck size={13} />
                                  ) : (
                                    <Check size={13} />
                                  )}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Reactions Strip */}
                          {Object.keys(reactionCounts).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(reactionCounts).map(([em, count]) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={() =>
                                    apiFetch(`/api/messages/${msg.id}/react`, {
                                      method: 'POST',
                                      body: JSON.stringify({ emoji: em }),
                                    })
                                  }
                                  className="rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#141418] px-1.5 py-0.5 text-xs shadow-sm"
                                >
                                  {em} {count}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Hover / Tap Message Actions */}
                          {!msg.isDeleted && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveMsgMenuId(activeMsgMenuId === msg.id ? null : msg.id)
                              }
                              className={`absolute top-1 ${
                                mine ? '-left-8' : '-right-8'
                              } flex h-7 w-7 items-center justify-center rounded-lg bg-black/20 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100`}
                              aria-label="Message options"
                            >
                              <MoreVertical size={14} />
                            </button>
                          )}

                          {activeMsgMenuId === msg.id && (
                            <div
                              className={`absolute z-30 mt-1 w-48 rounded-xl border border-white/15 bg-[#141418] p-1.5 text-xs text-white shadow-2xl ${
                                mine ? 'right-0' : 'left-0'
                              }`}
                            >
                              <div className="flex justify-between px-1.5 py-1 border-b border-white/10 mb-1">
                                {QUICK_EMOJIS.slice(0, 6).map((em) => (
                                  <button
                                    key={em}
                                    type="button"
                                    onClick={() => {
                                      apiFetch(`/api/messages/${msg.id}/react`, {
                                        method: 'POST',
                                        body: JSON.stringify({ emoji: em }),
                                      });
                                      setActiveMsgMenuId(null);
                                    }}
                                    className="hover:scale-125 transition text-sm"
                                  >
                                    {em}
                                  </button>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setReplyTo(msg);
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Reply size={13} /> Reply
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setForwardingMsg(msg);
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Forward size={13} /> Forward
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.content).catch(() => {});
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Copy size={13} /> Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  apiFetch(`/api/messages/${msg.id}/pin`, { method: 'POST' });
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Pin size={13} /> {msg.isPinned ? 'Unpin' : 'Pin'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiFetch(`/api/messages/${msg.id}/star`, { method: 'POST' });
                                  setMessages((prev) =>
                                    prev.map((m) => (m.id === msg.id ? { ...m, isStarred: res.isStarred } : m))
                                  );
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Star size={13} /> {msg.isStarred ? 'Unstar' : 'Star'}
                              </button>
                              {mine && msg.messageType === 'text' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingMsg(msg);
                                    setComposerText(msg.content);
                                    setActiveMsgMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                                >
                                  <Pencil size={13} /> Edit
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={async () => {
                                  await apiFetch(`/api/messages/${msg.id}?scope=me`, { method: 'DELETE' });
                                  setMessages((prev) => prev.filter((m) => m.id !== msg.id));
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-red-400 hover:bg-red-500/10"
                              >
                                <Trash2 size={13} /> Delete for me
                              </button>
                              {mine && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch(`/api/messages/${msg.id}?scope=everyone`, { method: 'DELETE' });
                                    setActiveMsgMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-red-400 hover:bg-red-500/10"
                                >
                                  <Trash2 size={13} /> Delete for everyone
                                </button>
                              )}
                              {!mine && (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await apiFetch('/api/reports', {
                                      method: 'POST',
                                      body: JSON.stringify({
                                        targetType: 'message',
                                        targetId: msg.id,
                                        reason: 'Abusive message reported',
                                      }),
                                    });
                                    setActiveMsgMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-amber-400 hover:bg-white/10"
                                >
                                  <Flag size={13} /> Report message
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            {/* Reply / Edit Banner */}
            {(replyTo || editingMsg) && (
              <div className="flex items-center justify-between border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#141418] px-4 py-2 text-xs">
                <div className="truncate">
                  <span className="font-semibold text-[#D4AF37]">
                    {editingMsg ? 'Editing message: ' : `Replying to ${replyTo?.senderName}: `}
                  </span>
                  <span className="opacity-80">{(editingMsg || replyTo)?.content}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReplyTo(null);
                    setEditingMsg(null);
                    setComposerText('');
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            )}

            {/* Composer Bar */}
            {activeConv.isBlocked ? (
              <div className="border-t border-white/10 bg-[#111115] p-3 text-center text-xs text-red-400">
                Messaging is unavailable because this user is blocked.
              </div>
            ) : activeConv.type === 'group' &&
              activeConv.onlyAdminsMessage &&
              activeConv.myRole === 'member' ? (
              <div className="border-t border-white/10 bg-[#111115] p-3 text-center text-xs text-[#9898A6]">
                Only group administrators can send messages in this group.
              </div>
            ) : (
              <div className="relative border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] px-2.5 sm:px-4 py-2.5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={uploadAccept}
                  className="hidden"
                  onChange={handleFileUpload}
                />

                {emojiOpen && (
                  <div className="absolute bottom-16 left-3 z-30 grid grid-cols-8 gap-1.5 rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-3 shadow-2xl">
                    {PICKER_EMOJIS.map((em) => (
                      <button
                        key={em}
                        type="button"
                        onClick={() => setComposerText((t) => t + em)}
                        className="flex h-9 w-9 items-center justify-center rounded-lg text-lg hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        {em}
                      </button>
                    ))}
                  </div>
                )}

                {attachOpen && (
                  <div className="absolute bottom-16 left-12 z-30 w-52 rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-2 shadow-2xl space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('image')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <ImageIcon size={16} className="text-[#D4AF37]" /> Photo
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('video')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Video size={16} className="text-purple-400" /> Video
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('document')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <FileText size={16} className="text-sky-400" /> Document / PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('audio')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <Mic size={16} className="text-amber-400" /> Audio File
                    </button>
                    <button
                      type="button"
                      onClick={shareLocation}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <MapPin size={16} className="text-emerald-400" /> Share Location
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!composerText.trim()) return;
                    sendMessage(composerText.trim(), 'text');
                  }}
                  className="flex items-center gap-1.5 sm:gap-2"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setEmojiOpen(!emojiOpen);
                      setAttachOpen(false);
                    }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-[#D4AF37]"
                    aria-label="Emoji picker"
                  >
                    <Smile size={20} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAttachOpen(!attachOpen);
                      setEmojiOpen(false);
                    }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-[#D4AF37]"
                    aria-label="Attachments"
                  >
                    <Paperclip size={20} />
                  </button>

                  {recording ? (
                    <div className="flex h-11 flex-1 items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-xs text-red-400">
                      <span>Recording voice message... {recordingSeconds}s</span>
                      <button
                        type="button"
                        onClick={stopVoiceRecording}
                        className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white"
                      >
                        <Square size={12} /> Stop & Send
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      value={composerText}
                      onChange={(e) => emitTyping(e.target.value)}
                      placeholder="Message..."
                      className="h-11 flex-1 rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#18181D] px-4 text-sm focus:border-[#D4AF37] focus:outline-none"
                    />
                  )}

                  {composerText.trim() ? (
                    <button
                      type="submit"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37] text-[#09090B] hover:bg-[#E5C76B]"
                      aria-label="Send message"
                    >
                      <Send size={18} />
                    </button>
                  ) : !recording ? (
                    <button
                      type="button"
                      onClick={startVoiceRecording}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#D4AF37]/15 text-[#D4AF37] hover:bg-[#D4AF37]/25"
                      aria-label="Record voice message"
                    >
                      <Mic size={19} />
                    </button>
                  ) : null}
                </form>
              </div>
            )}
          </>
        )}
      </section>

      {/* Right Contact / Group Info Panel */}
      {infoPanelOpen && activeConv && (
        <aside className="hidden lg:flex w-[300px] shrink-0 flex-col border-l border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] p-5 overflow-y-auto">
          <div className="flex items-center justify-between pb-4 border-b border-black/10 dark:border-white/10">
            <h4 className="font-display font-bold">
              {activeConv.type === 'group' ? 'Group Info' : 'Contact Info'}
            </h4>
            <button type="button" onClick={() => setInfoPanelOpen(false)}>
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 flex flex-col items-center text-center">
            <div className="relative h-24 w-24">
              <div className="h-full w-full overflow-hidden rounded-full border-2 border-[#D4AF37]">
                {activeConv.avatarUrl ? (
                  <img src={activeConv.avatarUrl} alt={activeConv.title} referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[#18181D] font-display text-3xl font-bold text-[#D4AF37]">
                    {activeConv.title.charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              {activeConv.type === 'direct' && activeConv.peer?.isOnline && (
                <span
                  className="absolute bottom-1 right-1 h-4 w-4 rounded-full border-2 border-white dark:border-[#111115] bg-[#22C55E] shadow-[0_0_8px_rgba(34,197,94,0.85)]"
                  aria-label="Online"
                />
              )}
            </div>
            <h5 className="mt-3 font-display text-lg font-bold">{activeConv.title}</h5>
            {activeConv.peer && (
              <>
                <p className="font-mono-id text-xs text-[#D4AF37] mt-0.5">{activeConv.peer.rikzenId}</p>
                {activeConv.peer.isOnline && (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#22C55E]">
                    <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
                    Online
                  </p>
                )}
                {activeConv.peer.bio && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-[#9898A6]">{activeConv.peer.bio}</p>
                )}
              </>
            )}
            {activeConv.type === 'group' && activeConv.description && (
              <p className="mt-2 text-xs text-slate-500 dark:text-[#9898A6]">{activeConv.description}</p>
            )}
          </div>

          <div className="mt-6 space-y-2 border-t border-black/10 dark:border-white/10 pt-5">
            {activeConv.type === 'group' && activeConv.groupId && (
              <button
                type="button"
                onClick={() => setManageGroupId(activeConv.groupId!)}
                className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3.5 text-xs font-semibold text-[#D4AF37]"
              >
                <Users size={15} /> Manage Group & Members
              </button>
            )}

            <button
              type="button"
              onClick={async () => {
                await apiFetch(`/api/conversations/${activeConv.id}/mute`, {
                  method: 'POST',
                  body: JSON.stringify({ muted: !activeConv.muted }),
                });
                onRefreshConversations();
              }}
              className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 px-3.5 text-xs font-medium"
            >
              <VolumeX size={15} /> {activeConv.muted ? 'Unmute Notifications' : 'Mute Notifications'}
            </button>

            <button
              type="button"
              onClick={async () => {
                await apiFetch(`/api/conversations/${activeConv.id}/archive`, {
                  method: 'POST',
                  body: JSON.stringify({ archived: !activeConv.archived }),
                });
                onSelectConversation(null);
                onRefreshConversations();
              }}
              className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 px-3.5 text-xs font-medium"
            >
              <Archive size={15} /> {activeConv.archived ? 'Unarchive Chat' : 'Archive Chat'}
            </button>

            {activeConv.type === 'direct' && activeConv.peer && (
              <>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/friends/block', {
                      method: 'POST',
                      body: JSON.stringify({ targetUserId: activeConv.peer!.id }),
                    });
                    onRefreshConversations();
                  }}
                  className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 text-xs font-medium text-red-400"
                >
                  <Ban size={15} /> Block User
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await apiFetch('/api/reports', {
                      method: 'POST',
                      body: JSON.stringify({
                        targetType: 'user',
                        targetId: activeConv.peer!.id,
                        reason: 'User reported from chat info panel',
                      }),
                    });
                  }}
                  className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-medium text-amber-400"
                >
                  <Flag size={15} /> Report User
                </button>
              </>
            )}
          </div>
        </aside>
      )}

      {/* Forward Message Modal */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h4 className="font-display font-semibold">Forward Message</h4>
              <button type="button" onClick={() => setForwardingMsg(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    await apiFetch(`/api/conversations/${c.id}/messages`, {
                      method: 'POST',
                      body: JSON.stringify({
                        content: forwardingMsg.content,
                        messageType: forwardingMsg.messageType,
                        forwardedFromId: forwardingMsg.id,
                        metadata: forwardingMsg.metadata,
                      }),
                    });
                    setForwardingMsg(null);
                    onRefreshConversations();
                  }}
                  className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#09090B] p-3 text-left text-sm hover:border-[#D4AF37]"
                >
                  <span>{c.title}</span>
                  <Forward size={14} className="text-[#D4AF37]" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {createGroupOpen && (
        <CreateGroupModal
          onClose={() => setCreateGroupOpen(false)}
          onCreated={async (convId) => {
            await onRefreshConversations();
            onSelectConversation(convId);
          }}
        />
      )}

      {manageGroupId && (
        <GroupManageModal
          groupId={manageGroupId}
          me={me}
          onClose={() => setManageGroupId(null)}
          onUpdated={onRefreshConversations}
        />
      )}
    </div>
  );
};
