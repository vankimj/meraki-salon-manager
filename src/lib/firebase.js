import { initializeApp } from 'firebase/app';
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
// when the network drops and sync automatically when it returns. Multi-tab
// manager lets the kiosk + admin browser tab + a tech's phone share one
// IndexedDB on the same device without stomping each other.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
export const auth      = getAuth(app);
export const functions = getFunctions(app);
export const callFn    = (name) => httpsCallable(functions, name);

export const ALLOWED_EMAILS = ['jvankim@gmail.com'];
