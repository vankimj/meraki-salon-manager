import { initializeApp }   from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            'AIzaSyDyZkqpU30oiZYtm79ZFLAV7QNzZFvQEIo',
  authDomain:        'plumenexus-prod.firebaseapp.com',
  projectId:         'plumenexus-prod',
  storageBucket:     'plumenexus-prod.firebasestorage.app',
  messagingSenderId: '563347750501',
  appId:             '1:563347750501:web:db870fca9aa65f5b3c908c',
};

const app  = initializeApp(firebaseConfig);
const fns  = getFunctions(app);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// E2E only: when built/served with VITE_USE_EMULATORS=1, point Auth at the
// local Firebase Auth emulator so the signup phone-OTP flow can be tested
// without a Firebase test phone in prod (a prod test number is a verification
// backdoor we don't want to keep). Only Auth is emulated — the OTP spec never
// touches Firestore/Functions. Prod builds (no flag) are unaffected.
if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_USE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  if (typeof console !== 'undefined') console.info('[firebase] marketing using local Auth emulator (9099)');
}

// Expose the initialized Firebase Auth instance on window so Playwright
// E2E tests can drive sign-in flows without re-initializing Firebase
// (which creates a separate isolated app instance). Read-only handle —
// no functional surface beyond what the user already has via the UI.
if (typeof window !== 'undefined') {
  window.__plumeAuth = auth;
}

export const callMarketingChat   = httpsCallable(fns, 'chatWithMarketing');
export const callContactInquiry  = httpsCallable(fns, 'submitContactInquiry');
export const callProvisionTenant = httpsCallable(fns, 'provisionTenant');

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  return signInWithPopup(auth, provider);
}
export function watchAuth(cb)    { return onAuthStateChanged(auth, cb); }
export function signOutUser()    { return signOut(auth); }

// Slug availability check — slugs/ is public-readable so the signup form
// can do this without any Cloud Function call. Returns one of:
//   { available: true }
//   { available: false, kind: 'reserved' | 'primary' | 'alias' }
export async function checkSlugAvailability(slug) {
  const snap = await getDoc(doc(db, 'slugs', slug));
  if (!snap.exists()) return { available: true };
  return { available: false, kind: snap.data()?.kind };
}

// Subscribe to a provisioning job's progress doc. Returns unsubscribe fn.
export function watchProvisioningJob(jobId, cb) {
  return onSnapshot(doc(db, 'provisioningJobs', jobId), (s) => cb(s.exists() ? s.data() : null));
}
