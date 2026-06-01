import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, reauthenticateWithPopup } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

const firebaseConfig = {
  apiKey:            'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo',
  authDomain:        'plumenexus-prod.firebaseapp.com',
  projectId:         'plumenexus-prod',
  storageBucket:     'plumenexus-prod.firebasestorage.app',
  messagingSenderId: '563347750501',
  appId:             '1:563347750501:web:db870fca9aa65f5b3c908c',
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
export { doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp, onSnapshot, httpsCallable };
