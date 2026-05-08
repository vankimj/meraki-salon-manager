import {
  doc, collection,
  getDoc, getDocs, setDoc, addDoc, deleteDoc, updateDoc,
  orderBy, where, query, limit,
  onSnapshot, arrayUnion, increment, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { TENANT_ID } from './tenant';

// ── Tenant root helpers ────────────────────────────────
// Document refs need even-segment paths; 'data' is the sub-collection that provides the 4th segment.
const tenantDoc = (path) => doc(db, 'tenants', TENANT_ID, 'data', ...path.split('/'));
const tenantCol = (path) => collection(db, 'tenants', TENANT_ID, path);

// ── Refs ───────────────────────────────────────────────
const SLIDES_REF   = tenantDoc('slides');
const USERS_REF    = tenantDoc('users');
const SETTINGS_REF = tenantDoc('settings');
const LOGS_COL     = tenantCol('logs');
const SERVICES_COL = tenantCol('services');

// ── Bootstrap load (slides + users + settings) ─────────
// Uses allSettled so a permission error on users/settings (unauthenticated)
// doesn't block the publicly-readable slides from loading.
export async function loadAll() {
  const [sd, ud, stg] = await Promise.allSettled([
    getDoc(SLIDES_REF),
    getDoc(USERS_REF),
    getDoc(SETTINGS_REF),
  ]);
  const slidesDoc   = sd.status  === 'fulfilled' ? sd.value  : null;
  const usersDoc    = ud.status  === 'fulfilled' ? ud.value  : null;
  const settingsDoc = stg.status === 'fulfilled' ? stg.value : null;
  return {
    slides:        slidesDoc?.exists()   ? (slidesDoc.data().slides       ?? []) : null,
    def:           slidesDoc?.exists()   ? (slidesDoc.data().def          ?? 0)  : 0,
    cur:           slidesDoc?.exists()   ? (slidesDoc.data().cur          ?? 0)  : 0,
    users:         usersDoc?.exists()    ? (usersDoc.data().users         ?? []) : [],
    staffEmails:   usersDoc?.exists()    ? (usersDoc.data().staffEmails   ?? null) : null,
    adminEmails:   usersDoc?.exists()    ? (usersDoc.data().adminEmails   ?? null) : null,
    settings:      settingsDoc?.exists() ? settingsDoc.data()                    : {},
  };
}

// One-time backfill: write the derived `staffEmails`/`adminEmails` arrays
// onto an existing users doc that was created before those fields existed.
// Called silently from AppContext on admin load — admins are the only callers
// with permission to write the users doc, so non-admin invocations are inert.
export async function ensureStaffEmailsBackfill(users) {
  try {
    await setDoc(USERS_REF, {
      users,
      staffEmails: buildStaffEmails(users),
      adminEmails: buildAdminEmails(users),
    });
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
const STAFF_ROLES = ['admin', 'readonly', 'tech', 'scheduler'];
function emailsByRole(users, predicate) {
  return Array.from(new Set(
    (users || [])
      .filter(u => u && u.email && predicate(u))
      .map(u => String(u.email).trim().toLowerCase())
      .filter(Boolean),
  ));
}
export function buildStaffEmails(users) {
  return emailsByRole(users, u => STAFF_ROLES.includes(u.role));
}
export function buildAdminEmails(users) {
  return emailsByRole(users, u => u.role === 'admin');
}
export const saveUsers    = (users)    => setDoc(USERS_REF, {
  users,
  staffEmails: buildStaffEmails(users),
  adminEmails: buildAdminEmails(users),
});

// ── Settings ───────────────────────────────────────────
export const saveSettings = (settings) => setDoc(SETTINGS_REF, settings);

// ── Logs ───────────────────────────────────────────────
export const addLog       = (entry)    => addDoc(LOGS_COL, entry);

export async function fetchLogs(n = 100) {
  const snap = await getDocs(query(LOGS_COL, orderBy('timestamp', 'desc'), limit(n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Services ───────────────────────────────────────────
export async function fetchServices() {
  const snap = await getDocs(query(SERVICES_COL, orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

export const deleteService = (id) => deleteDoc(doc(SERVICES_COL, id));

// ── Clients ────────────────────────────────────────────
const CLIENTS_COL = tenantCol('clients');

export async function fetchClients() {
  const snap = await getDocs(query(CLIENTS_COL, orderBy('name')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchClient(id) {
  const snap = await getDoc(doc(CLIENTS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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

export async function saveClient(id, data) {
  await setDoc(doc(CLIENTS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export const deleteClient = (id) => deleteDoc(doc(CLIENTS_COL, id));

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

export async function fetchEmployees() {
  const snap = await getDocs(query(EMPLOYEES_COL, orderBy('sortOrder')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveEmployee(id, data) {
  const ref = id ? doc(EMPLOYEES_COL, id) : doc(EMPLOYEES_COL);
  await setDoc(ref, { ...data, updatedAt: new Date().toISOString() }, { merge: true });
  return ref.id;
}

export async function createEmployee(data) {
  const ref = await addDoc(EMPLOYEES_COL, {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export const deleteEmployee = (id) => deleteDoc(doc(EMPLOYEES_COL, id));

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
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

export async function fetchAppointmentById(id) {
  if (!id) return null;
  const snap = await getDoc(doc(APPTS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
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
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function createAppointment(data) {
  const ref = await addDoc(APPTS_COL, {
    ...data,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function saveAppointment(id, data) {
  await setDoc(doc(APPTS_COL, id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
}

export const deleteAppointment = (id) => deleteDoc(doc(APPTS_COL, id));

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

// Full visit history for a client: appointments + receipts (imports).
// Returns a unified, deduped list sorted newest-first. Each row exposes
// date, startTime, services[], techName, status, and revenue surface so
// the visit-history modal can render either source uniformly.
export async function fetchClientVisits(clientId) {
  const [apptSnap, rcptSnap] = await Promise.all([
    getDocs(query(APPTS_COL,    where('clientId', '==', clientId))),
    getDocs(query(RECEIPTS_COL, where('clientId', '==', clientId))).catch(() => ({ docs: [] })),
  ]);
  const appts    = apptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const receipts = rcptSnap.docs.map(d => ({ id: d.id, ...d.data() }));

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createBonus(data) {
  const ref = await addDoc(BONUSES_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export const deleteBonus = (id) => deleteDoc(doc(BONUSES_COL, id));

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchGiftCardByCode(code) {
  const snap = await getDocs(query(GIFT_CARDS_COL, where('code', '==', code.trim().toUpperCase())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function createGiftCard(data) {
  const ref = await addDoc(GIFT_CARDS_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function fetchDemoGiftCards() {
  const snap = await getDocs(query(GIFT_CARDS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const deleteGiftCard = (id) => deleteDoc(doc(GIFT_CARDS_COL, id));

export async function updateGiftCard(id, data) {
  await updateDoc(doc(GIFT_CARDS_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

// ── Promo codes ────────────────────────────────────────
const PROMO_COL = tenantCol('promoCodes');

export async function fetchPromoCodes() {
  const snap = await getDocs(PROMO_COL);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchPromoByCode(code) {
  const snap = await getDocs(query(PROMO_COL, where('code', '==', code.trim().toUpperCase())));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function createPromoCode(data) {
  const ref = await addDoc(PROMO_COL, { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function savePromoCode(id, data) {
  await updateDoc(doc(PROMO_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

export const deletePromoCode = (id) => deleteDoc(doc(PROMO_COL, id));

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

export const deleteReview = (id) => deleteDoc(doc(REVIEWS_COL, id));

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

export async function deleteMeeting(id) {
  await deleteDoc(doc(MEETINGS_COL, id));
}

// ── Check-in (public, no auth required) ────────────────
export async function getAppointmentById(id) {
  const snap = await getDoc(doc(APPTS_COL, id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function markCheckedIn(apptId, appt) {
  const now = new Date().toISOString();
  await updateDoc(doc(APPTS_COL, apptId), { checkedInAt: now });
  // Notify the tech via the existing notifications collection
  const col = collection(db, 'tenants', TENANT_ID, 'notifications');
  await addDoc(col, {
    apptId,
    techName:    appt.techName || '',
    clientName:  appt.clientName || 'A client',
    date:        appt.date,
    startTime:   appt.startTime || '',
    changeType:  'client_checkin',
    message:     `${appt.clientName || 'Your client'} has arrived and checked in! 📍`,
    createdAt:   now,
    sent:        false,
  });
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

export async function fetchDemoReceipts() {
  const snap = await getDocs(query(RECEIPTS_COL, where('_demo', '==', true)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const deleteReceipt = (id) => deleteDoc(doc(RECEIPTS_COL, id));

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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function saveProduct(id, data) {
  await setDoc(doc(PRODUCTS_COL, id), { ...data, updatedAt: new Date().toISOString() });
}

export async function createProduct(data) {
  await addDoc(PRODUCTS_COL, { ...data, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
}

export async function deleteProduct(id) {
  await deleteDoc(doc(PRODUCTS_COL, id));
}

// ── Marketing campaigns ───────────────────────────────
const CAMPAIGNS_COL = tenantCol('campaigns');

export async function fetchCampaigns() {
  const snap = await getDocs(query(CAMPAIGNS_COL, orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Real-time subscription so the UI sees status='pending' → 'sent' updates
// from sendSMSCampaign without a manual reload. Returns unsubscribe.
export function subscribeToCampaigns(cb) {
  const q = query(CAMPAIGNS_COL, orderBy('createdAt', 'desc'));
  return onSnapshot(q, snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function createCampaign(data) {
  await addDoc(CAMPAIGNS_COL, { ...data, createdAt: new Date().toISOString() });
}

export async function deleteCampaign(id) {
  return deleteDoc(doc(CAMPAIGNS_COL, id));
}

// Soft-cancel a campaign mid-flight. The Cloud Function checks the
// cancelRequested flag at every flush boundary and aborts cleanly.
export async function cancelCampaign(id) {
  await setDoc(doc(CAMPAIGNS_COL, id), {
    cancelRequested: true,
    cancelRequestedAt: new Date().toISOString(),
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

// ── Backup / Restore ────────────────────────────────────
export async function fetchAllForBackup() {
  const [slidesSnap, settingsSnap, usersSnap, handbookSnap, webfrontSnap, bookingCfgSnap] = await Promise.all([
    getDoc(tenantDoc('slides')),
    getDoc(tenantDoc('settings')),
    getDoc(tenantDoc('users')),
    getDoc(tenantDoc('handbook')),
    getDoc(tenantDoc('webfront')),
    getDoc(tenantDoc('bookingConfig')),
  ]);

  const cols = ['clients', 'employees', 'services', 'appointments', 'giftCards', 'promoCodes', 'bonuses', 'payrollRuns', 'meetings', 'handbookSigs', 'products'];
  const colSnaps = await Promise.all(cols.map(c => getDocs(tenantCol(c))));

  const data = {};
  cols.forEach((c, i) => {
    data[c] = colSnaps[i].docs.map(d => ({ _id: d.id, ...d.data() }));
  });

  data._slides       = slidesSnap.exists()     ? slidesSnap.data()     : null;
  data._settings     = settingsSnap.exists()   ? settingsSnap.data()   : null;
  data._users        = usersSnap.exists()      ? usersSnap.data()      : null;
  data._handbook     = handbookSnap.exists()   ? handbookSnap.data()   : null;
  data._webfront     = webfrontSnap.exists()   ? webfrontSnap.data()   : null;
  data._bookingConfig= bookingCfgSnap.exists() ? bookingCfgSnap.data() : null;

  return data;
}

export async function restoreFromBackup(data) {
  // Keep this list aligned with fetchAllForBackup's cols so a backup → restore
  // round-trip doesn't silently drop collections.
  const cols = ['clients', 'employees', 'services', 'appointments', 'giftCards', 'promoCodes', 'bonuses', 'payrollRuns', 'meetings', 'handbookSigs', 'products'];
  for (const col of cols) {
    if (!Array.isArray(data[col])) continue;
    for (const item of data[col]) {
      const { _id, ...docData } = item;
      if (_id) await setDoc(doc(tenantCol(col), _id), docData);
    }
  }
  if (data._slides)        await setDoc(tenantDoc('slides'),        data._slides);
  if (data._settings)      await setDoc(tenantDoc('settings'),      data._settings);
  if (data._users)         await setDoc(tenantDoc('users'),         data._users);
  if (data._handbook)      await setDoc(tenantDoc('handbook'),      data._handbook);
  if (data._webfront)      await setDoc(tenantDoc('webfront'),      data._webfront);
  if (data._bookingConfig) await setDoc(tenantDoc('bookingConfig'), data._bookingConfig);
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

export async function createTenantRecord(id, data) {
  await setDoc(doc(db, 'tenants', id), { ...data, createdAt: new Date().toISOString() });
}

export async function updateTenantRecord(id, data) {
  await setDoc(doc(db, 'tenants', id), { ...data, updatedAt: new Date().toISOString() }, { merge: true });
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

export async function saveWebfrontConfig(data) {
  await setDoc(WEBFRONT_CONFIG_REF, { ...data, updatedAt: new Date().toISOString() });
}

// ── Google Reviews cache (populated by Cloud Function) ─
export async function fetchGoogleReviews() {
  const snap = await getDoc(tenantDoc('googleReviews'));
  return snap.exists() ? snap.data() : null;
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
