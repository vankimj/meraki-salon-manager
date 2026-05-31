// Support-ticket data layer for the platform-admin console.
//
// Reads happen client-side (rules let isPlatformAdmin() see all
// supportTickets across tenants for the queue view, and the per-tenant
// detail page reads a single tenant's tickets directly). Writes go
// through Cloud Functions which gate platform-admin auth and write the
// admin reply / status change atomically.

import {
  db, fns, httpsCallable, collection, query, orderBy, limit, where, getDocs, doc, getDoc, onSnapshot,
} from './firebase.js';

const _listOpenSupportTickets = httpsCallable(fns, 'listOpenSupportTickets');
const _submitAdminTicketReply = httpsCallable(fns, 'submitAdminTicketReply');
const _updateSupportTicketStatus = httpsCallable(fns, 'updateSupportTicketStatus');
const _setMyPlatformAdminAlertContact = httpsCallable(fns, 'setMyPlatformAdminAlertContact');

// Cross-tenant queue view. The cloud function uses a collection-group
// query (admin SDK bypasses rules) and returns the ticket docs plus the
// derived tenantId for each.
export async function listOpenSupportTickets(status = 'open', limitN = 100) {
  const res = await _listOpenSupportTickets({ status, limit: limitN });
  return res.data?.tickets || [];
}

// Per-tenant tickets list (used on TenantDetail). Direct read via SDK;
// rules allow platform admin read on usageDaily/Monthly *and* on
// supportTickets across all tenants.
export async function listTicketsForTenant(tenantId, limitN = 50) {
  const snap = await getDocs(query(
    collection(db, 'tenants', tenantId, 'supportTickets'),
    orderBy('lastReplyAt', 'desc'),
    limit(limitN),
  ));
  return snap.docs.map(d => ({ id: d.id, tenantId, ...d.data() }));
}

export async function fetchTicket(tenantId, ticketId) {
  const s = await getDoc(doc(db, 'tenants', tenantId, 'supportTickets', ticketId));
  return s.exists() ? { id: s.id, tenantId, ...s.data() } : null;
}

export function subscribeToReplies(tenantId, ticketId, callback) {
  const q = query(
    collection(db, 'tenants', tenantId, 'supportTickets', ticketId, 'replies'),
    orderBy('at', 'asc'),
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}

export async function submitAdminReply(tenantId, ticketId, body, status) {
  const res = await _submitAdminTicketReply({ tenantId, ticketId, body, status });
  return res.data;
}

export async function updateTicketStatus(tenantId, ticketId, status) {
  const res = await _updateSupportTicketStatus({ tenantId, ticketId, status });
  return res.data;
}

// Reads the current platform-admin alert phone for the signed-in admin.
// Returns { phone, smsEnabled }. Falls back to nulls when nothing's set.
export async function fetchMyAlertContact(email) {
  if (!email) return { phone: null, smsEnabled: false };
  try {
    const s = await getDoc(doc(db, 'platform', 'admins'));
    if (!s.exists()) return { phone: null, smsEnabled: false };
    const d = s.data() || {};
    return {
      phone:      (d.phones || {})[email.toLowerCase()] || null,
      smsEnabled: !!((d.smsEnabled || {})[email.toLowerCase()]),
    };
  } catch (e) {
    console.warn('[fetchMyAlertContact] read failed:', e?.message);
    return { phone: null, smsEnabled: false };
  }
}

export async function setMyAlertContact(phone, smsEnabled) {
  const res = await _setMyPlatformAdminAlertContact({ phone, smsEnabled });
  return res.data;
}
