import { initializeApp }   from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, getDoc, onSnapshot } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            'AIzaSyD2zxSXuxtDKyuXKTpDDjfnKdyhLcLs59c',
  // authDomain is what users briefly see in the OAuth popup URL bar.
  // Pointing at our own brand domain keeps the flash on-brand rather
  // than showing 'meraki-salon-manager.firebaseapp.com'. Works because
  // Firebase Hosting auto-serves the /__/auth/* reserved namespace on
  // any custom hosting domain + plumenexus.com is in authorizedDomains.
  authDomain:        'plumenexus.com',
  projectId:         'meraki-salon-manager',
  storageBucket:     'meraki-salon-manager.firebasestorage.app',
  messagingSenderId: '721171829996',
  appId:             '1:721171829996:web:57f1a33d174c966b7fc1c9',
};

const app  = initializeApp(firebaseConfig);
const fns  = getFunctions(app);
export const auth = getAuth(app);
export const db   = getFirestore(app);

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
