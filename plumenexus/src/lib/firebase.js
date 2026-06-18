import { initializeApp }   from 'firebase/app';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth, connectAuthEmulator, GoogleAuthProvider, OAuthProvider, signInWithPopup, onAuthStateChanged, signOut, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from 'firebase/auth';
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
// Apple sign-in (web OAuth popup). Apple is already enabled as a Firebase Auth
// provider for this project (the main app + iOS app use it), so no extra config.
export async function signInWithApple() {
  const provider = new OAuthProvider('apple.com');
  provider.addScope('email');
  provider.addScope('name');
  return signInWithPopup(auth, provider);
}
export function watchAuth(cb)    { return onAuthStateChanged(auth, cb); }
export function signOutUser()    { return signOut(auth); }

// Passwordless email-link sign-in (magic link). Email-link sign-in is already
// enabled on this Firebase project (the main app uses it). The link returns to
// the current signup page; on return we complete sign-in with the remembered
// email (same-device) or one the user re-enters (cross-device).
export async function sendMagicLink(email) {
  await sendSignInLinkToEmail(auth, email, {
    url: window.location.origin + window.location.pathname + window.location.search,
    handleCodeInApp: true,
  });
  window.localStorage.setItem('emailForSignIn', email);
}
export function magicLinkInUrl() { return isSignInWithEmailLink(auth, window.location.href); }
export function rememberedMagicEmail() { return window.localStorage.getItem('emailForSignIn') || ''; }
export async function completeMagicLink(email) {
  const e = (email || rememberedMagicEmail()).trim();
  if (!e) throw new Error('need-email');
  const res = await signInWithEmailLink(auth, e, window.location.href);
  window.localStorage.removeItem('emailForSignIn');
  // Strip the magic-link params so a refresh doesn't re-trigger completion.
  window.history.replaceState({}, document.title, window.location.pathname);
  return res;
}

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
