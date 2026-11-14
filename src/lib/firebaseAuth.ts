import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

export const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
export const firebaseAuth = getAuth(firebaseApp);

const provider = new GoogleAuthProvider();
for (const scope of SCOPES) {
  provider.addScope(scope);
}
provider.setCustomParameters({ prompt: 'select_account' });

// Keep Google OAuth access token strictly in memory (never localStorage)
let cachedAccessToken: string | null = null;

onAuthStateChanged(firebaseAuth, (user: User | null) => {
  if (!user) {
    cachedAccessToken = null;
  }
});

export async function signInWithGooglePopup(): Promise<{
  accessToken: string;
  user: User;
}> {
  const result = await signInWithPopup(firebaseAuth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const accessToken = credential?.accessToken;
  if (!accessToken) {
    throw new Error('Could not obtain Google access token. Please try again.');
  }
  cachedAccessToken = accessToken;
  return { accessToken, user: result.user };
}

export function getGoogleAccessToken(): string | null {
  return cachedAccessToken;
}

export async function signOutGoogle(): Promise<void> {
  cachedAccessToken = null;
  if (firebaseAuth.currentUser) {
    await signOut(firebaseAuth).catch(() => {});
  }
}
