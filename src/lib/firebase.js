import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';
import { connectFirestoreEmulator } from 'firebase/firestore';

// E2E: point Auth/Firestore/Functions at the local Firebase emulators when
// VITE_USE_EMULATORS=1. Lets Playwright drive admin-gated flows (the downgrade
// gate) without Google OAuth or touching prod. No-op in any normal build.
const USE_EMULATORS = typeof import.meta !== 'undefined'
  && import.meta.env && import.meta.env.VITE_USE_EMULATORS === '1';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo',
  authDomain:        'plumenexus-prod.firebaseapp.com',
  projectId:         'plumenexus-prod',
  storageBucket:     'plumenexus-prod.firebasestorage.app',
  messagingSenderId: '563347750501',
  appId:             '1:563347750501:web:db870fca9aa65f5b3c908c',
};

const app = initializeApp(FIREBASE_CONFIG);

// Offline-first POS: enable IndexedDB persistence so writes queue locally
// when the network drops and sync automatically when it returns. Default
// (single-tab) tab manager — we previously used persistentMultipleTabManager
// but the SharedWorker startup added 1-2 seconds to every cold sign-in
// without buying anything in practice (admins rarely run multiple app tabs
// on the same device). Second tab silently falls back to memory cache.
//
// Mobile phones (iPhone / Android-Mobile) are skipped on purpose: under
// storage pressure or after Safari evicts site data, the IDB layer can
// pend queries forever with no error. Techs primarily browse on phones
// (read-only-ish) and don't need offline-write queueing — kiosks
// (iPads) keep persistence for offline POS resilience. Manual override:
// append ?nopersist=1 to force memory cache from anywhere.
//
// Fallback: if persistence init throws (private browsing, corrupted IDB),
// drop to in-memory and keep the app working.
const isPhoneUA = typeof navigator !== 'undefined' &&
  /iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent);
const forceNoPersist = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('nopersist') === '1';
const skipPersist = isPhoneUA || forceNoPersist || USE_EMULATORS;

let _db;
if (skipPersist) {
  _db = getFirestore(app);
} else {
  try {
    _db = initializeFirestore(app, {
      localCache: persistentLocalCache({}),
    });
  } catch (e) {
    console.warn('[Firestore] persistent cache init failed, falling back to memory:', e?.message);
    _db = getFirestore(app);
  }
}
export const db = _db;
export const auth      = getAuth(app);
// Expose the auth instance on window for e2e tests (signInAnonymously,
// linkWithPhoneNumber, signInWithCustomToken). Same pattern as
// plumenexus/src/lib/firebase.js. No secrets exposed — auth is an SDK
// handle anyone with the public Firebase config can construct.
if (typeof window !== 'undefined') window.__plumeAuth = auth;
export const functions = getFunctions(app);

if (USE_EMULATORS) {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(_db, 'localhost', 8080);
  connectFunctionsEmulator(functions, 'localhost', 5001);
  // eslint-disable-next-line no-console
  console.info('[firebase] using local emulators (auth:9099 firestore:8080 functions:5001)');
  // E2E helper: lets Playwright sign in through the real onAuthStateChanged →
  // checkUserAccess path (which hydrates gUser/isAdmin) without a Google popup.
  if (typeof window !== 'undefined') {
    window.__e2eSignIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
    // Invoke a callable through the emulated functions stack, returning .data.
    window.__e2eCall = (name, data) => httpsCallable(functions, name)(data || {}).then(r => r.data);
  }
}

export const callFn    = (name) => httpsCallable(functions, name);
export const storage   = getStorage(app);

export const ALLOWED_EMAILS = ['jvankim@gmail.com'];
