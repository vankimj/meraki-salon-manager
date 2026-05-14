import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, reauthenticateWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Same Firebase project as the salon app + marketing site. Different hosting site.
// authDomain = plumenexus.com so OAuth popup shows brand domain. Cloud Console
// OAuth client was updated to allow plumenexus.com + admin.plumenexus.com.
const firebaseConfig = {
  apiKey:            'AIzaSyD2zxSXuxtDKyuXKTpDDjfnKdyhLcLs59c',
  authDomain:        'admin.plumenexus.com',
  projectId:         'meraki-salon-manager',
  storageBucket:     'meraki-salon-manager.firebasestorage.app',
  messagingSenderId: '721171829996',
  appId:             '1:721171829996:web:57f1a33d174c966b7fc1c9',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const fns  = getFunctions(app);

// ── Auth ─────────────────────────────────────────────────
export const googleProvider = new GoogleAuthProvider();

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signIn() {
  return signInWithPopup(auth, googleProvider);
}

export async function signOutNow() {
  return signOut(auth);
}

// Force a fresh Google sign-in on the SAME account, used as a destructive-
// op gate. Pops the Google chooser, requires the user to physically click
// their account, and refreshes the auth token. Rejects if the user cancels
// or picks a different account. Throws auth/user-mismatch in that case so
// callers can surface a clear error.
export async function reauthGoogle() {
  if (!auth.currentUser) throw new Error('Not signed in.');
  return reauthenticateWithPopup(auth.currentUser, googleProvider);
}

// ── Re-exports for convenience ──────────────────────────
export { doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp, httpsCallable };
