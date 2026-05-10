import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Same Firebase project as the salon app + marketing site. Different hosting site.
const firebaseConfig = {
  apiKey:            'AIzaSyD2zxSXuxtDKyuXKTpDDjfnKdyhLcLs59c',
  authDomain:        'meraki-salon-manager.firebaseapp.com',
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

// ── Re-exports for convenience ──────────────────────────
export { doc, getDoc, getDocs, setDoc, addDoc, collection, query, orderBy, limit, where, serverTimestamp, httpsCallable };
