import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  Ban,
  Camera,
  Check,
  CheckCheck,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Download,
  Eraser,
  ExternalLink,
  FileDown,
  FileText,
  Flag,
  FolderOpen,
  Forward,
  Image as ImageIcon,
  ListPlus,
  MapPin,
  Mic,
  MoreVertical,
  Palette,
  Paperclip,
  Pencil,
  Phone,
  Pin,
  RefreshCw,
  Reply,
  Search,
  Send,
  Smile,
  Square,
  Star,
  Timer,
  Trash2,
  User,
  UserPlus,
  Users,
  Video,
  VolumeX,
  X,
} from 'lucide-react';
import { subscribeDirectMessagesFirestore } from '../lib/firebaseBackend';
import { setTypingActivityFirestore } from '../lib/firestore';
import {
  apiFetch,
  enqueueUnsentMessage,
  getUnsentQueue,
  isServerlessFirebaseMode,
  realtime,
  removeUnsentMessage,
  uploadMediaFile,
  validateUploadFile,
} from '../services/api';
import {
  detectSupportedAudioMime,
  downloadMediaFile,
  extractVideoMetadata,
  formatMediaDuration,
  type UploadCategory,
} from '../lib/mediaUtils';
import type { ChatMessage, ConversationSummary, UserProfile } from '../types/rikzen';
import { CreateGroupModal, GroupManageModal } from './GroupModals';
import { VoiceNotePlayer } from './VoiceNotePlayer';

interface ChatWorkspaceProps {
  me: UserProfile;
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onSelectConversation: (id: string | null) => void;
  onRefreshConversations: () => Promise<void>;
  onOpenFindPeople: () => void;
  onStartCall: (peer: { id: string; name: string; avatar: string | null }, callType: 'voice' | 'video') => void;
}

interface StagedMediaItem {
  id: string;
  file: File;
  previewUrl: string;
  kind: 'image' | 'video' | 'document' | 'audio';
}

const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏', '🔥', '✨'];
const PICKER_EMOJIS = [
  '😀', '😂', '🥰', '😍', '🤩', '😎', '🤔', '🙌',
  '👏', '👍', '❤️', '🔥', '✨', '🎉', '🙏', '🤝',
  '💯', '🚀', '💬', '🎧', '📸', '📍', '⚡', '🕷️',
];

const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return 'Offline';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Offline';
  const diffSec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return 'Last seen just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Last seen ${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const today = new Date();
  const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Last seen today at ${timeStr}`;
  const yest = new Date(today);
  yest.setDate(today.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `Last seen yesterday at ${timeStr}`;
  return `Last seen ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
}

