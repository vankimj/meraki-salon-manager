import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, arrayUnion, increment, deleteField, writeBatch,
} from 'firebase/firestore';
import { db, callFn, auth } from './firebase';
import { getCurrentTenant } from './currentTenant';
import { buildStaffEmails, buildAdminEmails, buildScheduleViewOnlyEmails } from './userProjections';

// tenantCol/tenantDoc read getCurrentTenant() at CALL time so a tenant
// switch in Profile re-routes subsequent queries without rebinding any
// module-level state. The old hardcoded TENANT_ID export still exists
// on firebase.js for the few places that import it directly (push
// registration). Those are migrated below.
const tenantCol = (path) => collection(db, 'tenants', getCurrentTenant(), path);
const tenantDoc = (path) => doc(db, 'tenants', getCurrentTenant(), 'data', ...path.split('/'));

// ── Soft-delete (data defense) ─────────────────────────
// Mirrors the web softDelete (src/lib/firestore.js): writes a tombstone
// instead of a hard delete so records land in the web Trash, stay in the
// BQ mirror, and auto-purge after 30 days. Every read MUST drop
// tombstoned docs via notTombstoned, or soft-deleted rows reappear.
const notTombstoned = (d) => d._deleted !== true;
function softDelete(ref, by) {
  return updateDoc(ref, {
    _deleted:   true,
    _deletedAt: new Date().toISOString(),
    _deletedBy: by || auth?.currentUser?.email || null,
  });
}

