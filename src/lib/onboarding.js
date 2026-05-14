// Onboarding wizard state + helpers. Sprint 1 of the wizard work.
//
// State lives at tenants/{tid}/data/onboarding:
//   {
//     branch:        'migrate' | 'fresh',
//     industry:      'nails' | 'hair' | 'both' | 'other',
//     phases: {
//       welcome:    { status: 'pending'|'done'|'skipped', updatedAt },
//       profile:    { status, updatedAt },
//       import:     { status, importedCounts: { clients, appts, receipts } },
//       money:      { status },
//       branding:   { status },
//       team:       { status, invitesSent },
//       reach:      { status, online, smsEnabled },
//       launch:     { status, launchedAt? },
//     },
//     startedAt, completedAt?,
//   }
//
// Writes go through the markOnboardingPhase Cloud Function so we can run
// phase-specific side effects server-side (sending invites, generating
// the launch kit, etc.).
import { db, callFn } from './firebase';
import { TENANT_ID } from './tenant';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';

export const PHASES = [
  { key: 'welcome',  label: 'Welcome'                                     },
  { key: 'profile',  label: 'Salon profile'                               },
  { key: 'import',   label: 'Bring your stuff'                            },
  { key: 'money',    label: 'Money + compliance'                          },
  { key: 'branding', label: 'Look & feel'                                 },
  { key: 'team',     label: 'Your team'                                   },
  { key: 'reach',    label: 'Reach your clients'                          },
  { key: 'launch',   label: 'Launch'                                      },
];

const PHASE_KEYS = PHASES.map(p => p.key);

const onboardingDoc = () => doc(db, 'tenants', TENANT_ID, 'data', 'onboarding');

export async function fetchOnboarding() {
  const snap = await getDoc(onboardingDoc());
  return snap.exists() ? snap.data() : null;
}

export function subscribeOnboarding(cb) {
  return onSnapshot(
    onboardingDoc(),
    s => cb(s.exists() ? s.data() : null),
    err => {
      // Permission-denied (rules not yet deployed, signed-out, etc.) —
      // treat as "no doc" so the auto-open + banner logic can proceed
      // rather than hanging in the undefined-loading state.
      console.warn('[onboarding] subscribe error:', err?.code || err?.message);
      cb(null);
    }
  );
}

// Wraps the markOnboardingPhase Cloud Function. `payload.skip = true`
// records the phase as 'skipped' instead of 'done'.
export async function markOnboardingPhase(phaseKey, payload = {}) {
  if (!PHASE_KEYS.includes(phaseKey)) throw new Error(`Unknown phase: ${phaseKey}`);
  const fn = callFn('markOnboardingPhase');
  const res = await fn({ tenantId: TENANT_ID, phaseKey, payload });
  return res?.data || {};
}

export function phaseStatus(onboarding, phaseKey) {
  return onboarding?.phases?.[phaseKey]?.status || 'pending';
}

export function completedCount(onboarding) {
  if (!onboarding?.phases) return 0;
  return PHASE_KEYS.filter(k =>
    onboarding.phases[k]?.status === 'done' || onboarding.phases[k]?.status === 'skipped'
  ).length;
}

export function isOnboardingComplete(onboarding) {
  if (!onboarding) return false;
  if (onboarding.completedAt) return true;
  return completedCount(onboarding) === PHASE_KEYS.length;
}

export function nextPendingPhase(onboarding) {
  if (!onboarding?.phases) return PHASE_KEYS[0];
  return PHASE_KEYS.find(k => {
    const s = onboarding.phases[k]?.status;
    return s !== 'done' && s !== 'skipped';
  }) || null;
}
