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
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage';
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

function toIso(val: any): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (typeof val.toDate === 'function') return val.toDate().toISOString();
  return new Date().toISOString();
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
      readReceipts: priv?.readReceipts ?? DEFAULT_PRIVACY.readReceipts,
      discoverableByName: priv?.discoverableByName ?? pub?.discoverableByName ?? DEFAULT_PRIVACY.discoverableByName,
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
        discoverableByName: true,
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
        readReceipts: true,
        discoverableByName: true,
        discoverableByPhone: false,
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
      lastMessageText: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'conversations', convId, 'members', uid), {
      uid,
      conversationId: convId,
      role: 'owner',
      joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'conversations', convId, 'members', peerId), {
      uid: peerId,
      conversationId: convId,
      role: 'member',
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
  filename = 'upload.bin'
): Promise<{ fileUrl: string; fileName: string; mimeType: string; sizeBytes: number }> {
  const user = await requireVerifiedUser();
  const storage = getStorage(firebaseApp);
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60);
  const path = `uploads/${user.uid}/${Date.now()}-${safeName}`;
  const sRef = storageRef(storage, path);
  try {
    await uploadBytes(sRef, file);
    const fileUrl = await getDownloadURL(sRef);
    return {
      fileUrl,
      fileName: filename,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
    };
  } catch (err: any) {
    const msg = err?.code || err?.message || '';
    if (String(msg).includes('storage/unauthorized') || String(msg).includes('permission')) {
      throw new Error(
        'Photo/Video upload needs Firebase Storage enabled & allowed in Firebase Console. Text Status works right away!'
      );
    }
    throw new Error(err?.message || 'Media upload failed. Please try again or use a Text Status.');
  }
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
  // User Discovery & Friends
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
        isOnline: Boolean(p.isOnline),
        lastSeenAt: toIso(p.updatedAt),
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

    const allReqs = [...sentSnap.docs, ...recvSnap.docs];
    const peerUids = new Set<string>();
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
            isOnline: Boolean(p.isOnline),
            lastSeenAt: toIso(p.updatedAt),
            isFriend: true,
            relationship: 'friends',
          });
        }
      }
    }

    return {
      friends,
      receivedRequests: requests.filter(
        (r) => r.receiver_id === fbUser.uid && r.status === 'pending'
      ),
      sentRequests: requests.filter(
        (r) => r.sender_id === fbUser.uid && r.status === 'pending'
      ),
      rejectedRequests: requests.filter((r) => r.status === 'rejected'),
      blockedUsers: [],
    } as T;
  }

  if (pathname === '/api/friends/request' && method === 'POST') {
    const fbUser = await requireVerifiedUser();
    const receiverUid = String(body.targetUserId || body.receiverId || '').trim();
    if (!receiverUid || receiverUid === fbUser.uid) {
      throw new Error('You cannot send a friend request to yourself.');
    }

    // Check existing requests between these two users
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
  // Conversations & Messages
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
    let createdSnap;
    let peerSnap;
    try {
      createdSnap = await getDocs(
        query(collection(db, 'conversations'), where('createdBy', '==', fbUser.uid))
      );
      peerSnap = await getDocs(
        query(collection(db, 'conversations'), where('peerUid', '==', fbUser.uid))
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.LIST, 'conversations');
    }

    const convMap = new Map<string, DocumentData>();
    for (const d of [...createdSnap.docs, ...peerSnap.docs]) {
      convMap.set(d.id, d.data());
    }

    const conversations: ConversationSummary[] = [];
    for (const [convId, c] of convMap.entries()) {
      const otherUid = c.createdBy === fbUser.uid ? c.peerUid : c.createdBy;
      let peer: PublicPeer | null = null;
      let title = c.title || 'Chat';
      let avatarUrl: string | null = null;

      if (c.type === 'direct' && otherUid) {
        try {
          const pSnap = await getDoc(doc(db, 'publicProfiles', otherUid));
          if (pSnap.exists()) {
            const p = pSnap.data();
            title = p.fullName || title;
            avatarUrl = p.avatarUrl || null;
            peer = {
              id: otherUid,
              rikzenId: p.rikzenId,
              fullName: p.fullName,
              avatarUrl: p.avatarUrl || null,
              bio: p.bio || null,
              phone: null,
              email: null,
              isOnline: Boolean(p.isOnline),
              lastSeenAt: toIso(p.updatedAt),
              isFriend: true,
            };
          }
        } catch {
          // ignore
        }
      }

      conversations.push({
        id: convId,
        type: c.type || 'direct',
        title,
        avatarUrl,
        peer,
        muted: false,
        archived: false,
        unreadCount: 0,
        lastMessageAt: toIso(c.updatedAt),
        lastMessage: c.lastMessageText
          ? {
              id: 'latest',
              content: c.lastMessageText,
              messageType: 'text',
              senderId: c.createdBy,
              senderName: title,
              createdAt: toIso(c.updatedAt),
            }
          : null,
      });
    }

    conversations.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return { conversations } as T;
  }

  const msgListMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
  if (msgListMatch) {
    const convId = msgListMatch[1];
    const fbUser = await requireVerifiedUser();

    if (method === 'GET') {
      let sentSnap;
      let recvSnap;
      try {
        sentSnap = await getDocs(
          query(
            collection(db, 'conversations', convId, 'messages'),
            where('senderUid', '==', fbUser.uid)
          )
        );
        recvSnap = await getDocs(
          query(
            collection(db, 'conversations', convId, 'messages'),
            where('recipientUid', '==', fbUser.uid)
          )
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.LIST, `conversations/${convId}/messages`);
      }

      const seen = new Map<string, ChatMessage>();
      for (const d of [...sentSnap.docs, ...recvSnap.docs]) {
        const m = d.data();
        seen.set(d.id, {
          id: m.id,
          conversationId: m.conversationId,
          senderId: m.senderUid,
          senderName: m.senderUid === fbUser.uid ? 'You' : 'Friend',
          senderAvatar: null,
          content: m.isDeleted ? 'This message was deleted' : m.content,
          messageType: m.messageType || 'text',
          replyToId: null,
          replyTo: null,
          forwardedFromId: null,
          metadata: {},
          isEdited: false,
          isDeleted: Boolean(m.isDeleted),
          isPinned: Boolean(m.isPinned),
          isStarred: false,
          status: 'read',
          reactions: [],
          createdAt: toIso(m.createdAt),
          updatedAt: toIso(m.updatedAt),
        });
      }
      const messages = Array.from(seen.values()).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );
      return { messages, hasMore: false } as T;
    }

    if (method === 'POST') {
      const convSnap = await getDoc(doc(db, 'conversations', convId));
      const cData = convSnap.exists() ? convSnap.data() : {};
      const peerUid = cData.createdBy === fbUser.uid ? cData.peerUid || null : cData.createdBy || null;
      const msgId = makeDocId('msg');
      const content = String(body.content || '').slice(0, 4000) || '[Attachment]';
      const messageType = body.messageType || 'text';

      try {
        await setDoc(doc(db, 'conversations', convId, 'messages', msgId), {
          id: msgId,
          conversationId: convId,
          senderUid: fbUser.uid,
          recipientUid: peerUid,
          content,
          messageType,
          isDeleted: false,
          isPinned: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'conversations', convId), {
          lastMessageText: content.slice(0, 500),
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, `conversations/${convId}/messages/${msgId}`);
      }

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
          replyToId: null,
          replyTo: null,
          forwardedFromId: null,
          metadata: {},
          isEdited: false,
          isDeleted: false,
          isPinned: false,
          isStarred: false,
          status: 'sent',
          reactions: [],
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      } as T;
    }
  }

  if (pathname.match(/^\/api\/conversations\/[^/]+\/read$/) && method === 'POST') {
    return { ok: true } as T;
  }

  // -------------------------------------------------------------------------
  // Statuses, Calls, Notifications, Reports, Defaults
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

      const viewedSet = readIdSet('rikzen_viewed_statuses');
      const mutedSet = readIdSet('rikzen_muted_statuses');
      const nowMs = Date.now();

      const activeDocs = snap.docs.filter((d) => {
        const s = d.data();
        const expMs =
          typeof s.expiresAt?.toMillis === 'function'
            ? s.expiresAt.toMillis()
            : new Date(toIso(s.expiresAt)).getTime();
        return expMs > nowMs;
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

      const statuses: StatusItem[] = activeDocs.map((d) => {
        const s = d.data();
        const author = authorMap.get(s.authorUid);
        const authorName = String(author?.fullName || 'RIKZEN User');
        const authorAvatar = (author?.avatarUrl as string | null) || null;
        const authorRikzenId = String(author?.rikzenId || '');
        const isMine = s.authorUid === fbUser.uid;
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
          isMuted: mutedSet.has(s.id),
          viewedByMe: isMine || viewedSet.has(s.id),
          viewCount: 0,
          viewers: [],
          expiresAt: toIso(s.expiresAt),
          createdAt: toIso(s.createdAt),
        };
      });

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
    } catch {
      // ignore storage errors
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
      cur.add(id);
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
      const calls: CallLogItem[] = [];
      for (const d of [...c1.docs, ...c2.docs]) {
        const c = d.data();
        calls.push({
          id: c.id,
          caller_id: c.callerUid,
          callee_id: c.calleeUid,
          call_type: c.callType,
          status: c.status,
          started_at: toIso(c.startedAt),
          ended_at: null,
          duration_seconds: 0,
          caller_name: c.callerUid === fbUser.uid ? 'You' : 'RIKZEN User',
          caller_avatar: null,
          caller_rikzen_id: '',
          callee_name: c.calleeUid === fbUser.uid ? 'You' : 'RIKZEN User',
          callee_avatar: null,
          callee_rikzen_id: '',
        });
      }
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
        type: 'info',
        title: n.title,
        body: n.body,
        data: {},
        isRead: Boolean(n.isRead),
        createdAt: toIso(n.createdAt),
      };
    });
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

