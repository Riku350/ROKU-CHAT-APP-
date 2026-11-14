import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  type User,
} from 'firebase/auth';
import {
  getDownloadURL,
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
} from 'firebase/storage';
import type {
  AppNotification,
  CallLogItem,
  ChatMessage,
  ConversationSummary,
  FriendRequestItem,
  PublicPeer,
  StatusItem,
  UserProfile,
} from '../types/rikzen';
import { firebaseApp, firebaseAuth } from './firebaseAuth';
import {
  db,
  handleFirestoreError,
  OperationType,
  sanitizeAvatarUrl,
  sanitizeMediaUrl,
  setPresenceFirestore,
} from './firestore';

const DEFAULT_PRIVACY: UserProfile['privacySettings'] = {
  lastSeen: 'friends',
  onlineStatus: 'friends',
  profilePhoto: 'everyone',
  bioVisibility: 'everyone',
  readReceipts: true,
  friendRequests: 'everyone',
  discoverableByPhone: false,
  discoverableByName: true,
  emailVisibility: 'nobody',
};

const DEFAULT_APPEARANCE: UserProfile['appearanceSettings'] = {
  theme: 'dark',
  wallpaper: 'obsidian-web',
  accentColor: 'gold',
  fontSize: 'medium',
  bubbleStyle: 'rounded',
};

const DEFAULT_NOTIFICATIONS: UserProfile['notificationSettings'] = {
  messages: true,
  friendRequests: true,
  groups: true,
  calls: true,
  statuses: true,
  sound: true,
  vibration: true,
};

const DEFAULT_STORAGE: UserProfile['storageSettings'] = {
  autoDownloadImages: true,
  autoDownloadVideo: false,
  autoDownloadDocs: true,
};

const DEFAULT_ACCESSIBILITY: UserProfile['accessibilitySettings'] = {
  reducedMotion: false,
  highContrast: false,
  appLanguage: 'en',
};

// Local lookup cache mapping messageId -> conversationId for PATCH/DELETE/react/pin/star
const messageConvCache = new Map<string, string>();

function generatePermanentRikzenIdFromUid(uid: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 2166136261;
  for (let i = 0; i < uid.length; i++) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  let code = '';
  for (let i = 0; i < 6; i++) {
    hash ^= hash >>> 13;
    hash = Math.imul(hash, 1274126177);
    code += chars[Math.abs(hash) % chars.length];
  }
  return `RIKZEN-${code}`;
}

function makeDocId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/[^a-zA-Z0-9]/g, '').slice(0, 16)
      : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function toIso(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  return new Date().toISOString();
}

function toMs(val: any): number {
  if (!val) return 0;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (typeof val === 'string') {
    const parsed = Date.parse(val);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function waitForFirebaseUser(): Promise<User | null> {
  return new Promise((resolve) => {
    if (firebaseAuth.currentUser) {
      resolve(firebaseAuth.currentUser);
      return;
    }
    const unsub = onAuthStateChanged(firebaseAuth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

function buildUserProfile(
  uid: string,
  email: string,
  pub: DocumentData | null,
  priv: DocumentData | null,
  fbUser?: User | null
): UserProfile {
  const rikzenId = String(pub?.rikzenId || priv?.rikzenId || generatePermanentRikzenIdFromUid(uid));
  const fullName = String(pub?.fullName || fbUser?.displayName || email.split('@')[0] || 'RIKZEN User');
  const isAdmin =
    email.toLowerCase() === 'phonedata9955@gmail.com' && Boolean(fbUser?.emailVerified ?? true);

  return {
    id: uid,
    rikzenId,
    email,
    fullName,
    avatarUrl: (pub?.avatarUrl as string | null) ?? fbUser?.photoURL ?? null,
    bio: String(pub?.bio ?? 'Hey there! I am using RIKZEN CHAT.'),
    phone: (priv?.phone as string | null) ?? null,
    phoneVerified: Boolean(priv?.phone),
    emailVerified: Boolean(fbUser?.emailVerified ?? true),
    dateOfBirth: (priv?.dateOfBirth as string | null) ?? null,
    onboardingCompleted: Boolean(pub?.onboardingCompleted ?? false),
    privacySettings: {
      ...DEFAULT_PRIVACY,
      lastSeen: priv?.lastSeen || pub?.lastSeenPrivacy || DEFAULT_PRIVACY.lastSeen,
      onlineStatus: priv?.onlineStatus || pub?.onlineStatusPrivacy || DEFAULT_PRIVACY.onlineStatus,
      profilePhoto: priv?.profilePhoto || DEFAULT_PRIVACY.profilePhoto,
      bioVisibility: priv?.bioVisibility || DEFAULT_PRIVACY.bioVisibility,
      emailVisibility: priv?.emailVisibility || DEFAULT_PRIVACY.emailVisibility,
      friendRequests: priv?.friendRequests || DEFAULT_PRIVACY.friendRequests,
      readReceipts: priv?.readReceipts ?? DEFAULT_PRIVACY.readReceipts,
      discoverableByName:
        priv?.discoverableByName ?? pub?.discoverableByName ?? DEFAULT_PRIVACY.discoverableByName,
      discoverableByPhone: priv?.discoverableByPhone ?? DEFAULT_PRIVACY.discoverableByPhone,
    },
    appearanceSettings: {
      ...DEFAULT_APPEARANCE,
      theme: priv?.theme || DEFAULT_APPEARANCE.theme,
      wallpaper: priv?.wallpaper || DEFAULT_APPEARANCE.wallpaper,
      accentColor: priv?.accentColor || DEFAULT_APPEARANCE.accentColor,
      fontSize: priv?.fontSize || DEFAULT_APPEARANCE.fontSize,
      bubbleStyle: priv?.bubbleStyle || DEFAULT_APPEARANCE.bubbleStyle,
    },
    notificationSettings: { ...DEFAULT_NOTIFICATIONS },
    storageSettings: { ...DEFAULT_STORAGE },
    accessibilitySettings: {
      ...DEFAULT_ACCESSIBILITY,
      appLanguage: priv?.appLanguage || DEFAULT_ACCESSIBILITY.appLanguage,
    },
    isAdmin,
  };
}

async function ensureAndLoadProfile(fbUser: User): Promise<UserProfile> {
  if (!fbUser.email) {
    throw new Error('Verified email address is required.');
  }
  if (!fbUser.emailVerified) {
    throw new Error('Please verify your email address first, or use Sign in with Google.');
  }

  const uid = fbUser.uid;
  const publicPath = `publicProfiles/${uid}`;
  const privatePath = `users/${uid}`;

  let pubData: DocumentData | null = null;
  try {
    const pubSnap = await getDoc(doc(db, 'publicProfiles', uid));
    pubData = pubSnap.exists() ? pubSnap.data() : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, publicPath);
  }

  let privData: DocumentData | null = null;
  try {
    const privSnap = await getDoc(doc(db, 'users', uid));
    privData = privSnap.exists() ? privSnap.data() : null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, privatePath);
  }

  const rikzenId = String(pubData?.rikzenId || privData?.rikzenId || generatePermanentRikzenIdFromUid(uid));
  const safeName = String(pubData?.fullName || fbUser.displayName || fbUser.email.split('@')[0] || 'RIKZEN User')
    .trim()
    .slice(0, 80);
  const safeAvatar = sanitizeAvatarUrl(pubData?.avatarUrl ?? fbUser.photoURL ?? null);

  if (!pubData) {
    try {
      await setDoc(doc(db, 'publicProfiles', uid), {
        uid,
        rikzenId,
        fullName: safeName,
        avatarUrl: safeAvatar,
        bio: 'Hey there! I am using RIKZEN CHAT.',
        onboardingCompleted: false,
        isOnline: true,
        lastSeenPrivacy: 'friends',
        onlineStatusPrivacy: 'friends',
        discoverableByName: true,
        typingInConversationId: null,
        typingActivity: 'idle',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const reSnap = await getDoc(doc(db, 'publicProfiles', uid));
      pubData = reSnap.data() || null;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, publicPath);
    }
  } else if (!pubData.isOnline) {
    try {
      await updateDoc(doc(db, 'publicProfiles', uid), {
        isOnline: true,
        updatedAt: serverTimestamp(),
      });
      pubData = { ...pubData, isOnline: true };
    } catch {
      // ignore non-fatal presence refresh
    }
  }

  if (!privData) {
    try {
      await setDoc(doc(db, 'users', uid), {
        uid,
        rikzenId,
        email: fbUser.email,
        phone: null,
        dateOfBirth: null,
        theme: 'dark',
        wallpaper: 'obsidian-web',
        accentColor: 'gold',
        fontSize: 'medium',
        bubbleStyle: 'rounded',
        appLanguage: 'en',
        lastSeen: 'friends',
        onlineStatus: 'friends',
        profilePhoto: 'everyone',
        bioVisibility: 'everyone',
        emailVisibility: 'nobody',
        friendRequests: 'everyone',
        readReceipts: true,
        discoverableByName: true,
        discoverableByPhone: false,
        blockedUids: [],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      const reSnap = await getDoc(doc(db, 'users', uid));
      privData = reSnap.data() || null;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, privatePath);
    }
  }

  return buildUserProfile(uid, fbUser.email, pubData, privData, fbUser);
}

async function requireVerifiedUser(): Promise<User> {
  const user = await waitForFirebaseUser();
  if (!user) {
    throw new Error('Authentication required. Please sign in.');
  }
  if (!user.emailVerified) {
    throw new Error('Please verify your email address or Sign in with Google.');
  }
  return user;
}

function directConversationId(uidA: string, uidB: string): string {
  const [first, second] = [uidA, uidB].sort();
  return `dm_${first}_${second}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

async function ensureDirectConversationFirestore(uid: string, peerId: string): Promise<string> {
  const convId = directConversationId(uid, peerId);
  const convRef = doc(db, 'conversations', convId);

  let existsConv = false;
  try {
    const snap = await getDoc(convRef);
    existsConv = snap.exists();
  } catch {
    existsConv = false;
  }

  if (!existsConv) {
    let peerName = 'Direct Chat';
    try {
      const peerSnap = await getDoc(doc(db, 'publicProfiles', peerId));
      if (peerSnap.exists()) {
        peerName = String(peerSnap.data().fullName || 'Direct Chat').slice(0, 120);
      }
    } catch {
      // ignore
    }

    const batch = writeBatch(db);
    batch.set(convRef, {
      id: convId,
      type: 'direct',
      title: peerName,
      createdBy: uid,
      peerUid: peerId,
      memberUids: [uid, peerId],
      lastMessageId: null,
      lastMessageText: '',
      lastMessageType: 'text',
      lastMessageSenderUid: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'conversations', convId, 'members', uid), {
      uid,
      conversationId: convId,
      role: 'owner',
      muted: false,
      archived: false,
      pinned: false,
      markedUnread: false,
      disappearingSeconds: 0,
      chatTheme: null,
      customList: '',
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'conversations', convId, 'members', peerId), {
      uid: peerId,
      conversationId: convId,
      role: 'member',
      muted: false,
      archived: false,
      pinned: false,
      markedUnread: false,
      disappearingSeconds: 0,
      chatTheme: null,
      customList: '',
      joinedAt: serverTimestamp(),
    });
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${convId}`);
    }
  }
  return convId;
}

async function resolveConversationForMessage(messageId: string, uid: string, hintConvId?: string): Promise<string | null> {
  if (hintConvId) return hintConvId;
  const cached = messageConvCache.get(messageId);
  if (cached) return cached;

  const [c1, c2, c3] = await Promise.all([
    getDocs(query(collection(db, 'conversations'), where('createdBy', '==', uid))).catch(() => null),
    getDocs(query(collection(db, 'conversations'), where('peerUid', '==', uid))).catch(() => null),
    getDocs(query(collection(db, 'conversations'), where('memberUids', 'array-contains', uid))).catch(() => null),
  ]);
  const convIds = new Set<string>();
  for (const snap of [c1, c2, c3]) {
    if (snap) snap.docs.forEach((d) => convIds.add(d.id));
  }
  for (const cid of convIds) {
    try {
      const mSnap = await getDoc(doc(db, 'conversations', cid, 'messages', messageId));
      if (mSnap.exists()) {
        messageConvCache.set(messageId, cid);
        return cid;
      }
    } catch {
      // continue searching
    }
  }
  return null;
}

function mapFirestoreMessageDoc(
  m: DocumentData,
  myUid: string,
  senderProfile?: DocumentData
): ChatMessage {
  if (m.id && m.conversationId) {
    messageConvCache.set(m.id, m.conversationId);
  }
  const reactions = Array.isArray(m.reactions) ? m.reactions : [];
  const starredBy = Array.isArray(m.starredBy) ? m.starredBy : [];
  const metadata: Record<string, any> = {};
  if (m.fileUrl) metadata.fileUrl = m.fileUrl;
  if (m.fileName) metadata.fileName = m.fileName;
  if (m.mimeType) metadata.mimeType = m.mimeType;
  if (typeof m.sizeBytes === 'number') metadata.sizeBytes = m.sizeBytes;
  if (typeof m.durationSeconds === 'number') metadata.durationSeconds = m.durationSeconds;
  if (typeof m.latitude === 'number') metadata.latitude = m.latitude;
  if (typeof m.longitude === 'number') metadata.longitude = m.longitude;

  const status: 'sent' | 'delivered' | 'read' = m.readAt
    ? 'read'
    : m.deliveredAt
    ? 'delivered'
    : 'sent';

  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderUid,
    senderName:
      m.senderUid === myUid ? 'You' : String(senderProfile?.fullName || 'Friend'),
    senderAvatar: (senderProfile?.avatarUrl as string | null) || null,
    content: m.isDeleted ? 'This message was deleted' : m.content,
    messageType: m.messageType || 'text',
    replyToId: m.replyToId || null,
    replyTo: m.replyToId
      ? {
          id: m.replyToId,
          content: m.replyToText || 'Message',
          messageType: m.replyToType || 'text',
          senderName: m.replyToSender || 'User',
        }
      : null,
    forwardedFromId: m.forwardedFromId || null,
    metadata,
    isEdited: Boolean(m.isEdited),
    isDeleted: Boolean(m.isDeleted),
    isPinned: Boolean(m.isPinned),
    isStarred: starredBy.includes(myUid),
    status,
    reactions,
    createdAt: toIso(m.createdAt),
    updatedAt: toIso(m.updatedAt),
    expiresAt: m.expiresAt ? toIso(m.expiresAt) : null,
  };
}

function mapFirebaseAuthError(err: any): Error {
  const code = err?.code || '';
  if (code === 'auth/email-already-in-use') {
    return new Error('An account with this email already exists. Please switch to Sign In.');
  }
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return new Error('Invalid email or password.');
  }
  if (code === 'auth/operation-not-allowed') {
    return new Error(
      'Email/Password login is not enabled in Firebase Authentication yet. Use Sign in with Google or enable Email/Password in Firebase Console.'
    );
  }
  if (code === 'auth/weak-password') {
    return new Error('Password must be at least 6 characters.');
  }
  return new Error(err?.message || 'Authentication failed.');
}

export async function uploadFileToFirebaseStorage(
  file: File | Blob,
  filename = 'upload.bin',
  onProgress?: (percent: number) => void
): Promise<{ fileUrl: string; fileName: string; mimeType: string; sizeBytes: number }> {
  const user = await requireVerifiedUser();
  const storage = getStorage(firebaseApp);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const path = `uploads/${user.uid}/${Date.now()}-${safeName}`;
  const sRef = storageRef(storage, path);

  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(sRef, file);
    task.on(
      'state_changed',
      (snapshot) => {
        if (snapshot.totalBytes > 0 && onProgress) {
          onProgress(Math.min(99, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)));
        }
      },
      (err: any) => {
        const msg = err?.code || err?.message || '';
        if (String(msg).includes('storage/unauthorized') || String(msg).includes('permission')) {
          reject(
            new Error(
              'Media upload needs Firebase Storage enabled & allowed in Firebase Console.'
            )
          );
          return;
        }
        reject(new Error(err?.message || 'Media upload failed. Please try again.'));
      },
      async () => {
        try {
          const fileUrl = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          resolve({
            fileUrl,
            fileName: filename,
            mimeType: file.type || 'application/octet-stream',
            sizeBytes: file.size,
          });
        } catch (err: any) {
          reject(new Error(err?.message || 'Failed to finalize uploaded file URL.'));
        }
      }
    );
  });
}

