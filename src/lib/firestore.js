import {
  doc, collection,
  getDoc, getDocs, setDoc, addDoc, deleteDoc, deleteField, updateDoc,
  orderBy, where, query, limit,
  onSnapshot, arrayUnion, increment, writeBatch,
} from 'firebase/firestore';
import { db, callFn } from './firebase';
import { TENANT_ID } from './tenant';
import { buildStaffEmails, buildAdminEmails, buildScheduleViewOnlyEmails } from './userProjections';

// ── Tenant root helpers ────────────────────────────────
// Document refs need even-segment paths; 'data' is the sub-collection that provides the 4th segment.
const tenantDoc = (path) => doc(db, 'tenants', TENANT_ID, 'data', ...path.split('/'));
const tenantCol = (path) => collection(db, 'tenants', TENANT_ID, path);

// ── Soft-delete pattern ────────────────────────────────
// User-initiated deletions on customer-data collections (clients,
// appointments, receipts, memberships, giftCards) write a tombstone
// instead of removing the doc — `_deleted: true` + audit fields.
// Fetch helpers filter `_deleted !== true` client-side so tombstones
// are invisible to normal app code. A 30-day cleanup cron in
// functions/index.js purges tombstones permanently. Restore from
// BigQuery (within 7-day PITR + forever in the BQ mirror) is always
// available — see recoverUsersFullFromBQ for the lossless pattern.
//
// Internal callers that need to permanently remove a doc (demo
// cleanup, GG receipt dedup, etc.) call the parallel `purgeXxx`
// functions which use deleteDoc directly. NEVER use deleteDoc directly
// on customer-data collections from product code.
function softDelete(ref, by) {
  return updateDoc(ref, {
    _deleted:   true,
    _deletedAt: new Date().toISOString(),
    _deletedBy: by || null,
  });
}
function notTombstoned(d) { return d._deleted !== true; }

// Per-doc snapshot history + restore. Wraps the getDocSnapshotHistory and
// restoreDocFromBQ Cloud Functions. `collection` must be one of clients,
// appointments, receipts, employees (the BQ-mirrored set).
export async function fetchDocSnapshotHistory(collection, docId, limit = 10) {
  const res = await callFn('getDocSnapshotHistory')({ tenantId: TENANT_ID, collection, docId, limit });
  return res?.data || { snapshots: [] };
}
export async function restoreDocFromBQ(collection, docId, snapshotTimestamp) {
  const res = await callFn('restoreDocFromBQ')({ tenantId: TENANT_ID, collection, docId, snapshotTimestamp });
  return res?.data || { restored: false };
}

// List recently soft-deleted records across every collection that uses the
// tombstone pattern. Returns a flat array sorted by `_deletedAt` desc with
// a `collection` field per row so the UI can group/render appropriately.
// Per-collection query is `where('_deleted', '==', true)` — uses the
// auto-maintained single-field index on `_deleted`, no composite needed.
// Sorting + limiting happens client-side (small N, ~30 tombstones max per
// collection given the 30-day cleanup cron).
const SOFT_DELETED_COLLECTIONS = [
  { key: 'clients',         col: () => CLIENTS_COL,          restorable: true  },
  { key: 'appointments',    col: () => APPTS_COL,            restorable: true  },
  { key: 'receipts',        col: () => RECEIPTS_COL,         restorable: true  },
  { key: 'employees',       col: () => EMPLOYEES_COL,        restorable: true  },
  // Below are NOT BigQuery-mirrored, so the per-doc BQ restore path won't
  // work for them. They show in the list for visibility + can be undeleted
  // via a separate tombstone-clear callable (added below).
  { key: 'memberships',     col: () => MEMBERSHIPS_COL,      restorable: false },
  { key: 'giftCards',       col: () => GIFT_CARDS_COL,       restorable: false },
  { key: 'services',        col: () => SERVICES_COL,         restorable: false },
  { key: 'bonuses',         col: () => BONUSES_COL,          restorable: false },
  { key: 'membershipPlans', col: () => MEMBERSHIP_PLANS_COL, restorable: false },
  { key: 'timeOff',         col: () => TIMEOFF_COL,          restorable: false },
  { key: 'promoCodes',      col: () => PROMO_COL,            restorable: false },
  { key: 'reviews',         col: () => REVIEWS_COL,          restorable: false },
  { key: 'meetings',        col: () => MEETINGS_COL,         restorable: false },
  { key: 'products',        col: () => PRODUCTS_COL,         restorable: false },
  { key: 'campaigns',       col: () => CAMPAIGNS_COL,        restorable: false },
];
export async function fetchRecentlyDeleted({ maxPerCollection = 50, collections = null } = {}) {
  // `collections` (optional) scopes the scan to specific collection keys —
  // used by the per-module + calendar trash panels so each shows only its
  // own deleted records. No filter → every soft-delete collection (the
  // global Admin trash).
  const targets = collections
    ? SOFT_DELETED_COLLECTIONS.filter(s => collections.includes(s.key))
    : SOFT_DELETED_COLLECTIONS;
  const results = await Promise.all(targets.map(async ({ key, col, restorable }) => {
    try {
      const snap = await getDocs(query(col(), where('_deleted', '==', true), limit(maxPerCollection)));
      return snap.docs.map(d => ({
        id:          d.id,
        collection:  key,
        restorable,
        ...d.data(),
      }));
    } catch (e) {
      // Permission-denied / network / index-pending: skip this collection
      // rather than aborting the whole list.
      console.warn(`[fetchRecentlyDeleted] ${key} failed:`, e?.code || e?.message);
      return [];
    }
  }));
  const flat = results.flat();
  // Newest deletions first
  flat.sort((a, b) => (b._deletedAt || '').localeCompare(a._deletedAt || ''));
  return flat;
}

// Clear a tombstone for non-BQ-mirrored collections — simply removes the
// _deleted markers, bringing the doc back live. The "live" doc state
// returned is whatever was on the tombstone (sans deletion fields).
// Admin-only via Firestore rules. BQ-mirrored collections should use the
// per-doc restoreDocFromBQ instead since that's lossless and forensic-marked.
export async function clearTombstone(collection, docId) {
  const colMap = Object.fromEntries(SOFT_DELETED_COLLECTIONS.map(s => [s.key, s.col]));
  const getCol = colMap[collection];
  if (!getCol) throw new Error(`Collection "${collection}" not in soft-delete allowlist`);
  await updateDoc(doc(getCol(), docId), {
    _deleted:   deleteField(),
    _deletedAt: deleteField(),
    _deletedBy: deleteField(),
    _restoredAt: new Date().toISOString(),
  });
}

// ── Refs ───────────────────────────────────────────────
const SLIDES_REF      = tenantDoc('slides');
const USERS_REF       = tenantDoc('users');     // slim projection (staff readable)
const USERS_FULL_REF  = tenantDoc('usersFull'); // rich users[] (admin only)
const SETTINGS_REF    = tenantDoc('settings');
const SEED_STATE_REF  = tenantDoc('seedState'); // demo-seed checkpoint (resume support)