function renderLinkifiedText(text: string): React.ReactNode {
  const parts = text.split(URL_REGEX);
  return parts.map((part, idx) => {
    if (part.match(/^https?:\/\//)) {
      return (
        <a
          key={idx}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-[#D4AF37]/80 underline-offset-2 text-[#F5E6B3] dark:text-[#F5E6B3] hover:text-[#D4AF37]"
        >
          {part}
        </a>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);

  const [composerText, setComposerText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsgs, setForwardingMsgs] = useState<ChatMessage[] | null>(null);
  const [activeMsgMenuId, setActiveMsgMenuId] = useState<string | null>(null);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(new Set());

  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [infoPanelOpen, setInfoPanelOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [headerSubMenu, setHeaderSubMenu] = useState<'root' | 'disappearing' | 'theme' | 'more'>('root');
  const [sharedMediaOpen, setSharedMediaOpen] = useState(false);
  const [sharedTab, setSharedTab] = useState<'media' | 'links' | 'docs'>('media');
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [listInput, setListInput] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [manageGroupId, setManageGroupId] = useState<string | null>(null);

  // Typing & Recording indicators (convId -> 'typing' | 'recording')
  const [peerActivities, setPeerActivities] = useState<Record<string, 'typing' | 'recording' | null>>({});

  // Voice recording + pre-send audio preview
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordedAudio, setRecordedAudio] = useState<{
    blob: Blob;
    url: string;
    duration: number;
    mimeType: string;
    ext: string;
  } | null>(null);
  const [sendingVoice, setSendingVoice] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);
  const recordingCancelledRef = useRef(false);
  const recordingSecRef = useRef(0);
  const typingTimeoutRef = useRef<number | null>(null);

  // Staged file pre-send preview modal + progress
  const [stagedFiles, setStagedFiles] = useState<StagedMediaItem[]>([]);
  const [stagedCaption, setStagedCaption] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; name: string } | null>(null);

  // Camera capture modal
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'user' | 'environment'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || null,
    [conversations, activeConversationId]
  );

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 2800);
  };

  // Mark messages read ONLY when active conversation is actually open and tab visible
  const markActiveConversationRead = (convId: string) => {
    if (document.visibilityState !== 'visible') return;
    apiFetch(`/api/conversations/${convId}/read`, { method: 'POST' })
      .then(() => onRefreshConversations())
      .catch(() => {});
  };

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
        markActiveConversationRead(convId);
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
    setMultiSelectMode(false);
    setSelectedMsgIds(new Set());
    setActiveMsgMenuId(null);
    setHeaderMenuOpen(false);
    setHeaderSubMenu('root');
    setInfoPanelOpen(false);
    setChatSearchOpen(false);
    setChatSearchQuery('');
    setSharedMediaOpen(false);

    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    if (isServerlessFirebaseMode()) {
      setLoadingMsgs(true);
      const unsub = subscribeDirectMessagesFirestore(activeConversationId, me.id, (msgs) => {
        setMessages(msgs);
        setLoadingMsgs(false);
        const hasUnreadIncoming = msgs.some((m) => m.senderId !== me.id && m.status !== 'read');
        if (hasUnreadIncoming && document.visibilityState === 'visible') {
          markActiveConversationRead(activeConversationId);
        }
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

  // WebSocket live message, receipt, reaction, typing & recording listener
  useEffect(() => {
    const unsub = realtime.subscribe((event, payload) => {
      if (event === 'ws:ready') {
        flushOfflineQueue();
      } else if (event === 'message:new') {
        const msg = payload as ChatMessage;
        onRefreshConversations();
        if (msg.conversationId === activeConversationId) {
          setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
          if (msg.senderId !== me.id && document.visibilityState === 'visible') {
            markActiveConversationRead(msg.conversationId);
          }
          window.setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 40);
        }
      } else if (event === 'message:delivered') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              payload.messageIds?.includes(m.id) && m.status === 'sent'
                ? { ...m, status: 'delivered' }
                : m
            )
          );
        }
        onRefreshConversations();
      } else if (event === 'message:read') {
        if (payload.conversationId === activeConversationId) {
          setMessages((prev) =>
            prev.map((m) =>
              payload.messageIds?.includes(m.id) ? { ...m, status: 'read' } : m
            )
          );
        }
        onRefreshConversations();
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
        if (payload.userId !== me.id) {
          setPeerActivities((prev) => ({ ...prev, [payload.conversationId]: 'typing' }));
        }
      } else if (event === 'typing:stop') {
        if (payload.userId !== me.id) {
          setPeerActivities((prev) => ({ ...prev, [payload.conversationId]: null }));
        }
      } else if (event === 'recording:start') {
        if (payload.userId !== me.id) {
          setPeerActivities((prev) => ({ ...prev, [payload.conversationId]: 'recording' }));
        }
      } else if (event === 'recording:stop') {
        if (payload.userId !== me.id) {
          setPeerActivities((prev) => ({ ...prev, [payload.conversationId]: null }));
        }
      } else if (
        event === 'presence:update' ||
        event === 'profile:updated' ||
        event === 'conversation:refresh' ||
        event === 'friend:accepted'
      ) {
        onRefreshConversations();
      }
    });

    return () => unsub();
  }, [activeConversationId, me.id]);

  // Auto-resize composer textarea
  const adjustTextareaHeight = () => {
    const el = composerInputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const emitTyping = (text: string) => {
    setComposerText(text);
    window.setTimeout(adjustTextareaHeight, 0);
    if (!activeConversationId) return;

    if (isServerlessFirebaseMode()) {
      setTypingActivityFirestore(activeConversationId, text.trim() ? 'typing' : 'idle');
    } else {
      realtime.send('typing:start', { conversationId: activeConversationId });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = window.setTimeout(() => {
      if (isServerlessFirebaseMode()) {
        setTypingActivityFirestore(activeConversationId, 'idle');
      } else {
        realtime.send('typing:stop', { conversationId: activeConversationId });
      }
    }, 1800);
  };

  const sendMessage = async (
    content: string,
    messageType: ChatMessage['messageType'] = 'text',
    metadata: Record<string, any> = {},
    existingTempId?: string
  ) => {
    if (!activeConversationId) return;

    if (editingMsg && !existingTempId) {
      await apiFetch(`/api/messages/${editingMsg.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ content, conversationId: activeConversationId }),
      });
      setMessages((prev) =>
        prev.map((m) => (m.id === editingMsg.id ? { ...m, content, isEdited: true } : m))
      );
      setEditingMsg(null);
      setComposerText('');
      return;
    }

    const tempId = existingTempId || `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
      failedLocal: false,
    };

    if (existingTempId) {
      setMessages((prev) =>
        prev.map((m) => (m.id === existingTempId ? { ...m, pendingLocal: true, failedLocal: false } : m))
      );
    } else {
      setMessages((prev) => [...prev, optimistic]);
      setComposerText('');
      if (composerInputRef.current) composerInputRef.current.style.height = '44px';
      setReplyTo(null);
    }

    if (isServerlessFirebaseMode()) {
      setTypingActivityFirestore(activeConversationId, 'idle');
    } else {
      realtime.send('typing:stop', { conversationId: activeConversationId });
    }
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
      removeUnsentMessage(tempId);
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        return withoutTemp.some((m) => m.id === res.message.id)
          ? withoutTemp
          : [...withoutTemp, res.message];
      });
      onRefreshConversations();
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === tempId ? { ...m, pendingLocal: false, failedLocal: true } : m
        )
      );
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

  // File picking -> stage into Pre-send Preview Modal
  const categoryForKind = (kind: StagedMediaItem['kind']): UploadCategory => {
    if (kind === 'image' || kind === 'video') return 'chat-media';
    if (kind === 'document') return 'chat-documents';
    return 'voice-messages';
  };

  const handleFilePick = (
    e: React.ChangeEvent<HTMLInputElement>,
    forcedKind: StagedMediaItem['kind']
  ) => {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (picked.length === 0 || !activeConversationId) return;
    setAttachOpen(false);
    setUploadError(null);

    const newStaged: StagedMediaItem[] = [];
    for (const f of picked) {
      const kind: StagedMediaItem['kind'] = f.type.startsWith('image/')
        ? 'image'
        : f.type.startsWith('video/')
        ? 'video'
        : f.type.startsWith('audio/')
        ? 'audio'
        : forcedKind;
      try {
        validateUploadFile(f, f.name, categoryForKind(kind));
        newStaged.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          file: f,
          previewUrl: URL.createObjectURL(f),
          kind,
        });
      } catch (err: any) {
        showToast(err?.message || 'Unsupported or oversized file.');
      }
    }
    if (newStaged.length > 0) {
      setStagedFiles((prev) => [...prev, ...newStaged]);
    }
  };

  const clearStagedFiles = () => {
    stagedFiles.forEach((s) => URL.revokeObjectURL(s.previewUrl));
    setStagedFiles([]);
    setStagedCaption('');
    setUploadProgress(0);
    setUploadError(null);
  };

  const sendStagedMedia = async () => {
    if (!activeConversationId || stagedFiles.length === 0) return;
    setUploadingFiles(true);
    setUploadError(null);
    try {
      for (let i = 0; i < stagedFiles.length; i++) {
        const item = stagedFiles[i];
        const category = categoryForKind(item.kind);
        let durationSeconds: number | undefined;
        let thumbnailUrl: string | undefined;

        if (item.kind === 'video') {
          const meta = await extractVideoMetadata(item.file);
          if (meta.durationSeconds > 0) {
            durationSeconds = meta.durationSeconds;
          }
          if (meta.thumbnailBlob) {
            try {
              const thumbUp = await uploadMediaFile(
                meta.thumbnailBlob,
                `thumb-${Date.now()}.jpg`,
                undefined,
                'chat-media'
              );
              thumbnailUrl = thumbUp.fileUrl;
            } catch {
              // Non-fatal thumbnail failure
            }
          }
        }

        const uploaded = await uploadMediaFile(
          item.file,
          item.file.name,
          (pct) => {
            const overall = Math.round(((i + pct / 100) / stagedFiles.length) * 100);
            setUploadProgress(overall);
          },
          category
        );
        const label =
          i === stagedFiles.length - 1 && stagedCaption.trim()
            ? stagedCaption.trim()
            : uploaded.fileName;
        await sendMessage(label, item.kind, {
          fileUrl: uploaded.fileUrl,
          fileName: uploaded.fileName,
          mimeType: uploaded.mimeType,
          sizeBytes: uploaded.sizeBytes,
          ...(durationSeconds !== undefined ? { durationSeconds } : {}),
          ...(thumbnailUrl ? { thumbnailUrl } : {}),
        });
      }
      clearStagedFiles();
    } catch (err: any) {
      setUploadError(err?.message || 'Upload failed. Please retry.');
    } finally {
      setUploadingFiles(false);
    }
  };

  const triggerPickMedia = (kind: 'image' | 'video' | 'document' | 'audio') => {
    if (kind === 'image') photoInputRef.current?.click();
    else if (kind === 'video') videoInputRef.current?.click();
    else if (kind === 'document') docInputRef.current?.click();
    else audioInputRef.current?.click();
  };

  // Live Camera Capture
  const stopCameraStream = () => {
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
  };

  const openCamera = async (facing: 'user' | 'environment' = cameraFacing) => {
    setAttachOpen(false);
    setCameraError(null);
    setCameraOpen(true);
    stopCameraStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: facing },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      setCameraError(err?.message || 'Camera permission denied.');
    }
  };

  const captureCameraPhoto = () => {
    const vid = cameraVideoRef.current;
    if (!vid) return;
    const canvas = document.createElement('canvas');
    canvas.width = vid.videoWidth || 1280;
    canvas.height = vid.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' });
        setStagedFiles((prev) => [
          ...prev,
          {
            id: `${Date.now()}`,
            file,
            previewUrl: URL.createObjectURL(file),
            kind: 'image',
          },
        ]);
        stopCameraStream();
        setCameraOpen(false);
      },
      'image/jpeg',
      0.92
    );
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
        showToast('Location permission denied.');
      }
    );
  };

  // Voice recording with live timer, cross-browser MIME support, Cancel, and Retryable Audio Preview
  const startVoiceRecording = async () => {
    if (!activeConversationId) return;
    setVoiceError(null);
    const audioFormat = detectSupportedAudioMime();
    if (!navigator.mediaDevices?.getUserMedia || !audioFormat) {
      showToast('Voice recording is not supported on this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, { mimeType: audioFormat.mimeType });
      } catch {
        mr = new MediaRecorder(stream);
      }
      const actualMime = mr.mimeType || audioFormat.mimeType || 'audio/webm';
      const actualExt = actualMime.includes('mp4')
        ? 'm4a'
        : actualMime.includes('ogg')
        ? 'ogg'
        : actualMime.includes('aac')
        ? 'aac'
        : audioFormat.ext || 'webm';

      audioChunksRef.current = [];
      recordingCancelledRef.current = false;

      mr.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (isServerlessFirebaseMode()) {
          setTypingActivityFirestore(activeConversationId, 'idle');
        } else {
          realtime.send('recording:stop', { conversationId: activeConversationId });
        }
        if (recordingCancelledRef.current) {
          setRecordingSeconds(0);
          return;
        }
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        if (blob.size > 0) {
          setRecordedAudio({
            blob,
            url: URL.createObjectURL(blob),
            duration: recordingSecRef.current,
            mimeType: actualMime,
            ext: actualExt,
          });
        }
        setRecordingSeconds(0);
      };

      mediaRecorderRef.current = mr;
      mr.start(250);
      setRecording(true);
      setRecordingSeconds(0);
      recordingSecRef.current = 0;

      if (isServerlessFirebaseMode()) {
        setTypingActivityFirestore(activeConversationId, 'recording');
      } else {
        realtime.send('recording:start', { conversationId: activeConversationId });
      }

      recordTimerRef.current = window.setInterval(() => {
        recordingSecRef.current += 1;
        setRecordingSeconds(recordingSecRef.current);
      }, 1000);
    } catch {
      showToast('Microphone permission is required for voice notes.');
    }
  };

  const stopVoiceRecording = (cancel = false) => {
    recordingCancelledRef.current = cancel;
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  };

  const sendRecordedVoice = async () => {
    if (!recordedAudio || !activeConversationId || sendingVoice) return;
    setSendingVoice(true);
    setVoiceError(null);
    try {
      const uploaded = await uploadMediaFile(
        recordedAudio.blob,
        `voice-${Date.now()}.${recordedAudio.ext}`,
        undefined,
        'voice-messages'
      );
      const dur = recordedAudio.duration;
      await sendMessage('Voice message', 'voice', {
        fileUrl: uploaded.fileUrl,
        fileName: uploaded.fileName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.sizeBytes,
        durationSeconds: dur,
      });
      URL.revokeObjectURL(recordedAudio.url);
      setRecordedAudio(null);
    } catch (err: any) {
      setVoiceError(err?.message || 'Failed to upload voice note. Please retry.');
    } finally {
      setSendingVoice(false);
    }
  };

  const discardRecordedVoice = () => {
    if (recordedAudio) URL.revokeObjectURL(recordedAudio.url);
    setRecordedAudio(null);
    setVoiceError(null);
  };

  // Multi-select helpers
  const toggleSelectMessage = (id: string) => {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copySelectedMessages = () => {
    const selected = messages.filter((m) => selectedMsgIds.has(m.id));
    const text = selected.map((m) => `[${m.senderName}]: ${m.content}`).join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setMultiSelectMode(false);
    setSelectedMsgIds(new Set());
    showToast(`Copied ${selected.length} message(s).`);
  };

  const deleteSelectedForMe = async () => {
    const ids = Array.from(selectedMsgIds);
    await Promise.all(
      ids.map((id) =>
        apiFetch(`/api/messages/${id}?scope=me&conversationId=${encodeURIComponent(activeConversationId || '')}`, {
          method: 'DELETE',
        }).catch(() => {})
      )
    );
    setMessages((prev) => prev.filter((m) => !selectedMsgIds.has(m.id)));
    setMultiSelectMode(false);
    setSelectedMsgIds(new Set());
  };

  // Export Chat (.txt)
  const exportChatTxt = () => {
    if (!activeConv) return;
    const lines = messages.map((m) => {
      const time = new Date(m.createdAt).toLocaleString();
      return `[${time}] ${m.senderName}: ${m.content}`;
    });
    const blob = new Blob([`RIKZEN CHAT Export — ${activeConv.title}\n\n${lines.join('\n')}`], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeConv.title.replace(/[^a-zA-Z0-9_-]/g, '_')}-chat.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setHeaderMenuOpen(false);
    showToast('Chat exported.');
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

  const sharedItems = useMemo(() => {
    const media = messages.filter(
      (m) => !m.isDeleted && (m.messageType === 'image' || m.messageType === 'video') && m.metadata?.fileUrl
    );
    const docs = messages.filter(
      (m) => !m.isDeleted && (m.messageType === 'document' || m.messageType === 'audio' || m.messageType === 'voice') && m.metadata?.fileUrl
    );
    const links: Array<{ id: string; url: string; content: string; createdAt: string }> = [];
    for (const m of messages) {
      if (m.isDeleted) continue;
      const matches = m.content.match(URL_REGEX);
      if (matches) {
        matches.forEach((u) => links.push({ id: `${m.id}-${u}`, url: u, content: m.content, createdAt: m.createdAt }));
      }
    }
    return { media, docs, links };
  }, [messages]);

  const pinnedMessage = useMemo(() => messages.find((m) => m.isPinned && !m.isDeleted), [messages]);

  const activePeerActivity = useMemo(() => {
    if (!activeConv) return null;
    if (peerActivities[activeConv.id]) return peerActivities[activeConv.id];
    if (
      activeConv.peer?.typingInConversationId === activeConv.id &&
      (activeConv.peer.typingActivity === 'typing' || activeConv.peer.typingActivity === 'recording')
    ) {
      return activeConv.peer.typingActivity;
    }
    return null;
  }, [activeConv, peerActivities]);

  const wallpaperStyle = (): React.CSSProperties => {
    const wp = activeConv?.chatTheme || me.appearanceSettings?.wallpaper || 'obsidian-web';
    const isLightTheme =
      me.appearanceSettings?.theme === 'light' || wp === 'champagne-cream';

    if (isLightTheme || wp === 'champagne-mist') {
      return {
        backgroundColor: isLightTheme ? '#FAF6EE' : '#09090B',
        backgroundImage: isLightTheme
          ? 'radial-gradient(rgba(184,137,31,0.14) 1px, transparent 1px)'
          : 'radial-gradient(circle at top left, rgba(212,175,55,0.14), transparent 60%)',
        backgroundSize: isLightTheme ? '22px 22px' : undefined,
      };
    }
    if (wp === 'obsidian-web') {
      return {
        backgroundImage: `linear-gradient(rgba(9,9,11,0.72), rgba(9,9,11,0.82)), url('/src/assets/images/rikzen_chat_wallpaper_1794652829386.jpg')`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      };
    }
    if (wp === 'emerald-silk') {
      return { background: 'radial-gradient(circle at top right, rgba(21,128,61,0.18), transparent 65%)' };
    }
    return { backgroundColor: '#09090B' };
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

  const fmtTimer = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const renderOutgoingTick = (status?: string, pending?: boolean, failed?: boolean) => {
    if (failed) return <AlertCircle size={13} className="text-red-400" />;
    if (pending) return <Clock size={12} className="opacity-70" />;
    if (status === 'read') return <CheckCheck size={14} className="text-[#EF4444]" />;
    if (status === 'delivered') return <CheckCheck size={14} className="text-white" />;
    return <Check size={14} className="text-white" />;
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-white dark:bg-[#09090B]">
      {/* Left Conversation List */}
      <aside
        className={`${
          activeConversationId ? 'hidden md:flex' : 'flex'
        } w-full md:w-[340px] lg:w-[360px] shrink-0 flex-col border-r border-black/10 dark:border-[#D4AF37]/15 bg-slate-50/70 dark:bg-[#0E0E12]`}
      >
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
                title="New Group or Join Invite"
                aria-label="Create or join group"
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
              const rowActivity =
                peerActivities[c.id] ||
                (c.peer?.typingInConversationId === c.id ? c.peer.typingActivity : null);
              const isMineLast = c.lastMessage?.senderId === me.id;

              return (
                <div
                  key={c.id}
                  className={`group relative flex items-center transition ${
                    selected
                      ? 'bg-[#D4AF37]/15 dark:bg-[#D4AF37]/12'
                      : 'hover:bg-black/3 dark:hover:bg-white/4'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRowMenuId(null);
                      onSelectConversation(c.id);
                    }}
                    className="flex flex-1 min-w-0 items-center gap-3 px-3.5 py-3 text-left"
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="truncate text-sm font-semibold">{c.title}</p>
                          {c.pinned && <Pin size={12} className="shrink-0 text-[#D4AF37]" />}
                          {c.muted && <VolumeX size={12} className="shrink-0 text-slate-400" />}
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
                        <div className="flex items-center gap-1 min-w-0">
                          {isMineLast && !rowActivity && (
                            <span className="shrink-0">
                              {c.lastMessage?.status === 'read' ? (
                                <CheckCheck size={13} className="text-[#EF4444]" />
                              ) : c.lastMessage?.status === 'delivered' ? (
                                <CheckCheck size={13} className="text-slate-400 dark:text-white/80" />
                              ) : (
                                <Check size={13} className="text-slate-400 dark:text-white/80" />
                              )}
                            </span>
                          )}
                          <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">
                            {rowActivity === 'recording' ? (
                              <span className="font-medium text-[#22C55E]">recording audio...</span>
                            ) : rowActivity === 'typing' ? (
                              <span className="font-medium text-[#22C55E]">typing...</span>
                            ) : c.lastMessage ? (
                              c.lastMessage.messageType === 'text'
                                ? c.lastMessage.content
                                : `Sent ${c.lastMessage.messageType}`
                            ) : c.type === 'group' ? (
                              `${c.memberCount || 1} members`
                            ) : (
                              'Connected · Say hello'
                            )}
                          </p>
                        </div>

                        {c.unreadCount > 0 && (
                          <span className="flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-[#22C55E] px-1.5 text-[11px] font-bold tabular-nums text-[#09090B]">
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRowMenuId(rowMenuId === c.id ? null : c.id)}
                    className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 opacity-75 hover:bg-black/10 dark:hover:bg-white/10"
                    aria-label="Conversation options"
                  >
                    <MoreVertical size={15} />
                  </button>

                  {rowMenuId === c.id && (
                    <div className="absolute right-3 top-12 z-40 w-44 rounded-xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-1.5 text-xs shadow-2xl">
                      <button
                        type="button"
                        onClick={async () => {
                          setRowMenuId(null);
                          await apiFetch(`/api/conversations/${c.id}/pin`, {
                            method: 'POST',
                            body: JSON.stringify({ pinned: !c.pinned }),
                          });
                          onRefreshConversations();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Pin size={13} /> {c.pinned ? 'Unpin chat' : 'Pin chat'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setRowMenuId(null);
                          await apiFetch(`/api/conversations/${c.id}/mute`, {
                            method: 'POST',
                            body: JSON.stringify({ muted: !c.muted }),
                          });
                          onRefreshConversations();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <VolumeX size={13} /> {c.muted ? 'Unmute' : 'Mute'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setRowMenuId(null);
                          await apiFetch(`/api/conversations/${c.id}/unread`, {
                            method: 'POST',
                            body: JSON.stringify({ unread: !c.markedUnread }),
                          });
                          onRefreshConversations();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <CheckSquare size={13} /> {c.markedUnread ? 'Mark read' : 'Mark unread'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setRowMenuId(null);
                          await apiFetch(`/api/conversations/${c.id}/archive`, {
                            method: 'POST',
                            body: JSON.stringify({ archived: !c.archived }),
                          });
                          onRefreshConversations();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Archive size={13} /> {c.archived ? 'Unarchive' : 'Archive'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          setRowMenuId(null);
                          await apiFetch(`/api/conversations/${c.id}`, { method: 'DELETE' });
                          if (activeConversationId === c.id) onSelectConversation(null);
                          onRefreshConversations();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-red-400 hover:bg-red-500/10"
                      >
                        <Trash2 size={13} /> Delete chat
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main Chat Pane */}
      <section
        className={`${
          activeConversationId ? 'flex' : 'hidden md:flex'
        } relative flex-1 flex-col overflow-hidden bg-slate-100 dark:bg-[#09090B]`}
      >
        {toastMsg && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-50 rounded-xl border border-[#D4AF37]/40 bg-[#141418] px-4 py-2 text-xs font-medium text-[#F5E6B3] shadow-xl">
            {toastMsg}
          </div>
        )}

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
            <header className="relative flex items-center justify-between border-b border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] px-2.5 sm:px-5 py-2.5">
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelectConversation(null)}
                  className="flex md:hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="Back to chats"
                >
                  <ChevronLeft size={22} />
                </button>
                <button
                  type="button"
                  onClick={() => setInfoPanelOpen(!infoPanelOpen)}
                  className="relative h-10 w-10 shrink-0 text-left"
                >
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
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate font-semibold text-sm">{activeConv.title}</h3>
                    {activeConv.disappearingSeconds ? (
                      <span title="Disappearing messages active" className="inline-flex shrink-0">
                        <Timer size={12} className="text-[#D4AF37]" />
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-slate-500 dark:text-[#9898A6]">
                    {activePeerActivity === 'recording' ? (
                      <span className="text-[#22C55E] font-semibold">recording audio...</span>
                    ) : activePeerActivity === 'typing' ? (
                      <span className="text-[#22C55E] font-semibold">typing...</span>
                    ) : activeConv.type === 'group' ? (
                      `${activeConv.memberCount || 1} members`
                    ) : activeConv.peer?.isOnline ? (
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#22C55E]">
                        <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
                        Online
                      </span>
                    ) : (
                      formatLastSeen(activeConv.peer?.lastSeenAt)
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
                          'video'
                        )
                      }
                      className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5 text-[#D4AF37]"
                      aria-label="Video call"
                    >
                      <Video size={18} />
                    </button>
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
                  </>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setHeaderMenuOpen(!headerMenuOpen);
                    setHeaderSubMenu('root');
                  }}
                  className="flex h-10 w-10 items-center justify-center rounded-xl hover:bg-black/5 dark:hover:bg-white/5"
                  aria-label="More options"
                >
                  <MoreVertical size={19} />
                </button>
              </div>

              {/* Complete WhatsApp-Style Three-Dot Header Menu */}
              {headerMenuOpen && (
                <div className="absolute right-3 top-14 z-40 w-64 rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-1.5 text-xs shadow-2xl">
                  {headerSubMenu === 'root' && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setInfoPanelOpen(true);
                          setHeaderMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <User size={15} /> {activeConv.type === 'group' ? 'Group info' : 'View contact'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChatSearchOpen(true);
                          setHeaderMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Search size={15} /> Search
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSharedMediaOpen(true);
                          setHeaderMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <FolderOpen size={15} /> Media, links and documents
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/conversations/${activeConv.id}/mute`, {
                            method: 'POST',
                            body: JSON.stringify({ muted: !activeConv.muted }),
                          });
                          onRefreshConversations();
                          setHeaderMenuOpen(false);
                          showToast(activeConv.muted ? 'Notifications unmuted.' : 'Notifications muted.');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <VolumeX size={15} /> {activeConv.muted ? 'Unmute notifications' : 'Mute notifications'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('disappearing')}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <span className="flex items-center gap-2.5">
                          <Timer size={15} /> Disappearing messages
                        </span>
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('theme')}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <span className="flex items-center gap-2.5">
                          <Palette size={15} /> Chat theme
                        </span>
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('more')}
                        className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <span className="flex items-center gap-2.5">
                          <MoreVertical size={15} /> More
                        </span>
                        <ChevronRight size={14} />
                      </button>
                    </>
                  )}

                  {headerSubMenu === 'disappearing' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('root')}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 font-semibold text-[#D4AF37]"
                      >
                        <ChevronLeft size={14} /> Disappearing timer
                      </button>
                      {[
                        { label: 'Off', secs: 0 },
                        { label: '24 hours', secs: 86400 },
                        { label: '7 days', secs: 604800 },
                        { label: '90 days', secs: 7776000 },
                      ].map((opt) => (
                        <button
                          key={opt.secs}
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/conversations/${activeConv.id}/disappearing`, {
                              method: 'POST',
                              body: JSON.stringify({ seconds: opt.secs }),
                            });
                            onRefreshConversations();
                            setHeaderMenuOpen(false);
                            showToast(`Disappearing messages: ${opt.label}`);
                          }}
                          className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 ${
                            (activeConv.disappearingSeconds || 0) === opt.secs ? 'text-[#D4AF37] font-semibold' : ''
                          }`}
                        >
                          <span>{opt.label}</span>
                          {(activeConv.disappearingSeconds || 0) === opt.secs && <Check size={14} />}
                        </button>
                      ))}
                    </>
                  )}

                  {headerSubMenu === 'theme' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('root')}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 font-semibold text-[#D4AF37]"
                      >
                        <ChevronLeft size={14} /> Chat Theme
                      </button>
                      {[
                        { id: '', label: 'Default Appearance' },
                        { id: 'champagne-cream', label: 'Champagne Cream (Light)' },
                        { id: 'obsidian-web', label: 'Obsidian Spiderweb' },
                        { id: 'emerald-silk', label: 'Emerald Silk' },
                        { id: 'midnight', label: 'Pure Midnight' },
                      ].map((t) => (
                        <button
                          key={t.id || 'default'}
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/api/conversations/${activeConv.id}/theme`, {
                              method: 'POST',
                              body: JSON.stringify({ theme: t.id || null }),
                            });
                            onRefreshConversations();
                            setHeaderMenuOpen(false);
                            showToast(`Theme applied: ${t.label}`);
                          }}
                          className="flex w-full items-center justify-between rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                        >
                          <span>{t.label}</span>
                          {(activeConv.chatTheme || '') === t.id && <Check size={14} className="text-[#D4AF37]" />}
                        </button>
                      ))}
                    </>
                  )}

                  {headerSubMenu === 'more' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setHeaderSubMenu('root')}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 font-semibold text-[#D4AF37]"
                      >
                        <ChevronLeft size={14} /> More Actions
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch('/api/reports', {
                            method: 'POST',
                            body: JSON.stringify({
                              targetType: activeConv.type === 'group' ? 'group' : 'user',
                              targetId: activeConv.peer?.id || activeConv.id,
                              reason: 'Reported from conversation menu',
                            }),
                          });
                          setHeaderMenuOpen(false);
                          showToast('Report submitted.');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-amber-400 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Flag size={14} /> Report
                      </button>
                      {activeConv.type === 'direct' && activeConv.peer && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (activeConv.isBlocked) {
                              await apiFetch(`/api/friends/block/${activeConv.peer!.id}`, { method: 'DELETE' });
                              showToast('User unblocked.');
                            } else {
                              await apiFetch('/api/friends/block', {
                                method: 'POST',
                                body: JSON.stringify({ targetUserId: activeConv.peer!.id }),
                              });
                              showToast('User blocked.');
                            }
                            onRefreshConversations();
                            setHeaderMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-red-400 hover:bg-red-500/10"
                        >
                          <Ban size={14} /> {activeConv.isBlocked ? 'Unblock user' : 'Block user'}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setClearConfirmOpen(true);
                          setHeaderMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-red-400 hover:bg-red-500/10"
                      >
                        <Eraser size={14} /> Clear chat
                      </button>
                      <button
                        type="button"
                        onClick={exportChatTxt}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <FileDown size={14} /> Export chat (.txt)
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          await apiFetch(`/api/conversations/${activeConv.id}/pin`, {
                            method: 'POST',
                            body: JSON.stringify({ pinned: true }),
                          });
                          onRefreshConversations();
                          setHeaderMenuOpen(false);
                          showToast('Chat pinned to top.');
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <Pin size={14} /> Add shortcut (Pin chat)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setListInput(activeConv.customList || '');
                          setListModalOpen(true);
                          setHeaderMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10"
                      >
                        <ListPlus size={14} /> Add to list
                      </button>
                    </>
                  )}
                </div>
              )}
            </header>

            {/* Multi-select Toolbar */}
            {multiSelectMode && (
              <div className="flex items-center justify-between border-b border-[#D4AF37]/30 bg-[#141418] px-4 py-2 text-xs text-white">
                <span className="font-semibold text-[#F5E6B3]">{selectedMsgIds.size} selected</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={selectedMsgIds.size === 0}
                    onClick={copySelectedMessages}
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 hover:bg-white/20 disabled:opacity-40"
                  >
                    <Copy size={13} /> Copy
                  </button>
                  <button
                    type="button"
                    disabled={selectedMsgIds.size === 0}
                    onClick={() =>
                      setForwardingMsgs(messages.filter((m) => selectedMsgIds.has(m.id)))
                    }
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 hover:bg-white/20 disabled:opacity-40"
                  >
                    <Forward size={13} /> Forward
                  </button>
                  <button
                    type="button"
                    disabled={selectedMsgIds.size === 0}
                    onClick={deleteSelectedForMe}
                    className="flex items-center gap-1 rounded-lg bg-red-500/20 px-2.5 py-1.5 text-red-300 hover:bg-red-500/30 disabled:opacity-40"
                  >
                    <Trash2 size={13} /> Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMultiSelectMode(false);
                      setSelectedMsgIds(new Set());
                    }}
                    className="rounded-lg px-2 py-1.5 text-[#9898A6] hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

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
              style={wallpaperStyle()}
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
                  const isSelected = selectedMsgIds.has(msg.id);

                  const reactionCounts = msg.reactions.reduce<Record<string, number>>((acc, r) => {
                    acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                    return acc;
                  }, {});

                  return (
                    <React.Fragment key={msg.id}>
                      {showDateHeader && (
                        <div className="my-3 flex justify-center">
                          <span className="text-[11px] font-medium text-slate-600 dark:text-[#9898A6] bg-white/90 dark:bg-[#141418]/90 px-3 py-1 rounded-lg border border-black/5 dark:border-white/10">
                            {currDate}
                          </span>
                        </div>
                      )}

                      <div
                        onClick={() => multiSelectMode && toggleSelectMessage(msg.id)}
                        className={`group flex items-center gap-2 ${mine ? 'justify-end' : 'justify-start'} ${
                          multiSelectMode ? 'cursor-pointer' : ''
                        }`}
                      >
                        {multiSelectMode && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectMessage(msg.id)}
                            className="h-4 w-4 accent-[#D4AF37]"
                          />
                        )}

                        <div className="relative max-w-[82%] sm:max-w-[68%]">
                          <div
                            className={`rounded-2xl px-3.5 py-2.5 shadow-sm ${
                              mine
                                ? 'bg-[#1F1A0E] text-[#F5F5F7] border border-[#D4AF37]/30 rounded-br-sm'
                                : 'bg-white dark:bg-[#16161C] text-slate-900 dark:text-[#F5F5F7] border border-black/8 dark:border-white/8 rounded-bl-sm'
                            } ${isSelected ? 'ring-2 ring-[#D4AF37]' : ''}`}
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
                              <div className="mb-1.5 space-y-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setLightboxPhoto({
                                      url: msg.metadata.fileUrl,
                                      name: msg.metadata.fileName || msg.content || 'photo.jpg',
                                    })
                                  }
                                  className="block overflow-hidden rounded-xl cursor-zoom-in"
                                >
                                  <img
                                    src={msg.metadata.fileUrl}
                                    alt={msg.metadata.fileName || msg.content}
                                    className="max-h-72 rounded-xl object-cover"
                                  />
                                </button>
                                {msg.content && msg.content !== msg.metadata.fileName && (
                                  <p className="text-sm leading-relaxed break-words">{msg.content}</p>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadMediaFile(msg.metadata.fileUrl, msg.metadata.fileName || 'photo.jpg')
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] text-[#D4AF37] hover:underline cursor-pointer"
                                >
                                  <Download size={12} /> Download photo
                                </button>
                              </div>
                            )}

                            {!msg.isDeleted && msg.messageType === 'video' && msg.metadata?.fileUrl && (
                              <div className="mb-1.5 space-y-1.5">
                                <div className="relative overflow-hidden rounded-xl bg-black">
                                  <video
                                    src={msg.metadata.fileUrl}
                                    poster={msg.metadata.thumbnailUrl || undefined}
                                    controls
                                    playsInline
                                    preload="metadata"
                                    className="max-h-72 w-full rounded-xl"
                                  />
                                  {typeof msg.metadata.durationSeconds === 'number' &&
                                    msg.metadata.durationSeconds > 0 && (
                                      <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
                                        {formatMediaDuration(msg.metadata.durationSeconds)}
                                      </span>
                                    )}
                                </div>
                                {msg.content && msg.content !== msg.metadata.fileName && (
                                  <p className="text-sm leading-relaxed break-words">{msg.content}</p>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadMediaFile(msg.metadata.fileUrl, msg.metadata.fileName || 'video.mp4')
                                  }
                                  className="inline-flex items-center gap-1 text-[11px] text-[#D4AF37] hover:underline cursor-pointer"
                                >
                                  <Download size={12} /> Download video
                                </button>
                              </div>
                            )}

                            {!msg.isDeleted &&
                              (msg.messageType === 'voice' || msg.messageType === 'audio') &&
                              msg.metadata?.fileUrl && (
                                <div className="mb-1">
                                  <VoiceNotePlayer
                                    src={msg.metadata.fileUrl}
                                    durationSeconds={msg.metadata.durationSeconds}
                                    fileName={msg.metadata.fileName}
                                    mimeType={msg.metadata.mimeType}
                                    onDownload={() =>
                                      downloadMediaFile(
                                        msg.metadata.fileUrl,
                                        msg.metadata.fileName || `voice-${msg.id}.webm`
                                      )
                                    }
                                  />
                                </div>
                              )}

                            {!msg.isDeleted && msg.messageType === 'document' && msg.metadata?.fileUrl && (
                              <div className="mb-1.5 rounded-xl bg-black/15 dark:bg-black/35 p-2.5 text-xs">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#D4AF37]/15 font-mono-id text-[10px] font-bold uppercase text-[#D4AF37]">
                                    {(
                                      (msg.metadata.fileName || 'DOC').split('.').pop() || 'DOC'
                                    ).slice(0, 4)}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium">
                                      {msg.metadata.fileName || msg.content}
                                    </p>
                                    {msg.metadata.sizeBytes ? (
                                      <p className="text-[10px] opacity-70">
                                        {formatBytes(msg.metadata.sizeBytes)}
                                      </p>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2">
                                  <a
                                    href={msg.metadata.fileUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/8 py-1.5 text-[11px] font-medium hover:bg-white/15"
                                  >
                                    <ExternalLink size={12} /> Open
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      downloadMediaFile(
                                        msg.metadata.fileUrl,
                                        msg.metadata.fileName || msg.content
                                      )
                                    }
                                    className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-[#D4AF37]/15 py-1.5 text-[11px] font-medium text-[#D4AF37] hover:bg-[#D4AF37]/25 cursor-pointer"
                                  >
                                    <Download size={12} /> Download
                                  </button>
                                </div>
                              </div>
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
                                {msg.isDeleted ? msg.content : renderLinkifiedText(msg.content)}
                              </p>
                            )}

                            {/* Footer: Timestamp + Status Ticks (Sending Clock, 1 White Sent, 2 White Delivered, 2 RED Seen) */}
                            <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] tabular-nums">
                              {msg.isStarred && <Star size={10} className="fill-[#D4AF37] text-[#D4AF37]" />}
                              {msg.isEdited && <span className="opacity-70">edited</span>}
                              <span className="opacity-75">
                                {new Date(msg.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                              {mine && !msg.isDeleted && (
                                <span
                                  className="inline-flex items-center"
                                  title={
                                    msg.failedLocal
                                      ? 'Failed to send'
                                      : msg.pendingLocal
                                      ? 'Sending'
                                      : msg.status === 'read'
                                      ? 'Seen'
                                      : msg.status === 'delivered'
                                      ? 'Delivered'
                                      : 'Sent'
                                  }
                                >
                                  {renderOutgoingTick(msg.status, msg.pendingLocal, msg.failedLocal)}
                                </span>
                              )}
                            </div>

                            {msg.failedLocal && (
                              <button
                                type="button"
                                onClick={() => sendMessage(msg.content, msg.messageType, msg.metadata, msg.id)}
                                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:underline"
                              >
                                <RefreshCw size={11} /> Tap to retry
                              </button>
                            )}
                          </div>

                          {/* Reactions Strip */}
                          {Object.keys(reactionCounts).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {Object.entries(reactionCounts).map(([em, count]) => (
                                <button
                                  key={em}
                                  type="button"
                                  onClick={async () => {
                                    const res = await apiFetch(`/api/messages/${msg.id}/react`, {
                                      method: 'POST',
                                      body: JSON.stringify({ emoji: em, conversationId: msg.conversationId }),
                                    });
                                    if (res.reactions) {
                                      setMessages((prev) =>
                                        prev.map((m) => (m.id === msg.id ? { ...m, reactions: res.reactions } : m))
                                      );
                                    }
                                  }}
                                  className="rounded-lg border border-black/10 dark:border-white/15 bg-white dark:bg-[#141418] px-1.5 py-0.5 text-xs shadow-sm"
                                >
                                  {em} {count}
                                </button>
                              ))}
                            </div>
                          )}

                          {/* Hover / Tap Message Actions */}
                          {!msg.isDeleted && !multiSelectMode && (
                            <button
                              type="button"
                              onClick={() =>
                                setActiveMsgMenuId(activeMsgMenuId === msg.id ? null : msg.id)
                              }
                              className={`absolute top-1 ${
                                mine ? '-left-8' : '-right-8'
                              } flex h-7 w-7 items-center justify-center rounded-lg bg-black/25 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100`}
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
                                    onClick={async () => {
                                      const res = await apiFetch(`/api/messages/${msg.id}/react`, {
                                        method: 'POST',
                                        body: JSON.stringify({ emoji: em, conversationId: msg.conversationId }),
                                      });
                                      if (res.reactions) {
                                        setMessages((prev) =>
                                          prev.map((m) => (m.id === msg.id ? { ...m, reactions: res.reactions } : m))
                                        );
                                      }
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
                                  setForwardingMsgs([msg]);
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
                                  showToast('Copied text.');
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Copy size={13} /> Copy
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setMultiSelectMode(true);
                                  setSelectedMsgIds(new Set([msg.id]));
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <CheckSquare size={13} /> Select messages
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiFetch(`/api/messages/${msg.id}/pin`, {
                                    method: 'POST',
                                    body: JSON.stringify({ conversationId: msg.conversationId }),
                                  });
                                  setMessages((prev) =>
                                    prev.map((m) => (m.id === msg.id ? { ...m, isPinned: res.isPinned } : m))
                                  );
                                  setActiveMsgMenuId(null);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-white/10"
                              >
                                <Pin size={13} /> {msg.isPinned ? 'Unpin' : 'Pin'}
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  const res = await apiFetch(`/api/messages/${msg.id}/star`, {
                                    method: 'POST',
                                    body: JSON.stringify({ conversationId: msg.conversationId }),
                                  });
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
                                  await apiFetch(
                                    `/api/messages/${msg.id}?scope=me&conversationId=${encodeURIComponent(msg.conversationId)}`,
                                    { method: 'DELETE' }
                                  );
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
                                    await apiFetch(
                                      `/api/messages/${msg.id}?scope=everyone&conversationId=${encodeURIComponent(msg.conversationId)}`,
                                      { method: 'DELETE' }
                                    );
                                    setMessages((prev) =>
                                      prev.map((m) =>
                                        m.id === msg.id
                                          ? { ...m, isDeleted: true, content: 'This message was deleted' }
                                          : m
                                      )
                                    );
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
                                    showToast('Message reported.');
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
              <div className="relative border-t border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] px-2 sm:px-4 py-2.5">
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/webp,image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleFilePick(e, 'image')}
                />
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/mp4,video/webm,video/quicktime,video/*"
                  className="hidden"
                  onChange={(e) => handleFilePick(e, 'video')}
                />
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.txt,.xls,.xlsx,.ppt,.pptx,.csv,.zip"
                  className="hidden"
                  onChange={(e) => handleFilePick(e, 'document')}
                />
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  className="hidden"
                  onChange={(e) => handleFilePick(e, 'audio')}
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
                  <div className="absolute bottom-16 left-12 z-30 w-60 rounded-2xl border border-black/10 dark:border-white/15 bg-white dark:bg-[#16161C] p-2 shadow-2xl space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('image')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <ImageIcon size={16} className="text-[#D4AF37]" /> Photos (Gallery / Multi)
                    </button>
                    <button
                      type="button"
                      onClick={() => openCamera('environment')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <Camera size={16} className="text-emerald-400" /> Take Photo (Camera)
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('video')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <Video size={16} className="text-purple-400" /> Video (up to 50 MB)
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('document')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <FileText size={16} className="text-sky-400" /> Document (PDF, DOC, XLS, PPT)
                    </button>
                    <button
                      type="button"
                      onClick={() => triggerPickMedia('audio')}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <Mic size={16} className="text-amber-400" /> Audio File
                    </button>
                    <button
                      type="button"
                      onClick={shareLocation}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                    >
                      <MapPin size={16} className="text-emerald-400" /> Share Location
                    </button>
                  </div>
                )}

                {recordedAudio ? (
                  <div className="space-y-2 rounded-xl border border-[#D4AF37]/35 bg-[#18181D] p-2.5">
                    {voiceError && (
                      <p className="rounded-lg border border-red-500/35 bg-red-500/15 px-2.5 py-1 text-xs text-red-200">
                        {voiceError}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex-1 min-w-[180px]">
                        <VoiceNotePlayer
                          compact
                          src={recordedAudio.url}
                          durationSeconds={recordedAudio.duration}
                          mimeType={recordedAudio.mimeType}
                          fileName={`voice-preview.${recordedAudio.ext}`}
                        />
                      </div>
                      <button
                        type="button"
                        disabled={sendingVoice}
                        onClick={discardRecordedVoice}
                        className="flex h-9 items-center gap-1 rounded-lg border border-white/15 px-3 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50 cursor-pointer"
                      >
                        <Trash2 size={14} /> Discard
                      </button>
                      <button
                        type="button"
                        disabled={sendingVoice}
                        onClick={sendRecordedVoice}
                        className="flex h-9 items-center gap-1 rounded-lg bg-[#D4AF37] px-3.5 text-xs font-semibold text-[#09090B] disabled:opacity-50 cursor-pointer"
                      >
                        <Send size={14} />{' '}
                        {sendingVoice ? 'Sending...' : voiceError ? 'Retry Send' : 'Send Voice Note'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!composerText.trim()) return;
                      sendMessage(composerText.trim(), 'text');
                    }}
                    className="flex items-end gap-1 sm:gap-1.5"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setEmojiOpen(!emojiOpen);
                        setAttachOpen(false);
                      }}
                      className="flex h-11 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-[#D4AF37]"
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
                      className="flex h-11 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-[#D4AF37]"
                      aria-label="Attachments"
                    >
                      <Paperclip size={20} />
                    </button>

                    {recording ? (
                      <div className="flex h-11 flex-1 items-center justify-between rounded-xl border border-red-500/40 bg-red-500/10 px-3 text-xs text-red-400">
                        <span className="flex items-center gap-2 font-medium tabular-nums">
                          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
                          Recording {fmtTimer(recordingSeconds)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => stopVoiceRecording(true)}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => stopVoiceRecording(false)}
                            className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1 font-semibold text-white"
                          >
                            <Square size={11} /> Stop
                          </button>
                        </div>
                      </div>
                    ) : (
                      <textarea
                        ref={composerInputRef}
                        rows={1}
                        value={composerText}
                        onChange={(e) => emitTyping(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (composerText.trim()) sendMessage(composerText.trim(), 'text');
                          }
                        }}
                        placeholder="Message..."
                        className="min-h-[44px] max-h-[120px] flex-1 resize-none rounded-xl border border-black/10 dark:border-white/10 bg-slate-100 dark:bg-[#18181D] px-3.5 py-2.5 text-sm leading-snug focus:border-[#D4AF37] focus:outline-none"
                      />
                    )}

                    {!recording && !composerText.trim() && (
                      <button
                        type="button"
                        onClick={() => openCamera('environment')}
                        className="flex h-11 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:text-[#D4AF37]"
                        aria-label="Open camera"
                      >
                        <Camera size={20} />
                      </button>
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
                )}
              </div>
            )}
          </>
        )}
      </section>

      {/* Contact / Group Info Panel (Desktop sidebar + Mobile overlay) */}
      {infoPanelOpen && activeConv && (
        <aside className="fixed inset-y-0 right-0 z-40 flex w-80 lg:static lg:w-[300px] shrink-0 flex-col border-l border-black/10 dark:border-white/10 bg-white dark:bg-[#111115] p-5 overflow-y-auto shadow-2xl lg:shadow-none">
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
                {activeConv.peer.isOnline ? (
                  <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-[#22C55E]">
                    <span className="h-2 w-2 rounded-full bg-[#22C55E]" />
                    Online
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-slate-500 dark:text-[#9898A6]">
                    {formatLastSeen(activeConv.peer.lastSeenAt)}
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
            <button
              type="button"
              onClick={() => setSharedMediaOpen(true)}
              className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-black/10 dark:border-white/10 px-3.5 text-xs font-medium"
            >
              <FolderOpen size={15} /> Media, Links & Docs ({sharedItems.media.length + sharedItems.docs.length})
            </button>

            {activeConv.type === 'group' && activeConv.groupId && (
              <button
                type="button"
                onClick={() => setManageGroupId(activeConv.groupId!)}
                className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/10 px-3.5 text-xs font-semibold text-[#D4AF37]"
              >
                <Users size={15} /> Manage Group & Invite Link
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
                    if (activeConv.isBlocked) {
                      await apiFetch(`/api/friends/block/${activeConv.peer!.id}`, { method: 'DELETE' });
                    } else {
                      await apiFetch('/api/friends/block', {
                        method: 'POST',
                        body: JSON.stringify({ targetUserId: activeConv.peer!.id }),
                      });
                    }
                    onRefreshConversations();
                  }}
                  className="flex min-h-[42px] w-full items-center gap-2 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 text-xs font-medium text-red-400"
                >
                  <Ban size={15} /> {activeConv.isBlocked ? 'Unblock User' : 'Block User'}
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
                    showToast('User reported.');
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

      {/* Pre-Send Media Preview Modal (Photos, Videos, PDFs, Docs, Audio) */}
      {stagedFiles.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h4 className="font-display font-semibold">
                Preview & Send ({stagedFiles.length} file{stagedFiles.length > 1 ? 's' : ''})
              </h4>
              <button type="button" onClick={clearStagedFiles} disabled={uploadingFiles}>
                <X size={18} />
              </button>
            </div>

            {uploadError && (
              <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs text-red-200">
                {uploadError}
              </div>
            )}

            <div className="mt-4 flex-1 space-y-3 overflow-y-auto">
              {stagedFiles.map((item) => (
                <div
                  key={item.id}
                  className="relative overflow-hidden rounded-xl border border-white/10 bg-[#09090B] p-2.5"
                >
                  <button
                    type="button"
                    disabled={uploadingFiles}
                    onClick={() => {
                      URL.revokeObjectURL(item.previewUrl);
                      setStagedFiles((prev) => prev.filter((x) => x.id !== item.id));
                    }}
                    className="absolute top-2 right-2 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/75 text-white hover:bg-red-600"
                  >
                    <X size={14} />
                  </button>
                  {item.kind === 'image' && (
                    <img src={item.previewUrl} alt={item.file.name} className="max-h-60 w-full rounded-lg object-contain" />
                  )}
                  {item.kind === 'video' && (
                    <video src={item.previewUrl} controls className="max-h-60 w-full rounded-lg" />
                  )}
                  {item.kind === 'audio' && (
                    <div className="p-2">
                      <p className="mb-1.5 text-xs font-medium">{item.file.name}</p>
                      <audio src={item.previewUrl} controls className="w-full" />
                    </div>
                  )}
                  {item.kind === 'document' && (
                    <div className="flex items-center gap-3 p-2">
                      <FileText size={24} className="text-[#D4AF37]" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.file.name}</p>
                        <p className="text-xs text-[#9898A6]">{formatBytes(item.file.size)}</p>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={stagedCaption}
                onChange={(e) => setStagedCaption(e.target.value)}
                placeholder="Add a caption (optional)..."
                className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
              />

              {uploadingFiles && (
                <div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-[#D4AF37] transition-all"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="mt-1 text-right text-xs text-[#9898A6]">Uploading {uploadProgress}%</p>
                </div>
              )}

                <button
                  type="button"
                  disabled={uploadingFiles}
                  onClick={sendStagedMedia}
                  className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B] disabled:opacity-50 cursor-pointer"
                >
                  <Send size={16} />
                  <span>
                    {uploadingFiles
                      ? `Sending (${uploadProgress}%)...`
                      : uploadError
                      ? 'Retry Upload'
                      : 'Send Media'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Camera Capture Modal */}
      {cameraOpen && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4 text-white">
          <div className="flex w-full max-w-lg items-center justify-between pb-3">
            <h4 className="font-display font-semibold">Take Photo</h4>
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                setCameraOpen(false);
              }}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10"
            >
              <X size={18} />
            </button>
          </div>
          {cameraError ? (
            <p className="rounded-xl border border-red-500/40 bg-red-500/15 px-4 py-3 text-xs text-red-200">
              {cameraError}
            </p>
          ) : (
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              muted
              className="max-h-[68vh] w-full max-w-lg rounded-2xl border border-[#D4AF37]/30 bg-black object-cover"
            />
          )}
          <div className="mt-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                const next = cameraFacing === 'user' ? 'environment' : 'user';
                setCameraFacing(next);
                openCamera(next);
              }}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10"
              title="Flip camera"
            >
              <RefreshCw size={18} />
            </button>
            <button
              type="button"
              onClick={captureCameraPhoto}
              className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-[#D4AF37] bg-white text-[#09090B]"
              aria-label="Capture photo"
            >
              <Camera size={24} />
            </button>
          </div>
        </div>
      )}

      {/* Shared Media, Links & Documents Modal */}
      {sharedMediaOpen && activeConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h4 className="font-display font-bold">Media, Links and Documents</h4>
              <button type="button" onClick={() => setSharedMediaOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 flex gap-2">
              {[
                { id: 'media' as const, label: `Media (${sharedItems.media.length})` },
                { id: 'links' as const, label: `Links (${sharedItems.links.length})` },
                { id: 'docs' as const, label: `Docs (${sharedItems.docs.length})` },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSharedTab(t.id)}
                  className={`flex-1 min-h-[36px] rounded-lg text-xs font-semibold ${
                    sharedTab === t.id ? 'bg-[#D4AF37] text-[#09090B]' : 'bg-white/5 text-[#9898A6]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mt-4 flex-1 overflow-y-auto">
              {sharedTab === 'media' && (
                sharedItems.media.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#9898A6]">No shared photos or videos yet.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {sharedItems.media.map((m) => (
                      <a
                        key={m.id}
                        href={m.metadata.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="aspect-square overflow-hidden rounded-xl border border-white/10 bg-black"
                      >
                        {m.messageType === 'video' ? (
                          <video src={m.metadata.fileUrl} className="h-full w-full object-cover" />
                        ) : (
                          <img src={m.metadata.fileUrl} alt={m.content} className="h-full w-full object-cover" />
                        )}
                      </a>
                    ))}
                  </div>
                )
              )}
              {sharedTab === 'links' && (
                sharedItems.links.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#9898A6]">No shared links yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sharedItems.links.map((l) => (
                      <a
                        key={l.id}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#09090B] p-3 text-xs hover:border-[#D4AF37]"
                      >
                        <span className="truncate text-[#F5E6B3]">{l.url}</span>
                        <ExternalLink size={14} className="shrink-0 text-[#D4AF37]" />
                      </a>
                    ))}
                  </div>
                )
              )}
              {sharedTab === 'docs' && (
                sharedItems.docs.length === 0 ? (
                  <p className="py-10 text-center text-xs text-[#9898A6]">No shared documents or audio files yet.</p>
                ) : (
                  <div className="space-y-2">
                    {sharedItems.docs.map((m) => (
                      <div
                        key={m.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-[#09090B] p-3 text-xs hover:border-[#D4AF37]"
                      >
                        <a
                          href={m.metadata.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 min-w-0 flex-1 hover:text-[#D4AF37]"
                        >
                          <FileText size={16} className="text-[#D4AF37] shrink-0" />
                          <span className="truncate">{m.metadata.fileName || m.content}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => downloadMediaFile(m.metadata.fileUrl, m.metadata.fileName || m.content)}
                          className="shrink-0 p-1 hover:text-[#D4AF37] cursor-pointer"
                          title="Download document"
                        >
                          <Download size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Clear Chat Confirmation Modal */}
      {clearConfirmOpen && activeConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-[#111115] p-5 text-white shadow-2xl">
            <h4 className="font-display text-base font-bold">Clear this chat?</h4>
            <p className="mt-1.5 text-xs text-[#9898A6]">
              Messages will be cleared from your view in {activeConv.title}.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                className="flex-1 min-h-[40px] rounded-xl border border-white/15 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await apiFetch(`/api/conversations/${activeConv.id}/clear`, { method: 'POST' });
                  setMessages([]);
                  setClearConfirmOpen(false);
                  onRefreshConversations();
                  showToast('Chat cleared.');
                }}
                className="flex-1 min-h-[40px] rounded-xl bg-red-600 text-xs font-semibold text-white"
              >
                Clear Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add to List Modal */}
      {listModalOpen && activeConv && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              await apiFetch(`/api/conversations/${activeConv.id}/list`, {
                method: 'POST',
                body: JSON.stringify({ listName: listInput.trim() }),
              });
              setListModalOpen(false);
              onRefreshConversations();
              showToast(listInput.trim() ? `Added to list "${listInput.trim()}"` : 'Removed from list');
            }}
            className="w-full max-w-sm rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 text-white shadow-2xl"
          >
            <h4 className="font-display text-base font-bold">Add Conversation to List</h4>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {['VIP', 'Work', 'Family', 'Friends'].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setListInput(preset)}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-xs hover:border-[#D4AF37]"
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={listInput}
              onChange={(e) => setListInput(e.target.value)}
              placeholder="List name (leave blank to remove)..."
              className="mt-3 h-10 w-full rounded-xl border border-white/15 bg-[#09090B] px-3 text-sm"
            />
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setListModalOpen(false)}
                className="flex-1 min-h-[40px] rounded-xl border border-white/15 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 min-h-[40px] rounded-xl bg-[#D4AF37] text-xs font-semibold text-[#09090B]"
              >
                Save List
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Forward Message(s) Modal */}
      {forwardingMsgs && forwardingMsgs.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-[#D4AF37]/25 bg-[#111115] p-5 text-white shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <h4 className="font-display font-semibold">
                Forward {forwardingMsgs.length > 1 ? `${forwardingMsgs.length} Messages` : 'Message'}
              </h4>
              <button type="button" onClick={() => setForwardingMsgs(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={async () => {
                    for (const fm of forwardingMsgs) {
                      await apiFetch(`/api/conversations/${c.id}/messages`, {
                        method: 'POST',
                        body: JSON.stringify({
                          content: fm.content,
                          messageType: fm.messageType,
                          forwardedFromId: fm.id,
                          metadata: fm.metadata,
                        }),
                      });
                    }
                    setForwardingMsgs(null);
                    setMultiSelectMode(false);
                    setSelectedMsgIds(new Set());
                    onRefreshConversations();
                    showToast(`Forwarded to ${c.title}`);
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

      {/* Photo Lightbox Modal */}
      {lightboxPhoto && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4 text-white"
          onClick={() => setLightboxPhoto(null)}
        >
          <div
            className="flex w-full max-w-4xl items-center justify-between pb-3"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="truncate text-sm font-medium text-white/90">{lightboxPhoto.name}</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => downloadMediaFile(lightboxPhoto.url, lightboxPhoto.name)}
                className="flex min-h-[38px] items-center gap-1.5 rounded-xl bg-[#D4AF37] px-3.5 text-xs font-semibold text-[#09090B] hover:bg-[#E5C76B] cursor-pointer"
              >
                <Download size={14} /> Download
              </button>
              <button
                type="button"
                onClick={() => setLightboxPhoto(null)}
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 cursor-pointer"
                aria-label="Close photo viewer"
              >
                <X size={18} />
              </button>
            </div>
          </div>
          <img
            src={lightboxPhoto.url}
            alt={lightboxPhoto.name}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </div>
  );
};
