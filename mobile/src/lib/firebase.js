import { initializeApp, getApps } from 'firebase/app';
import { initializeAuth, getAuth, GoogleAuthProvider } from 'firebase/auth';
import * as FirebaseAuth from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import AsyncStorage from '@react-native-async-storage/async-storage';

const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo',
  authDomain:        'plumenexus-prod.firebaseapp.com',
  projectId:         'plumenexus-prod',
  storageBucket:     'plumenexus-prod.firebasestorage.app',
  messagingSenderId: '563347750501',
  appId:             '1:563347750501:web:db870fca9aa65f5b3c908c',
};

const app = getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

// React Native needs explicit Auth init with AsyncStorage persistence.
// firebase v11 ships getReactNativePersistence in the rn-targeted
// bundle; we look it up dynamically so a non-RN bundle path (or hot
// reload re-running this module) doesn't crash. If it's unavailable
// we fall back to getAuth and accept session-loss between launches.
let _auth;
try {
  const getRNPersistence = FirebaseAuth.getReactNativePersistence;
  if (typeof getRNPersistence === 'function') {
    _auth = initializeAuth(app, { persistence: getRNPersistence(AsyncStorage) });
  } else {
    _auth = getAuth(app);
  }
} catch (e) {
  console.log('[firebase] auth init fell back to getAuth:', e?.message);
  try { _auth = getAuth(app); } catch {}
}
export const auth = _auth;

export const db        = getFirestore(app);
export const functions = getFunctions(app);
export const callFn    = (name) => httpsCallable(functions, name);
export const googleProvider = new GoogleAuthProvider();

export const ALLOWED_EMAILS = ['jvankim@gmail.com'];
