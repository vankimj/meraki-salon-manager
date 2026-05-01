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
    slides:   slidesDoc?.exists()   ? (slidesDoc.data().slides   ?? []) : null,
    def:      slidesDoc?.exists()   ? (slidesDoc.data().def      ?? 0)  : 0,
    cur:      slidesDoc?.exists()   ? (slidesDoc.data().cur      ?? 0)  : 0,
    users:    usersDoc?.exists()    ? (usersDoc.data().users     ?? []) : [],
    settings: settingsDoc?.exists() ? settingsDoc.data()                : {},
  };
}

// ── Slides ─────────────────────────────────────────────
export const saveSlides   = (slides, def, cur) => setDoc(SLIDES_REF, { slides, def, cur });

// ── Users ──────────────────────────────────────────────
export const saveUsers    = (users)    => setDoc(USERS_REF, { users });

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
  const snap = await getDocs(query(APPTS_COL, where('clientId', '==', clientId), orderBy('date', 'desc'), limit(100)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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
  await addDoc(RECEIPTS_COL, { ...data, createdAt: new Date().toISOString(), sent: false });
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

export async function createCampaign(data) {
  await addDoc(CAMPAIGNS_COL, { ...data, createdAt: new Date().toISOString() });
}

export async function deleteCampaign(id) {
  return deleteDoc(doc(CAMPAIGNS_COL, id));
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