// ── Appointments ───────────────────────────────────────
export async function fetchAppointments(date) {
  const snap = await getDocs(query(tenantCol('appointments'), where('date', '==', date)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

// Live subscription — fires on every Firestore change. Used by Schedule
// so the tech sees status flips made on the iPad checkout immediately.
// On permission-denied / network errors we still call the success cb
// with an empty list so the screen can drop its loading state instead
// of spinning forever.
export function subscribeAppointments(date, cb) {
  const q = query(tenantCol('appointments'), where('date', '==', date));
  return onSnapshot(q, (snap) => {
    const list = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(notTombstoned)
      .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
    cb(list);
  }, (err) => {
    console.warn('[firestore] subscribeAppointments error:', err?.message);
    cb([]);
  });
}

export async function createAppointment(data) {
  const ref = await addDoc(tenantCol('appointments'), {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateAppointment(id, data) {
  await setDoc(doc(tenantCol('appointments'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export async function setAppointmentStatus(id, status) {
  await updateAppointment(id, { status });
}

export async function checkInAppointment(id) {
  // Single-shot null→string transition is what the rule allows for
  // public callers; staff (this app) can update freely. We still write
  // the same shape so the tech-app behavior matches the web.
  await updateAppointment(id, { checkedInAt: new Date().toISOString() });
}

export async function setAppointmentNotes(id, notes) {
  await updateAppointment(id, { notes });
}

// Soft-delete an appointment (tombstone). `by` is the acting user's
// email for the audit trail. Reads filter these out via notTombstoned;
// the web Admin → Trash can restore them within 30 days.
export async function softDeleteAppointment(id, by) {
  await updateDoc(doc(tenantCol('appointments'), id), {
    _deleted:   true,
    _deletedAt: new Date().toISOString(),
    _deletedBy: by || auth?.currentUser?.email || null,
    updatedAt:  new Date().toISOString(),
  });
}

// Back-compat alias — repurposed from the old HARD delete to the soft
// path so nothing in the app ever bypasses the data-defense system.
export async function deleteAppointment(id, by) {
  return softDeleteAppointment(id, by);
}

// ── Clients ────────────────────────────────────────────
export async function fetchClients() {
  const snap = await getDocs(query(tenantCol('clients'), orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchClient(id) {
  const snap = await getDoc(doc(tenantCol('clients'), id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function createClient(data) {
  const ref = await addDoc(tenantCol('clients'), {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function saveClient(id, data) {
  await setDoc(doc(tenantCol('clients'), id),
    { ...data, updatedAt: new Date().toISOString() },
    { merge: true });
}

// Pull a client's appointment history. Same query the web ClientsAdmin
// uses — appointments where clientId matches. Sorted newest first.
export async function fetchClientAppointments(clientId) {
  if (!clientId) return [];
  const snap = await getDocs(query(tenantCol('appointments'), where('clientId', '==', clientId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => `${b.date} ${b.startTime}`.localeCompare(`${a.date} ${a.startTime}`));
}

// ── Employees ─────────────────────────────────────────
export async function fetchEmployees() {
  const snap = await getDocs(query(tenantCol('employees'), orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Save editable fields on an employee doc. The Firestore rule for
// employees/{id} requires admin to write the parent doc, so techs
// can't actually persist self-edits today — we still ship the call
// here and mock-update locally. A future rules change will let a tech
// update their OWN doc (matched by email) for the editable fields,
// which keeps comp data in employees/{id}/private/comp (admin-only).
export async function saveEmployee(id, data) {
  await setDoc(doc(tenantCol('employees'), id),
    { ...data, updatedAt: new Date().toISOString() },
    { merge: true });
}

// Look up the current user's employee record by email (employees doc
// is publicly readable, so this works without admin access). Returns
// null if no employee matches the email — e.g. for admins who don't
// double as a tech.
export async function fetchEmployeeByEmail(email) {
  if (!email) return null;
  const e = String(email).toLowerCase().trim();
  // Try indexed field 'email' first; fall back to scan if your data
  // hasn't been backfilled with lowercase email.
  try {
    const snap = await getDocs(query(tenantCol('employees'), where('email', '==', e)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {}
  const all = await fetchEmployees();
  return all.find(emp => (emp.email || '').toLowerCase().trim() === e) || null;
}

// ── Receipts (for earnings) ───────────────────────────
export async function fetchReceiptsByRange(startDate, endDate) {
  // Inclusive range on the `date` field (YYYY-MM-DD). Sort client-side
  // because where + orderBy on different fields needs a composite index.
  const snap = await getDocs(query(
    tenantCol('receipts'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

export async function fetchAppointmentsByRange(startDate, endDate) {
  const snap = await getDocs(query(
    tenantCol('appointments'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// Time off — used by ScheduleScreen to mark days where the tech is
// out so the gap calculator skips them entirely. Same shape as the
// web fetchTimeOff: each entry has { techName, startDate, endDate, ... }.
export async function fetchTimeOff() {
  const snap = await getDocs(tenantCol('timeOff'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
}
export async function createTimeOff(data) {
  const ref = await addDoc(tenantCol('timeOff'), {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function deleteTimeOff(id) {
  await deleteDoc(doc(tenantCol('timeOff'), id));
}

// ── Services ───────────────────────────────────────────
export async function fetchServices() {
  const snap = await getDocs(query(tenantCol('services'), orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}
export async function createService(data) {
  const ref = await addDoc(tenantCol('services'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveService(id, data) {
  await setDoc(doc(tenantCol('services'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteService(id) {
  await softDelete(doc(tenantCol('services'), id));
}

// ── Settings ───────────────────────────────────────────
export async function fetchSettings() {
  const snap = await getDoc(tenantDoc('settings'));
  return snap.exists() ? snap.data() : {};
}

// ── Client chat ───────────────────────────────────────
// One document per client at chats/{clientId}; messages stored as an
// array on the doc (matches the web Chat module's data model).
const CHATS_COL = tenantCol('chats');

export function subscribeToChats(cb) {
  const q = query(CHATS_COL, orderBy('lastAt', 'desc'));
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => {
    console.warn('[firestore] subscribeToChats error:', err?.message);
    cb([]);
  });
}

export function subscribeToChat(clientId, cb) {
  return onSnapshot(doc(CHATS_COL, clientId), (snap) => {
    cb(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => {
    console.warn('[firestore] subscribeToChat error:', err?.message);
    cb(null);
  });
}

export async function sendChatMessage(clientId, clientInfo, message) {
  const now = new Date().toISOString();
  const chatRef = doc(CHATS_COL, clientId);
  const snap = await getDoc(chatRef);
  if (!snap.exists()) {
    await setDoc(chatRef, {
      clientId,
      clientName:  clientInfo?.name  || 'Client',
      clientEmail: clientInfo?.email || '',
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
}

export async function markChatRead(clientId) {
  try {
    await updateDoc(doc(CHATS_COL, clientId), { unreadStaff: 0 });
  } catch {}
}

// Outbound SMS / Email — wraps the same sendDirectSms / sendDirectEmail
// Cloud Functions the web ChatAdmin uses. Server-side appends to the
// chats thread with channel='sms' or channel='email' so the conversation
// stays in one place regardless of which channel was used.
export async function sendSmsToClient(clientId, body) {
  const res = await callFn('sendDirectSms')({ tenantId: getCurrentTenant(), clientId, body });
  return res?.data || { ok: true };
}
export async function sendEmailToClient(clientId, subject, body) {
  const res = await callFn('sendDirectEmail')({ tenantId: getCurrentTenant(), clientId, subject, body });
  return res?.data || { ok: true };
}

// ── Products (Studio, admin) ───────────────────────────
export async function fetchProducts() {
  const snap = await getDocs(tenantCol('products'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export async function createProduct(data) {
  const ref = await addDoc(tenantCol('products'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveProduct(id, data) {
  await setDoc(doc(tenantCol('products'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteProduct(id) {
  await softDelete(doc(tenantCol('products'), id));
}

// ── Attendance (Studio, admin) — one doc per YYYY-MM-DD ─
export async function fetchAttendance(dateKey) {
  const snap = await getDoc(doc(tenantCol('attendance'), dateKey));
  return snap.exists() ? { id: snap.id, ...snap.data() } : { id: dateKey, date: dateKey, entries: [] };
}
export async function saveAttendance(dateKey, entries) {
  await setDoc(doc(tenantCol('attendance'), dateKey),
    { date: dateKey, entries, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── Gift cards + promo codes (Studio, admin) ───────────
export async function fetchGiftCards() {
  const snap = await getDocs(tenantCol('giftCards'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export async function createGiftCard(data) {
  const ref = await addDoc(tenantCol('giftCards'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function updateGiftCard(id, data) {
  await setDoc(doc(tenantCol('giftCards'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteGiftCard(id) {
  await softDelete(doc(tenantCol('giftCards'), id));
}
export async function fetchPromoCodes() {
  const snap = await getDocs(tenantCol('promoCodes'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export async function createPromoCode(data) {
  const ref = await addDoc(tenantCol('promoCodes'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function savePromoCode(id, data) {
  await setDoc(doc(tenantCol('promoCodes'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deletePromoCode(id) {
  await softDelete(doc(tenantCol('promoCodes'), id));
}

// ── Memberships (Pro, admin) ───────────────────────────
export async function fetchMembershipPlans() {
  const snap = await getDocs(tenantCol('membershipPlans'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}
export async function createMembershipPlan(data) {
  const ref = await addDoc(tenantCol('membershipPlans'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveMembershipPlan(id, data) {
  await setDoc(doc(tenantCol('membershipPlans'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteMembershipPlan(id) {
  await softDelete(doc(tenantCol('membershipPlans'), id));
}
export async function fetchMemberships() {
  const snap = await getDocs(tenantCol('memberships'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || ''));
}
export async function createMembership(data) {
  const ref = await addDoc(tenantCol('memberships'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function saveMembership(id, data) {
  await setDoc(doc(tenantCol('memberships'), id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function deleteMembership(id) {
  await softDelete(doc(tenantCol('memberships'), id));
}

// ── Trash / restore (mirrors web src/lib/firestore.js) ─────────────────
// Each soft-delete collection's path == its key under tenantCol. The 4
// BQ-mirrored collections restore losslessly via the restoreDocFromBQ
// Cloud Function; the rest un-tombstone in place via clearTombstone.
const SOFT_DELETED_COLLECTIONS = [
  { key: 'clients',         restorable: true  },
  { key: 'appointments',    restorable: true  },
  { key: 'receipts',        restorable: true  },
  { key: 'employees',       restorable: true  },
  { key: 'memberships',     restorable: false },
  { key: 'giftCards',       restorable: false },
  { key: 'services',        restorable: false },
  { key: 'bonuses',         restorable: false },
  { key: 'membershipPlans', restorable: false },
  { key: 'timeOff',         restorable: false },
  { key: 'promoCodes',      restorable: false },
  { key: 'reviews',         restorable: false },
  { key: 'meetings',        restorable: false },
  { key: 'products',        restorable: false },
  { key: 'campaigns',       restorable: false },
];

// `collections` (optional) scopes to specific keys for per-module/calendar
// trash; omit for the global Admin trash. Single-field `_deleted` index —
// no composite needed. Failing collections are skipped, not fatal.
export async function fetchRecentlyDeleted({ maxPerCollection = 50, collections = null } = {}) {
  const targets = collections
    ? SOFT_DELETED_COLLECTIONS.filter(s => collections.includes(s.key))
    : SOFT_DELETED_COLLECTIONS;
  const results = await Promise.all(targets.map(async ({ key, restorable }) => {
    try {
      const snap = await getDocs(query(tenantCol(key), where('_deleted', '==', true), limit(maxPerCollection)));
      return snap.docs.map(d => ({ id: d.id, collection: key, restorable, ...d.data() }));
    } catch (e) {
      console.warn(`[fetchRecentlyDeleted] ${key} failed:`, e?.code || e?.message);
      return [];
    }
  }));
  return results.flat().sort((a, b) => (b._deletedAt || '').localeCompare(a._deletedAt || ''));
}

// Un-tombstone in place (non-BQ collections). Admin-only via rules.
export async function clearTombstone(collectionKey, docId) {
  if (!SOFT_DELETED_COLLECTIONS.some(s => s.key === collectionKey)) {
    throw new Error(`Collection "${collectionKey}" not in soft-delete allowlist`);
  }
  await updateDoc(doc(tenantCol(collectionKey), docId), {
    _deleted:    deleteField(),
    _deletedAt:  deleteField(),
    _deletedBy:  deleteField(),
    _restoredAt: new Date().toISOString(),
  });
}

// Lossless restore from the BigQuery mirror (clients/appointments/receipts/
// employees) via the existing Cloud Function.
export async function restoreDocFromBQ(collectionKey, docId, snapshotTimestamp) {
  const res = await callFn('restoreDocFromBQ')({
    tenantId: getCurrentTenant(), collection: collectionKey, docId, snapshotTimestamp,
  });
  return res?.data || { restored: false };
}

// ── Admin (mobile) ─────────────────────────────────────
// Activity log — same shape as web logActivity (timestamp/email/name/
// action/details). Admin-only read via rules.
export async function fetchLogs(n = 100) {
  const snap = await getDocs(query(tenantCol('logs'), orderBy('timestamp', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Merge-update tenant settings (data/settings). Mirrors the web
// updateSettings — only the passed keys change.
export async function updateSettings(payload) {
  await setDoc(tenantDoc('settings'), { ...payload, updatedAt: new Date().toISOString() }, { merge: true });
}

// Rich users[] from data/usersFull (admin-only doc). Read-only on mobile
// for now; role edits stay on web until the projection writeBatch is ported.
export async function fetchUsersFull() {
  const snap = await getDoc(tenantDoc('usersFull'));
  return snap.exists() ? (snap.data().users || []) : [];
}

// Integrity report (nightly scanner). Read-only.
export async function fetchIntegrityReport() {
  try { const snap = await getDoc(tenantDoc('integrityReport')); return snap.exists() ? snap.data() : null; }
  catch { return null; }
}

// In-app feedback (bug/idea) submitted by staff. Admin triage.
export async function fetchFeedback() {
  const snap = await getDocs(query(tenantCol('feedback'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function updateFeedbackStatus(id, status) {
  await updateDoc(doc(tenantCol('feedback'), id), { status, updatedAt: new Date().toISOString() });
}

// ── Employees — PUBLIC fields only on mobile ───────────
// Comp/payroll lives in employees/{id}/private/comp and is written via a
// writeBatch split on web (data-integrity). Mobile intentionally edits
// only the public doc (name/contact/social/active) — never comp.
export async function createEmployee(data) {
  const ref = await addDoc(tenantCol('employees'), {
    ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function deleteEmployee(id) {
  await softDelete(doc(tenantCol('employees'), id));
}

// ── Meetings (Studio, admin) ───────────────────────────
export async function fetchMeetings() {
  const snap = await getDocs(tenantCol('meetings'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned)
    .sort((a, b) => (b.startTimestamp || b.createdAt || '').localeCompare(a.startTimestamp || a.createdAt || ''));
}
export async function createMeeting(data) {
  const ref = await addDoc(tenantCol('meetings'), {
    ...data, reminders: { sent60: false, sent15: false },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  return ref.id;
}
export async function updateMeeting(id, data) {
  await updateDoc(doc(tenantCol('meetings'), id), { ...data, updatedAt: new Date().toISOString() });
}
export async function deleteMeeting(id) {
  await softDelete(doc(tenantCol('meetings'), id));
}

// ── Admin read tabs (Notifs / Reviews / Onboarding) ────
export async function fetchNotifications(n = 150) {
  const snap = await getDocs(query(tenantCol('notifications'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function fetchReviewRequests(n = 200) {
  const snap = await getDocs(query(tenantCol('reviewRequests'), orderBy('createdAt', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
export async function fetchReviewReceived() {
  const snap = await getDocs(tenantCol('reviewReceived'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}
export async function fetchOnboarding() {
  const snap = await getDoc(tenantDoc('onboarding'));
  return snap.exists() ? snap.data() : null;
}

// ── Walk-in kiosk: turn roster (doc per day) + waitlist ─
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export async function fetchTurnRoster(date = todayKey()) {
  const snap = await getDoc(doc(tenantCol('turnRoster'), date));
  return snap.exists() ? { date, ...snap.data() } : { date, roster: [] };
}
export async function saveTurnRoster(date, roster) {
  await setDoc(doc(tenantCol('turnRoster'), date), { date, roster, updatedAt: new Date().toISOString() });
}
export async function fetchWaitlist(date = todayKey()) {
  const snap = await getDocs(query(tenantCol('waitlist'), where('date', '==', date)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
}
export async function addWaitlistEntry(data) {
  const ref = await addDoc(tenantCol('waitlist'), {
    ...data, date: todayKey(), addedAt: new Date().toISOString(), status: 'waiting',
  });
  return ref.id;
}
export async function updateWaitlistEntry(id, data) {
  await updateDoc(doc(tenantCol('waitlist'), id), { ...data, updatedAt: new Date().toISOString() });
}
export async function removeWaitlistEntry(id) {
  await deleteDoc(doc(tenantCol('waitlist'), id));
}

// ── HR: bonuses / performance reviews / payroll (read) ──
export async function fetchBonuses() {
  const snap = await getDocs(query(tenantCol('bonuses'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}
export async function createBonus(data) {
  const ref = await addDoc(tenantCol('bonuses'), { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}
export async function deleteBonus(id) { await softDelete(doc(tenantCol('bonuses'), id)); }
export async function fetchReviews() {
  const snap = await getDocs(query(tenantCol('reviews'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}
export async function saveReview(id, data) {
  const now = new Date().toISOString();
  if (id) { await setDoc(doc(tenantCol('reviews'), id), { ...data, updatedAt: now }, { merge: true }); return id; }
  const ref = await addDoc(tenantCol('reviews'), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}
export async function deleteReview(id) { await softDelete(doc(tenantCol('reviews'), id)); }
export async function fetchPayrollRuns() {
  const snap = await getDocs(query(tenantCol('payrollRuns'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
// Admin-only: public employee doc + the private/comp sub-doc (commissionPct,
// rateType, gustoId, …) merged. Non-admin callers get public fields only.
export async function fetchEmployeesWithComp() {
  const list = await fetchEmployees();
  await Promise.all(list.map(async emp => {
    try {
      const c = await getDoc(doc(tenantCol('employees'), emp.id, 'private', 'comp'));
      if (c.exists()) Object.assign(emp, c.data());
    } catch { /* non-admin — leave public only */ }
  }));
  return list;
}
export async function createPayrollRun(run) {
  const ref = await addDoc(tenantCol('payrollRuns'), { ...run, status: 'draft', createdAt: new Date().toISOString() });
  return ref.id;
}
// Submit a saved run to Gusto as an off-cycle payroll (existing Cloud Function).
export async function gustoSubmitPayroll(payrollRunId) {
  const res = await callFn('gustoSubmitPayroll')({ tenantId: getCurrentTenant(), payrollRunId });
  return res?.data || {};
}

// ── Demo data (LEAN mobile seeder) ─────────────────────
// A small, safe seed for testing — NOT the web's 600-client batch. All rows
// tagged _demo:true so clearDemoData removes exactly what was seeded.
const DEMO_FIRST = ['Ava', 'Mia', 'Zoe', 'Leah', 'Nora', 'Ivy', 'Ruby', 'Cleo', 'Esme', 'Lila', 'Tara', 'Remy', 'Sage', 'Wren', 'Faye'];
const DEMO_LAST  = ['Park', 'Cole', 'Hayes', 'Reed', 'Lane', 'Frost', 'Vance', 'Quinn', 'Beck', 'Shaw'];
export async function seedDemoData(onProgress) {
  const today = new Date();
  let made = 0;
  for (let i = 0; i < 15; i++) {
    const name = `${DEMO_FIRST[i % DEMO_FIRST.length]} ${DEMO_LAST[i % DEMO_LAST.length]}`;
    const cref = await addDoc(tenantCol('clients'), {
      _demo: true, name,
      phone: `+1614555${String(1000 + i).slice(-4)}`,
      email: `${name.toLowerCase().replace(/\s/g, '.')}@example.com`,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    // ~2 appointments each over the last 20 days
    for (let k = 0; k < 2; k++) {
      const d = new Date(today); d.setDate(d.getDate() - ((i + k) % 20));
      await addDoc(tenantCol('appointments'), {
        _demo: true, clientId: cref.id, clientName: name,
        date: d.toISOString().slice(0, 10),
        startTime: `${10 + (k % 7)}:00`, duration: 60, status: 'done',
        services: [{ name: 'Gel Manicure', price: 45 }],
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      });
    }
    made++;
    onProgress?.(`Seeded ${made}/15 demo clients…`);
  }
  return { clients: made };
}
export async function clearDemoData(onProgress) {
  let removed = 0;
  for (const col of ['appointments', 'clients']) {
    const snap = await getDocs(query(tenantCol(col), where('_demo', '==', true)));
    for (const d of snap.docs) { await deleteDoc(doc(tenantCol(col), d.id)); removed++; onProgress?.(`Removed ${removed} demo records…`); }
  }
  return { removed };
}

// ── Marketing campaigns — DRAFT management only on mobile ──
// Mobile intentionally does NOT schedule/send campaigns (that fires real
// SMS/email to clients via the Cloud Function sweep). Create here lands a
// status:'draft'; scheduling/sending happens on the web app.
export async function fetchCampaigns() {
  const snap = await getDocs(query(tenantCol('campaigns'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}
export async function createCampaignDraft(data) {
  await addDoc(tenantCol('campaigns'), { ...data, status: 'draft', createdAt: new Date().toISOString() });
}
export async function deleteCampaign(id) { await softDelete(doc(tenantCol('campaigns'), id)); }
export async function cancelCampaign(id) {
  const ref = doc(tenantCol('campaigns'), id);
  const snap = await getDoc(ref);
  const cur = snap.exists() ? snap.data() : null;
  const isScheduled = cur?.status === 'scheduled';
  await setDoc(ref, {
    cancelRequested: true, cancelRequestedAt: new Date().toISOString(),
    ...(isScheduled ? { status: 'cancelled', cancelledAt: new Date().toISOString() } : {}),
  }, { merge: true });
}

// ── Webfront (public site) config — business info + hours ──
export async function fetchWebfrontConfig() {
  const snap = await getDoc(tenantDoc('webfront'));
  return snap.exists() ? snap.data() : {};
}
export async function saveWebfrontConfig(partial) {
  await setDoc(tenantDoc('webfront'), { ...partial, updatedAt: new Date().toISOString() }, { merge: true });
}

// ── SMS status (read-only) ─────────────────────────────
export async function fetchSmsStatus() {
  const [smsSnap, tenSnap] = await Promise.all([
    getDoc(tenantDoc('sms')).catch(() => null),
    getDoc(doc(db, 'tenants', getCurrentTenant())).catch(() => null),
  ]);
  const sms = smsSnap?.exists() ? smsSnap.data() : null;
  const ten = tenSnap?.exists() ? tenSnap.data() : {};
  return { sms, sandboxMode: ten.sandboxMode !== false, tfn: ten.tfn || sms?.tfn || null };
}

// ── OAuth connect (mobile) ─────────────────────────────
// Reuses the EXISTING server-side flows: the callable mints a tenant-scoped
// auth URL (server nonce), the web-hosted callback stores the tokens, and we
// re-read the status afterward. No new Cloud Functions / redirect URIs.
export async function getGoogleBusinessAuthUrl() {
  const res = await callFn('startGoogleBusinessAuth')({ tenantId: getCurrentTenant() });
  return res?.data?.authUrl || null;
}
export async function fetchGoogleBusinessAuth() {
  const snap = await getDoc(tenantDoc('googleBusinessAuth'));
  return snap.exists() ? snap.data() : null;
}
export async function getGustoAuthUrl() {
  const res = await callFn('gustoGetAuthUrl')({ tenantId: getCurrentTenant() });
  return res?.data?.url || null;
}
// Gusto connection status lives in settings.gusto (settings.gusto.accessToken).

// ── Marketing SEND (opt-in gated) ──────────────────────
// Build the recipient list with the SAME channel opt-in gating as web
// (marketingOptOut master switch + commPreferences.marketingSms/Email;
// legacy clients without prefs default opted-in). TCPA-sensitive — never
// send to a client who opted out.
export async function buildMarketingRecipients(channel) {
  const clients = await fetchClients();
  const channelOk = (c) => {
    if (c.marketingOptOut) return false;
    const cp = c.commPreferences;
    if (!cp) return true;
    return channel === 'sms' ? cp.marketingSms !== false : cp.marketingEmail !== false;
  };
  return clients
    .filter(c => (channel === 'sms' ? c.phone : c.email) && channelOk(c))
    .map(c => ({ clientId: c.id, name: c.name, email: c.email || null, phone: c.phone || null }));
}
// Create a 'pending' campaign doc → the sendSMSCampaign / sendMarketingCampaign
// onDocumentCreated trigger delivers it. Segment is 'all' (opted-in only).
export async function sendCampaignNow({ name, channel, smsBody, subject, body, recipients }) {
  await addDoc(tenantCol('campaigns'), {
    name, channel,
    smsBody: channel === 'sms'   ? (smsBody || '') : null,
    subject: channel === 'email' ? (subject || '') : null,
    body:    channel === 'email' ? (body || '')    : null,
    segmentType: 'all', segmentParams: {},
    recipients, recipientCount: recipients.length,
    status: 'pending', scheduleAt: null,
    sentCount: 0, failCount: 0,
    createdAt: new Date().toISOString(),
  });
}

// ── Role editing — FAITHFUL port of web saveUsers (writeBatch) ──
// Atomically writes data/usersFull (rich array) + data/users (projections)
// in ONE batch — identical to web src/lib/firestore.js saveUsers. This is
// the fix that prevents the usersFull-missing incident, not the cause.
async function saveUsers(users) {
  const batch = writeBatch(db);
  batch.set(tenantDoc('users'), {
    users:       deleteField(),
    byEmail:     deleteField(),
    staffEmails: buildStaffEmails(users),
    adminEmails: buildAdminEmails(users),
    scheduleViewOnlyEmails: buildScheduleViewOnlyEmails(users),
  }, { merge: true });
  batch.set(tenantDoc('usersFull'), { users }, { merge: true });
  await batch.commit();
}

// Change one user's role/techName/scheduleAccess. Reads the current rich
// array, updates the matching entry, re-projects + writes atomically.
export async function setUserRole(email, role, { techName, scheduleAccess } = {}) {
  const e = String(email || '').toLowerCase();
  const users = await fetchUsersFull();
  let found = false;
  const updated = users.map(u => {
    if ((u.email || '').toLowerCase() !== e) return u;
    found = true;
    return {
      ...u, role,
      techName: techName !== undefined ? techName : (u.techName || null),
      scheduleAccess: scheduleAccess !== undefined ? scheduleAccess : (u.scheduleAccess || 'edit'),
      grantedAt: new Date().toISOString(),
    };
  });
  if (!found) throw new Error('User not found in the access list');
  await saveUsers(updated);
}
