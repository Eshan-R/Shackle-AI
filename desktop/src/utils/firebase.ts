import { initializeApp } from 'firebase/app';
import {
  getAuth, 
  setPersistence,
  browserLocalPersistence,
  signInWithPopup, 
  signInWithCredential,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  getRedirectResult as firebaseGetRedirectResult,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  getFirestore,
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot
} from 'firebase/firestore';
import { UserProfile, LeagueUser } from '../types';

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
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error Detailed: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Hardcoded configs to prevent relative imports issues outside src
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore (uses the default database)
export const db = getFirestore(app);

export const auth = getAuth(app);

// Explicitly set persistence to browserLocalPersistence to guarantee session restoration across desktop app restarts
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Failed setting Firebase Auth local persistence:", err);
});

export async function logInWithEmail(email: string, pass: string) {
  return signInWithEmailAndPassword(auth, email, pass);
}

export async function registerWithEmail(email: string, pass: string) {
  return createUserWithEmailAndPassword(auth, email, pass);
}

export async function logOutUser() {
  return signOut(auth);
}

// Standard Browser Fallback using Popup
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}

// Native Desktop Handshake Handler using Credentials
export async function signInWithGoogleDesktop(idToken: string, accessToken?: string) {
  const credential = GoogleAuthProvider.credential(idToken, accessToken);
  return signInWithCredential(auth, credential);
}

// export async function signInWithApple() {
//   const provider = new OAuthProvider('apple.com');
//   // Note: ensure OAuthProvider is imported if Apple auth is active
//   return signInWithPopup(auth, provider);
// }

// Handle redirect results helper using renamed import alias
export async function getRedirectResult() {
  return await firebaseGetRedirectResult(auth);
}

// User Profile Sync Helpers in Firestore
export async function fetchUserProfile(uid: string): Promise<UserProfile | null> {
  const path = `users/${uid}`;
  try {
    const userDocRef = doc(db, "users", uid);
    const snap = await getDoc(userDocRef);
    if (snap.exists()) {
      return snap.data() as UserProfile;
    }
    return null; // document does not exist – this is not an error
  } catch (error) {
    console.error("Error fetching user profile from Firestore:", error);
    // Throw the error so callers know Firestore read failed
    throw error;
  }
}

// Sanitization helper to recursively strip undefined properties and ephemeral internal markers before saving to Firestore
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeForFirestore(item)) as unknown as T;
  }
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (key === '_isBaselinePlaceholder' || key.startsWith('_')) {
      continue;
    }
    if (value !== undefined) {
      sanitized[key] = sanitizeForFirestore(value);
    }
  }
  return sanitized as T;
}

export async function saveUserProfile(uid: string, profile: UserProfile) {
  const path = `users/${uid}`;
  try {
    const userDocRef = doc(db, "users", uid);
    const sanitizedProfile = sanitizeForFirestore(profile);
    await setDoc(userDocRef, sanitizedProfile, { merge: true });
  } catch (error) {
    console.error("Error saving user profile to Firestore:", error);
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updateUserProfileXP(uid: string, xp: number, streak: number, strikes: string, level: number, league: string) {
  const path = `users/${uid}`;
  try {
    const userDocRef = doc(db, "users", uid);
    await updateDoc(userDocRef, {
      xp,
      streak,
      strikes,
      level,
      league
    });
  } catch (error) {
    console.error("Error updating user stats in Firestore:", error);
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchLeagueLeaderboard(tier: string): Promise<LeagueUser[]> {
  try {
    const usersRef = collection(db, 'users');
    const q = query(
      usersRef,
      where('league', '==', tier),
      orderBy('xp', 'desc'),
      limit(50)
    );
    
    const querySnapshot = await getDocs(q);
    const leaderboard: LeagueUser[] = [];
    
    const parseStrikesNum = (val: any): number => {
      if (typeof val === 'number') return val;
      if (!val || String(val).toLowerCase() === 'none') return 0;
      const match = String(val).match(/\d+/);
      return match ? parseInt(match[0], 10) : 0;
    };

    querySnapshot.forEach((doc) => {
      const data = doc.data();
      leaderboard.push({
        rank: 0, // Assigned dynamically after mapping
        username: data.username || 'unshackler',
        displayName: data.displayName || 'Anonymous',
        xp: data.xp || 0,
        streak: data.streak || 0,
        strikes: parseStrikesNum(data.strikes),
        isCurrentUser: auth.currentUser?.uid === doc.id
      });
    });

    console.log(`[LEAGUE] Fetched ${leaderboard.length} user(s) for tier "${tier}":`, leaderboard);
    
    // Sort and map ranks
    return leaderboard
      .sort((a, b) => b.xp - a.xp)
      .map((user, idx) => ({ ...user, rank: idx + 1 }));
  } catch (error) {
    // Log the full error object — Firestore missing-index and permission errors
    // are only visible in the detail, not in the top-level message string.
    console.error('Error fetching Firestore league standings:', error);
    try {
      const parseStrikesNum = (val: any): number => {
        if (typeof val === 'number') return val;
        if (!val || String(val).toLowerCase() === 'none') return 0;
        const match = String(val).match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };
      const allUsersSnap = await getDocs(collection(db, 'users'));
      const allUsers: LeagueUser[] = [];
      allUsersSnap.forEach((doc) => {
        const data = doc.data();
        if (data.league === tier) {
          allUsers.push({
            rank: 0,
            username: data.username || 'unshackler',
            displayName: data.displayName || 'Anonymous',
            xp: data.xp || 0,
            streak: data.streak || 0,
            strikes: parseStrikesNum(data.strikes),
            isCurrentUser: auth.currentUser?.uid === doc.id
          });
        }
      });
      return allUsers.sort((a, b) => b.xp - a.xp).map((u, i) => ({ ...u, rank: i + 1 }));
    } catch (fallbackError) {
      console.error("Fallback league standings fetch also failed:", fallbackError);
      return [];
    }
  }
}

export function subscribeToLeagueLeaderboard(tier: string, callback: (users: LeagueUser[]) => void) {
  const usersRef = collection(db, 'users');
  const q = query(
    usersRef,
    where('league', '==', tier),
    orderBy('xp', 'desc'),
    limit(50)
  );

  const parseStrikesNum = (val: any): number => {
    if (typeof val === 'number') return val;
    if (!val || String(val).toLowerCase() === 'none') return 0;
    const match = String(val).match(/\d+/);
    return match ? parseInt(match[0], 10) : 0;
  };

  return onSnapshot(q, (querySnapshot) => {
    const leaderboard: LeagueUser[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      leaderboard.push({
        rank: 0,
        username: data.username || 'unshackler',
        displayName: data.displayName || 'Anonymous',
        xp: data.xp || 0,
        streak: data.streak || 0,
        strikes: parseStrikesNum(data.strikes),
        isCurrentUser: auth.currentUser?.uid === doc.id
      });
    });
    
    const ranked = leaderboard
      .sort((a, b) => b.xp - a.xp)
      .map((user, idx) => ({ ...user, rank: idx + 1 }));
      
    callback(ranked);
  }, (error) => {
    console.error("Leagues real-time synchronization error:", error);
  });
}