export function subscribeDirectMessagesFirestore(
  conversationId: string,
  uid: string,
  onMessages: (msgs: ChatMessage[]) => void
): () => void {
  const path = `conversations/${conversationId}/messages`;
  const sentMap = new Map<string, ChatMessage>();
  const recvMap = new Map<string, ChatMessage>();

  const emit = () => {
    const merged = new Map<string, ChatMessage>([...sentMap, ...recvMap]);
    const list = Array.from(merged.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
    onMessages(list);
  };

  const mapDoc = (m: DocumentData): ChatMessage => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderUid,
    senderName: m.senderUid === uid ? 'You' : 'Friend',
    senderAvatar: null,
    content: m.isDeleted ? 'This message was deleted' : m.content,
    messageType: m.messageType || 'text',
    replyToId: null,
    replyTo: null,
    forwardedFromId: null,
    metadata: {},
    isEdited: false,
    isDeleted: Boolean(m.isDeleted),
    isPinned: Boolean(m.isPinned),
    isStarred: false,
    status: 'read',
    reactions: [],
    createdAt: toIso(m.createdAt),
    updatedAt: toIso(m.updatedAt),
  });

  const u1 = onSnapshot(
    query(collection(db, 'conversations', conversationId, 'messages'), where('senderUid', '==', uid)),
    (snap) => {
      sentMap.clear();
      snap.docs.forEach((d) => sentMap.set(d.id, mapDoc(d.data())));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );

  const u2 = onSnapshot(
    query(
      collection(db, 'conversations', conversationId, 'messages'),
      where('recipientUid', '==', uid)
    ),
    (snap) => {
      recvMap.clear();
      snap.docs.forEach((d) => recvMap.set(d.id, mapDoc(d.data())));
      emit();
    },
    (err) => handleFirestoreError(err, OperationType.GET, path)
  );

  return () => {
    u1();
    u2();
  };
}