async function fetchUserConversationsList(uid: string): Promise<ConversationSummary[]> {
  let createdSnap;
  let peerSnap;
  let memberSnap;
  try {
    [createdSnap, peerSnap, memberSnap] = await Promise.all([
      getDocs(query(collection(db, 'conversations'), where('createdBy', '==', uid))),
      getDocs(query(collection(db, 'conversations'), where('peerUid', '==', uid))),
      getDocs(query(collection(db, 'conversations'), where('memberUids', 'array-contains', uid))),
    ]);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'conversations');
  }

  const convMap = new Map<string, DocumentData>();
  for (const d of [...createdSnap.docs, ...peerSnap.docs, ...memberSnap.docs]) {
    convMap.set(d.id, d.data());
  }

  let myBlocked: string[] = [];
  try {
    const mePriv = await getDoc(doc(db, 'users', uid));
    if (mePriv.exists() && Array.isArray(mePriv.data().blockedUids)) {
      myBlocked = mePriv.data().blockedUids;
    }
  } catch {
    // ignore
  }
  const blockedSet = new Set(myBlocked);

  const conversations: ConversationSummary[] = [];
  for (const [convId, c] of convMap.entries()) {
    const type: 'direct' | 'group' = c.type === 'group' ? 'group' : 'direct';
    const otherUid = type === 'direct' ? (c.createdBy === uid ? c.peerUid : c.createdBy) : null;
    let peer: PublicPeer | null = null;
    let title = c.title || (type === 'group' ? 'Group Chat' : 'Chat');
    let avatarUrl: string | null = c.avatarUrl || null;

    if (type === 'direct' && otherUid) {
      try {
        const pSnap = await getDoc(doc(db, 'publicProfiles', otherUid));
        if (pSnap.exists()) {
          const p = pSnap.data();
          title = p.fullName || title;
          avatarUrl = p.avatarUrl || null;
          const onlinePrivacy = p.onlineStatusPrivacy || 'friends';
          const seenPrivacy = p.lastSeenPrivacy || 'friends';
          peer = {
            id: otherUid,
            rikzenId: p.rikzenId,
            fullName: p.fullName,
            avatarUrl: p.avatarUrl || null,
            bio: p.bio || null,
            phone: null,
            email: null,
            isOnline: onlinePrivacy === 'nobody' ? false : Boolean(p.isOnline),
            lastSeenAt: seenPrivacy === 'nobody' ? null : toIso(p.updatedAt),
            typingInConversationId: p.typingInConversationId || null,
            typingActivity: p.typingActivity || 'idle',
            isFriend: true,
          };
        }
      } catch {
        // ignore
      }
    }

    let memberData: DocumentData = {};
    try {
      const mSnap = await getDoc(doc(db, 'conversations', convId, 'members', uid));
      if (mSnap.exists()) {
        memberData = mSnap.data();
      }
    } catch {
      // ignore
    }

    // Compute unread count and latest message tick status
    let unreadCount = 0;
    let latestStatus: 'sent' | 'delivered' | 'read' = 'sent';
    try {
      const [sSnap, rSnap, grpSnap] = await Promise.all([
        getDocs(query(collection(db, 'conversations', convId, 'messages'), where('senderUid', '==', uid))),
        getDocs(query(collection(db, 'conversations', convId, 'messages'), where('recipientUid', '==', uid))),
        getDocs(query(collection(db, 'conversations', convId, 'messages'), where('memberUids', 'array-contains', uid))).catch(() => null),
      ]);
      const msgMap = new Map<string, DocumentData>();
      for (const s of [sSnap, rSnap, grpSnap]) {
        if (s) s.docs.forEach((md) => msgMap.set(md.id, md.data()));
      }

      const nowMs = Date.now();
      const clearedMs = toMs(memberData.clearedAt);
      const lastReadMs = toMs(memberData.lastReadAt);

      let latestMsg: DocumentData | null = null;
      let latestMs = 0;

      for (const m of msgMap.values()) {
        const deletedFor = Array.isArray(m.deletedForUids) ? m.deletedForUids : [];
        if (deletedFor.includes(uid)) continue;
        const expMs = toMs(m.expiresAt);
        if (expMs > 0 && expMs <= nowMs) continue;
        const cMs = toMs(m.createdAt);
        if (clearedMs > 0 && cMs <= clearedMs) continue;

        if (cMs >= latestMs) {
          latestMs = cMs;
          latestMsg = m;
        }
        if (m.senderUid !== uid && !m.readAt && (lastReadMs === 0 || cMs > lastReadMs)) {
          unreadCount++;
        }
      }

      if (latestMsg && latestMsg.senderUid === uid) {
        latestStatus = latestMsg.readAt ? 'read' : latestMsg.deliveredAt ? 'delivered' : 'sent';
      }
    } catch {
      // ignore unread computation errors
    }

    if (memberData.markedUnread && unreadCount === 0) {
      unreadCount = 1;
    }

    conversations.push({
      id: convId,
      type,
      groupId: type === 'group' ? convId : undefined,
      title,
      description: c.description || '',
      avatarUrl,
      inviteCode: c.inviteCode || null,
      peer,
      isBlocked: otherUid ? blockedSet.has(otherUid) : false,
      onlyAdminsMessage: Boolean(c.onlyAdminsMessage),
      onlyAdminsEditInfo: Boolean(c.onlyAdminsEditInfo),
      myRole: (memberData.role as 'owner' | 'admin' | 'member') || 'member',
      memberCount: Array.isArray(c.memberUids) ? c.memberUids.length : undefined,
      muted: Boolean(memberData.muted),
      archived: Boolean(memberData.archived),
      pinned: Boolean(memberData.pinned),
      markedUnread: Boolean(memberData.markedUnread),
      disappearingSeconds: Number(memberData.disappearingSeconds || 0),
      chatTheme: (memberData.chatTheme as string | null) || null,
      customList: String(memberData.customList || ''),
      unreadCount,
      lastMessageAt: toIso(c.updatedAt),
      lastMessage: c.lastMessageText
        ? {
            id: c.lastMessageId || 'latest',
            content: c.lastMessageText,
            messageType: c.lastMessageType || 'text',
            senderId: c.lastMessageSenderUid || c.createdBy,
            senderName: c.lastMessageSenderUid === uid ? 'You' : title,
            status: latestStatus,
            createdAt: toIso(c.updatedAt),
          }
        : null,
    });
  }

  conversations.sort((a, b) => {
    if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) {
      return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0);
    }
    return b.lastMessageAt.localeCompare(a.lastMessageAt);
  });

  return conversations;
}

