import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyD2zxSXuxtDKyuXKTpDDjfnKdyhLcLs59c',
  authDomain:        'meraki-salon-manager.firebaseapp.com',
  projectId:         'meraki-salon-manager',
  storageBucket:     'meraki-salon-manager.firebasestorage.app',
  messagingSenderId: '721171829996',
  appId:             '1:721171829996:web:57f1a33d174c966b7fc1c9',
};

const app = initializeApp(FIREBASE_CONFIG);

// Offline-first POS: enable IndexedDB persistence so writes queue locally
// when the network drops and sync automatically when it returns. Default
// (single-tab) tab manager — we previously used persistentMultipleTabManager
// but the SharedWorker startup added 1-2 seconds to every cold sign-in
// without buying anything in practice (admins rarely run multiple app tabs
// on the same device). Second tab silently falls back to memory cache.
//
// Fallback: if persistence init throws (private browsing, corrupted IDB),
// drop to in-memory and keep the app working.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({}),
  });
} catch (e) {
  console.warn('[Firestore] persistent cache init failed, falling back to memory:', e?.message);
  _db = getFirestore(app);
}
export const db = _db;
export const auth      = getAuth(app);
export const functions = getFunctions(app);
export const callFn    = (name) => httpsCallable(functions, name);

export const ALLOWED_EMAILS = ['jvankim@gmail.com'];
