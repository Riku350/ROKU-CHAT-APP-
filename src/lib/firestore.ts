import {
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import type { UserProfile } from '../types/rikzen';
import { firebaseApp, firebaseAuth } from './firebaseAuth';

export const db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

const VALID_THEMES = new Set(['dark', 'light', 'system']);
const VALID_WALLPAPERS = new Set(['obsidian-web', 'midnight', 'emerald-silk', 'champagne-mist']);
const RIKZEN_ID_RE = /^RIKZEN-[A-Z0-9]{4,12}$/;

function sanitizeAvatarUrl(url: string | null | undefined): string | null {
  if (!url || typeof url !== 'string') return null;
  if (url.startsWith('data:') || url.length > 512) return null;
  return url;
}

export async function syncUserToFirestore(profile: UserProfile): Promise<void> {
  const fbUser = firebaseAuth.currentUser;
  if (!fbUser || !fbUser.emailVerified || !fbUser.email) {
    return;
  }
  if (!RIKZEN_ID_RE.test(profile.rikzenId)) {
    return;
  }

  const uid = fbUser.uid;
  const publicPath = `publicProfiles/${uid}`;
  const privatePath = `users/${uid}`;

  const safeName = (profile.fullName || 'RIKZEN User').trim().slice(0, 80) || 'RIKZEN User';
  const safeBio = (profile.bio || '').trim().slice(0, 220);
  const safeAvatar = sanitizeAvatarUrl(profile.avatarUrl);
  const safePhone = profile.phone ? profile.phone.trim().slice(0, 32) : null;
  const safeDob = profile.dateOfBirth ? profile.dateOfBirth.trim().slice(0, 24) : null;
  const safeTheme = VALID_THEMES.has(profile.appearanceSettings?.theme)
    ? profile.appearanceSettings.theme
    : 'dark';
  const safeWallpaper = VALID_WALLPAPERS.has(profile.appearanceSettings?.wallpaper)
    ? profile.appearanceSettings.wallpaper
    : 'obsidian-web';

  const publicRef = doc(db, 'publicProfiles', uid);
  let publicExists = false;
  try {
    const snap = await getDoc(publicRef);
    publicExists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, publicPath);
  }

  if (!publicExists) {
    try {
      await setDoc(publicRef, {
        uid,
        rikzenId: profile.rikzenId,
        fullName: safeName,
        avatarUrl: safeAvatar,
        bio: safeBio,
        onboardingCompleted: Boolean(profile.onboardingCompleted),
        isOnline: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, publicPath);
    }
  } else {
    try {
      await updateDoc(publicRef, {
        fullName: safeName,
        avatarUrl: safeAvatar,
        bio: safeBio,
        onboardingCompleted: Boolean(profile.onboardingCompleted),
        isOnline: true,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, publicPath);
    }
  }

  const privateRef = doc(db, 'users', uid);
  let privateExists = false;
  try {
    const snap = await getDoc(privateRef);
    privateExists = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, privatePath);
  }

  if (!privateExists) {
    try {
      await setDoc(privateRef, {
        uid,
        rikzenId: profile.rikzenId,
        email: fbUser.email,
        phone: safePhone,
        dateOfBirth: safeDob,
        theme: safeTheme,
        wallpaper: safeWallpaper,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, privatePath);
    }
  } else {
    try {
      await updateDoc(privateRef, {
        phone: safePhone,
        dateOfBirth: safeDob,
        theme: safeTheme,
        wallpaper: safeWallpaper,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, privatePath);
    }
  }
}

export function subscribeOwnPublicProfile(
  uid: string,
  onData: (data: Record<string, unknown> | null) => void
): Unsubscribe {
  const path = `publicProfiles/${uid}`;
  return onSnapshot(
    doc(db, 'publicProfiles', uid),
    (snap) => {
      onData(snap.exists() ? (snap.data() as Record<string, unknown>) : null);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}