export function subscribeConversationsFirestore(
  uid: string,
  onUpdate: (conversations: ConversationSummary[]) => void
): () => void {
  let active = true;
  let timer: number | null = null;
  const triggerReload = () => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      if (!active) return;
      try {
        const list = await fetchUserConversationsList(uid);
        if (active) onUpdate(list);
      } catch {
        // ignore transient snapshot errors
      }
    }, 150);
  };

  const u1 = onSnapshot(
    query(collection(db, 'conversations'), where('createdBy', '==', uid)),
    () => triggerReload(),
    () => {}
  );
  const u2 = onSnapshot(
    query(collection(db, 'conversations'), where('peerUid', '==', uid)),
    () => triggerReload(),
    () => {}
  );
  const u3 = onSnapshot(
    query(collection(db, 'conversations'), where('memberUids', 'array-contains', uid)),
    () => triggerReload(),
    () => {}
  );

  return () => {
    active = false;
    if (timer) window.clearTimeout(timer);
    u1();
    u2();
    u3();
  };
}

export async function handleFirebaseApiFallback<T = any>(
  rawPath: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method || 'GET').toUpperCase();
  const url = new URL(rawPath, 'https://rikzen.local');
  const pathname = url.pathname;
  const body =
    typeof options.body === 'string' && options.body.trim()
      ? JSON.parse(options.body)
      : {};

  // -------------------------------------------------------------------------
  // Auth Endpoints
  // -------------------------------------------------------------------------
  if (pathname === '/api/auth/google' && method === 'POST') {
    const fbUser = await waitForFirebaseUser();
    if (!fbUser) {
      throw new Error('Google sign-in did not complete. Please try again.');
    }
    const profile = await ensureAndLoadProfile(fbUser);
    return { token: 'firebase-session', profile } as T;
  }

  if (pathname === '/api/auth/register' && method === 'POST') {
    try {
      const cred = await createUserWithEmailAndPassword(
        firebaseAuth,
        String(body.email || '').trim(),
        String(body.password || '')
      );
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        await signOut(firebaseAuth).catch(() => {});
        throw new Error(
          'Account created! Please click the verification link sent to your email, or use Sign in with Google for instant access.'
        );
      }
      const profile = await ensureAndLoadProfile(cred.user);
      return { token: 'firebase-session', profile } as T;
    } catch (err: any) {
      throw mapFirebaseAuthError(err);
    }
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    try {
      const cred = await signInWithEmailAndPassword(
        firebaseAuth,
        String(body.email || '').trim(),
        String(body.password || '')
      );
      if (!cred.user.emailVerified) {
        await sendEmailVerification(cred.user).catch(() => {});
        await signOut(firebaseAuth).catch(() => {});
        throw new Error(
          'Please verify your email address using the link sent to your inbox, or Sign in with Google.'
        );
      }
      const profile = await ensureAndLoadProfile(cred.user);
      return { token: 'firebase-session', profile } as T;
    } catch (err: any) {
      throw mapFirebaseAuthError(err);
    }
  }

  if (pathname === '/api/auth/forgot-password' && method === 'POST') {
    await sendPasswordResetEmail(firebaseAuth, String(body.email || '').trim());
    return {
      ok: true,
      message: 'Password reset link sent to your email address via Firebase.',
    } as T;
  }

  if (pathname === '/api/auth/me' && method === 'GET') {
    const fbUser = await requireVerifiedUser();
    const profile = await ensureAndLoadProfile(fbUser);
    return { profile } as T;
  }

  if (pathname === '/api/auth/complete-onboarding' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const uid = fbUser.uid;
    const safeName = String(body.fullName || '').trim().slice(0, 80);
    if (!safeName) throw new Error('Full name is required.');
    const safeBio = String(body.bio || 'Hey there! I am using RIKZEN CHAT.').trim().slice(0, 220);
    const safePhone = body.phone ? String(body.phone).trim().slice(0, 32) : null;
    const safeDob = body.dateOfBirth ? String(body.dateOfBirth).trim().slice(0, 24) : null;
    const safeAvatar = sanitizeAvatarUrl(body.avatarUrl);

    try {
      await updateDoc(doc(db, 'publicProfiles', uid), {
        fullName: safeName,
        bio: safeBio,
        avatarUrl: safeAvatar,
        onboardingCompleted: true,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `publicProfiles/${uid}`);
    }

    try {
      await updateDoc(doc(db, 'users', uid), {
        phone: safePhone,
        dateOfBirth: safeDob,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}`);
    }

    const profile = await ensureAndLoadProfile(fbUser);
    return { profile } as T;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    await setPresenceFirestore(false).catch(() => {});
    await signOut(firebaseAuth).catch(() => {});
    return { ok: true } as T;
  }

  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    await updatePassword(fbUser, String(body.newPassword || ''));
    return { ok: true } as T;
  }

  if (pathname === '/api/auth/change-phone' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const newPhone = body.newPhone ? String(body.newPhone).trim().slice(0, 32) : null;
    try {
      await updateDoc(doc(db, 'users', fbUser.uid), {
        phone: newPhone,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
    }
    return { ok: true, phone: newPhone } as T;
  }

  if (pathname === '/api/auth/account' && method === 'DELETE') {
    const fbUser = await requireVerifiedUser();
    try {
      await deleteDoc(doc(db, 'users', fbUser.uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${fbUser.uid}`);
    }
    await deleteUser(fbUser).catch(() => {});
    return { ok: true } as T;
  }

  // -------------------------------------------------------------------------
  // Profile & Settings
  // -------------------------------------------------------------------------
  if (pathname === '/api/profiles/me' && method === 'PATCH') {
    const fbUser = await requireVerifiedUser();
    const pubPatch: Record<string, any> = { updatedAt: serverTimestamp() };
    if (body.fullName !== undefined) pubPatch.fullName = String(body.fullName).trim().slice(0, 80);
    if (body.bio !== undefined) pubPatch.bio = String(body.bio).trim().slice(0, 220);
    if (body.avatarUrl !== undefined) pubPatch.avatarUrl = sanitizeAvatarUrl(body.avatarUrl);

    try {
      await updateDoc(doc(db, 'publicProfiles', fbUser.uid), pubPatch);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `publicProfiles/${fbUser.uid}`);
    }

    if (body.phone !== undefined) {
      try {
        await updateDoc(doc(db, 'users', fbUser.uid), {
          phone: body.phone ? String(body.phone).trim().slice(0, 32) : null,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
      }
    }

    const profile = await ensureAndLoadProfile(fbUser);
    return { profile } as T;
  }

  if (pathname === '/api/profiles/settings' && method === 'PATCH') {
    const fbUser = await requireVerifiedUser();
    const privPatch: Record<string, any> = { updatedAt: serverTimestamp() };
    const pubPatch: Record<string, any> = {};

    if (body.appearanceSettings) {
      const a = body.appearanceSettings;
      if (a.theme) privPatch.theme = a.theme;
      if (a.wallpaper) privPatch.wallpaper = a.wallpaper;
      if (a.accentColor) privPatch.accentColor = a.accentColor;
      if (a.fontSize) privPatch.fontSize = a.fontSize;
      if (a.bubbleStyle) privPatch.bubbleStyle = a.bubbleStyle;
    }
    if (body.privacySettings) {
      const p = body.privacySettings;
      if (p.lastSeen) {
        privPatch.lastSeen = p.lastSeen;
        pubPatch.lastSeenPrivacy = p.lastSeen;
      }
      if (p.onlineStatus) {
        privPatch.onlineStatus = p.onlineStatus;
        pubPatch.onlineStatusPrivacy = p.onlineStatus;
      }
      if (p.profilePhoto) privPatch.profilePhoto = p.profilePhoto;
      if (p.bioVisibility) privPatch.bioVisibility = p.bioVisibility;
      if (p.emailVisibility) privPatch.emailVisibility = p.emailVisibility;
      if (p.friendRequests) privPatch.friendRequests = p.friendRequests;
      if (typeof p.readReceipts === 'boolean') privPatch.readReceipts = p.readReceipts;
      if (typeof p.discoverableByPhone === 'boolean') privPatch.discoverableByPhone = p.discoverableByPhone;
      if (typeof p.discoverableByName === 'boolean') {
        privPatch.discoverableByName = p.discoverableByName;
        pubPatch.discoverableByName = p.discoverableByName;
      }
    }
    if (body.accessibilitySettings?.appLanguage) {
      privPatch.appLanguage = String(body.accessibilitySettings.appLanguage).slice(0, 16);
    }

    try {
      await updateDoc(doc(db, 'users', fbUser.uid), privPatch);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
    }
    if (Object.keys(pubPatch).length > 0) {
      try {
        await updateDoc(doc(db, 'publicProfiles', fbUser.uid), {
          ...pubPatch,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `publicProfiles/${fbUser.uid}`);
      }
    }

    const profile = await ensureAndLoadProfile(fbUser);
    return {
      privacySettings: profile.privacySettings,
      appearanceSettings: profile.appearanceSettings,
      notificationSettings: profile.notificationSettings,
      storageSettings: profile.storageSettings,
      accessibilitySettings: profile.accessibilitySettings,
    } as T;
  }

  // -------------------------------------------------------------------------
  // User Discovery, Friends & Blocking
  // -------------------------------------------------------------------------
  if (pathname === '/api/users/search' && method === 'GET') {
    const fbUser = await requireVerifiedUser();
    const qStr = (url.searchParams.get('q') || '').trim().toLowerCase();
    if (!qStr) return { results: [] } as T;

    let snap;
    try {
      snap = await getDocs(
        query(collection(db, 'publicProfiles'), where('onboardingCompleted', '==', true))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'publicProfiles');
    }

    let reqSentSnap;
    let reqRecvSnap;
    try {
      reqSentSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('senderUid', '==', fbUser.uid))
      );
      reqRecvSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('receiverUid', '==', fbUser.uid))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'friendRequests');
    }

    const relMap = new Map<string, { relationship: PublicPeer['relationship']; requestId: string }>();
    for (const d of [...reqSentSnap.docs, ...reqRecvSnap.docs]) {
      const r = d.data();
      const peerId = r.senderUid === fbUser.uid ? r.receiverUid : r.senderUid;
      if (r.status === 'accepted') {
        relMap.set(peerId, { relationship: 'friends', requestId: d.id });
      } else if (r.status === 'pending') {
        relMap.set(peerId, {
          relationship: r.senderUid === fbUser.uid ? 'sent' : 'received',
          requestId: d.id,
        });
      }
    }

    const results: PublicPeer[] = [];
    for (const d of snap.docs) {
      const p = d.data();
      if (p.uid === fbUser.uid) continue;
      const rikzenMatch = String(p.rikzenId || '').toLowerCase() === qStr;
      const nameMatch =
        p.discoverableByName !== false &&
        String(p.fullName || '').toLowerCase().includes(qStr);
      if (!rikzenMatch && !nameMatch) continue;
      const rel = relMap.get(p.uid);
      results.push({
        id: p.uid,
        rikzenId: p.rikzenId,
        fullName: p.fullName,
        avatarUrl: p.avatarUrl || null,
        bio: p.bio || null,
        phone: null,
        email: null,
        isOnline: p.onlineStatusPrivacy === 'nobody' ? false : Boolean(p.isOnline),
        lastSeenAt: p.lastSeenPrivacy === 'nobody' ? null : toIso(p.updatedAt),
        isFriend: rel?.relationship === 'friends',
        relationship: rel?.relationship || 'none',
        requestId: rel?.requestId || null,
        canSendRequest: !rel,
      });
    }
    return { results } as T;
  }

  if (pathname === '/api/friends' && method === 'GET') {
    const fbUser = await requireVerifiedUser();
    let sentSnap;
    let recvSnap;
    try {
      sentSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('senderUid', '==', fbUser.uid))
      );
      recvSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('receiverUid', '==', fbUser.uid))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'friendRequests');
    }

    let blockedUids: string[] = [];
    try {
      const priv = await getDoc(doc(db, 'users', fbUser.uid));
      if (priv.exists() && Array.isArray(priv.data().blockedUids)) {
        blockedUids = priv.data().blockedUids;
      }
    } catch {
      // ignore
    }

    const allReqs = [...sentSnap.docs, ...recvSnap.docs];
    const peerUids = new Set<string>(blockedUids);
    for (const d of allReqs) {
      const r = d.data();
      peerUids.add(r.senderUid);
      peerUids.add(r.receiverUid);
    }

    const profileMap = new Map<string, DocumentData>();
    for (const uid of peerUids) {
      try {
        const s = await getDoc(doc(db, 'publicProfiles', uid));
        if (s.exists()) profileMap.set(uid, s.data());
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `publicProfiles/${uid}`);
      }
    }

    const friends: PublicPeer[] = [];
    const requests: FriendRequestItem[] = [];
    const seenFriend = new Set<string>();

    for (const d of allReqs) {
      const r = d.data();
      const sProf = profileMap.get(r.senderUid) || {};
      const rProf = profileMap.get(r.receiverUid) || {};
      requests.push({
        id: d.id,
        sender_id: r.senderUid,
        receiver_id: r.receiverUid,
        status: r.status,
        created_at: toIso(r.createdAt),
        updated_at: toIso(r.updatedAt),
        sender_rikzen_id: sProf.rikzenId || '',
        sender_name: sProf.fullName || 'RIKZEN User',
        sender_avatar: sProf.avatarUrl || null,
        sender_bio: sProf.bio || '',
        receiver_rikzen_id: rProf.rikzenId || '',
        receiver_name: rProf.fullName || 'RIKZEN User',
        receiver_avatar: rProf.avatarUrl || null,
        receiver_bio: rProf.bio || '',
      });

      if (r.status === 'accepted') {
        const peerId = r.senderUid === fbUser.uid ? r.receiverUid : r.senderUid;
        if (!seenFriend.has(peerId)) {
          seenFriend.add(peerId);
          const p = profileMap.get(peerId) || {};
          friends.push({
            id: peerId,
            rikzenId: p.rikzenId || '',
            fullName: p.fullName || 'RIKZEN User',
            avatarUrl: p.avatarUrl || null,
            bio: p.bio || null,
            phone: null,
            email: null,
            isOnline: p.onlineStatusPrivacy === 'nobody' ? false : Boolean(p.isOnline),
            lastSeenAt: p.lastSeenPrivacy === 'nobody' ? null : toIso(p.updatedAt),
            isFriend: true,
            relationship: 'friends',
          });
        }
      }
    }

    const blockedUsers = blockedUids.map((bUid) => {
      const bp = profileMap.get(bUid) || {};
      return {
        id: bUid,
        rikzen_id: bp.rikzenId || '',
        full_name: bp.fullName || 'Blocked User',
        avatar_url: bp.avatarUrl || null,
      };
    });

    return {
      friends,
      receivedRequests: requests.filter(
        (r) => r.receiver_id === fbUser.uid && r.status === 'pending'
      ),
      sentRequests: requests.filter(
        (r) => r.sender_id === fbUser.uid && r.status === 'pending'
      ),
      rejectedRequests: requests.filter((r) => r.status === 'rejected'),
      blockedUsers,
    } as T;
  }

  if (pathname === '/api/friends/request' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const receiverUid = String(body.targetUserId || body.receiverId || '').trim();
    if (!receiverUid || receiverUid === fbUser.uid) {
      throw new Error('You cannot send a friend request to yourself.');
    }

    let sentSnap;
    let recvSnap;
    try {
      sentSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('senderUid', '==', fbUser.uid))
      );
      recvSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('receiverUid', '==', fbUser.uid))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'friendRequests');
    }

    for (const d of [...sentSnap.docs, ...recvSnap.docs]) {
      const r = d.data();
      const involvesTarget =
        (r.senderUid === fbUser.uid && r.receiverUid === receiverUid) ||
        (r.senderUid === receiverUid && r.receiverUid === fbUser.uid);
      if (!involvesTarget) continue;
      if (r.status === 'accepted') {
        throw new Error('You are already connected with this user.');
      }
      if (r.status === 'pending') {
        throw new Error('A friend request already exists between you two.');
      }
      if (r.status === 'rejected') {
        try {
          await deleteDoc(doc(db, 'friendRequests', d.id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `friendRequests/${d.id}`);
        }
      }
    }

    const reqId = makeDocId('fr');
    try {
      await setDoc(doc(db, 'friendRequests', reqId), {
        id: reqId,
        senderUid: fbUser.uid,
        receiverUid,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `friendRequests/${reqId}`);
    }
    return { ok: true, id: reqId } as T;
  }

  const cancelReqMatch = pathname.match(/^\/api\/friends\/request\/([^/]+)$/);
  if (cancelReqMatch && method === 'DELETE') {
    const fbUser = await requireVerifiedUser();
    const reqId = cancelReqMatch[1];
    try {
      const snap = await getDoc(doc(db, 'friendRequests', reqId));
      if (!snap.exists()) throw new Error('Friend request not found.');
      if (snap.data().senderUid !== fbUser.uid && snap.data().receiverUid !== fbUser.uid) {
        throw new Error('Not authorized to cancel this request.');
      }
      await deleteDoc(doc(db, 'friendRequests', reqId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `friendRequests/${reqId}`);
    }
    return { ok: true } as T;
  }

  if (pathname === '/api/friends/respond' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const requestId = String(body.requestId || '').trim();
    if (!requestId) {
      throw new Error('Friend request ID is required.');
    }

    let reqSnap;
    try {
      reqSnap = await getDoc(doc(db, 'friendRequests', requestId));
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `friendRequests/${requestId}`);
    }
    if (!reqSnap.exists()) {
      throw new Error('Friend request not found.');
    }
    const reqData = reqSnap.data();
    if (reqData.receiverUid !== fbUser.uid) {
      throw new Error('Only the recipient can respond to this friend request.');
    }

    const action = body.action === 'accept' ? 'accepted' : 'rejected';
    try {
      await updateDoc(doc(db, 'friendRequests', requestId), {
        status: action,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${requestId}`);
    }

    if (action === 'accepted') {
      const conversationId = await ensureDirectConversationFirestore(
        fbUser.uid,
        String(reqData.senderUid)
      );
      return { ok: true, status: action, conversationId } as T;
    }

    return { ok: true, status: action } as T;
  }

  if (pathname === '/api/friends/block' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const targetId = String(body.targetUserId || '').trim();
    if (!targetId) throw new Error('Target user ID required.');
    try {
      const priv = await getDoc(doc(db, 'users', fbUser.uid));
      const cur: string[] = Array.isArray(priv.data()?.blockedUids) ? priv.data()?.blockedUids : [];
      if (!cur.includes(targetId)) {
        await updateDoc(doc(db, 'users', fbUser.uid), {
          blockedUids: [...cur, targetId].slice(0, 200),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
    }
    return { ok: true } as T;
  }

  const unblockMatch = pathname.match(/^\/api\/friends\/block\/([^/]+)$/);
  if (unblockMatch && method === 'DELETE') {
    const fbUser = await requireVerifiedUser();
    const targetId = unblockMatch[1];
    try {
      const priv = await getDoc(doc(db, 'users', fbUser.uid));
      const cur: string[] = Array.isArray(priv.data()?.blockedUids) ? priv.data()?.blockedUids : [];
      await updateDoc(doc(db, 'users', fbUser.uid), {
        blockedUids: cur.filter((u) => u !== targetId),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${fbUser.uid}`);
    }
    return { ok: true } as T;
  }

  if (pathname.startsWith('/api/friends/') && method === 'DELETE') {
    const fbUser = await requireVerifiedUser();
    const targetId = pathname.replace('/api/friends/', '');
    try {
      const sentSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('senderUid', '==', fbUser.uid))
      );
      const recvSnap = await getDocs(
        query(collection(db, 'friendRequests'), where('receiverUid', '==', fbUser.uid))
      );
      for (const d of [...sentSnap.docs, ...recvSnap.docs]) {
        const r = d.data();
        if (r.senderUid === targetId || r.receiverUid === targetId) {
          await deleteDoc(doc(db, 'friendRequests', d.id));
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `friendRequests`);
    }
    return { ok: true } as T;
  }

  // -------------------------------------------------------------------------
  // Conversations & Actions
  // -------------------------------------------------------------------------
  if (pathname === '/api/conversations/direct' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const peerId = String(body.peerId || '').trim();
    if (!peerId || peerId === fbUser.uid) throw new Error('Invalid peer user.');
    const convId = await ensureDirectConversationFirestore(fbUser.uid, peerId);
    return { conversationId: convId } as T;
  }

  if (pathname === '/api/conversations' && method === 'GET') {
    const fbUser = await requireVerifiedUser();
    const conversations = await fetchUserConversationsList(fbUser.uid);
    return { conversations } as T;
  }

  const convActionMatch = pathname.match(
    /^\/api\/conversations\/([^/]+)\/(mute|archive|pin|unread|disappearing|theme|list|clear|delivered|read)$/
  );
  if (convActionMatch && method === 'POST') {
    const convId = convActionMatch[1];
    const action = convActionMatch[2];
    const fbUser = await requireVerifiedUser();
    const memberRef = doc(db, 'conversations', convId, 'members', fbUser.uid);

    if (action === 'mute') {
      await updateDoc(memberRef, { muted: Boolean(body.muted) }).catch(() => {});
      return { ok: true, muted: Boolean(body.muted) } as T;
    }
    if (action === 'archive') {
      await updateDoc(memberRef, { archived: Boolean(body.archived) }).catch(() => {});
      return { ok: true, archived: Boolean(body.archived) } as T;
    }
    if (action === 'pin') {
      await updateDoc(memberRef, { pinned: Boolean(body.pinned) }).catch(() => {});
      return { ok: true, pinned: Boolean(body.pinned) } as T;
    }
    if (action === 'unread') {
      await updateDoc(memberRef, { markedUnread: Boolean(body.unread) }).catch(() => {});
      return { ok: true, markedUnread: Boolean(body.unread) } as T;
    }
    if (action === 'disappearing') {
      const seconds = Math.max(0, Number(body.seconds || 0));
      await updateDoc(memberRef, { disappearingSeconds: Math.round(seconds) }).catch(() => {});
      return { ok: true, disappearingSeconds: Math.round(seconds) } as T;
    }
    if (action === 'theme') {
      const chatTheme = body.theme ? String(body.theme).slice(0, 32) : null;
      await updateDoc(memberRef, { chatTheme }).catch(() => {});
      return { ok: true, chatTheme } as T;
    }
    if (action === 'list') {
      const customList = String(body.listName || '').trim().slice(0, 64);
      await updateDoc(memberRef, { customList }).catch(() => {});
      return { ok: true, customList } as T;
    }
    if (action === 'clear') {
      await updateDoc(memberRef, { clearedAt: serverTimestamp() }).catch(() => {});
      return { ok: true } as T;
    }

    if (action === 'delivered' || action === 'read') {
      let allowRead = true;
      if (action === 'read') {
        await updateDoc(memberRef, {
          lastReadAt: serverTimestamp(),
          markedUnread: false,
        }).catch(() => {});
        try {
          const meSnap = await getDoc(doc(db, 'users', fbUser.uid));
          if (meSnap.exists() && meSnap.data().readReceipts === false) {
            allowRead = false;
          }
        } catch {
          // default allow
        }
      }

      try {
        const [rSnap, gSnap] = await Promise.all([
          getDocs(query(collection(db, 'conversations', convId, 'messages'), where('recipientUid', '==', fbUser.uid))),
          getDocs(query(collection(db, 'conversations', convId, 'messages'), where('memberUids', 'array-contains', fbUser.uid))).catch(() => null),
        ]);
        const docsMap = new Map<string, DocumentData>();
        rSnap.docs.forEach((d) => docsMap.set(d.id, d.data()));
        if (gSnap) gSnap.docs.forEach((d) => docsMap.set(d.id, d.data()));

        for (const [mId, m] of docsMap.entries()) {
          if (m.senderUid === fbUser.uid) continue;
          const patch: Record<string, any> = {};
          if (!m.deliveredAt) {
            patch.deliveredAt = serverTimestamp();
          }
          if (action === 'read' && allowRead && !m.readAt) {
            patch.readAt = serverTimestamp();
          }
          if (Object.keys(patch).length > 0) {
            patch.updatedAt = serverTimestamp();
            await updateDoc(doc(db, 'conversations', convId, 'messages', mId), patch).catch(() => {});
          }
        }
      } catch {
        // non-fatal receipt ack
      }
      return { ok: true } as T;
    }
  }

  const convDeleteMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
  if (convDeleteMatch && method === 'DELETE') {
    const convId = convDeleteMatch[1];
    const fbUser = await requireVerifiedUser();
    try {
      await updateDoc(doc(db, 'conversations', convId, 'members', fbUser.uid), {
        archived: true,
        clearedAt: serverTimestamp(),
      });
    } catch {
      // ignore
    }
    return { ok: true } as T;
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------
  const msgListMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgListMatch) {
    const convId = msgListMatch[1];
    const fbUser = await requireVerifiedUser();

    if (method === 'GET') {
      let sentSnap;
      let recvSnap;
      let grpSnap;
      let memberData: DocumentData = {};
      try {
        [sentSnap, recvSnap, grpSnap] = await Promise.all([
          getDocs(query(collection(db, 'conversations', convId, 'messages'), where('senderUid', '==', fbUser.uid))),
          getDocs(query(collection(db, 'conversations', convId, 'messages'), where('recipientUid', '==', fbUser.uid))),
          getDocs(query(collection(db, 'conversations', convId, 'messages'), where('memberUids', 'array-contains', fbUser.uid))).catch(() => null),
        ]);
        const memSnap = await getDoc(doc(db, 'conversations', convId, 'members', fbUser.uid));
        if (memSnap.exists()) memberData = memSnap.data();
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `conversations/${convId}/messages`);
      }

      const rawDocs = new Map<string, DocumentData>();
      for (const s of [sentSnap, recvSnap, grpSnap]) {
        if (s) s.docs.forEach((d) => rawDocs.set(d.id, d.data()));
      }

      const senderIds = new Set<string>();
      for (const m of rawDocs.values()) {
        if (m.senderUid && m.senderUid !== fbUser.uid) senderIds.add(m.senderUid);
      }
      const profileMap = new Map<string, DocumentData>();
      for (const sUid of senderIds) {
        const p = await getDoc(doc(db, 'publicProfiles', sUid)).catch(() => null);
        if (p?.exists()) profileMap.set(sUid, p.data());
      }

      const nowMs = Date.now();
      const clearedMs = toMs(memberData.clearedAt);
      const messages: ChatMessage[] = [];

      for (const m of rawDocs.values()) {
        const deletedFor = Array.isArray(m.deletedForUids) ? m.deletedForUids : [];
        if (deletedFor.includes(fbUser.uid)) continue;
        const expMs = toMs(m.expiresAt);
        if (expMs > 0 && expMs <= nowMs) continue;
        const cMs = toMs(m.createdAt);
        if (clearedMs > 0 && cMs <= clearedMs) continue;

        messages.push(mapFirestoreMessageDoc(m, fbUser.uid, profileMap.get(m.senderUid)));
      }

      messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return { messages, hasMore: false } as T;
    }

    if (method === 'POST') {
      const convSnap = await getDoc(doc(db, 'conversations', convId));
      const cData = convSnap.exists() ? convSnap.data() : {};
      const peerUid = cData.type === 'direct'
        ? (cData.createdBy === fbUser.uid ? cData.peerUid || null : cData.createdBy || null)
        : null;
      const memberUids: string[] = Array.isArray(cData.memberUids)
        ? Array.from(new Set([...cData.memberUids, fbUser.uid]))
        : [fbUser.uid, ...(peerUid ? [peerUid] : [])];

      let disappearingSeconds = 0;
      try {
        const memSnap = await getDoc(doc(db, 'conversations', convId, 'members', fbUser.uid));
        if (memSnap.exists()) disappearingSeconds = Number(memSnap.data().disappearingSeconds || 0);
      } catch {
        // ignore
      }

      const msgId = makeDocId('msg');
      const content = String(body.content || '').slice(0, 4000) || '[Attachment]';
      const messageType = body.messageType || 'text';
      const meta = body.metadata || {};

      let replyToText: string | null = null;
      let replyToSender: string | null = null;
      let replyToType: string | null = null;
      if (body.replyToId) {
        try {
          const rSnap = await getDoc(doc(db, 'conversations', convId, 'messages', String(body.replyToId)));
          if (rSnap.exists()) {
            const rd = rSnap.data();
            replyToText = String(rd.content || '').slice(0, 500);
            replyToType = String(rd.messageType || 'text').slice(0, 32);
            replyToSender = rd.senderUid === fbUser.uid ? 'You' : 'Member';
          }
        } catch {
          // ignore
        }
      }

      const expiresAt =
        disappearingSeconds > 0
          ? Timestamp.fromMillis(Date.now() + disappearingSeconds * 1000)
          : null;

      const msgDoc: Record<string, any> = {
        id: msgId,
        conversationId: convId,
        senderUid: fbUser.uid,
        recipientUid: peerUid,
        memberUids,
        content,
        messageType,
        replyToId: body.replyToId || null,
        replyToText,
        replyToSender,
        replyToType,
        forwardedFromId: body.forwardedFromId || null,
        fileUrl: sanitizeMediaUrl(meta.fileUrl),
        fileName: meta.fileName ? String(meta.fileName).slice(0, 200) : null,
        mimeType: meta.mimeType ? String(meta.mimeType).slice(0, 120) : null,
        ...(typeof meta.sizeBytes === 'number' ? { sizeBytes: Math.round(meta.sizeBytes) } : {}),
        ...(typeof meta.durationSeconds === 'number'
          ? { durationSeconds: Math.round(meta.durationSeconds) }
          : {}),
        ...(typeof meta.latitude === 'number' ? { latitude: meta.latitude } : {}),
        ...(typeof meta.longitude === 'number' ? { longitude: meta.longitude } : {}),
        isEdited: false,
        isDeleted: false,
        isPinned: false,
        starredBy: [],
        deletedForUids: [],
        reactions: [],
        deliveredAt: null,
        readAt: null,
        expiresAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(doc(db, 'conversations', convId, 'messages', msgId), msgDoc);
        await updateDoc(doc(db, 'conversations', convId), {
          lastMessageId: msgId,
          lastMessageText: content.slice(0, 500),
          lastMessageType: String(messageType).slice(0, 32),
          lastMessageSenderUid: fbUser.uid,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}/messages/${msgId}`);
      }

      messageConvCache.set(msgId, convId);
      const nowIso = new Date().toISOString();
      return {
        message: {
          id: msgId,
          conversationId: convId,
          senderId: fbUser.uid,
          senderName: fbUser.displayName || 'You',
          senderAvatar: fbUser.photoURL || null,
          content,
          messageType,
          replyToId: body.replyToId || null,
          replyTo: body.replyToId
            ? {
                id: body.replyToId,
                content: replyToText || 'Message',
                messageType: replyToType || 'text',
                senderName: replyToSender || 'Member',
              }
            : null,
          forwardedFromId: body.forwardedFromId || null,
          metadata: meta,
          isEdited: false,
          isDeleted: false,
          isPinned: false,
          isStarred: false,
          status: 'sent',
          reactions: [],
          createdAt: nowIso,
          updatedAt: nowIso,
          expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null,
        },
      } as T;
    }
  }

  const msgItemMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (msgItemMatch && (method === 'PATCH' || method === 'DELETE')) {
    const msgId = msgItemMatch[1];
    const fbUser = await requireVerifiedUser();
    const convId = await resolveConversationForMessage(
      msgId,
      fbUser.uid,
      body.conversationId || url.searchParams.get('conversationId') || undefined
    );
    if (!convId) throw new Error('Message conversation not found.');
    const mRef = doc(db, 'conversations', convId, 'messages', msgId);

    if (method === 'PATCH') {
      const content = String(body.content || '').trim().slice(0, 4000);
      if (!content) throw new Error('Message content required.');
      await updateDoc(mRef, {
        content,
        isEdited: true,
        updatedAt: serverTimestamp(),
      });
      return { ok: true, id: msgId, content } as T;
    }

    if (method === 'DELETE') {
      const scope = url.searchParams.get('scope') || 'me';
      const snap = await getDoc(mRef);
      if (!snap.exists()) return { ok: true } as T;
      const m = snap.data();
      if (scope === 'everyone' && m.senderUid === fbUser.uid) {
        await updateDoc(mRef, {
          isDeleted: true,
          content: 'This message was deleted',
          updatedAt: serverTimestamp(),
        });
      } else {
        const cur: string[] = Array.isArray(m.deletedForUids) ? m.deletedForUids : [];
        if (!cur.includes(fbUser.uid)) {
          await updateDoc(mRef, {
            deletedForUids: [...cur, fbUser.uid].slice(0, 100),
            updatedAt: serverTimestamp(),
          });
        }
      }
      return { ok: true } as T;
    }
  }

  const msgSubActionMatch = pathname.match(/^\/api\/messages\/([^/]+)\/(react|pin|star)$/);
  if (msgSubActionMatch && method === 'POST') {
    const msgId = msgSubActionMatch[1];
    const subAction = msgSubActionMatch[2];
    const fbUser = await requireVerifiedUser();
    const convId = await resolveConversationForMessage(
      msgId,
      fbUser.uid,
      body.conversationId || url.searchParams.get('conversationId') || undefined
    );
    if (!convId) throw new Error('Message conversation not found.');
    const mRef = doc(db, 'conversations', convId, 'messages', msgId);
    const snap = await getDoc(mRef);
    if (!snap.exists()) throw new Error('Message not found.');
    const m = snap.data();

    if (subAction === 'react') {
      const emoji = String(body.emoji || '').trim().slice(0, 16);
      const cur: Array<{ emoji: string; user_id: string }> = Array.isArray(m.reactions)
        ? m.reactions
        : [];
      const existsIdx = cur.findIndex((r) => r.user_id === fbUser.uid && r.emoji === emoji);
      let next = cur.filter((r) => r.user_id !== fbUser.uid);
      if (existsIdx === -1 && emoji) {
        next = [...next, { emoji, user_id: fbUser.uid }].slice(0, 200);
      }
      await updateDoc(mRef, { reactions: next, updatedAt: serverTimestamp() });
      return { reactions: next } as T;
    }

    if (subAction === 'pin') {
      const nextPin = !m.isPinned;
      await updateDoc(mRef, { isPinned: nextPin, updatedAt: serverTimestamp() });
      return { isPinned: nextPin } as T;
    }

    if (subAction === 'star') {
      const cur: string[] = Array.isArray(m.starredBy) ? m.starredBy : [];
      const isStarred = !cur.includes(fbUser.uid);
      const next = isStarred ? [...cur, fbUser.uid] : cur.filter((u) => u !== fbUser.uid);
      await updateDoc(mRef, { starredBy: next.slice(0, 100), updatedAt: serverTimestamp() });
      return { isStarred } as T;
    }
  }

  // -------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------
  if (pathname === '/api/groups' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const title = String(body.name || '').trim().slice(0, 120);
    if (!title) throw new Error('Group name is required.');
    const description = String(body.description || '').trim().slice(0, 500);
    const avatarUrl = sanitizeAvatarUrl(body.avatarUrl);
    const memberIds: string[] = Array.isArray(body.memberIds) ? body.memberIds : [];
    const uniqueMembers = Array.from(new Set([fbUser.uid, ...memberIds.filter(Boolean)])).slice(0, 100);
    const groupId = makeDocId('grp');
    const inviteCode = generateInviteCode();

    const batch = writeBatch(db);
    batch.set(doc(db, 'conversations', groupId), {
      id: groupId,
      type: 'group',
      title,
      description,
      avatarUrl,
      inviteCode,
      onlyAdminsMessage: false,
      onlyAdminsEditInfo: false,
      createdBy: fbUser.uid,
      peerUid: null,
      memberUids: uniqueMembers,
      lastMessageId: null,
      lastMessageText: '',
      lastMessageType: 'text',
      lastMessageSenderUid: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    for (const mUid of uniqueMembers) {
      batch.set(doc(db, 'conversations', groupId, 'members', mUid), {
        uid: mUid,
        conversationId: groupId,
        role: mUid === fbUser.uid ? 'owner' : 'member',
        muted: false,
        archived: false,
        pinned: false,
        markedUnread: false,
        disappearingSeconds: 0,
        chatTheme: null,
        customList: '',
        joinedAt: serverTimestamp(),
      });
    }
    try {
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `conversations/${groupId}`);
    }
    return { id: groupId, conversationId: groupId, inviteCode } as T;
  }

  const grpJoinMatch = pathname.match(/^\/api\/groups\/join\/([^/]+)$/);
  if (grpJoinMatch && method === 'POST') {
    throw new Error(
      'Group invite links require live backend sync or asking the group creator to add you from Friends.'
    );
  }

  const grpInviteMatch = pathname.match(/^\/api\/groups\/([^/]+)\/invite$/);
  if (grpInviteMatch && method === 'GET') {
    await requireVerifiedUser();
    const groupId = grpInviteMatch[1];
    const snap = await getDoc(doc(db, 'conversations', groupId));
    if (!snap.exists()) throw new Error('Group not found.');
    let code = snap.data().inviteCode || null;
    if (!code || url.searchParams.get('reset') === 'true') {
      code = generateInviteCode();
      await updateDoc(doc(db, 'conversations', groupId), {
        inviteCode: code,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    }
    return { inviteCode: code } as T;
  }

  const grpDetailMatch = pathname.match(/^\/api\/groups\/([^/]+)$/);
  if (grpDetailMatch) {
    const groupId = grpDetailMatch[1];
    await requireVerifiedUser();

    if (method === 'GET') {
      const snap = await getDoc(doc(db, 'conversations', groupId));
      if (!snap.exists()) throw new Error('Group not found.');
      const g = snap.data();
      const memSnap = await getDocs(collection(db, 'conversations', groupId, 'members'));
      const members = await Promise.all(
        memSnap.docs.map(async (md) => {
          const mData = md.data();
          const pSnap = await getDoc(doc(db, 'publicProfiles', mData.uid)).catch(() => null);
          const p = pSnap?.exists() ? pSnap.data() : {};
          return {
            id: mData.uid,
            rikzen_id: p.rikzenId || '',
            full_name: p.fullName || 'RIKZEN Member',
            avatar_url: p.avatarUrl || null,
            role: mData.role || 'member',
          };
        })
      );
      return {
        group: {
          id: groupId,
          name: g.title,
          description: g.description || '',
          avatar_url: g.avatarUrl || null,
          invite_code: g.inviteCode || null,
          only_admins_message: Boolean(g.onlyAdminsMessage),
          only_admins_edit_info: Boolean(g.onlyAdminsEditInfo),
        },
        members,
      } as T;
    }

    if (method === 'PATCH') {
      const patch: Record<string, any> = { updatedAt: serverTimestamp() };
      if (body.name) patch.title = String(body.name).trim().slice(0, 120);
      if (body.description !== undefined) patch.description = String(body.description).trim().slice(0, 500);
      if (body.avatarUrl !== undefined) patch.avatarUrl = sanitizeAvatarUrl(body.avatarUrl);
      if (typeof body.onlyAdminsMessage === 'boolean') patch.onlyAdminsMessage = body.onlyAdminsMessage;
      if (typeof body.onlyAdminsEditInfo === 'boolean') patch.onlyAdminsEditInfo = body.onlyAdminsEditInfo;
      await updateDoc(doc(db, 'conversations', groupId), patch);
      return { ok: true } as T;
    }

    if (method === 'DELETE') {
      await deleteDoc(doc(db, 'conversations', groupId));
      return { ok: true } as T;
    }
  }

  const grpMembersAddMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members$/);
  if (grpMembersAddMatch && method === 'POST') {
    await requireVerifiedUser();
    const groupId = grpMembersAddMatch[1];
    const targetId = String(body.userId || '').trim();
    if (!targetId) throw new Error('User ID required.');
    const gSnap = await getDoc(doc(db, 'conversations', groupId));
    if (!gSnap.exists()) throw new Error('Group not found.');
    const curMembers: string[] = Array.isArray(gSnap.data().memberUids) ? gSnap.data().memberUids : [];
    const nextMembers = Array.from(new Set([...curMembers, targetId])).slice(0, 100);
    await setDoc(doc(db, 'conversations', groupId, 'members', targetId), {
      uid: targetId,
      conversationId: groupId,
      role: 'member',
      muted: false,
      archived: false,
      pinned: false,
      markedUnread: false,
      disappearingSeconds: 0,
      chatTheme: null,
      customList: '',
      joinedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'conversations', groupId), {
      memberUids: nextMembers,
      updatedAt: serverTimestamp(),
    });
    return { ok: true } as T;
  }

  const grpMemberItemMatch = pathname.match(/^\/api\/groups\/([^/]+)\/members\/([^/]+)$/);
  if (grpMemberItemMatch) {
    const [, groupId, targetUid] = grpMemberItemMatch;
    await requireVerifiedUser();
    if (method === 'PATCH') {
      const role = body.role === 'admin' ? 'admin' : 'member';
      await updateDoc(doc(db, 'conversations', groupId, 'members', targetUid), { role });
      return { ok: true } as T;
    }
    if (method === 'DELETE') {
      await deleteDoc(doc(db, 'conversations', groupId, 'members', targetUid));
      const gSnap = await getDoc(doc(db, 'conversations', groupId)).catch(() => null);
      if (gSnap?.exists()) {
        const cur: string[] = Array.isArray(gSnap.data().memberUids) ? gSnap.data().memberUids : [];
        await updateDoc(doc(db, 'conversations', groupId), {
          memberUids: cur.filter((u) => u !== targetUid),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      return { ok: true } as T;
    }
  }

  // -------------------------------------------------------------------------
  // Statuses (with privacy & real Firestore view tracking)
  // -------------------------------------------------------------------------
  if (pathname === '/api/statuses') {
    const fbUser = await requireVerifiedUser();
    const readIdSet = (key: string): Set<string> => {
      try {
        const raw = localStorage.getItem(`${key}_${fbUser.uid}`);
        return new Set(raw ? (JSON.parse(raw) as string[]) : []);
      } catch {
        return new Set();
      }
    };

    if (method === 'GET') {
      let snap;
      try {
        snap = await getDocs(collection(db, 'statuses'));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'statuses');
      }

      // Fetch accepted friends for 'friends' privacy filtering
      const friendSet = new Set<string>([fbUser.uid]);
      try {
        const [f1, f2] = await Promise.all([
          getDocs(query(collection(db, 'friendRequests'), where('senderUid', '==', fbUser.uid))),
          getDocs(query(collection(db, 'friendRequests'), where('receiverUid', '==', fbUser.uid))),
        ]);
        for (const d of [...f1.docs, ...f2.docs]) {
          const r = d.data();
          if (r.status === 'accepted') {
            friendSet.add(r.senderUid === fbUser.uid ? r.receiverUid : r.senderUid);
          }
        }
      } catch {
        // ignore
      }

      const viewedSet = readIdSet('rikzen_viewed_statuses');
      const mutedSet = readIdSet('rikzen_muted_statuses');
      const nowMs = Date.now();

      const activeDocs = snap.docs.filter((d) => {
        const s = d.data();
        const expMs =
          typeof s.expiresAt?.toMillis === 'function'
            ? s.expiresAt.toMillis()
            : new Date(toIso(s.expiresAt)).getTime();
        if (expMs <= nowMs) return false;
        if (s.privacy === 'friends' || s.privacy === 'contacts') {
          return friendSet.has(s.authorUid);
        }
        return true;
      });

      const authorUids = Array.from(new Set(activeDocs.map((d) => String(d.data().authorUid || ''))));
      const authorMap = new Map<string, DocumentData>();
      for (const aUid of authorUids) {
        if (!aUid) continue;
        try {
          const p = await getDoc(doc(db, 'publicProfiles', aUid));
          if (p.exists()) authorMap.set(aUid, p.data());
        } catch {
          // ignore
        }
      }

      const statuses: StatusItem[] = await Promise.all(
        activeDocs.map(async (d) => {
          const s = d.data();
          const author = authorMap.get(s.authorUid);
          const authorName = String(author?.fullName || 'RIKZEN User');
          const authorAvatar = (author?.avatarUrl as string | null) || null;
          const authorRikzenId = String(author?.rikzenId || '');
          const isMine = s.authorUid === fbUser.uid;

          let viewers: StatusItem['viewers'] = [];
          let viewedByMe = isMine || viewedSet.has(s.id);
          try {
            const vSnap = await getDocs(collection(db, 'statuses', s.id, 'views'));
            viewers = vSnap.docs
              .map((vd) => {
                const v = vd.data();
                if (v.viewerUid === fbUser.uid) viewedByMe = true;
                return {
                  viewer_id: v.viewerUid,
                  full_name: v.viewerName || 'RIKZEN User',
                  avatar_url: v.viewerAvatar || null,
                  rikzen_id: v.viewerRikzenId || '',
                  reaction: v.reaction || null,
                  viewed_at: toIso(v.viewedAt),
                };
              })
              .filter((v) => v.viewer_id !== s.authorUid);
          } catch {
            // ignore
          }

          return {
            id: s.id,
            userId: s.authorUid,
            authorName,
            authorAvatar,
            authorRikzenId,
            mediaType: s.mediaType,
            content: s.content || '',
            mediaUrl: s.mediaUrl || null,
            caption: s.caption || '',
            backgroundColor: s.backgroundColor || '#18181D',
            privacy: s.privacy || 'friends',
            isMuted: mutedSet.has(s.id),
            viewedByMe,
            viewCount: viewers.length,
            viewers: isMine ? viewers : [],
            expiresAt: toIso(s.expiresAt),
            createdAt: toIso(s.createdAt),
          };
        })
      );

      statuses.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { statuses } as T;
    }

    if (method === 'POST') {
      const mediaType: 'text' | 'image' | 'video' =
        body.mediaType === 'image' || body.mediaType === 'video' ? body.mediaType : 'text';
      const content = String(body.content || '').trim().slice(0, 1000);
      const mediaUrl = sanitizeMediaUrl(body.mediaUrl);
      const caption = String(body.caption || '').trim().slice(0, 300);
      const backgroundColor = String(body.backgroundColor || '#18181D').trim().slice(0, 32) || '#18181D';
      const privacy = ['everyone', 'friends', 'contacts'].includes(body.privacy)
        ? body.privacy
        : 'friends';

      if (mediaType === 'text' && !content) {
        throw new Error('Please write something for your status.');
      }
      if (mediaType !== 'text' && !mediaUrl) {
        throw new Error('Please select a valid photo or video first.');
      }

      const statusId = makeDocId('st');
      const expiresAt = Timestamp.fromMillis(Date.now() + 24 * 60 * 60 * 1000);
      try {
        await setDoc(doc(db, 'statuses', statusId), {
          id: statusId,
          authorUid: fbUser.uid,
          mediaType,
          content,
          mediaUrl,
          caption,
          backgroundColor,
          privacy,
          expiresAt,
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `statuses/${statusId}`);
      }
      return {
        ok: true,
        id: statusId,
        expiresAt: expiresAt.toDate().toISOString(),
      } as T;
    }
  }

  const statusViewMatch = pathname.match(/^\/api\/statuses\/([^/]+)\/view$/);
  if (statusViewMatch && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const id = statusViewMatch[1];
    try {
      const key = `rikzen_viewed_statuses_${fbUser.uid}`;
      const cur = new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
      cur.add(id);
      localStorage.setItem(key, JSON.stringify(Array.from(cur)));

      const mePub = await getDoc(doc(db, 'publicProfiles', fbUser.uid)).catch(() => null);
      const me = mePub?.exists() ? mePub.data() : {};
      await setDoc(
        doc(db, 'statuses', id, 'views', fbUser.uid),
        {
          viewerUid: fbUser.uid,
          viewerName: String(me.fullName || fbUser.displayName || 'RIKZEN User').slice(0, 80),
          viewerAvatar: sanitizeAvatarUrl(me.avatarUrl || fbUser.photoURL || null),
          viewerRikzenId: String(me.rikzenId || '').slice(0, 24),
          reaction: body.reaction ? String(body.reaction).slice(0, 16) : null,
          viewedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch {
      // non-fatal
    }
    return { ok: true } as T;
  }

  const statusMuteMatch = pathname.match(/^\/api\/statuses\/([^/]+)\/mute$/);
  if (statusMuteMatch && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const id = statusMuteMatch[1];
    try {
      const key = `rikzen_muted_statuses_${fbUser.uid}`;
      const cur = new Set(JSON.parse(localStorage.getItem(key) || '[]') as string[]);
      if (cur.has(id)) cur.delete(id);
      else cur.add(id);
      localStorage.setItem(key, JSON.stringify(Array.from(cur)));
    } catch {
      // ignore storage errors
    }
    return { ok: true } as T;
  }

  if (pathname.startsWith('/api/statuses/') && method === 'DELETE') {
    await requireVerifiedUser();
    const id = pathname.replace('/api/statuses/', '');
    try {
      await deleteDoc(doc(db, 'statuses', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `statuses/${id}`);
    }
    return { ok: true } as T;
  }

  // -------------------------------------------------------------------------
  // Calls & Status Logs
  // -------------------------------------------------------------------------
  const callStatusMatch = pathname.match(/^\/api\/calls\/([^/]+)\/status$/);
  if (callStatusMatch && method === 'POST') {
    await requireVerifiedUser();
    const callId = callStatusMatch[1];
    const allowed = new Set(['ringing', 'connected', 'ended', 'missed', 'rejected', 'busy']);
    const nextStatus = allowed.has(body.status) ? body.status : 'ended';
    const isTerminal = ['ended', 'missed', 'rejected', 'busy'].includes(nextStatus);
    try {
      const cSnap = await getDoc(doc(db, 'calls', callId));
      if (cSnap.exists()) {
        const curStatus = cSnap.data().status;
        if (!['ended', 'missed', 'rejected', 'busy'].includes(curStatus)) {
          await updateDoc(doc(db, 'calls', callId), {
            status: nextStatus,
            durationSeconds: Math.max(0, Math.round(Number(body.durationSeconds || 0))),
            ...(isTerminal ? { endedAt: serverTimestamp() } : {}),
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch {
      // ignore if already terminal
    }
    return { ok: true } as T;
  }

  if (pathname === '/api/calls') {
    const fbUser = await requireVerifiedUser();
    if (method === 'GET') {
      let c1;
      let c2;
      try {
        c1 = await getDocs(query(collection(db, 'calls'), where('callerUid', '==', fbUser.uid)));
        c2 = await getDocs(query(collection(db, 'calls'), where('calleeUid', '==', fbUser.uid)));
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, 'calls');
      }

      const callDocsMap = new Map<string, DocumentData>();
      for (const d of [...c1.docs, ...c2.docs]) {
        callDocsMap.set(d.id, d.data());
      }
      const uids = new Set<string>();
      for (const c of callDocsMap.values()) {
        uids.add(c.callerUid);
        uids.add(c.calleeUid);
      }
      const pMap = new Map<string, DocumentData>();
      for (const u of uids) {
        const ps = await getDoc(doc(db, 'publicProfiles', u)).catch(() => null);
        if (ps?.exists()) pMap.set(u, ps.data());
      }

      const calls: CallLogItem[] = Array.from(callDocsMap.values()).map((c) => {
        const caller = pMap.get(c.callerUid) || {};
        const callee = pMap.get(c.calleeUid) || {};
        return {
          id: c.id,
          caller_id: c.callerUid,
          callee_id: c.calleeUid,
          call_type: c.callType,
          status: c.status,
          started_at: toIso(c.startedAt),
          ended_at: c.endedAt ? toIso(c.endedAt) : null,
          duration_seconds: Number(c.durationSeconds || 0),
          caller_name: caller.fullName || (c.callerUid === fbUser.uid ? 'You' : 'RIKZEN User'),
          caller_avatar: caller.avatarUrl || null,
          caller_rikzen_id: caller.rikzenId || '',
          callee_name: callee.fullName || (c.calleeUid === fbUser.uid ? 'You' : 'RIKZEN User'),
          callee_avatar: callee.avatarUrl || null,
          callee_rikzen_id: callee.rikzenId || '',
        };
      });
      calls.sort((a, b) => b.started_at.localeCompare(a.started_at));
      return { calls } as T;
    }
    if (method === 'POST') {
      const callId = makeDocId('call');
      try {
        await setDoc(doc(db, 'calls', callId), {
          id: callId,
          callerUid: fbUser.uid,
          calleeUid: String(body.calleeId || ''),
          callType: body.callType === 'video' ? 'video' : 'voice',
          status: 'ringing',
          startedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `calls/${callId}`);
      }
      return { callId } as T;
    }
  }

  // -------------------------------------------------------------------------
  // Notifications, Reports, Devices, Communities, Channels
  // -------------------------------------------------------------------------
  if (pathname === '/api/notifications' && method === 'GET') {
    const fbUser = await requireVerifiedUser();
    let snap;
    try {
      snap = await getDocs(
        query(collection(db, 'notifications'), where('recipientUid', '==', fbUser.uid))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'notifications');
    }
    const notifications: AppNotification[] = snap.docs.map((d) => {
      const n = d.data();
      return {
        id: n.id,
        type: n.type || 'info',
        title: n.title,
        body: n.body,
        data: {},
        isRead: Boolean(n.isRead),
        createdAt: toIso(n.createdAt),
      };
    });
    notifications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { notifications } as T;
  }

  if (pathname === '/api/notifications/read-all' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    try {
      const snap = await getDocs(
        query(collection(db, 'notifications'), where('recipientUid', '==', fbUser.uid))
      );
      for (const d of snap.docs) {
        if (!d.data().isRead) {
          await updateDoc(doc(db, 'notifications', d.id), { isRead: true });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'notifications');
    }
    return { ok: true } as T;
  }

  if (pathname === '/api/reports' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const reportId = makeDocId('rep');
    try {
      await setDoc(doc(db, 'reports', reportId), {
        id: reportId,
        reporterUid: fbUser.uid,
        targetType: body.targetType || 'feedback',
        targetId: String(body.targetId || 'general').slice(0, 128),
        reason: String(body.reason || '').slice(0, 1000),
        status: 'open',
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `reports/${reportId}`);
    }
    return { ok: true } as T;
  }

  if (pathname === '/api/devices' && method === 'GET') {
    return {
      devices: [
        {
          id: 'current-browser',
          device_name: 'Current Browser',
          platform: 'Firebase Cloud Session',
          last_active_at: new Date().toISOString(),
        },
      ],
    } as T;
  }

  if (pathname === '/api/communities' && method === 'GET') {
    return { communities: [] } as T;
  }

  if (pathname === '/api/channels' && method === 'GET') {
    return { channels: [] } as T;
  }

  return { ok: true } as T;
}

// ---------------------------------------------------------------------------
// Live Firestore Subscriptions (Messages & WebRTC Signaling)
// ---------------------------------------------------------------------------
export function subscribeDirectMessagesFirestore(
  conversationId: string,
  uid: string,
  onMessages: (msgs: ChatMessage[]) => void
): () => void {
  const path = `conversations/${conversationId}/messages`;
  const sentMap = new Map<string, DocumentData>();
  const recvMap = new Map<string, DocumentData>();
  const grpMap = new Map<string, DocumentData>();
  const profileCache = new Map<string, DocumentData>();

  const emit = async () => {
    const merged = new Map<string, DocumentData>([...sentMap, ...recvMap, ...grpMap]);
    const nowMs = Date.now();
    const missingSenders = new Set<string>();
    for (const m of merged.values()) {
      if (m.senderUid && m.senderUid !== uid && !profileCache.has(m.senderUid)) {
        missingSenders.add(m.senderUid);
      }
    }
    if (missingSenders.size > 0) {
      await Promise.all(
        Array.from(missingSenders).map(async (sUid) => {
          const p = await getDoc(doc(db, 'publicProfiles', sUid)).catch(() => null);
          if (p?.exists()) profileCache.set(sUid, p.data());
        })
      );
    }

    const list: ChatMessage[] = [];
    for (const m of merged.values()) {
      const deletedFor = Array.isArray(m.deletedForUids) ? m.deletedForUids : [];
      if (deletedFor.includes(uid)) continue;
      const expMs = toMs(m.expiresAt);
      if (expMs > 0 && expMs <= nowMs) continue;
      list.push(mapFirestoreMessageDoc(m, uid, profileCache.get(m.senderUid)));
    }
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    onMessages(list);
  };

  const u1 = onSnapshot(
    query(collection(db, 'conversations', conversationId, 'messages'), where('senderUid', '==', uid)),
    (snap) => {
      sentMap.clear();
      snap.docs.forEach((d) => sentMap.set(d.id, d.data()));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );

  const u2 = onSnapshot(
    query(collection(db, 'conversations', conversationId, 'messages'), where('recipientUid', '==', uid)),
    (snap) => {
      recvMap.clear();
      snap.docs.forEach((d) => recvMap.set(d.id, d.data()));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );

  const u3 = onSnapshot(
    query(collection(db, 'conversations', conversationId, 'messages'), where('memberUids', 'array-contains', uid)),
    (snap) => {
      grpMap.clear();
      snap.docs.forEach((d) => grpMap.set(d.id, d.data()));
      emit();
    },
    () => {}
  );

  return () => {
    u1();
    u2();
    u3();
  };
}

export async function sendCallSignalFirestore(
  callId: string,
  payload: {
    status?: 'ringing' | 'connected' | 'ended' | 'missed' | 'rejected' | 'busy';
    offerSdp?: string | null;
    answerSdp?: string | null;
    candidate?: Record<string, any> | null;
    durationSeconds?: number;
  }
): Promise<void> {
  const fbUser = firebaseAuth.currentUser;
  if (!fbUser || !callId) return;

  if (payload.candidate) {
    const candId = makeDocId('cand');
    await setDoc(doc(db, 'calls', callId, 'candidates', candId), {
      id: candId,
      senderUid: fbUser.uid,
      candidate: JSON.stringify(payload.candidate).slice(0, 4000),
      createdAt: serverTimestamp(),
    }).catch(() => {});
  }

  const patch: Record<string, any> = {};
  if (payload.status) patch.status = payload.status;
  if (payload.offerSdp !== undefined) patch.offerSdp = payload.offerSdp?.slice(0, 30000) || null;
  if (payload.answerSdp !== undefined) patch.answerSdp = payload.answerSdp?.slice(0, 30000) || null;
  if (typeof payload.durationSeconds === 'number') {
    patch.durationSeconds = Math.max(0, Math.round(payload.durationSeconds));
  }
  if (payload.status && ['ended', 'missed', 'rejected', 'busy'].includes(payload.status)) {
    patch.endedAt = serverTimestamp();
  }

  if (Object.keys(patch).length > 0) {
    patch.updatedAt = serverTimestamp();
    await updateDoc(doc(db, 'calls', callId), patch).catch(() => {});
  }
}

export function subscribeCallSignalFirestore(
  callId: string,
  myUid: string,
  handlers: {
    onOffer?: (sdp: RTCSessionDescriptionInit) => void;
    onAnswer?: (sdp: RTCSessionDescriptionInit) => void;
    onCandidate?: (candidate: RTCIceCandidateInit) => void;
    onStatus?: (status: 'ringing' | 'connected' | 'ended' | 'missed' | 'rejected' | 'busy') => void;
  }
): () => void {
  let handledOffer = false;
  let handledAnswer = false;
  let lastStatus = '';
  const seenCands = new Set<string>();

  const uCall = onSnapshot(
    doc(db, 'calls', callId),
    (snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      if (d.status && d.status !== lastStatus) {
        lastStatus = d.status;
        handlers.onStatus?.(d.status);
      }
      if (!handledOffer && d.offerSdp && d.callerUid !== myUid) {
        handledOffer = true;
        try {
          handlers.onOffer?.(JSON.parse(d.offerSdp));
        } catch {
          // ignore
        }
      }
      if (!handledAnswer && d.answerSdp && d.callerUid === myUid) {
        handledAnswer = true;
        try {
          handlers.onAnswer?.(JSON.parse(d.answerSdp));
        } catch {
          // ignore
        }
      }
    },
    () => {}
  );

  const uCands = onSnapshot(
    collection(db, 'calls', callId, 'candidates'),
    (snap) => {
      snap.docs.forEach((cd) => {
        if (seenCands.has(cd.id)) return;
        seenCands.add(cd.id);
        const c = cd.data();
        if (c.senderUid === myUid) return;
        try {
          handlers.onCandidate?.(JSON.parse(c.candidate));
        } catch {
          // ignore
        }
      });
    },
    () => {}
  );

  return () => {
    uCall();
    uCands();
  };
}

export function subscribeIncomingCallsFirestore(
  myUid: string,
  onIncoming: (call: {
    callId: string;
    fromUserId: string;
    fromName: string;
    fromAvatar: string | null;
    callType: 'voice' | 'video';
  }) => void
): () => void {
  const seenCallIds = new Set<string>();
  return onSnapshot(
    query(collection(db, 'calls'), where('calleeUid', '==', myUid), where('status', '==', 'ringing')),
    async (snap) => {
      for (const d of snap.docs) {
        if (seenCallIds.has(d.id)) continue;
        const c = d.data();
        const ageMs = Date.now() - toMs(c.startedAt);
        if (ageMs > 60_000) continue; // ignore stale ringing rows
        seenCallIds.add(d.id);
        const pSnap = await getDoc(doc(db, 'publicProfiles', c.callerUid)).catch(() => null);
        const p = pSnap?.exists() ? pSnap.data() : {};
        onIncoming({
          callId: c.id,
          fromUserId: c.callerUid,
          fromName: String(p.fullName || 'RIKZEN User'),
          fromAvatar: (p.avatarUrl as string | null) || null,
          callType: c.callType === 'video' ? 'video' : 'voice',
        });
      }
    },
    () => {}
  );
}
