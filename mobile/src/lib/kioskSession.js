import { signInWithCustomToken } from 'firebase/auth';
import { auth, callFn } from './firebase';
import { getCurrentTenant } from './currentTenant';
import { setKioskLocked } from './kioskLock';

// RBAC #8 — turn THIS device into a dedicated kiosk, on-device (no QR/pairing).
// The owner is signed in as themselves and taps "set up as kiosk"; we mint a
// near-zero-privilege kiosk identity (provisionKioskLogin is owner-gated
// server-side) and sign THIS device into it, then engage the kiosk lock. After
// this the session itself can't reach clients/reports/admin even if the lock is
// defeated — the escalation hole is closed. Returns { kioskId }.
export async function becomeKiosk(label) {
  const res = await callFn('provisionKioskLogin')({ tenantId: getCurrentTenant(), label: label || 'Kiosk' });
  const token = res?.data?.token;
  if (!token) throw new Error('Could not provision a kiosk login.');
  await signInWithCustomToken(auth, token);   // swaps THIS device onto the kiosk identity
  await setKioskLocked('Kiosk');              // cage the UI (defense in depth)
  return res.data;
}

// The current session's kiosk claim, or null. Drives kiosk-only rendering +
// routing sales through recordKioskSale.
export async function getKioskClaim() {
  const u = auth.currentUser;
  if (!u) return null;
  try {
    const r = await u.getIdTokenResult();
    return r.claims?.kiosk === true ? { tenantId: r.claims.tenantId || null, kioskId: r.claims.kioskId || null } : null;
  } catch { return null; }
}