// ── Demo-seed checkpoint state ─────────────────────────
// Read by Admin.jsx on mount to detect interrupted seeds. Written by
// seedFullDemo after each step so a logout / tab-close / crash can be
// resumed from the next pending step instead of doubling up records.
// Shape: { phase: 'running'|'complete'|'failed', completedSteps: [...],
//          currentStep, startedAt, updatedAt, startedBy, stats }
export async function fetchSeedState() {
  try {
    const snap = await getDoc(SEED_STATE_REF);
    return snap.exists() ? snap.data() : null;
  } catch (_) { return null; }
}
export async function saveSeedState(state) {
  await setDoc(SEED_STATE_REF, { ...state, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function clearSeedState() {
  try { await deleteDoc(SEED_STATE_REF); } catch (_) {}
}
const LOGS_COL     = tenantCol('logs');
const SERVICES_COL = tenantCol('services');

// ── Bootstrap load (slides + users + settings) ─────────
// Uses allSettled so a permission error doesn't block the publicly-readable
// slides from loading.
//
// Read strategy after the user-doc split:
//   - data/users (staff readable): always tries — returns staffEmails,
//     adminEmails, byEmail map, and any legacy users[] array still present.
//   - data/usersFull (admin only): tries in parallel — succeeds for admin
//     callers, fails closed for techs/scheduler/readonly. The rich array
//     is what the user-management UI needs.
//
// `users[]` returned to the caller is whichever is freshest (full > legacy
// > byEmail-derived stub). Non-admin callers get a 1-element array of just
// their own slim record so AppContext's `users.find(u => u.email === me)`
// keeps working without leaking coworkers' details.
export async function loadAll() {
  const [sd, ud, ufd, stg] = await Promise.allSettled([
    getDoc(SLIDES_REF),
    getDoc(USERS_REF),
    getDoc(USERS_FULL_REF),
    getDoc(SETTINGS_REF),
  ]);
  const slidesDoc     = sd.status  === 'fulfilled' ? sd.value  : null;
  const usersDoc      = ud.status  === 'fulfilled' ? ud.value  : null;
  const usersFullDoc  = ufd.status === 'fulfilled' ? ufd.value : null;
  const settingsDoc   = stg.status === 'fulfilled' ? stg.value : null;

  const projection   = usersDoc?.exists() ? usersDoc.data() : {};
  const fullArray    = usersFullDoc?.exists() ? (usersFullDoc.data().users || []) : null;
  // Legacy fallback — pre-split tenants still have users[] on data/users.
  // The next admin save runs the migration and purges it.
  const legacyArray  = projection.users || null;

  return {
    slides:        slidesDoc?.exists()   ? (slidesDoc.data().slides ?? []) : null,
    def:           slidesDoc?.exists()   ? (slidesDoc.data().def    ?? 0)  : 0,
    cur:           slidesDoc?.exists()   ? (slidesDoc.data().cur    ?? 0)  : 0,
    users:         fullArray ?? legacyArray ?? [],
    staffEmails:   projection.staffEmails ?? null,
    adminEmails:   projection.adminEmails ?? null,
    // byEmail intentionally not returned — replaced by getMyTenantRole
    // callable so non-admin self-lookup doesn't expose coworker roles.
    settings:      settingsDoc?.exists() ? settingsDoc.data() : {},
  };
}

// Integrity report — written by the runIntegrityScan cron each night,
// read by the Admin UI to render a green/yellow/red health badge.
// Returns null if no scan has run yet (first 24h after deploy).
export async function fetchIntegrityReport() {
  try {
    const snap = await getDoc(tenantDoc('integrityReport'));
    return snap.exists() ? snap.data() : null;
  } catch (_) { return null; }
}

// Self-heal: rebuild data/usersFull when the rich array doc has gone
// missing (or empty) but the slim projection is intact. Two-tier recovery:
//
//   Tier 1 (lossless) — Ask the recoverUsersFullFromBQ Cloud Function to
//   restore the latest snapshot from the BigQuery mirror. This preserves
//   real grantedAt timestamps, custom names, phone, instagram, and every
//   other per-record field that was ever set. Requires the BQ mirror for
//   the data subcollection to be healthy (`fs-bq-data` extension).
//
//   Tier 2 (lossy fallback) — Reconstruct from staffEmails projection +
//   employees collection lookup for techName/name. grantedAt is reset to
//   now; per-record metadata is lost. Marks rows with `_healed: true` so
//   the source is auditable. Only fires if BQ recovery returns nothing
//   or errors.
//
// This is the failure mode that left Meraki without a Users tab for ~24h
// on 2026-05-10 — symptom is silent: staff still authorize via
// staffEmails but admins see an empty Users tab.
//
// Returns the rebuilt array on success, null if no heal needed or both
// tiers failed. Callers should refresh their `users` state from the result.
export async function healUsersFullIfMissing(loadedData) {
  const staff = loadedData?.staffEmails || [];
  const admins = loadedData?.adminEmails || [];
  const usersArr = loadedData?.users || [];
  if (!staff.length) return null;        // nothing to rebuild from
  if (usersArr.length) return null;      // not missing — already healthy

  // Tier 1: ask the Cloud Function to recover from BQ losslessly.
  try {
    const res = await callFn('recoverUsersFullFromBQ')({ tenantId: TENANT_ID });
    const data = res?.data;
    if (data?.recovered && Array.isArray(data.users) && data.users.length) {
      console.warn(`[healUsersFullIfMissing] LOSSLESS recovery via BigQuery snapshot @ ${data.snapshotTime} (${data.users.length} users)`);
      return data.users;
    }
    if (data && !data.recovered) {
      console.warn(`[healUsersFullIfMissing] BQ recovery returned no snapshot (reason=${data.reason}); falling back to staffEmails reconstruction`);
    }
  } catch (e) {
    console.warn('[healUsersFullIfMissing] BQ recovery threw, falling back to staffEmails:', e?.code || e?.message);
  }

  // Tier 2: lossy reconstruction from staffEmails + employees.
  let employees = [];
  try {
    const empSnap = await getDocs(tenantCol('employees'));
    employees = empSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (_) { /* employees unreadable for this caller — proceed without */ }
  const empByEmail = new Map(
    employees.filter(e => e.email).map(e => [String(e.email).toLowerCase(), e])
  );
  const adminSet = new Set(admins.map(e => String(e).toLowerCase()));
  const now = new Date().toISOString();

  const rebuilt = staff.map(email => {
    const lower = String(email).toLowerCase();
    const emp = empByEmail.get(lower);
    const isAdmin = adminSet.has(lower);
    return {
      email,
      role:      isAdmin ? 'admin' : 'tech',
      name:      emp?.name || email,
      picture:   emp?.photo || '',
      techName:  isAdmin ? null : (emp?.name || null),
      grantedAt: now,
      _healed:   true,
    };
  });

  try {
    await setDoc(USERS_FULL_REF, { users: rebuilt });
    console.warn(`[healUsersFullIfMissing] LOSSY rebuild from staffEmails (${rebuilt.length} users) — timestamps and per-record metadata reset to defaults`);
    return rebuilt;
  } catch (e) {
    console.warn('[healUsersFullIfMissing] write failed:', e?.code || e?.message);
    return null;
  }
}

// One-time backfill: write the derived `staffEmails`/`adminEmails` arrays
// to data/users and the rich array to data/usersFull. Called from
// AppContext on admin load — non-admin invocations no-op silently because
// the rules block both writes for them. Atomic via writeBatch — a partial
// failure was the suspected cause of the 2026-05-10 Meraki users incident.
export async function ensureStaffEmailsBackfill(users) {
  try {
    const batch = writeBatch(db);
    batch.set(USERS_REF, {
      users:       deleteField(),         // purge legacy users[]
      byEmail:     deleteField(),         // purge legacy byEmail leak
      staffEmails: buildStaffEmails(users),
      adminEmails: buildAdminEmails(users),
      scheduleViewOnlyEmails: buildScheduleViewOnlyEmails(users),
    }, { merge: true });
    batch.set(USERS_FULL_REF, { users }, { merge: true });
    await batch.commit();
  } catch (e) { console.warn('[ensureStaffEmailsBackfill] skipped:', e?.code || e?.message); }
}

// ── Slides ─────────────────────────────────────────────
export const saveSlides   = (slides, def, cur) => setDoc(SLIDES_REF, { slides, def, cur });

// ── Users ──────────────────────────────────────────────
// `staffEmails` and `adminEmails` are projections of the active-role emails
// the Firestore security rules read for `isTenantStaff(tenantId)` and
// `isTenantAdmin(tenantId)`. We rebuild them on every save so that role
// changes (grant/revoke admin, demote to readonly, deny) take effect
// immediately at the rules layer without app code having to maintain a
// parallel field.
// Pure projection builders live in userProjections.js (no Firebase import)
// so the security-critical role→allow-list mapping stays unit-testable.
// Re-exported here to preserve the existing firestore.js public surface.
export { buildStaffEmails, buildAdminEmails, buildScheduleViewOnlyEmails };
// (Removed) The `byEmail` projection map was a security regression —
// staff-readable so any tech could enumerate every coworker's
// (email, role) tuple from the JS console. Self-lookup now goes
// through the `getMyTenantRole` Cloud Function callable, which
// returns ONLY the caller's own slice. Old buildByEmail helper
// retained as a no-op so any stray callers (tests, etc.) don't break,
// and saveUsers/ensureStaffEmailsBackfill purge the legacy field via
// `deleteField()` markers below.
export function buildByEmail() { return undefined; }
// Save splits the write across two docs:
//   data/users      — slim projection (staff readable)
//   data/usersFull  — rich users[] (admin only)
// Atomic via writeBatch: both commit together or neither does. The
// previous Promise.all approach left a partial state where one doc
// could persist while the other rejected — suspected root cause of the
// 2026-05-10 Meraki incident where data/usersFull went missing while
// data/users.staffEmails survived.
export const saveUsers = async (users) => {
  const batch = writeBatch(db);
  batch.set(USERS_REF, {
    users:       deleteField(),         // purge legacy users[]
    byEmail:     deleteField(),         // purge legacy byEmail map (was leaking coworker roles)
    staffEmails: buildStaffEmails(users),
    adminEmails: buildAdminEmails(users),
    scheduleViewOnlyEmails: buildScheduleViewOnlyEmails(users),
  }, { merge: true });
  batch.set(USERS_FULL_REF, { users }, { merge: true });
  await batch.commit();
};

// ── Settings ───────────────────────────────────────────
export const saveSettings = (settings) => setDoc(SETTINGS_REF, settings);

// ── Logs ───────────────────────────────────────────────
export const addLog       = (entry)    => addDoc(LOGS_COL, entry);

export async function fetchLogs(n = 100) {
  const snap = await getDocs(query(LOGS_COL, orderBy('timestamp', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Billing artefacts (Stripe-driven) ───────────────────
// Disputes and refunds are written by the stripeWebhook Cloud Function
// after Stripe signature verification. Clients have read-only access
// gated to tenant admins via firestore.rules. UI sorts client-side; the
// `where + orderBy` combo triggers a composite-index requirement that
// isn't worth the operational overhead for a list this small.
const DISPUTES_COL = tenantCol('disputes');
const REFUNDS_COL  = tenantCol('refunds');

export async function fetchDisputes() {
  const snap = await getDocs(DISPUTES_COL);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

export async function fetchRefunds() {
  const snap = await getDocs(REFUNDS_COL);
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.refundedAt || '').localeCompare(a.refundedAt || ''));
}

// ── Services ───────────────────────────────────────────
export async function fetchServices() {
  const snap = await getDocs(query(SERVICES_COL, orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function saveService(id, data) {
  const ref = id ? doc(SERVICES_COL, id) : doc(SERVICES_COL);
  await setDoc(ref, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  return ref.id;
}

export async function createService(data) {
  const ref = await addDoc(SERVICES_COL, {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export const deleteService = (id, deletedBy) => softDelete(doc(SERVICES_COL, id), deletedBy);
export const purgeService  = (id) => deleteDoc(doc(SERVICES_COL, id));

// ── Clients ────────────────────────────────────────────
const CLIENTS_COL = tenantCol('clients');

export async function fetchClients() {
  const snap = await getDocs(query(CLIENTS_COL, orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function fetchClient(id) {
  const snap = await getDoc(doc(CLIENTS_COL, id));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  return notTombstoned(data) ? data : null;
}

export async function createClient(data) {
  const ref = await addDoc(CLIENTS_COL, {
    ...data,
    visits: data.visits ?? [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

// Bulk create N clients in batches of 450 (Firestore caps writeBatch at
// 500; leave headroom for transient retries). Returns array of newly-
// generated IDs in input order, so callers that need to reference them
// (e.g. building appointments off freshly-created clients) can.
// Used by the demo seeder — sequential addDoc was the main 15-minute
// bottleneck (~80ms RTT × 1000 clients). One round trip per 450 docs.
export async function createClientsBatch(arr, onProgress) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const now = new Date().toISOString();
  const SIZE = 450;
  const ids = [];
  for (let i = 0; i < arr.length; i += SIZE) {
    const chunk = arr.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const data of chunk) {
      const ref = doc(CLIENTS_COL);
      batch.set(ref, {
        ...data,
        visits: data.visits ?? [],
        createdAt: data.createdAt || now,
        updatedAt: now,
      });
      ids.push(ref.id);
    }
    await batch.commit();
    onProgress?.(`Clients: ${ids.length.toLocaleString()} / ${arr.length.toLocaleString()}`);
  }
  return ids;
}

export async function saveClient(id, data) {
  await setDoc(doc(CLIENTS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// Bulk-update N clients in batches of 450. Caller supplies an array of
// { id, data }. Used by demo backfills that touch many existing clients.
export async function saveClientsBatch(updates, onProgress) {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  const now = new Date().toISOString();
  const SIZE = 450;
  let written = 0;
  for (let i = 0; i < updates.length; i += SIZE) {
    const chunk = updates.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const { id, data } of chunk) {
      batch.set(doc(CLIENTS_COL, id), { ...data, updatedAt: now }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    onProgress?.(`Client updates: ${written.toLocaleString()} / ${updates.length.toLocaleString()}`);
  }
  return written;
}

export const deleteClient = (id, deletedBy) => softDelete(doc(CLIENTS_COL, id), deletedBy);
export const purgeClient  = (id) => deleteDoc(doc(CLIENTS_COL, id));

export async function fetchDemoClients() {
  const snap = await getDocs(query(CLIENTS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function servicesExist() {
  const snap = await getDocs(query(SERVICES_COL, limit(1)));
  return !snap.empty;
}

export async function clearServices() {
  const snap = await getDocs(SERVICES_COL);
  await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

// ── Turn roster (per-day walk-in rotation) ─────────────
// One doc per date keyed YYYY-MM-DD with { roster: [{ techId, techName,
// clockInAt, turnsTaken }] }. Order is determined by clockInAt + turnsTaken
// at read time so the "next up" tech is always the one with the fewest turns.
const TURN_ROSTER_COL = tenantCol('turnRoster');

export async function fetchTurnRoster(date) {
  const snap = await getDoc(doc(TURN_ROSTER_COL, date));
  if (!snap.exists()) return { date, roster: [] };
  return { date, ...snap.data() };
}

export function subscribeTurnRoster(date, cb) {
  return onSnapshot(doc(TURN_ROSTER_COL, date), s => {
    cb(s.exists() ? { date, ...s.data() } : { date, roster: [] });
  });
}

export async function saveTurnRoster(date, roster) {
  await setDoc(doc(TURN_ROSTER_COL, date), { date, roster, updatedAt: new Date().toISOString() });
}

// ── Attendance / time cards (per-day doc) ──────────────
// One doc per date keyed YYYY-MM-DD with { entries: [{ employeeId,
// employeeName, clockInAt, clockOutAt }] }. Admin-managed; ties scheduled
// hours (employee.workDays) to actual times worked.
const ATTENDANCE_COL = tenantCol('attendance');

export async function fetchAttendance(date) {
  const snap = await getDoc(doc(ATTENDANCE_COL, date));
  if (!snap.exists()) return { date, entries: [] };
  return { date, ...snap.data() };
}

export function subscribeAttendance(date, cb) {
  return onSnapshot(doc(ATTENDANCE_COL, date), s => {
    cb(s.exists() ? { date, ...s.data() } : { date, entries: [] });
  });
}

export async function saveAttendance(date, entries) {
  await setDoc(doc(ATTENDANCE_COL, date), { date, entries, updatedAt: new Date().toISOString() });
}

// ── Employees ─────────────────────────────────────────
const EMPLOYEES_COL = tenantCol('employees');

// Compensation & tax-form fields — moved off the public employee doc and
// stored under `employees/{id}/private/comp`, admin-only readable.
// `employees/{id}` itself is publicly readable (booking page needs names,
// photos, services). This split keeps SSNs, pay rate, banking info etc.
// out of any unauthenticated reader's reach.
const PRIVATE_EMP_FIELDS = [
  'taxId', 'paymentNotes', 'payRate', 'payType', 'rateType',
  'commissionPct', 'hourlyRate', 'paymentPref',
  'gustoId', 'gustoEmail',
];
const empPrivateRef = (id) => doc(EMPLOYEES_COL, id, 'private', 'comp');

function splitEmployeeFields(data) {
  const publicFields = { ...data };
  const privateFields = {};
  for (const k of PRIVATE_EMP_FIELDS) {
    if (k in publicFields) {
      privateFields[k] = publicFields[k];
      delete publicFields[k];
    }
  }
  return { publicFields, privateFields };
}

export async function fetchEmployees() {
  // Public read path. Returns only the public slice (parent doc only).
  // Booking page, schedule, walk-in kiosk all use this — they don't need
  // comp data. Compensation views call fetchEmployeesWithComp instead.
  const snap = await getDocs(query(EMPLOYEES_COL, orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// Admin-only. Fetches the public doc + the private/comp sub-doc per
// employee, returning a merged object identical in shape to the legacy
// pre-split data so EmployeesAdmin / HR / payroll continue to read fields
// at their original paths. Falls through gracefully on permission denial.
export async function fetchEmployeesWithComp() {
  const snap = await getDocs(query(EMPLOYEES_COL, orderBy('sortOrder')));
  const list = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
  await Promise.all(list.map(async emp => {
    try {
      const compSnap = await getDoc(empPrivateRef(emp.id));
      if (compSnap.exists()) Object.assign(emp, compSnap.data());
    } catch (_) { /* non-admin caller — leave the merge empty */ }
  }));
  return list;
}

export async function saveEmployee(id, data) {
  const targetId = id || doc(EMPLOYEES_COL).id;
  const { publicFields, privateFields } = splitEmployeeFields(data);
  const ref = doc(EMPLOYEES_COL, targetId);
  const now = new Date().toISOString();
  // Atomic two-doc write via writeBatch — either BOTH the public-doc
  // purge AND the private-doc set commit, or neither. Without this, a
  // partial failure (transient permission-denied, network blip) could
  // leave legacy sensitive fields stranded on the publicly-readable
  // parent doc until the next successful save.
  const purgeMarkers = {};
  for (const k of PRIVATE_EMP_FIELDS) purgeMarkers[k] = deleteField();
  const batch = writeBatch(db);
  batch.set(ref, { ...purgeMarkers, ...publicFields, updatedAt: now }, { merge: true });
  if (Object.keys(privateFields).length) {
    batch.set(empPrivateRef(targetId), { ...privateFields, updatedAt: now }, { merge: true });
  }
  await batch.commit();
  return targetId;
}

export async function createEmployee(data) {
  const { publicFields, privateFields } = splitEmployeeFields(data);
  const now = new Date().toISOString();
  // Pre-allocate the ID so the public + private writes can ride a single
  // batch. addDoc → setDoc sequentially could leave the public doc
  // committed without its private/comp child if the second write fails.
  const ref = doc(EMPLOYEES_COL);
  const batch = writeBatch(db);
  batch.set(ref, { ...publicFields, createdAt: now, updatedAt: now });
  if (Object.keys(privateFields).length) {
    batch.set(empPrivateRef(ref.id), { ...privateFields, createdAt: now, updatedAt: now });
  }
  await batch.commit();
  return ref.id;
}

export const deleteEmployee = (id, deletedBy) => softDelete(doc(EMPLOYEES_COL, id), deletedBy);
export const purgeEmployee  = (id) => deleteDoc(doc(EMPLOYEES_COL, id));

export async function employeesExist() {
  const snap = await getDocs(query(EMPLOYEES_COL, limit(1)));
  return !snap.empty;
}

// ── Appointments ───────────────────────────────────────
const APPTS_COL = tenantCol('appointments');

export async function fetchAppointments(date) {
  const snap = await getDocs(query(APPTS_COL, where('date', '==', date)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

export async function fetchAppointmentById(id) {
  if (!id) return null;
  const snap = await getDoc(doc(APPTS_COL, id));
  if (!snap.exists()) return null;
  const data = { id: snap.id, ...snap.data() };
  return notTombstoned(data) ? data : null;
}

// Find today's appointment for a given client (by id or by phone digits).
// Returns the soonest upcoming one, or the in-progress one if started.
export async function findTodaysAppointmentForClient({ clientId, phone, date }) {
  const today = date || new Date().toISOString().slice(0, 10);
  const phoneDigits = phone ? (phone.match(/\d/g) || []).join('') : '';
  const snap = await getDocs(query(APPTS_COL, where('date', '==', today)));
  const todays = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const matches = todays.filter(a => {
    if (clientId && a.clientId === clientId) return true;
    if (phoneDigits) {
      const aPhone = (a.clientPhone || '').match(/\d/g);
      if (aPhone && aPhone.join('') === phoneDigits) return true;
    }
    return false;
  });
  if (matches.length === 0) return null;
  // Prefer scheduled/in-progress, sorted by startTime
  matches.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  return matches.find(a => a.status !== 'done' && a.status !== 'cancelled') || matches[0];
}

// Real-time subscription for a single date (Schedule day view).
export function subscribeToAppointments(date, cb) {
  const q = query(APPTS_COL, where('date', '==', date));
  return onSnapshot(q, snap => {
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(notTombstoned)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    cb(list);
  });
}

// Real-time subscription for a date range (Schedule week view).
export function subscribeToAppointmentsByRange(startDate, endDate, cb) {
  const q = query(APPTS_COL,
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  );
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)));
}

export async function createAppointment(data) {
  const ref = await addDoc(APPTS_COL, {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

// Bulk create N appointments — see createClientsBatch for the rationale.
// ~2,500 appointments × ~80ms sequential = 3+ min; batched = ~1 second.
// Returns array of newly-generated IDs in input order.
export async function createAppointmentsBatch(arr, onProgress) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const now = new Date().toISOString();
  const SIZE = 450;
  const ids = [];
  for (let i = 0; i < arr.length; i += SIZE) {
    const chunk = arr.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const data of chunk) {
      const ref = doc(APPTS_COL);
      batch.set(ref, {
        ...data,
        createdAt: data.createdAt || now,
        updatedAt: now,
      });
      ids.push(ref.id);
    }
    await batch.commit();
    onProgress?.(`Appointments: ${ids.length.toLocaleString()} / ${arr.length.toLocaleString()}`);
  }
  return ids;
}

// Bulk-update N appointments — same shape as saveClientsBatch.
export async function saveAppointmentsBatch(updates, onProgress) {
  if (!Array.isArray(updates) || updates.length === 0) return 0;
  const now = new Date().toISOString();
  const SIZE = 450;
  let written = 0;
  for (let i = 0; i < updates.length; i += SIZE) {
    const chunk = updates.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const { id, data } of chunk) {
      batch.set(doc(APPTS_COL, id), { ...data, updatedAt: now }, { merge: true });
    }
    await batch.commit();
    written += chunk.length;
    onProgress?.(`Appointment updates: ${written.toLocaleString()} / ${updates.length.toLocaleString()}`);
  }
  return written;
}

export async function saveAppointment(id, data) {
  await setDoc(doc(APPTS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export const deleteAppointment = (id, deletedBy) => softDelete(doc(APPTS_COL, id), deletedBy);
export const purgeAppointment  = (id) => deleteDoc(doc(APPTS_COL, id));

export async function fetchRecurringGroup(groupId) {
  const snap = await getDocs(query(APPTS_COL, where('recurringGroupId', '==', groupId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function deleteRecurringGroup(groupId) {
  const snap = await getDocs(query(APPTS_COL, where('recurringGroupId', '==', groupId)));
  const batch = writeBatch(db);
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

export async function fetchClientAppointments(clientId) {
  // where + orderBy on different fields would require a composite index;
  // the project convention is to filter with where alone and sort client-side.
  const snap = await getDocs(query(APPTS_COL, where('clientId', '==', clientId)));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  rows.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return rows;
}

// Normalize a US phone to canonical 10-digit form for cross-record
// matching. Mirrors normalizePhone() in ScheduleAdmin — kept inline here
// to avoid pulling a UI module into the firestore lib.
function _phoneDigits(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : '';
}

// Full visit history for a client: appointments + receipts (imports).
// Returns a unified, deduped list sorted newest-first. Each row exposes
// date, startTime, services[], techName, status, and revenue surface so
// the visit-history modal can render either source uniformly.
//
// `client` is optional — when supplied (with name/phone/email), we ALSO
// fetch records that weren't explicitly linked to this clientId but match
// on phone or email (covers walk-ins logged with no clientId, GG-imported
// receipts that didn't get a clientId backfill, and duplicate client
// records). Match is by normalized 10-digit phone or lowercased email.
export async function fetchClientVisits(clientId, client) {
  if (!clientId) return [];
  // Auto-fetch the client doc if the caller didn't already have it loaded.
  if (!client) { try { client = await fetchClient(clientId); } catch (_) {} }

  const wantEmail  = (client?.email || '').trim().toLowerCase() || null;
  const wantDigits = _phoneDigits(client?.phone);

  // Find every client record that represents the same person (typically
  // just one, but cleans up cases where the booking page minted a
  // duplicate before findOrCreateClient existed). Match on phone/email.
  // Falls back to just the supplied clientId if the clients query fails
  // (rules don't permit it for this user, etc.).
  const sameIds = new Set([clientId]);
  if (wantEmail || wantDigits) {
    try {
      const cSnap = await getDocs(CLIENTS_COL);
      cSnap.docs.forEach(d => {
        const c = d.data();
        const cEmail  = (c.email || '').trim().toLowerCase();
        const cDigits = _phoneDigits(c.phone);
        if (wantEmail && cEmail === wantEmail)   sameIds.add(d.id);
        if (wantDigits && cDigits === wantDigits) sameIds.add(d.id);
      });
    } catch (_) { /* fall through with strict clientId */ }
  }

  // Run a query per matching id (Firestore `in` is capped at 30 — typical
  // case is 1–2 ids, so per-id queries stay simple and indexed). For each,
  // pull both APPTS and RECEIPTS that were linked to that id.
  const idList = Array.from(sameIds);
  const apptSnaps = await Promise.all(idList.map(id =>
    getDocs(query(APPTS_COL, where('clientId', '==', id))).catch(() => ({ docs: [] }))
  ));
  const rcptSnaps = await Promise.all(idList.map(id =>
    getDocs(query(RECEIPTS_COL, where('clientId', '==', id))).catch(() => ({ docs: [] }))
  ));

  const apptMap = new Map();
  const rcptMap = new Map();
  const addIfLive = (map, snap) => snap.docs.forEach(d => {
    const data = { id: d.id, ...d.data() };
    if (notTombstoned(data)) map.set(d.id, data);
  });
  apptSnaps.forEach(snap => addIfLive(apptMap, snap));
  rcptSnaps.forEach(snap => addIfLive(rcptMap, snap));

  // Orphan-walk-in fallback: if we have a phone, also pick up records
  // that have NO clientId but a matching phone (legacy walk-ins logged
  // without linking). Email-equality query is indexed; phone is filtered
  // client-side because stored formats are inconsistent.
  if (wantEmail) {
    try {
      const aSnap = await getDocs(query(APPTS_COL, where('clientEmail', '==', wantEmail)));
      aSnap.docs.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (notTombstoned(data) && !apptMap.has(d.id)) apptMap.set(d.id, data);
      });
    } catch (_) {}
    try {
      const rSnap = await getDocs(query(RECEIPTS_COL, where('clientEmail', '==', wantEmail)));
      rSnap.docs.forEach(d => {
        const data = { id: d.id, ...d.data() };
        if (notTombstoned(data) && !rcptMap.has(d.id)) rcptMap.set(d.id, data);
      });
    } catch (_) {}
  }

  const appts    = Array.from(apptMap.values());
  const receipts = Array.from(rcptMap.values());

  // De-dupe: if a receipt covers an appointment via apptIds, drop the appt
  // since the receipt is the canonical record.
  const covered = new Set();
  receipts.forEach(r => (r.apptIds || []).forEach(id => covered.add(id)));

  const visits = [
    ...receipts.map(r => ({
      id:        r.id,
      source:    'receipt',
      date:      r.date,
      startTime: r.startTime || (r.payment?.paidAt ? r.payment.paidAt.slice(11, 16) : ''),
      services:  r.services || [],
      techName:  r.techName || '',
      status:    r.refunded ? 'refunded' : 'done',
      revenue:   (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0),
      raw:       r,
    })),
    ...appts.filter(a => !covered.has(a.id)).map(a => ({
      id:        a.id,
      source:    'appt',
      date:      a.date,
      startTime: a.startTime || '',
      services:  a.services || [],
      techName:  a.techName || '',
      status:    a.status || 'scheduled',
      revenue:   (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0),
      raw:       a,
    })),
  ];
  visits.sort((a, b) => {
    const d = (b.date || '').localeCompare(a.date || '');
    if (d !== 0) return d;
    return (b.startTime || '').localeCompare(a.startTime || '');
  });
  return visits;
}

export async function fetchDemoAppointments() {
  const snap = await getDocs(query(APPTS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Access requests ────────────────────────────────────
const REQUESTS_COL = tenantCol('requests');

export async function submitAccessRequest(uid, data) {
  await setDoc(doc(REQUESTS_COL, uid), { ...data, requestedAt: new Date().toISOString() });
}

export async function fetchAccessRequests() {
  const snap = await getDocs(REQUESTS_COL);
  return snap.docs.map(d => ({ uid: d.id, ...d.data(), role: 'pending' }));
}

export async function deleteAccessRequest(uid) {
  await deleteDoc(doc(REQUESTS_COL, uid));
}

// ── Bonuses ────────────────────────────────────────────
const BONUSES_COL = tenantCol('bonuses');

export async function fetchBonuses() {
  const snap = await getDocs(query(BONUSES_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function createBonus(data) {
  const ref = await addDoc(BONUSES_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export const deleteBonus = (id, deletedBy) => softDelete(doc(BONUSES_COL, id), deletedBy);
export const purgeBonus  = (id) => deleteDoc(doc(BONUSES_COL, id));

// ── Payroll runs ───────────────────────────────────────
const PAYROLL_COL = tenantCol('payrollRuns');

export async function fetchPayrollRuns() {
  const snap = await getDocs(query(PAYROLL_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createPayrollRun(data) {
  const ref = await addDoc(PAYROLL_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function savePayrollRun(id, data) {
  await setDoc(doc(PAYROLL_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Appointments by range ──────────────────────────────
export async function fetchAppointmentsByRange(startDate, endDate) {
  const snap = await getDocs(query(APPTS_COL,
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// ── Memberships ────────────────────────────────────────
// Plans are templates (e.g. "Manicure Club $80/mo"). Memberships are the
// per-client subscription records (one client → one membership at a time).
const MEMBERSHIP_PLANS_COL = tenantCol('membershipPlans');
const MEMBERSHIPS_COL      = tenantCol('memberships');

export async function fetchMembershipPlans() {
  const snap = await getDocs(MEMBERSHIP_PLANS_COL);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (a.price || 0) - (b.price || 0));
}
export function subscribeMembershipPlans(cb) {
  return onSnapshot(MEMBERSHIP_PLANS_COL, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(notTombstoned)
      .sort((a, b) => (a.price || 0) - (b.price || 0));
    cb(list);
  });
}
export async function createMembershipPlan(data) {
  const ref = await addDoc(MEMBERSHIP_PLANS_COL, {
    ...data,
    active: data.active !== false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveMembershipPlan(id, data) {
  await setDoc(doc(MEMBERSHIP_PLANS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteMembershipPlan(id, deletedBy) {
  await softDelete(doc(MEMBERSHIP_PLANS_COL, id), deletedBy);
}
export async function purgeMembershipPlan(id) {
  await deleteDoc(doc(MEMBERSHIP_PLANS_COL, id));
}

export async function fetchMemberships() {
  const snap = await getDocs(MEMBERSHIPS_COL);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}
export function subscribeMemberships(cb) {
  return onSnapshot(MEMBERSHIPS_COL, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(notTombstoned)
      .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
    cb(list);
  });
}
// Look up a single client's active membership. Returns null if none.
export async function fetchClientMembership(clientId) {
  if (!clientId) return null;
  const snap = await getDocs(query(MEMBERSHIPS_COL, where('clientId', '==', clientId), where('status', '==', 'active')));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}
export async function createMembership(data) {
  const ref = await addDoc(MEMBERSHIPS_COL, {
    ...data,
    status: data.status || 'active',
    startedAt: data.startedAt || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveMembership(id, data) {
  await setDoc(doc(MEMBERSHIPS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteMembership(id, deletedBy) {
  await softDelete(doc(MEMBERSHIPS_COL, id), deletedBy);
}
export async function purgeMembership(id) {
  await deleteDoc(doc(MEMBERSHIPS_COL, id));
}

// ── Time off (vacation / sick / personal) ──────────────
const TIMEOFF_COL = tenantCol('timeOff');

export async function fetchTimeOff() {
  const snap = await getDocs(TIMEOFF_COL);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}

export function subscribeTimeOff(cb) {
  return onSnapshot(TIMEOFF_COL, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(notTombstoned)
      .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    cb(list);
  });
}

export async function createTimeOff(data) {
  const ref = await addDoc(TIMEOFF_COL, {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateTimeOff(id, data) {
  await setDoc(doc(TIMEOFF_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function deleteTimeOff(id, deletedBy) {
  await softDelete(doc(TIMEOFF_COL, id), deletedBy);
}
export async function purgeTimeOff(id) {
  await deleteDoc(doc(TIMEOFF_COL, id));
}

// Returns the set of clientIds with any appointment OR receipt strictly
// before `beforeDate`. Used to classify clients in the current period as
// "new" (first ever visit) vs "returning" — accurate even when the prior
// period is short.
export async function fetchHistoricalClientIds(beforeDate) {
  const [aSnap, rSnap] = await Promise.all([
    getDocs(query(APPTS_COL, where('date', '<', beforeDate))).catch(() => ({ docs: [] })),
    getDocs(query(RECEIPTS_COL, where('date', '<', beforeDate))).catch(() => ({ docs: [] })),
  ]);
  const ids = new Set();
  aSnap.docs.forEach(d => { const c = d.data().clientId; if (c) ids.add(c); });
  rSnap.docs.forEach(d => { const c = d.data().clientId; if (c) ids.add(c); });
  return ids;
}

// ── Gift cards ─────────────────────────────────────────
const GIFT_CARDS_COL = tenantCol('giftCards');

export async function fetchGiftCards() {
  const snap = await getDocs(query(GIFT_CARDS_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function fetchGiftCardByCode(code) {
  const snap = await getDocs(query(GIFT_CARDS_COL, where('code', '==', code.trim().toUpperCase())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// Find redeemable gift cards by recipient name / phone / email (or code) — the
// "customer forgot their code" lookup. Active, non-voided, positive balance only.
export async function fetchGiftCardsByContact(qRaw) {
  const q = String(qRaw || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = (q.match(/\d/g) || []).join('');
  const snap = await getDocs(GIFT_CARDS_COL);
  const out = [];
  snap.docs.forEach(dd => {
    const g = { id: dd.id, ...dd.data() };
    if (g.voided || !(Number(g.balance) > 0)) return;
    const name  = String(g.recipientName || '').toLowerCase();
    const email = String(g.recipientEmail || '').toLowerCase();
    const code  = String(g.code || '').toLowerCase();
    const gPhone = (String(g.recipientPhone || '').match(/\d/g) || []).join('');
    const phoneHit = digits.length >= 7 && gPhone && gPhone.slice(-10) === digits.slice(-10);
    if (name.includes(q) || email.includes(q) || code.includes(q) || phoneHit) out.push(g);
  });
  return out.slice(0, 25);
}

export async function createGiftCard(data) {
  const ref = await addDoc(GIFT_CARDS_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

// Bulk-create N gift cards. Returns IDs in input order — receipt records
// for the matching sale need to reference the gift card ID in
// payment.giftCardsSold[].
export async function createGiftCardsBatch(arr, onProgress) {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const now = new Date().toISOString();
  const SIZE = 450;
  const ids = [];
  for (let i = 0; i < arr.length; i += SIZE) {
    const chunk = arr.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const data of chunk) {
      const ref = doc(GIFT_CARDS_COL);
      batch.set(ref, { ...data, createdAt: data.createdAt || now });
      ids.push(ref.id);
    }
    await batch.commit();
    onProgress?.(`Gift cards: ${ids.length.toLocaleString()} / ${arr.length.toLocaleString()}`);
  }
  return ids;
}

export async function fetchDemoGiftCards() {
  const snap = await getDocs(query(GIFT_CARDS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const deleteGiftCard = (id, deletedBy) => softDelete(doc(GIFT_CARDS_COL, id), deletedBy);
export const purgeGiftCard  = (id) => deleteDoc(doc(GIFT_CARDS_COL, id));

export async function updateGiftCard(id, data) {
  await updateDoc(doc(GIFT_CARDS_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

// ── Promo codes ────────────────────────────────────────
const PROMO_COL = tenantCol('promoCodes');

export async function fetchPromoCodes() {
  const snap = await getDocs(PROMO_COL);
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function fetchPromoByCode(code) {
  const snap = await getDocs(query(PROMO_COL, where('code', '==', code.trim().toUpperCase())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = { id: d.id, ...d.data() };
  return notTombstoned(data) ? data : null;
}

export async function createPromoCode(data) {
  const ref = await addDoc(PROMO_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function savePromoCode(id, data) {
  await updateDoc(doc(PROMO_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

export const deletePromoCode = (id, deletedBy) => softDelete(doc(PROMO_COL, id), deletedBy);
export const purgePromoCode  = (id) => deleteDoc(doc(PROMO_COL, id));

// ── Feedback ───────────────────────────────────────────
const FEEDBACK_COL = tenantCol('feedback');

export async function createFeedback(data) {
  const ref = await addDoc(FEEDBACK_COL, { ...data, createdAt: new Date().toISOString(), status: 'open' });
  return ref.id;
}

export async function fetchFeedback() {
  const snap = await getDocs(query(FEEDBACK_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateFeedbackStatus(id, status) {
  await updateDoc(doc(FEEDBACK_COL, id), { status, updatedAt: new Date().toISOString() });
}

// ── Performance reviews ────────────────────────────────
const REVIEWS_COL = tenantCol('reviews');

export async function fetchReviews() {
  const snap = await getDocs(query(REVIEWS_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function saveReview(id, data) {
  const now = new Date().toISOString();
  if (id) {
    await setDoc(doc(REVIEWS_COL, id), { ...data, updatedAt: now }, { merge: true });
    return id;
  }
  const ref = await addDoc(REVIEWS_COL, { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}

export const deleteReview = (id, deletedBy) => softDelete(doc(REVIEWS_COL, id), deletedBy);
export const purgeReview  = (id) => deleteDoc(doc(REVIEWS_COL, id));

// ── User preferences (per-uid, e.g. tech overlay) ─────
const USER_PREFS_COL = tenantCol('userPrefs');

export async function fetchUserPrefs(uid) {
  const snap = await getDoc(doc(USER_PREFS_COL, uid));
  return snap.exists() ? snap.data() : {};
}

export async function saveUserPrefs(uid, data) {
  await setDoc(doc(USER_PREFS_COL, uid), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Handbook ───────────────────────────────────────────
const HANDBOOK_REF  = tenantDoc('handbook');
const HANDBOOK_SIGS = tenantCol('handbookSigs');

export async function fetchHandbook() {
  const snap = await getDoc(HANDBOOK_REF);
  return snap.exists() ? snap.data() : null;
}

export async function saveHandbook(data) {
  await setDoc(HANDBOOK_REF, { ...data, updatedAt: new Date().toISOString() });
}

export async function fetchHandbookSigs() {
  const snap = await getDocs(HANDBOOK_SIGS);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

export async function signHandbookDoc(uid, data) {
  await setDoc(doc(HANDBOOK_SIGS, uid), { ...data, signedAt: new Date().toISOString() });
}

export async function fetchMyHandbookSig(uid) {
  const snap = await getDoc(doc(HANDBOOK_SIGS, uid));
  return snap.exists() ? snap.data() : null;
}

// ── Meetings ──────────────────────────────────────────
const MEETINGS_COL = tenantCol('meetings');

export async function fetchMeetings() {
  const snap = await getDocs(query(MEETINGS_COL, orderBy('startTimestamp', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function createMeeting(data) {
  const ref = await addDoc(MEETINGS_COL, {
    ...data,
    reminders: { sent60: false, sent15: false },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateMeeting(id, data) {
  await updateDoc(doc(MEETINGS_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

export async function deleteMeeting(id, deletedBy) {
  await softDelete(doc(MEETINGS_COL, id), deletedBy);
}
export async function purgeMeeting(id) {
  await deleteDoc(doc(MEETINGS_COL, id));
}

// ── Check-in (public, no auth required) ────────────────
// Public read of an appointment via its id used to be a direct getDoc()
// against the publicly-readable appointments collection, but that
// collection now requires staff to read (it holds full client PII).
// The public Cloud Function `getPublicAppointment` returns only the
// minimal slice the check-in confirm screen needs — no phone, email,
// notes, or full client name.
export async function getAppointmentById(id) {
  const { httpsCallable } = await import('firebase/functions');
  const { functions } = await import('./firebase');
  try {
    const res = await httpsCallable(functions, 'getPublicAppointment')({ tenantId: TENANT_ID, apptId: id });
    return res?.data ? { id: res.data.id, ...res.data } : null;
  } catch (_) { return null; }
}

export async function markCheckedIn(apptId) {
  // Public single-field update only. The staff-facing notification doc
  // is created server-side by `notifyOnCheckIn` (Firestore trigger),
  // so the public client doesn't need access to the full appt PII.
  await updateDoc(doc(APPTS_COL, apptId), { checkedInAt: new Date().toISOString() });
}

// ── Receipts (post-checkout outreach) ──────────────────
const RECEIPTS_COL = tenantCol('receipts');

export async function createReceipt(data) {
  await addDoc(RECEIPTS_COL, {
    sent: false,
    ...data,
    createdAt: data.createdAt || new Date().toISOString(),
  });
}

// Bulk create N receipts. ~8,000 receipts × ~80ms = 11 min sequential;
// batched ~3 sec. The biggest single line item in the seed run.
export async function createReceiptsBatch(arr, onProgress) {
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const now = new Date().toISOString();
  const SIZE = 450;
  let written = 0;
  for (let i = 0; i < arr.length; i += SIZE) {
    const chunk = arr.slice(i, i + SIZE);
    const batch = writeBatch(db);
    for (const data of chunk) {
      const ref = doc(RECEIPTS_COL);
      batch.set(ref, {
        sent: false,
        ...data,
        createdAt: data.createdAt || now,
      });
    }
    await batch.commit();
    written += chunk.length;
    onProgress?.(`Receipts: ${written.toLocaleString()} / ${arr.length.toLocaleString()}`);
  }
  return written;
}

export async function fetchDemoReceipts() {
  const snap = await getDocs(query(RECEIPTS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const deleteReceipt = (id, deletedBy) => softDelete(doc(RECEIPTS_COL, id), deletedBy);
export const purgeReceipt  = (id) => deleteDoc(doc(RECEIPTS_COL, id));

// ── Pre-import dedup keys ──────────────────────────────
// Returns a Set of `_glossgeniusChargeId` values for receipts already in the
// DB. The joined-receipts importer skips any payment whose chargeId is in
// this set, so re-running the importer is now idempotent.
export async function fetchExistingGgChargeIds() {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  const set = new Set();
  snap.docs.forEach(d => {
    const id = d.data()._glossgeniusChargeId;
    if (id) set.add(id);
  });
  return set;
}

// Returns a Set of _glossgeniusTransactionId values already in the receipts
// collection. This is the per-row unique ID from the GG Payment Details
// CSV (column "Payment Transaction ID") and is the correct dedup key for
// re-import. Charge ID alone is insufficient because GG re-uses the same
// Charge ID across payment/refund pairs and split payments, so dedup-by-
// chargeId silently drops refund and split-second-half rows.
export async function fetchExistingGgTransactionIds() {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  const set = new Set();
  snap.docs.forEach(d => {
    const id = d.data()._glossgeniusTransactionId;
    if (id) set.add(id);
  });
  return set;
}

// Returns a Set of normalized client name keys (matching csvImport.clientKey)
// already in the clients collection. Used to skip duplicate client imports.
export async function fetchExistingClientNameKeys() {
  const snap = await getDocs(CLIENTS_COL);
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const set = new Set();
  snap.docs.forEach(d => {
    const c = d.data();
    if (c?.name) set.add(norm(c.name));
  });
  return set;
}

// Synthetic key for an appointment row — used to dedup re-imports of the GG
// Appointments CSV. Matches the importer's expected fields.
function apptDedupKey({ date, startTime, clientName, techName, services }) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const svcName = norm(services?.[0]?.name);
  return `${date || ''}|${startTime || ''}|${norm(clientName)}|${norm(techName)}|${svcName}`;
}
export { apptDedupKey };

// Returns a Set of dedup keys for every appointment already in the DB.
export async function fetchExistingApptKeys() {
  const snap = await getDocs(APPTS_COL);
  const set = new Set();
  snap.docs.forEach(d => set.add(apptDedupKey(d.data())));
  return set;
}

// Synthetic key for a single-file "Sales" receipt (mapSaleRow path) — used
// to dedup re-imports when the row has no Charge ID.
function saleDedupKey({ date, clientName, payment }) {
  const norm = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return `${date || ''}|${norm(clientName)}|${(payment?.total || 0).toFixed(2)}|${payment?.method || ''}`;
}
export { saleDedupKey };

// Set of synthetic keys for every existing receipt. Covers both joined-path
// (which also has a Charge ID dedup) and single-file paths.
export async function fetchExistingReceiptKeys() {
  const snap = await getDocs(RECEIPTS_COL);
  const set = new Set();
  snap.docs.forEach(d => set.add(saleDedupKey(d.data())));
  return set;
}

// Counts every appointment doc — destructive scope preview for the
// "wipe all appointments" button.
export async function countAllAppointments() {
  const snap = await getDocs(APPTS_COL);
  return snap.size;
}

// Hard reset: delete EVERY appointment doc, regardless of source. Used
// before re-importing GG appointment history when a tenant wants a clean
// calendar. Irreversible. Receipts are NOT touched (sales history is
// preserved). Demo / online-booking / in-app appointments all go.
export async function wipeAllAppointments(onProgress) {
  const snap = await getDocs(APPTS_COL);
  const total = snap.size;
  let deleted = 0;
  for (const d of snap.docs) {
    await deleteDoc(doc(APPTS_COL, d.id));
    deleted++;
    if (onProgress && deleted % 50 === 0) onProgress(`Deleted ${deleted.toLocaleString()} / ${total.toLocaleString()}…`);
  }
  return { deleted, total };
}

// Counts every receipt doc — destructive scope preview for the
// "wipe all transactions" button.
export async function countAllReceipts() {
  const snap = await getDocs(RECEIPTS_COL);
  return snap.size;
}

// Hard reset: delete EVERY receipt doc, regardless of source. Wipes the
// entire sales/transaction history (in-app checkouts + GG imports + demo).
// Irreversible. Appointments and clients are NOT touched.
export async function wipeAllReceipts(onProgress) {
  const snap = await getDocs(RECEIPTS_COL);
  const total = snap.size;
  let deleted = 0;
  for (const d of snap.docs) {
    await deleteDoc(doc(RECEIPTS_COL, d.id));
    deleted++;
    if (onProgress && deleted % 50 === 0) onProgress(`Deleted ${deleted.toLocaleString()} / ${total.toLocaleString()}…`);
  }
  return { deleted, total };
}

// Preview of what wipeAllGgImports would delete — counts per collection so
// the user can decide before pulling the trigger.
export async function previewGgImportWipe() {
  const [clients, appts, receipts] = await Promise.all([
    getDocs(query(CLIENTS_COL,  where('_importedFrom', '==', 'glossgenius'))),
    getDocs(query(APPTS_COL,    where('_importedFrom', '==', 'glossgenius'))),
    getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius'))),
  ]);
  return {
    clients:  clients.size,
    appointments: appts.size,
    receipts: receipts.size,
    total:    clients.size + appts.size + receipts.size,
  };
}

// Hard reset: delete every record tagged `_importedFrom: 'glossgenius'` across
// clients, appointments, and receipts. After this runs, the user can re-import
// the GG Clients CSV + Payment Details + Checkout Line Items cleanly. Local
// (non-GG) records are untouched. Irreversible — no soft-delete.
export async function wipeAllGgImports(onProgress) {
  const [clientsSnap, apptsSnap, receiptsSnap] = await Promise.all([
    getDocs(query(CLIENTS_COL,  where('_importedFrom', '==', 'glossgenius'))),
    getDocs(query(APPTS_COL,    where('_importedFrom', '==', 'glossgenius'))),
    getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius'))),
  ]);
  const total = clientsSnap.size + apptsSnap.size + receiptsSnap.size;
  let done = 0;

  async function deleteAll(snap, col, label) {
    for (const d of snap.docs) {
      await deleteDoc(doc(col, d.id));
      done++;
      if (onProgress && done % 50 === 0) onProgress(`Deleted ${done.toLocaleString()} / ${total.toLocaleString()} (${label})…`);
    }
  }

  await deleteAll(receiptsSnap, RECEIPTS_COL, 'receipts');
  await deleteAll(apptsSnap,    APPTS_COL,    'appointments');
  await deleteAll(clientsSnap,  CLIENTS_COL,  'clients');

  return {
    deletedReceipts:    receiptsSnap.size,
    deletedAppointments: apptsSnap.size,
    deletedClients:     clientsSnap.size,
    total,
  };
}

// Same idea as the createdAt distribution but for the receipt's `date` field
// (the transaction's actual sale date, which the metrics filter requires
// for inclusion). Returns counts of valid vs missing/malformed.
export async function diagnoseReceiptDate() {
  const snap = await getDocs(RECEIPTS_COL);
  const byYear = {};
  let valid = 0, missing = 0, malformed = 0;
  const sampleMissing = [];
  const sampleMalformed = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const dt = data.date;
    if (!dt) {
      missing++;
      if (sampleMissing.length < 5) sampleMissing.push({ id: d.id, clientName: data.clientName, total: data.payment?.total || 0, method: data.payment?.method, createdAt: data.createdAt });
      return;
    }
    if (typeof dt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dt)) {
      malformed++;
      if (sampleMalformed.length < 5) sampleMalformed.push({ id: d.id, value: String(dt).slice(0, 40), method: data.payment?.method });
      return;
    }
    valid++;
    const yr = dt.slice(0, 4);
    byYear[yr] = (byYear[yr] || 0) + 1;
  });
  return { total: snap.size, valid, missing, malformed, byYear, sampleMissing, sampleMalformed };
}

// Backfill: copy a usable date string into receipts whose `date` field is
// missing or malformed. Pulls (in order): payment.paidAt → createdAt
// (slicing off the time portion to get YYYY-MM-DD). Same signature pattern
// as the createdAt backfill — safe to run multiple times.
export async function backfillReceiptDate(onProgress) {
  const snap = await getDocs(RECEIPTS_COL);
  let scanned = 0, updated = 0, skipped = 0, unfixable = 0;
  const sampleUnfixable = [];
  for (const d of snap.docs) {
    scanned++;
    const data = d.data();
    const cur = data.date;
    if (cur && typeof cur === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cur)) { skipped++; continue; }
    const fromPaid = typeof data?.payment?.paidAt === 'string' ? data.payment.paidAt.slice(0, 10) : null;
    const fromCreated = typeof data?.createdAt === 'string' ? data.createdAt.slice(0, 10) : null;
    const target = (fromPaid && /^\d{4}-\d{2}-\d{2}$/.test(fromPaid))
      ? fromPaid
      : (fromCreated && /^\d{4}-\d{2}-\d{2}$/.test(fromCreated) ? fromCreated : null);
    if (!target) {
      unfixable++;
      if (sampleUnfixable.length < 5) sampleUnfixable.push({ id: d.id, clientName: data.clientName, total: data.payment?.total || 0 });
      continue;
    }
    await updateDoc(doc(RECEIPTS_COL, d.id), { date: target });
    updated++;
    if (onProgress && updated % 25 === 0) onProgress(`Backfilled ${updated}/${scanned}…`);
  }
  return { scanned, updated, skipped, unfixable, sampleUnfixable };
}

// Diagnostic: bucket every receipt's createdAt by year + flags type problems
// (Firestore Timestamps stored as objects instead of ISO strings, garbage
// like "Invalid Date", or out-of-range years). Use this when the Reports
// `where('createdAt', ...)` range query is silently dropping receipts.
export async function diagnoseReceiptCreatedAt() {
  const snap = await getDocs(RECEIPTS_COL);
  const byYear = {};
  let validIso = 0, nonString = 0, unparseable = 0, missing = 0;
  const sampleNonString = [];
  const sampleUnparseable = [];
  snap.docs.forEach(d => {
    const data = d.data();
    const c = data.createdAt;
    if (c == null) { missing++; return; }
    if (typeof c !== 'string') {
      nonString++;
      if (sampleNonString.length < 5) sampleNonString.push({ id: d.id, type: typeof c, value: String(c).slice(0, 60), method: data.payment?.method });
      return;
    }
    const dt = new Date(c);
    if (isNaN(dt.getTime())) {
      unparseable++;
      if (sampleUnparseable.length < 5) sampleUnparseable.push({ id: d.id, value: c.slice(0, 40), method: data.payment?.method });
      return;
    }
    validIso++;
    const yr = dt.getUTCFullYear();
    byYear[yr] = (byYear[yr] || 0) + 1;
  });
  return {
    total: snap.size,
    validIso,
    nonString,
    unparseable,
    missing,
    byYear,
    sampleNonString,
    sampleUnparseable,
  };
}

// Diagnostic: explain a method-bucket count discrepancy by listing all
// receipts with the given normalized method, grouped by transactionType
// and source. Use it when "Cash" (or another method) on the Reports KPI
// shows fewer transactions than the user counted manually — most often
// the gap is rows tagged 'cancellation' or 'void' that the Overview
// excludes from "money collected" by design.
export async function diagnoseMethodBucket(method) {
  const snap = await getDocs(query(RECEIPTS_COL, where('payment.method', '==', method)));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  const byType = {};
  const bySource = {};
  let totalAll = 0, sumAll = 0;
  rows.forEach(r => {
    const t = r.transactionType || '(unset)';
    const s = r._glossgeniusSource || (r._importedFrom === 'glossgenius' ? '(no source)' : '(in-app)');
    const total = Number(r.payment?.total) || 0;
    if (!byType[t])   byType[t]   = { count: 0, total: 0 };
    if (!bySource[s]) bySource[s] = { count: 0, total: 0 };
    byType[t].count++;     byType[t].total   += total;
    bySource[s].count++;   bySource[s].total += total;
    totalAll++; sumAll += total;
  });
  return {
    method,
    totalReceipts: totalAll,
    grossTotal:    sumAll, // pre-filter — includes everything regardless of transactionType
    byType,                 // counts + sums grouped by transactionType
    bySource,               // counts + sums grouped by GG source
  };
}

// Diagnostic: revenue vs payment-method KPI doubling. Looks for two flavors
// of duplication in GG-imported receipts:
//   (a) joined-path duplicates (same _glossgeniusChargeId on N>1 docs).
//   (b) cross-format duplicates: the single-file "Sales" import path
//       creates receipts WITHOUT _glossgeniusChargeId, while the joined
//       Payment + Line Items path creates ones WITH chargeId. If the user
//       ran both, every transaction is doubled and the dedup-by-chargeId
//       backfill misses it. We detect this by counting GG receipts in each
//       flavor.
export async function diagnoseImportFormats() {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  let total = 0, withChargeId = 0, withoutChargeId = 0;
  let svcRev = 0, paymentTotal = 0, tax = 0, tip = 0, retail = 0;
  let svcRevWith = 0, totalWith = 0, svcRevWithout = 0, totalWithout = 0;
  const sampleWithout = [];

  snap.docs.forEach(d => {
    const r = d.data();
    total++;
    const p = r.payment || {};
    const sRev = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
    const ret  = (r.retailProducts || []).reduce((s, x) => s + (Number(x.price) || 0) * (x.qty || 1), 0);
    svcRev       += sRev;
    paymentTotal += Number(p.total) || 0;
    tax          += Number(p.tax)   || 0;
    tip          += Number(p.tip)   || 0;
    retail       += ret;

    if (r._glossgeniusChargeId) {
      withChargeId++;
      svcRevWith += sRev;
      totalWith  += Number(p.total) || 0;
    } else {
      withoutChargeId++;
      svcRevWithout += sRev;
      totalWithout  += Number(p.total) || 0;
      if (sampleWithout.length < 5) sampleWithout.push({
        id: d.id, date: r.date, clientName: r.clientName, total: Number(p.total) || 0, services: (r.services || []).map(s => s.name),
      });
    }
  });

  return {
    totalGgReceipts: total,
    withChargeId:    { count: withChargeId,    svcRev: svcRevWith,    paymentTotal: totalWith },
    withoutChargeId: { count: withoutChargeId, svcRev: svcRevWithout, paymentTotal: totalWithout },
    aggregates: { svcRev, paymentTotal, tax, tip, retail },
    expectedTotal: svcRev + retail + tax + tip,
    inflationRatio: svcRev > 0 ? paymentTotal / svcRev : null,
    sampleWithoutChargeId: sampleWithout,
  };
}

// Delete all GG-imported receipts that have NO _glossgeniusChargeId. Use
// this to clean up the single-file "Sales" import path duplicates after
// confirming via diagnoseImportFormats that the joined-path receipts are
// the canonical ones to keep. Irreversible.
export async function deleteImportedReceiptsWithoutChargeId(onProgress) {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  let scanned = 0, deleted = 0;
  for (const d of snap.docs) {
    scanned++;
    const data = d.data();
    if (data._glossgeniusChargeId) continue;
    await deleteDoc(doc(RECEIPTS_COL, d.id));
    deleted++;
    if (onProgress && deleted % 25 === 0) onProgress(`Deleted ${deleted}/${scanned} scanned…`);
  }
  return { scanned, deleted };
}

// Diagnostic: explain a cash-total discrepancy by breaking it down by
// source (GG-imported vs in-app) and detecting duplicate Charge IDs. Run
// this when the Cash KPI looks ~2x off — it's almost always a double-import.
export async function diagnoseCashTotals(startDate, endDate) {
  const startISO = `${startDate}T00:00:00.000Z`;
  const endISO   = `${endDate}T23:59:59.999Z`;
  const snap = await getDocs(query(RECEIPTS_COL,
    where('createdAt', '>=', startISO),
    where('createdAt', '<=', endISO),
  ));
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  let cashCount = 0, cashTotal = 0;
  let cashGgCount = 0, cashGgTotal = 0;
  let cashInAppCount = 0, cashInAppTotal = 0;
  let salesAllSources = 0;

  // Count Charge ID occurrences for the GG-imported subset to surface dupes.
  const chargeIdCounts = {};
  const sampleDupes = {};

  rows.forEach(r => {
    const p = r.payment || {};
    const svcRev = (r.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
    const retail = (r.retailProducts || []).reduce((s, x) => s + (Number(x.price) || 0) * (x.qty || 1), 0);
    salesAllSources += svcRev + retail;

    if (p.method === 'cash') {
      cashCount++;
      cashTotal += Number(p.total) || 0;
      if (r._importedFrom === 'glossgenius') {
        cashGgCount++;
        cashGgTotal += Number(p.total) || 0;
      } else {
        cashInAppCount++;
        cashInAppTotal += Number(p.total) || 0;
      }
    }

    if (r._glossgeniusChargeId) {
      const cid = r._glossgeniusChargeId;
      chargeIdCounts[cid] = (chargeIdCounts[cid] || 0) + 1;
      if (chargeIdCounts[cid] > 1 && Object.keys(sampleDupes).length < 8) {
        sampleDupes[cid] = (sampleDupes[cid] || 0) + 1;
      }
    }
  });

  const dupChargeIds = Object.entries(chargeIdCounts).filter(([, n]) => n > 1);
  const totalRowsDuplicated = dupChargeIds.reduce((s, [, n]) => s + (n - 1), 0);

  return {
    range: { startDate, endDate },
    receiptsScanned: rows.length,
    sales: { allSources: salesAllSources },
    cash: {
      total:       cashTotal,
      txnCount:    cashCount,
      ggImported:  { count: cashGgCount,    total: cashGgTotal },
      inApp:       { count: cashInAppCount, total: cashInAppTotal },
    },
    duplicates: {
      uniqueChargeIdsAffected: dupChargeIds.length,
      extraDuplicateRows:      totalRowsDuplicated,
      sample: dupChargeIds.slice(0, 8).map(([cid, n]) => ({ chargeId: cid, copies: n })),
    },
  };
}

// Dedup imported GG receipts: keeps the oldest doc per `_glossgeniusTransactionId`
// (the per-row unique ID from the GG Payment Details CSV) and deletes the
// rest. Returns counts; safe to run twice. Falls back to chargeId for legacy
// receipts that lack a transactionId. We deliberately do NOT dedup by
// chargeId alone — a payment + refund pair shares a chargeId by design.
export async function dedupeImportedReceipts(onProgress) {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  const byKey = {};
  snap.docs.forEach(d => {
    const data = d.data();
    const key = data._glossgeniusTransactionId || data._glossgeniusChargeId;
    if (!key) return;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push({ id: d.id, createdAt: data.createdAt || '' });
  });

  let scanned = 0, deleted = 0;
  for (const k of Object.keys(byKey)) {
    const copies = byKey[k];
    scanned++;
    if (copies.length < 2) continue;
    // Keep the oldest createdAt (earliest import); delete the rest.
    copies.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    for (let i = 1; i < copies.length; i++) {
      await deleteDoc(doc(RECEIPTS_COL, copies[i].id));
      deleted++;
      if (onProgress && deleted % 25 === 0) onProgress(`Deleted ${deleted} duplicates…`);
    }
  }
  return { uniqueChargeIds: scanned, duplicatesDeleted: deleted };
}

// Diagnostic: fetch a sample of GG receipts whose techName equals the given
// value. Pass '' to find receipts with no tech assigned (the source of the
// "Unassigned" leaderboard row).
export async function sampleGgReceiptsByTech(techName, n = 10) {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  const matches = [];
  for (const d of snap.docs) {
    const data = d.data();
    const t = (data.techName || '').trim();
    if (t === techName) {
      matches.push({ id: d.id, ...data });
      if (matches.length >= n) break;
    }
  }
  return matches;
}

// Diagnostic: returns counts of unlinked GG receipts grouped by clientName,
// plus the total number of client records on file. Helps figure out why a
// backfill matched 0 — usually either no clients imported, or name mismatches.
export async function diagnoseUnlinkedReceipts() {
  const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const clientsSnap = await getDocs(tenantCol('clients'));
  const clientNames = new Set();
  clientsSnap.forEach(d => {
    const c = d.data();
    if (c?.name) clientNames.add(normalize(c.name));
  });

  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  const counts = {};
  let unlinked = 0;
  snap.forEach(d => {
    const data = d.data();
    if (data.clientId) return;
    unlinked++;
    const name = data.clientName || '(empty)';
    counts[name] = (counts[name] || 0) + 1;
  });

  const top = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  return {
    clientCount: clientNames.size,
    totalUnlinked: unlinked,
    topNames: top.map(([name, count]) => ({
      name,
      count,
      hasMatch: clientNames.has(normalize(name)),
    })),
  };
}

// Link previously imported GG receipts to existing client docs by matching
// clientName → client.id. Uses a normalized key (case + whitespace insensitive).
export async function backfillImportedReceiptClientIds(onProgress) {
  const normalize = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');

  const clientsSnap = await getDocs(tenantCol('clients'));
  const lookup = {};
  clientsSnap.forEach(d => {
    const c = d.data();
    if (c?.name) lookup[normalize(c.name)] = d.id;
  });

  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  let scanned = 0, linked = 0, alreadyLinked = 0, noMatch = 0;
  for (const d of snap.docs) {
    scanned++;
    const data = d.data();
    if (data.clientId) { alreadyLinked++; continue; }
    const id = data.clientName ? lookup[normalize(data.clientName)] : null;
    if (!id) { noMatch++; continue; }
    await updateDoc(doc(RECEIPTS_COL, d.id), { clientId: id });
    linked++;
    if (onProgress && scanned % 25 === 0) onProgress(`Linked ${linked}/${scanned}…`);
  }
  return { scanned, linked, alreadyLinked, noMatch };
}

// Stronger backfill: makes sure EVERY receipt has a usable createdAt so the
// Reports `where('createdAt', '>=', start)` range query doesn't silently
// drop docs whose createdAt is null/undefined. Falls back through:
//   payment.paidAt → r.date + noon UTC → leaves doc untouched if neither.
// Returns counts of scanned/updated/skipped/sample so the caller can show
// progress and surface the unfixable rows.
export async function backfillReceiptCreatedAtStrong(onProgress) {
  const snap = await getDocs(RECEIPTS_COL);
  let scanned = 0, updated = 0, skipped = 0, unfixable = 0;
  const sampleUnfixable = [];
  for (const d of snap.docs) {
    scanned++;
    const data = d.data();
    if (data.createdAt) { skipped++; continue; }
    const fromPaid = data?.payment?.paidAt;
    const fromDate = data?.date ? `${data.date}T12:00:00.000Z` : null;
    const target = fromPaid || fromDate;
    if (!target) {
      unfixable++;
      if (sampleUnfixable.length < 5) sampleUnfixable.push({
        id: d.id, clientName: data.clientName, total: data?.payment?.total || 0, method: data?.payment?.method,
      });
      continue;
    }
    await updateDoc(doc(RECEIPTS_COL, d.id), { createdAt: target });
    updated++;
    if (onProgress && updated % 25 === 0) onProgress(`Backfilled ${updated}/${scanned}…`);
  }
  return { scanned, updated, skipped, unfixable, sampleUnfixable };
}

// One-time fix: receipts imported before the createdAt fix had createdAt
// overwritten with the import time. Copy payment.paidAt → createdAt so
// reports/transactions filter by the historical sale date.
export async function backfillImportedReceiptCreatedAt(onProgress) {
  const snap = await getDocs(query(RECEIPTS_COL, where('_importedFrom', '==', 'glossgenius')));
  let scanned = 0, updated = 0, skipped = 0;
  for (const d of snap.docs) {
    scanned++;
    const data = d.data();
    const target = data?.payment?.paidAt;
    if (!target) { skipped++; continue; }
    if (data.createdAt === target) { skipped++; continue; }
    await updateDoc(doc(RECEIPTS_COL, d.id), { createdAt: target });
    updated++;
    if (onProgress && scanned % 25 === 0) onProgress(`Backfilled ${updated}/${scanned}…`);
  }
  return { scanned, updated, skipped };
}

export async function fetchReceiptsByRange(startDate, endDate) {
  // createdAt is an ISO timestamp; build inclusive bounds on the date portion.
  const startISO = `${startDate}T00:00:00.000Z`;
  const endISO   = `${endDate}T23:59:59.999Z`;
  const snap = await getDocs(query(RECEIPTS_COL,
    where('createdAt', '>=', startISO),
    where('createdAt', '<=', endISO),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// All-time receipt lookup by exact client name — pull up an old sale a customer
// asks about (older than the browse window). Single `where`, sorted newest-first.
export async function fetchReceiptsByClientName(name) {
  const n = String(name || '').trim();
  if (!n) return [];
  const snap = await getDocs(query(RECEIPTS_COL, where('clientName', '==', n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => String(b.createdAt || b.date || '').localeCompare(String(a.createdAt || a.date || '')));
}

// Fetch specific appointments by id (e.g. a receipt's apptIds) to resolve the
// participants of a combined checkout. Small N — one getDoc each.
export async function fetchAppointmentsByIds(ids = []) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  const snaps = await Promise.all(uniq.map(id => getDoc(doc(APPTS_COL, id)).catch(() => null)));
  return snaps.filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() }));
}

// Service ratings written by submitServiceRating callable when clients tap
// stars on the hosted /r/{token} page. One row per (receipt, tech).
const SERVICE_RATINGS_COL = tenantCol('serviceRatings');

export async function fetchServiceRatingsByRange(startDate, endDate) {
  const startISO = `${startDate}T00:00:00.000Z`;
  const endISO   = `${endDate}T23:59:59.999Z`;
  const snap = await getDocs(query(SERVICE_RATINGS_COL,
    where('submittedAt', '>=', startISO),
    where('submittedAt', '<=', endISO),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// ── Notification center ────────────────────────────────
const NOTIFS_COL   = tenantCol('notifications');

export async function sendHandbookReminderNotif(techName, handbookTitle, version) {
  await addDoc(NOTIFS_COL, {
    changeType:    'handbook_reminder',
    techName,
    handbookTitle: handbookTitle || 'Employee Handbook',
    version:       version || '1.0',
    createdAt:     new Date().toISOString(),
    sent:          false,
  });
}

// Real-time subscription to the most recent notifications (for the top-bar bell)
export function subscribeToRecentNotifications(n, cb) {
  const q = query(NOTIFS_COL, orderBy('createdAt', 'desc'), limit(n));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function markNotificationRead(id, email) {
  await setDoc(doc(NOTIFS_COL, id), { readBy: arrayUnion(email), updatedAt: new Date().toISOString() }, { merge: true });
}

export async function fetchNotificationCenter(n = 150) {
  const [notifSnap, receiptSnap, reviewSnap] = await Promise.all([
    getDocs(query(NOTIFS_COL,           orderBy('createdAt', 'desc'), limit(n))),
    getDocs(query(RECEIPTS_COL,         orderBy('createdAt', 'desc'), limit(n))),
    getDocs(query(REVIEW_REQUESTS_COL,  orderBy('createdAt', 'desc'), limit(n))),
  ]);
  const notifs   = notifSnap.docs.map(d  => ({ id: d.id, _kind: 'notif',          ...d.data() }));
  const receipts = receiptSnap.docs.map(d => ({ id: d.id, _kind: 'receipt',        ...d.data() }));
  const reviews  = reviewSnap.docs.map(d  => ({ id: d.id, _kind: 'review_request', ...d.data() }));
  return [...notifs, ...receipts, ...reviews].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

// ── Products (retail inventory) ───────────────────────────
const PRODUCTS_COL = tenantCol('products');

export async function fetchProducts() {
  const snap = await getDocs(query(PRODUCTS_COL, orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

export async function saveProduct(id, data) {
  await setDoc(doc(PRODUCTS_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

export async function createProduct(data) {
  await addDoc(PRODUCTS_COL, { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function deleteProduct(id, deletedBy) {
  await softDelete(doc(PRODUCTS_COL, id), deletedBy);
}
export async function purgeProduct(id) {
  await deleteDoc(doc(PRODUCTS_COL, id));
}

// ── Marketing campaigns ───────────────────────────────
const CAMPAIGNS_COL = tenantCol('campaigns');

export async function fetchCampaigns() {
  const snap = await getDocs(query(CAMPAIGNS_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// Real-time subscription so the UI sees status='pending' → 'sent' updates
// from sendSMSCampaign without a manual reload. Returns unsubscribe.
export function subscribeToCampaigns(cb) {
  const q = query(CAMPAIGNS_COL, orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)));
}

export async function createCampaign(data) {
  await addDoc(CAMPAIGNS_COL, { ...data, createdAt: new Date().toISOString() });
}

export async function deleteCampaign(id, deletedBy) {
  return softDelete(doc(CAMPAIGNS_COL, id), deletedBy);
}
export async function purgeCampaign(id) {
  return deleteDoc(doc(CAMPAIGNS_COL, id));
}

// Cancel a campaign. For scheduled campaigns we flip status directly
// (the sweep skips them). For in-flight campaigns we set cancelRequested
// and let the Cloud Function honor it at the next flush boundary.
export async function cancelCampaign(id) {
  const ref = doc(CAMPAIGNS_COL, id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : null;
  const isScheduled = cur?.status === 'scheduled';
  await setDoc(ref, {
    cancelRequested: true,
    cancelRequestedAt: new Date().toISOString(),
    ...(isScheduled ? { status: 'cancelled', cancelledAt: new Date().toISOString() } : {}),
  }, { merge: true });
}

const CAMPAIGN_TEMPLATES_COL = tenantCol('campaignTemplates');

export async function fetchCampaignTemplates() {
  const snap = await getDocs(query(CAMPAIGN_TEMPLATES_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveCampaignTemplate(data) {
  return addDoc(CAMPAIGN_TEMPLATES_COL, { ...data, createdAt: new Date().toISOString() });
}

export async function deleteCampaignTemplate(id) {
  return deleteDoc(doc(CAMPAIGN_TEMPLATES_COL, id));
}

// ── Review requests ───────────────────────────────────
const REVIEW_REQUESTS_COL = tenantCol('reviewRequests');

export async function createReviewRequest(data) {
  await addDoc(REVIEW_REQUESTS_COL, { ...data, createdAt: new Date().toISOString(), sent: false });
}

export async function fetchReviewRequests(n = 200) {
  const snap = await getDocs(query(REVIEW_REQUESTS_COL, orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Client portal ──────────────────────────────────────
export async function fetchClientByPhone(phone) {
  if (!phone) return null;
  // Normalize: digits only — handles users typing (614) 555-0100 vs 6145550100.
  const norm = (phone.match(/\d/g) || []).join('');
  if (!norm) return null;
  const snap = await getDocs(CLIENTS_COL);
  const candidates = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => {
      const cn = (c.phone || '').match(/\d/g);
      return cn && cn.join('') === norm;
    });
  return candidates[0] || null;
}

export async function fetchClientByEmail(email) {
  const normalized = email.trim().toLowerCase();
  // Try exact match first, then lowercase match
  for (const val of [email.trim(), normalized]) {
    const snap = await getDocs(query(CLIENTS_COL, where('email', '==', val)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }
  return null;
}

// Booking-page self-lookup: the unauthenticated/public booking flow can't
// read `clients` directly (staff-only rules). After Firebase Auth issues
// a token (Google / magic link / phone OTP), this callable returns the
// caller's own slim client record matched on token-verified email or phone.
// Response: { client: {...} | null, banned?: true, requiresIdentityConfirm?: boolean }
export async function callMyClientRecord() {
  try {
    const res = await callFn('getMyClientRecord')({ tenantId: TENANT_ID });
    return res?.data || { client: null };
  } catch (e) {
    console.warn('[getMyClientRecord]', e?.message);
    return { client: null };
  }
}

// ── Backup / Restore ────────────────────────────────────
// Comprehensive data export. Per Plume Nexus principle #8, this captures
// EVERYTHING the customer owns so they can leave with their entire history
// intact. Skips only in-app-only state (notifications, chatNotifications,
// userPrefs, requests, turnRoster) which are transient and non-portable.
export async function fetchAllForBackup() {
  // All single-doc settings paths we back up. Order doesn't matter — they
  // all get their own slot in the returned object under `_<name>`.
  const settingsPaths = [
    'slides', 'settings', 'users', 'usersFull', 'settingsPrivate',
    'handbook', 'webfront', 'bookingConfig',
  ];
  const settingsSnaps = await Promise.all(settingsPaths.map(p => getDoc(tenantDoc(p))));

  const cols = [
    // Core operational
    'clients', 'employees', 'services', 'appointments', 'receipts',
    // Money
    'giftCards', 'promoCodes', 'bonuses', 'payrollRuns', 'taxForms',
    // Marketing + comms
    'campaigns', 'campaignTemplates', 'chats',
    // Reviews
    'reviews', 'reviewReceived', 'reviewRequests',
    // Time + scheduling
    'meetings', 'timeOff', 'attendance', 'waitlist',
    // Memberships
    'memberships', 'membershipPlans',
    // Other
    'products', 'handbookSigs', 'logs', 'feedback',
  ];
  const colSnaps = await Promise.all(cols.map(c => getDocs(tenantCol(c))));

  const data = {};
  cols.forEach((c, i) => {
    data[c] = colSnaps[i].docs.map(d => ({ _id: d.id, ...d.data() }));
  });

  settingsPaths.forEach((p, i) => {
    data['_' + p] = settingsSnaps[i].exists() ? settingsSnaps[i].data() : null;
  });

  // Employee compensation subcollection (employees/{id}/private/comp).
  // Holds tax IDs, SSNs, pay rates, banking info, Gusto IDs — moved off
  // the public employee doc during PII hardening. Without this in the
  // backup, every employee loses comp data on restore.
  const empCompMap = {};
  await Promise.all((data.employees || []).map(async emp => {
    if (!emp._id) return;
    try {
      const compSnap = await getDoc(doc(tenantCol('employees'), emp._id, 'private', 'comp'));
      if (compSnap.exists()) empCompMap[emp._id] = compSnap.data();
    } catch (_) { /* per-employee permission/network failure — leave it out, don't abort the whole backup */ }
  }));
  data._employeeComp = empCompMap;

  return data;
}

export async function restoreFromBackup(data, onProgress) {
  // Keep this list aligned with fetchAllForBackup's cols so a backup → restore
  // round-trip doesn't silently drop collections.
  const cols = [
    'clients', 'employees', 'services', 'appointments', 'receipts',
    'giftCards', 'promoCodes', 'bonuses', 'payrollRuns', 'taxForms',
    'campaigns', 'campaignTemplates', 'chats',
    'reviews', 'reviewReceived', 'reviewRequests',
    'meetings', 'timeOff', 'attendance', 'waitlist',
    'memberships', 'membershipPlans',
    'products', 'handbookSigs', 'logs', 'feedback',
  ];
  const SIZE = 450;
  // Batched per-collection restore. Without this, a 12k-doc tenant would
  // restore in ~15 min (same root-cause as the seed-flow bottleneck);
  // batched is ~30 seconds.
  for (const col of cols) {
    const items = data[col];
    if (!Array.isArray(items) || items.length === 0) continue;
    let written = 0;
    for (let i = 0; i < items.length; i += SIZE) {
      const chunk = items.slice(i, i + SIZE);
      const batch = writeBatch(db);
      for (const item of chunk) {
        const { _id, ...docData } = item;
        if (_id) batch.set(doc(tenantCol(col), _id), docData);
      }
      await batch.commit();
      written += chunk.length;
      onProgress?.(`${col}: ${written.toLocaleString()} / ${items.length.toLocaleString()}`);
    }
  }
  // Settings docs + employee comp can all share a single batch — there
  // are only ~10 settings + however many employees with comp (~10-20).
  // Well under the 500-op limit.
  const settingsPaths = [
    'slides', 'settings', 'users', 'usersFull', 'settingsPrivate',
    'handbook', 'webfront', 'bookingConfig',
  ];
  const tailBatch = writeBatch(db);
  let tailOps = 0;
  for (const p of settingsPaths) {
    const val = data['_' + p];
    if (val) { tailBatch.set(tenantDoc(p), val); tailOps++; }
  }
  if (data._employeeComp && typeof data._employeeComp === 'object') {
    for (const [empId, comp] of Object.entries(data._employeeComp)) {
      if (empId && comp && typeof comp === 'object') {
        tailBatch.set(doc(tenantCol('employees'), empId, 'private', 'comp'), comp);
        tailOps++;
      }
    }
  }
  if (tailOps > 0) {
    await tailBatch.commit();
    onProgress?.(`Settings + comp: ${tailOps} docs`);
  }
}

// ── Online booking config (publicly readable) ─────────
const BOOKING_CONFIG_REF = tenantDoc('bookingConfig');

export async function fetchBookingConfig() {
  const snap = await getDoc(BOOKING_CONFIG_REF);
  return snap.exists() ? snap.data() : { enabled: false };
}

export async function saveBookingConfig(data) {
  await setDoc(BOOKING_CONFIG_REF, { ...data, updatedAt: new Date().toISOString() });
}

// ── Client chat ────────────────────────────────────────
// One document per client (keyed by clientId). Messages stored as an array.
const CHATS_COL = tenantCol('chats');

export function subscribeToChats(cb) {
  const q = query(CHATS_COL, orderBy('lastAt', 'desc'));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export function subscribeToChat(clientId, cb) {
  return onSnapshot(doc(CHATS_COL, clientId), snap => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  });
}

export async function sendChatMessage(clientId, clientInfo, message) {
  const now = new Date().toISOString();
  const chatRef = doc(CHATS_COL, clientId);
  const snap = await getDoc(chatRef);
  const existingUnread = snap.exists() ? (snap.data().unreadStaff || 0) : 0;
  if (!snap.exists()) {
    await setDoc(chatRef, {
      clientId,
      clientName:  clientInfo.name  || 'Client',
      clientEmail: clientInfo.email || '',
      messages:    [message],
      lastMessage: message.text,
      lastAt:      now,
      unreadStaff: message.from === 'client' ? 1 : 0,
      updatedAt:   now,
    });
  } else {
    const updates = {
      messages:    arrayUnion(message),
      lastMessage: message.text,
      lastAt:      now,
      updatedAt:   now,
    };
    if (message.from === 'client') updates.unreadStaff = increment(1);
    else                           updates.unreadStaff = 0;
    await updateDoc(chatRef, updates);
  }
  // Notify admins the first time a client sends unread messages in a session
  if (message.from === 'client' && existingUnread === 0) {
    await addDoc(tenantCol('chatNotifications'), {
      clientId,
      clientName:  clientInfo.name  || 'Client',
      clientEmail: clientInfo.email || '',
      preview:     message.text,
      createdAt:   now,
    }).catch(() => {});
  }
}

export async function markChatRead(clientId) {
  const snap = await getDoc(doc(CHATS_COL, clientId));
  if (snap.exists()) await updateDoc(doc(CHATS_COL, clientId), { unreadStaff: 0 });
}

// Outbound SMS to a client. Goes through the sendDirectSms callable which
// dispatches via Twilio + appends the message to chats/{clientId}.
export async function sendSmsToClient(clientId, body) {
  const fn = callFn('sendDirectSms');
  const res = await fn({ tenantId: TENANT_ID, clientId, body });
  return res?.data || { ok: true };
}

// Outbound email to a client. Same shape as sendSmsToClient but goes via
// AWS SES and adds the message to the chats thread with channel='email'.
export async function sendEmailToClient(clientId, subject, body) {
  const fn = callFn('sendDirectEmail');
  const res = await fn({ tenantId: TENANT_ID, clientId, subject, body });
  return res?.data || { ok: true };
}

// Live subscription on a single gift card doc — used by GiftCardsAdmin
// to show emailStatus updates in real time as the Cloud Function works.
export function subscribeToGiftCard(cardId, cb) {
  return onSnapshot(doc(GIFT_CARDS_COL, cardId), s => cb(s.exists() ? { id: s.id, ...s.data() } : null));
}

// Manual retry of the gift card email. Calls the retryGiftCardEmail
// callable which resets the status and re-runs the send.
export async function retryGiftCardEmail(cardId) {
  const fn = callFn('retryGiftCardEmail');
  const res = await fn({ tenantId: TENANT_ID, cardId });
  return res?.data || { ok: true };
}

// ── SMS / TFN provisioning (multi-tenant) ──────────────
// Buys a Toll-Free number for this tenant and submits Twilio Toll-Free
// Verification on their behalf. Backend: provisionTenantSMS in
// functions/index.js. Idempotent — re-calling while in flight returns
// the existing state.
export async function provisionTenantSMS(form, areaCode) {
  const fn = callFn('provisionTenantSMS');
  const res = await fn({ tenantId: TENANT_ID, form, areaCode });
  return res?.data || {};
}

// Releases the TFN back to Twilio (stops $2/mo) and tombstones data/sms.
// Used on Pro→Solo downgrade or when the tenant explicitly turns SMS off.
export async function releaseTenantSMS() {
  const fn = callFn('releaseTenantSMS');
  const res = await fn({ tenantId: TENANT_ID });
  return res?.data || {};
}

// Live subscription on the SMS provisioning state. The wizard uses this
// to show pending_twilio → pending_carrier → approved transitions
// without polling.
export function subscribeTenantSms(cb) {
  return onSnapshot(tenantDoc('sms'), s => cb(s.exists() ? s.data() : null));
}

// Live subscription on the tenant registry doc (tenants/{TENANT_ID}).
// Surfaces sandboxMode + other tenant-level flags to the salon app.
// Sandbox-by-default: a tenant whose doc lacks an explicit
// sandboxMode=false is treated as sandbox (matches Cloud Function
// isSandboxTenant convention).
export function subscribeTenantRegistry(cb) {
  return onSnapshot(doc(db, 'tenants', TENANT_ID), s => {
    if (!s.exists()) { cb({ sandboxMode: true }); return; }
    const d = s.data() || {};
    cb({ ...d, sandboxMode: d.sandboxMode !== false });
  });
}

// Live subscription on the sandbox SMS inbox. Returns the most recent
// entries (capped) in reverse-chronological order. Used by the
// Marketing → SMS Test Mode panel.
export function subscribeSandboxSmsLog(cb, max = 100) {
  const ref = query(
    collection(db, 'tenants', TENANT_ID, 'sandboxSmsLog'),
    orderBy('at', 'desc'),
    limit(max),
  );
  return onSnapshot(ref, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

// Purge every sandboxSmsLog row for this tenant. Owner-triggered from
// the SMS Test Mode panel when the inbox is too cluttered.
export async function purgeSandboxSmsLog() {
  const snap = await getDocs(collection(db, 'tenants', TENANT_ID, 'sandboxSmsLog'));
  if (snap.empty) return 0;
  // Firestore batches max 500 ops. Chunk if there's a lot.
  const refs = snap.docs.map(d => d.ref);
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach(r => batch.delete(r));
    await batch.commit();
  }
  return refs.length;
}

export async function fetchTenantSms() {
  const s = await getDoc(tenantDoc('sms'));
  return s.exists() ? s.data() : null;
}

// ── Review received tracking ───────────────────────────
const REVIEW_RECEIVED_COL = tenantCol('reviewReceived');

export async function saveReviewReceived(data) {
  return addDoc(REVIEW_RECEIVED_COL, { ...data, createdAt: new Date().toISOString() });
}

export async function fetchReviewReceived() {
  const snap = await getDocs(query(REVIEW_RECEIVED_COL, orderBy('createdAt', 'desc'), limit(100)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Tax forms (1099-NEC) ───────────────────────────────
const TAX_FORMS_COL = tenantCol('taxForms');

export async function fetchTaxForms() {
  const snap = await getDocs(query(TAX_FORMS_COL, orderBy('year', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchTaxFormsByEmail(email) {
  const snap = await getDocs(query(TAX_FORMS_COL, where('techEmail', '==', email), orderBy('year', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function upsertTaxForm(year, techName, data) {
  const id = `${year}_${techName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  await setDoc(doc(TAX_FORMS_COL, id), { ...data, year, techName, updatedAt: new Date().toISOString() }, { merge: true });
  return id;
}

export async function deleteTaxForm(id) {
  return deleteDoc(doc(TAX_FORMS_COL, id));
}

export async function fetchPayrollRunsForYear(year) {
  const start = `${year}-01-01`;
  const end   = `${year}-12-31`;
  const snap  = await getDocs(query(PAYROLL_COL,
    where('endDate', '>=', start),
    where('endDate', '<=', end),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Tenant registry (root-level, super-admin only) ────
export async function fetchTenants() {
  const snap = await getDocs(query(collection(db, 'tenants'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Subdomain schema (per principle #11 + plumenexus/SUBDOMAIN-CHANGE-DESIGN.md):
// every new tenant gets `subdomain` (current primary), `aliases` (every previous
// subdomain, kept forever for 301 redirects), `subdomainChangedAt`, and
// `subdomainChangeCount` baked in. Doc id never changes; only `subdomain` does.
export async function createTenantRecord(id, data) {
  const slug = String(id).toLowerCase().trim();
  await setDoc(doc(db, 'tenants', slug), {
    ...data,
    subdomain:            slug,
    aliases:              [],
    subdomainChangedAt:   null,
    subdomainChangeCount: 0,
    createdAt:            new Date().toISOString(),
  });
}

export async function updateTenantRecord(id, data) {
  await setDoc(doc(db, 'tenants', id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

// Single tenant registry doc — surfaces subdomain + aliases for the
// Settings → Your Salon URL panel.
export async function fetchTenantRecord(id) {
  const snap = await getDoc(doc(db, 'tenants', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Seeds the minimum Firestore docs a new tenant needs to function.
// Safe to call multiple times — skips if already provisioned.
export async function provisionNewTenant(tenantId, ownerEmail, salonName) {
  const settingsRef = doc(db, 'tenants', tenantId, 'data', 'settings');
  const existing    = await getDoc(settingsRef);
  if (existing.exists()) return false; // already provisioned

  const now = new Date().toISOString();
  await Promise.all([
    setDoc(settingsRef, { timeoutMin: 5, createdAt: now }),
    setDoc(doc(db, 'tenants', tenantId, 'data', 'slides'), { slides: [], def: 0, cur: 0 }),
    setDoc(doc(db, 'tenants', tenantId, 'data', 'users'), {
      users: ownerEmail
        ? [{ email: ownerEmail, role: 'admin', uid: '', addedAt: now }]
        : [],
    }),
  ]);
  return true;
}

// Returns lightweight stats for the tenant management dashboard.
export async function fetchTenantStats(tenantId) {
  const [usersResult, apptResult] = await Promise.allSettled([
    getDoc(doc(db, 'tenants', tenantId, 'data', 'users')),
    getDocs(query(collection(db, 'tenants', tenantId, 'appointments'), limit(3))),
  ]);
  const provisioned = usersResult.status === 'fulfilled' && usersResult.value.exists();
  const userCount   = provisioned ? (usersResult.value.data().users?.length ?? 0) : 0;
  const apptCount   = apptResult.status === 'fulfilled' ? apptResult.value.size : 0;
  return { provisioned, userCount, apptCount };
}

// ── Webfront config (publicly readable) ───────────────
const WEBFRONT_CONFIG_REF = tenantDoc('webfront');

export async function fetchWebfrontConfig() {
  const snap = await getDoc(WEBFRONT_CONFIG_REF);
  return snap.exists() ? snap.data() : {};
}

// Live-subscribe to webfront config. Used by the public homepage so that
// edits in Admin (hours, copy, photos) reflect on the public page without
// a manual refresh. Returns an unsubscribe function.
export function subscribeWebfrontConfig(cb) {
  return onSnapshot(WEBFRONT_CONFIG_REF, snap => {
    cb(snap.exists() ? snap.data() : {});
  });
}

export async function saveWebfrontConfig(data) {
  await setDoc(WEBFRONT_CONFIG_REF, { ...data, updatedAt: new Date().toISOString() });
}

// Merge-only write — patch a subset of webfront fields without wiping
// the rest. Use when one feature (e.g. Schedule's storeHours → website
// mirror) needs to update a few fields and shouldn't clobber others.
export async function patchWebfrontConfig(partial) {
  await setDoc(WEBFRONT_CONFIG_REF, { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

// Resize an image File/Blob to a width-capped JPEG Blob (for Storage uploads).
// Returns a Blob, not a data URL — the resizeImg helper in utils/helpers.js
// returns a data URL and would force a costly base64 round-trip here.
async function imageToJpegBlob(file, maxW = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('decode failed: ' + file.name));
      i.src = url;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxW) { h = Math.round(h * (maxW / w)); w = maxW; }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
  } finally { URL.revokeObjectURL(url); }
}

// Upload a portfolio photo to Storage at tenants/{tid}/portfolio/{file}.
// Returns the public download URL — caller pushes it into
// webfront.portfolioUploads + cfg.portfolio. Resizes to 1600w@82% JPEG
// before upload; a 4MB phone shot lands at ~250KB.
export async function uploadPortfolioPhoto(file) {
  const { storage } = await import('./firebase.js');
  const { ref, uploadBytes, getDownloadURL } = await import('firebase/storage');
  const blob = await imageToJpegBlob(file, 1600, 0.82);
  const ts   = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `tenants/${TENANT_ID}/portfolio/${ts}-${rand}.jpg`;
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(r);
}

// Convert settings.storeHours ({ Mon: { open:'10:00', close:'19:00', closed:false }, … })
// to the webfront.hours dict shape ({ mon: '10am – 7pm' | 'Closed', … })
// that the public site reads. Empty open-time is treated as Closed.
export function storeHoursToWebfrontHours(storeHours) {
  if (!storeHours || typeof storeHours !== 'object') return {};
  const DAY_MAP = { Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat', Sun:'sun' };
  function fmt12(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return '';
    const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (Number.isNaN(h) || Number.isNaN(min)) return '';
    const ampm = h >= 12 ? 'pm' : 'am';
    h = h % 12 || 12;
    return min === 0 ? `${h}${ampm}` : `${h}:${String(min).padStart(2,'0')}${ampm}`;
  }
  function rangeFromDay(day) {
    if (!day || day.closed) return 'Closed';
    const open  = fmt12(day.open);
    const close = fmt12(day.close);
    if (!open) return 'Closed';
    if (!close) return `Opens ${open}`;
    return `${open} – ${close}`;
  }
  const out = {};
  for (const [src, dst] of Object.entries(DAY_MAP)) out[dst] = rangeFromDay(storeHours[src]);
  return out;
}

// ── Google Reviews cache (populated by Cloud Function) ─
export async function fetchGoogleReviews() {
  const snap = await getDoc(tenantDoc('googleReviews'));
  return snap.exists() ? snap.data() : null;
}
export function subscribeGoogleReviews(callback) {
  return onSnapshot(tenantDoc('googleReviews'), s => callback(s.exists() ? s.data() : null));
}
export async function refreshGoogleReviewsCache(placeId) {
  const res = await callFn('refreshGoogleReviews')({ tenantId: TENANT_ID, placeId });
  return res.data;
}

// ── Google Business Profile OAuth + full review sync ────
export function subscribeGoogleBusinessAuth(callback) {
  return onSnapshot(tenantDoc('googleBusinessAuth'), s => callback(s.exists() ? s.data() : null));
}
export async function startGoogleBusinessAuth() {
  const res = await callFn('startGoogleBusinessAuth')({ tenantId: TENANT_ID });
  return res.data;
}
export async function syncGoogleBusinessReviews() {
  const res = await callFn('syncGoogleBusinessReviews')({ tenantId: TENANT_ID });
  return res.data;
}
export async function disconnectGoogleBusiness() {
  const res = await callFn('disconnectGoogleBusiness')({ tenantId: TENANT_ID });
  return res.data;
}
export function subscribeGoogleReviewsLog(callback) {
  return onSnapshot(tenantCol('googleReviewsLog'), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ── Competitor ranking (populated by nearbyNailSalons CF) ─
export async function fetchCompetitorRankings() {
  const snap = await getDoc(tenantDoc('competitorRankings'));
  return snap.exists() ? snap.data() : null;
}
export function subscribeCompetitorRankings(callback) {
  return onSnapshot(tenantDoc('competitorRankings'), s => callback(s.exists() ? s.data() : null));
}
export async function refreshCompetitorRankings({ address, lat, lng, radiusMiles }) {
  const res = await callFn('nearbyNailSalons')({ tenantId: TENANT_ID, address, lat, lng, radiusMiles });
  return res.data;
}
export async function findBusinessByAddress(address) {
  const res = await callFn('findBusinessByAddress')({ tenantId: TENANT_ID, address });
  return res.data;
}

// ── Walk-in / arrival queue ────────────────────────────
const WAITLIST_COL = tenantCol('waitlist');

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function addToWaitlist(data) {
  return addDoc(WAITLIST_COL, { ...data, date: todayDateStr(), addedAt: new Date().toISOString(), status: 'waiting' });
}

export async function fetchTodayQueue() {
  const snap = await getDocs(query(WAITLIST_COL, where('date', '==', todayDateStr()), orderBy('addedAt', 'asc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export function subscribeQueue(date, callback) {
  return onSnapshot(
    query(WAITLIST_COL, where('date', '==', date), orderBy('addedAt', 'asc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
}

export async function updateWaitlistEntry(id, data) {
  await updateDoc(doc(db, 'tenants', TENANT_ID, 'waitlist', id), { ...data, updatedAt: new Date().toISOString() });
}

export async function removeWaitlistEntry(id) {
  await deleteDoc(doc(db, 'tenants', TENANT_ID, 'waitlist', id));
}
