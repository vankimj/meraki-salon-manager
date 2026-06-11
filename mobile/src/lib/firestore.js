import {
  collection, doc, getDoc, getDocs, addDoc, setDoc, deleteDoc, updateDoc,
  query, where, orderBy, limit, onSnapshot, arrayUnion, increment, deleteField, writeBatch, runTransaction,
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

// Soft-delete every appointment in a recurring series. Defaults to only
// this-and-future members (date >= fromDate) so already-completed past
// visits in the series are never tombstoned. Returns the deleted ids so
// the caller can reconcile local state / the cart tab.
export async function softDeleteRecurringSeries(groupId, by, { fromDate = null } = {}) {
  if (!groupId) return [];
  const snap = await getDocs(query(tenantCol('appointments'), where('recurringGroupId', '==', groupId)));
  const targets = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .filter(a => !fromDate || (a.date || '') >= fromDate);
  const stamp = new Date().toISOString();
  const actor = by || auth?.currentUser?.email || null;
  await Promise.all(targets.map(a =>
    updateDoc(doc(tenantCol('appointments'), a.id), {
      _deleted: true, _deletedAt: stamp, _deletedBy: actor, updatedAt: stamp,
    })
  ));
  return targets.map(a => a.id);
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

// Find a client by phone, matching on the last 10 digits so it works regardless
// of how the stored phone is formatted (existing clients are free-form). Returns
// the client or null. Scans the tenant's clients client-side — fine for a kiosk
// lookup at salon scale; revisit with a server-side phone index if it grows.
export async function fetchClientByPhone(phone) {
  const digits = (String(phone || '').match(/\d/g) || []).join('');
  const last10 = digits.replace(/^1(?=\d{10}$)/, '').slice(-10);
  if (last10.length < 10) return null;
  const snap = await getDocs(tenantCol('clients'));
  for (const d of snap.docs) {
    const cd = (String(d.data().phone || '').match(/\d/g) || []).join('').slice(-10);
    if (cd && cd === last10) return { id: d.id, ...d.data() };
  }
  return null;
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

// Distinct clientIds with any appointment/receipt BEFORE a date — powers the
// New-vs-Returning split (a client absent here is new). Matches web.
export async function fetchHistoricalClientIds(beforeDate) {
  const [aSnap, rSnap] = await Promise.all([
    getDocs(query(tenantCol('appointments'), where('date', '<', beforeDate))).catch(() => ({ docs: [] })),
    getDocs(query(tenantCol('receipts'), where('date', '<', beforeDate))).catch(() => ({ docs: [] })),
  ]);
  const ids = new Set();
  aSnap.docs.forEach(d => { const c = d.data().clientId; if (c) ids.add(c); });
  rSnap.docs.forEach(d => { const c = d.data().clientId; if (c) ids.add(c); });
  return ids;
}

// Post-checkout service ratings (tenants/{tid}/serviceRatings), keyed on the
// ISO `submittedAt`. Matches the web fetchServiceRatingsByRange.
export async function fetchServiceRatingsByRange(startDate, endDate) {
  const snap = await getDocs(query(
    tenantCol('serviceRatings'),
    where('submittedAt', '>=', `${startDate}T00:00:00.000Z`),
    where('submittedAt', '<=', `${endDate}T23:59:59.999Z`),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
}

// All-time receipt lookup by exact client name — for pulling up an old receipt
// (older than the browse window) when a customer asks. Single `where` (no
// composite index); sorted newest-first client-side.
export async function fetchReceiptsByClientName(name) {
  const n = String(name || '').trim();
  if (!n) return [];
  const snap = await getDocs(query(tenantCol('receipts'), where('clientName', '==', n)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(notTombstoned)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

// Fetch specific appointments by id (e.g. a receipt's apptIds) to resolve the
// participants of a combined checkout. Small N — one getDoc each, missing ids
// dropped.
export async function fetchAppointmentsByIds(ids = []) {
  const uniq = [...new Set((ids || []).filter(Boolean).map(String))];
  const snaps = await Promise.all(uniq.map(id => getDoc(doc(tenantCol('appointments'), id)).catch(() => null)));
  return snaps.filter(s => s && s.exists()).map(s => ({ id: s.id, ...s.data() }));
}

export async function fetchAppointmentsByRange(startDate, endDate) {
  const snap = await getDocs(query(
    tenantCol('appointments'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}

// Blocked booking attempts (honeypot / bot signals) in a date range.
export async function fetchFraudBlocksByRange(startDate, endDate) {
  const snap = await getDocs(query(
    tenantCol('fraudBlocks'),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
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

// Reports AI assistant — sends the full message history, returns { reply }.
export async function chatWithReports(messages) {
  const res = await callFn('chatWithReports')({ tenantId: getCurrentTenant(), messages });
  return res?.data || { reply: '' };
}

// ── Stripe Connect (merchant onboarding / KYC) — wraps the existing backend ──
export async function getStripeConnectStatus() {
  const res = await callFn('getStripeConnectStatus')({ tenantId: getCurrentTenant() });
  return res?.data || { connected: false };
}
export async function createExpressAccount() {
  const res = await callFn('createExpressAccount')({ tenantId: getCurrentTenant() });
  return res?.data || {};
}
export async function createAccountOnboardingLink() {
  const res = await callFn('createAccountOnboardingLink')({ tenantId: getCurrentTenant() });
  return res?.data || {};   // { url, expiresAt }
}
export async function createExpressLoginLink() {
  const res = await callFn('createExpressLoginLink')({ tenantId: getCurrentTenant() });
  return res?.data || {};   // { url, accountType }
}
export async function sendEmailToClient(clientId, subject, body) {
  const res = await callFn('sendDirectEmail')({ tenantId: getCurrentTenant(), clientId, subject, body });
  return res?.data || { ok: true };
}
// AI-drafted, per-client outreach when a tech is unavailable (mirrors the web
// ScheduleAdmin flow). `affected` = [{ id, clientName, clientPhone, clientEmail,
// date, startTime, services, techRequestType, newTechName }]. Returns { drafts:
// [{ apptId, smsDraft, emailDraft, ... }] } with reschedule links baked in.
export async function draftConflictTexts({ technicianName, reason, startDate, endDate, affected }) {
  const res = await callFn('draftConflictMessages')({
    tenantId: getCurrentTenant(), technicianName, reason, startDate, endDate, affected,
  });
  return res?.data || { drafts: [] };
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
// A client's active membership (mirrors web fetchClientMembership) so mobile
// checkout/kiosk can auto-apply the member discount. Returns null when none.
export async function fetchClientMembership(clientId) {
  if (!clientId) return null;
  const snap = await getDocs(query(tenantCol('memberships'), where('clientId', '==', clientId), where('status', '==', 'active')));
  const d = snap.docs.map(x => ({ id: x.id, ...x.data() })).filter(notTombstoned)[0];
  return d || null;
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

// ── Checkout / receipts ────────────────────────────────
// Mirrors web createReceipt — a done appointment carries its `payment` and
// IS the receipt for metrics; createReceipt is for retail-only / walk-in
// sales with no appointment.
// `id` (optional, a stable per-sale key) makes the write idempotent — a retried
// completeSale overwrites the same receipt instead of creating a duplicate
// (which would double-count revenue in Reports).
export async function createReceipt(data, id = null) {
  const payload = { sent: false, ...data, createdAt: data.createdAt || new Date().toISOString() };
  if (id) await setDoc(doc(tenantCol('receipts'), String(id)), payload, { merge: true });
  else await addDoc(tenantCol('receipts'), payload);
}
// Re-send a receipt by text/email after the sale. The server resets the
// sent/error markers + re-runs the same send path. `to` is an optional override
// (a different number/address than the one stored on the receipt). Identify the
// receipt by id when known, else by viewToken (the stable per-sale saleId).
export async function resendReceiptSms({ receiptId = null, viewToken = null, phone = null } = {}) {
  const res = await callFn('resendReceiptSms')({ tenantId: getCurrentTenant(), receiptId, viewToken, phone });
  return res?.data || { ok: false };
}
export async function resendReceiptEmail({ receiptId = null, viewToken = null, email = null } = {}) {
  const res = await callFn('resendReceiptEmail')({ tenantId: getCurrentTenant(), receiptId, viewToken, email });
  return res?.data || { ok: false };
}
// Refund a sale. `refundTo`: 'money' (Stripe refund for card / record-only for
// cash) or 'credit' (store credit, no money moves). Staff (admin or tech) may
// call it; the server notifies all admins. `idempotencyKey` (stable per attempt)
// makes a retry safe — no double refund or double credit.
export async function refundSale({ receiptId, amountCents, reason, refundTo = 'money', commissionByTech, idempotencyKey }) {
  const res = await callFn('refundSale')({ tenantId: getCurrentTenant(), receiptId, amountCents, reason, refundTo, commissionByTech, idempotencyKey });
  return res?.data || { ok: false };
}
// Staff-initiated customer cancellation notice (email + SMS, rebook link, no
// rating). Used by the schedule delete flow, which soft-deletes and so doesn't
// fire the server's status->cancelled trigger.
export async function notifyAppointmentCancelled(apptId) {
  const res = await callFn('notifyAppointmentCancelled')({ tenantId: getCurrentTenant(), apptId });
  return res?.data || { ok: false };
}
// Record a service redo: moves the commission for the selected service(s) from
// the original tech to `redoTech`. No money is refunded. Staff (admin or tech)
// may call it; the server notifies the affected techs. `idempotencyKey` (stable
// per attempt) makes a retry safe — no double-recorded redo.
export async function redoService({ receiptId, services, redoTech, reason, idempotencyKey, notify }) {
  const res = await callFn('redoService')({ tenantId: getCurrentTenant(), receiptId, services, redoTech, reason, idempotencyKey, notify });
  return res?.data || {};
}
// Manually add/remove a client's store credit (admin or tech). deltaCents is
// signed (+add / −remove). Server is atomic, audit-logged, alerts all admins.
export async function adjustClientCredit({ clientId, deltaCents, reason, idempotencyKey }) {
  const res = await callFn('adjustClientCredit')({ tenantId: getCurrentTenant(), clientId, deltaCents, reason, idempotencyKey });
  return res?.data || { ok: false };
}
// Self-service time clock (kiosk): verifies the tech's PIN server-side + records
// the clock in/out and alerts admins. kind = 'in' | 'out' | 'break_start' | 'break_end'.
export async function clockEvent({ employeeId, kind, pin, via = 'kiosk', at = null }) {
  const res = await callFn('clockEvent')({ tenantId: getCurrentTenant(), employeeId, kind, pin, via, at });
  return res?.data || { ok: false };
}
// Admin kiosk-exit PIN (to lock/unlock a kiosk).
export async function setKioskPin(pin) {
  const res = await callFn('setKioskPin')({ tenantId: getCurrentTenant(), pin });
  return res?.data || { ok: false };
}
export async function verifyKioskPin(pin) {
  const res = await callFn('verifyKioskPin')({ tenantId: getCurrentTenant(), pin });
  return res?.data || { ok: false };
}
export async function hasKioskPin() {
  const res = await callFn('hasKioskPin')({ tenantId: getCurrentTenant() });
  return res?.data || { hasPin: false };
}
// Admin sets / clears an employee's 4-digit clock-in PIN (scrypt-hashed server-side).
export async function setEmployeePin(employeeId, pin) {
  const res = await callFn('setEmployeePin')({ tenantId: getCurrentTenant(), employeeId, pin });
  return res?.data || { ok: false };
}
export async function clearEmployeePin(employeeId) {
  const res = await callFn('clearEmployeePin')({ tenantId: getCurrentTenant(), employeeId });
  return res?.data || { ok: false };
}
export async function fetchPromoByCode(code) {
  const snap = await getDocs(query(tenantCol('promoCodes'), where('code', '==', String(code || '').trim().toUpperCase())));
  if (snap.empty) return null;
  const d = { id: snap.docs[0].id, ...snap.docs[0].data() };
  return notTombstoned(d) ? d : null;
}
export async function fetchGiftCardByCode(code) {
  const snap = await getDocs(query(tenantCol('giftCards'), where('code', '==', String(code || '').trim().toUpperCase())));
  if (snap.empty) return null;
  const d = { id: snap.docs[0].id, ...snap.docs[0].data() };
  return notTombstoned(d) ? d : null;
}

// Find redeemable gift cards by the recipient's name / email / phone (or code) —
// for the "customer forgot their code" front-desk flow. Only active, non-voided
// cards with a balance. Scans client-side (fine at salon scale).
export async function fetchGiftCardsByContact(qRaw) {
  const q = String(qRaw || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const digits = (q.match(/\d/g) || []).join('');
  const snap = await getDocs(tenantCol('giftCards'));
  const out = [];
  snap.docs.forEach(dd => {
    const g = { id: dd.id, ...dd.data() };
    if (!notTombstoned(g) || g.voided || !(Number(g.balance) > 0)) return;
    const name  = String(g.recipientName || '').toLowerCase();
    const email = String(g.recipientEmail || '').toLowerCase();
    const code  = String(g.code || '').toLowerCase();
    const gPhone = (String(g.recipientPhone || '').match(/\d/g) || []).join('');
    const phoneHit = digits.length >= 7 && gPhone && gPhone.slice(-10) === digits.slice(-10);
    if (name.includes(q) || email.includes(q) || code.includes(q) || phoneHit) out.push(g);
  });
  return out.slice(0, 25);
}
// Stripe Terminal (Slice 2) — backend callables. The reader/Tap-to-Pay flow
// that consumes these lives in lib/terminal.js (needs the native SDK + a
// rebuild + a reader to run).
export async function createTerminalConnectionToken() {
  const res = await callFn('createTerminalConnectionToken')({ tenantId: getCurrentTenant() });
  return { secret: res?.data?.secret || null, testMode: !!res?.data?.testMode };
}
export async function createCardPaymentIntent(amountCents, description, idempotencyKey) {
  const res = await callFn('createPaymentIntent')({ tenantId: getCurrentTenant(), amountCents, description, paymentMethodType: 'card_present', idempotencyKey });
  return res?.data || null; // { clientSecret, paymentIntentId }
}
// Card-reader setup wizard: readiness + auto-create the Stripe Terminal Location.
export async function getTerminalSetupStatus() {
  const res = await callFn('getTerminalSetupStatus')({ tenantId: getCurrentTenant() });
  return res?.data || {};
}
export async function setupTerminalLocation() {
  const res = await callFn('setupTerminalLocation')({ tenantId: getCurrentTenant() });
  return res?.data || {};
}

// Charge a client's saved card off-session (card on file). Admin-only on the
// server (requireTenantAdmin). Returns { paymentIntentId, status, amountCharged }.
export async function chargeStoredCard({ clientId, amountCents, description, paymentMethodId, idempotencyKey } = {}) {
  const res = await callFn('chargeStoredCard')({
    tenantId: getCurrentTenant(), clientId, amount: amountCents, description, paymentMethodId, idempotencyKey,
  });
  return res?.data || null;
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
  { key: 'continuingEducation', restorable: false },
  { key: 'bonusRules',      restorable: false },
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

// ── Front-desk kiosk checkout session ──────────────────
// One active session per tenant (data/checkoutSession). A tech "sends to front
// desk" → setCheckoutSession (status 'pending'); the front-desk kiosk subscribes
// and takes over the screen. status: 'pending' | 'paying' | 'done' | 'idle'.
// The kiosk shows the customer checkout while pending/paying; idle/done → tip display.
export async function setCheckoutSession(data) {
  await setDoc(tenantDoc('checkoutSession'),
    { status: 'pending', createdAt: new Date().toISOString(), ...data, updatedAt: new Date().toISOString() });
}
export async function updateCheckoutSession(patch) {
  await setDoc(tenantDoc('checkoutSession'), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
}
export async function clearCheckoutSession() {
  try { await setDoc(tenantDoc('checkoutSession'), { status: 'idle', updatedAt: new Date().toISOString() }, { merge: true }); } catch (_) {}
}
export function subscribeCheckoutSession(cb) {
  return onSnapshot(tenantDoc('checkoutSession'),
    (snap) => cb(snap.exists() ? snap.data() : null),
    () => cb(null));
}

// Concurrency lock: when multiple front-desk kiosks share one session, only ONE
// may take payment (else two kiosks would create two separate charges — the
// per-kiosk idempotency keys differ, so idempotency alone can't stop it). The
// first kiosk to claim wins via a transaction; a claim older than 10 min is
// considered abandoned (a crashed/closed kiosk) and can be re-claimed. Returns
// true if THIS kiosk holds the claim.
// Idempotency claim for a sale's NON-idempotent side effects (store-credit
// deduct/issue, gift-card debit, promo count, stock decrement). The receipt +
// appt writes are already idempotent via the deterministic saleId, but the
// side effects are read-modify-write — so an offline-queue REPLAY (where the
// side effects committed but the critical write failed, leaving the sale to be
// replayed) would double-apply them. This transactionally claims a marker doc
// keyed by saleId: the first caller commits the marker and runs the side
// effects; any replay sees the marker and skips them (at-most-once). Returns
// true if THIS call should run the side effects.
export async function claimSaleSideEffects(saleId) {
  if (!saleId) return true; // no idempotency key (legacy) — preserve old behavior
  const ref = doc(tenantCol('saleMarkers'), saleId);
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return false;            // already applied by a prior attempt
      tx.set(ref, { at: new Date().toISOString() });
      return true;
    });
  } catch (_) {
    // Transient error: fail open so a normal (non-replay) sale still applies
    // its side effects. The replay case the marker protects against runs during
    // a flush that already confirmed connectivity, so the read succeeds there.
    return true;
  }
}

export async function claimCheckoutSession(kioskId) {
  const ref = tenantDoc('checkoutSession');
  try {
    return await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const d = snap.data();
      if (d.status !== 'pending' && d.status !== 'paying') return false; // not an active session
      const claimedAt = d.claimedAt ? Date.parse(d.claimedAt) : 0;
      const stale = !claimedAt || (Date.now() - claimedAt) > 10 * 60 * 1000;
      if (d.claimedBy && d.claimedBy !== kioskId && !stale) return false; // held by another kiosk
      tx.update(ref, { claimedBy: kioskId, claimedAt: new Date().toISOString() });
      return true;
    });
  } catch (_) {
    // On a transient error default to claiming — never lock out the only kiosk.
    return true;
  }
}

// TipFlow slides (data/slides.slides[]) — used by the kiosk idle TipFlow.
export async function fetchSlides() {
  try { const snap = await getDoc(tenantDoc('slides')); return snap.exists() ? (snap.data().slides || []) : []; }
  catch (_) { return []; }
}
// Full slides doc (slides[] + default index) for the slide manager.
export async function fetchSlidesDoc() {
  try {
    const snap = await getDoc(tenantDoc('slides'));
    const d = snap.exists() ? snap.data() : {};
    return { slides: Array.isArray(d.slides) ? d.slides : [], def: Number(d.def) || 0 };
  } catch (_) { return { slides: [], def: 0 }; }
}
// Persist the slide array + default index. Mirrors the web saveSlides — the
// kiosk idle reads slides[]; def marks which slide the web TipFlow rests on.
export async function saveSlides(slides, def = 0) {
  const arr = Array.isArray(slides) ? slides : [];
  const safeDef = Math.max(0, Math.min(arr.length - 1, Number(def) || 0));
  await setDoc(tenantDoc('slides'), { slides: arr, def: arr.length ? safeDef : 0, updatedAt: new Date().toISOString() }, { merge: true });
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

// Continuing education (per-employee CE records). Mirrors web shapes.
// Non-admin (staff) callers pass `ownUid` — rules only allow reading their own
// records (createdBy == uid), so the query must be scoped to match. Filtered
// path skips orderBy (avoids a composite index) and sorts client-side.
export async function fetchContinuingEducation(ownUid) {
  const q = ownUid
    ? query(tenantCol('continuingEducation'), where('createdBy', '==', ownUid))
    : query(tenantCol('continuingEducation'), orderBy('date', 'desc'));
  const rows = (await getDocs(q)).docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
  return ownUid ? rows.sort((a, b) => (b.date || '').localeCompare(a.date || '')) : rows;
}
export async function saveCE(id, data) {
  const now = new Date().toISOString();
  if (id) { await setDoc(doc(tenantCol('continuingEducation'), id), { ...data, updatedAt: now }, { merge: true }); return id; }
  const ref = await addDoc(tenantCol('continuingEducation'), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}
export async function deleteCE(id) { await softDelete(doc(tenantCol('continuingEducation'), id)); }

// Structured bonus rules.
export async function fetchBonusRules() {
  const snap = await getDocs(query(tenantCol('bonusRules'), orderBy('createdAt', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(notTombstoned);
}
export async function saveBonusRule(id, data) {
  const now = new Date().toISOString();
  if (id) { await setDoc(doc(tenantCol('bonusRules'), id), { ...data, updatedAt: now }, { merge: true }); return id; }
  const ref = await addDoc(tenantCol('bonusRules'), { ...data, createdAt: now, updatedAt: now });
  return ref.id;
}
export async function deleteBonusRule(id) { await softDelete(doc(tenantCol('bonusRules'), id)); }

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
// Google Business: per-tenant listing confirmation + review sync.
export async function findBusinessByAddress(address) {
  const res = await callFn('findBusinessByAddress')({ tenantId: getCurrentTenant(), address });
  return res?.data || {};
}
export async function syncGoogleBusinessReviews() {
  const res = await callFn('syncGoogleBusinessReviews')({ tenantId: getCurrentTenant() });
  return res?.data || {};
}
export async function disconnectGoogleBusiness() {
  const res = await callFn('disconnectGoogleBusiness')({ tenantId: getCurrentTenant() });
  return res?.data || {};
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
