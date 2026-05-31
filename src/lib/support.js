// Salon-side support-ticket helpers. Owner-facing read via the client SDK
// (Firestore rules allow tenant admins to read their own tickets); writes
// go through Cloud Functions so the platform team gets notified.

import { db, callFn } from './firebase';
import { TENANT_ID } from './tenant';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc, onSnapshot,
} from 'firebase/firestore';

const _submitTicket    = callFn('submitSupportTicket');
const _submitReply     = callFn('submitTicketReply');

export async function submitSupportTicket({ subject, body, priority }) {
  const r = await _submitTicket({ tenantId: TENANT_ID, subject, body, priority });
  return r.data;
}

export async function submitOwnerReply({ ticketId, body }) {
  const r = await _submitReply({ tenantId: TENANT_ID, ticketId, body });
  return r.data;
}

// Returns the N most recently active tickets (open + closed).
export async function fetchRecentTickets(n = 50) {
  const snap = await getDocs(query(
    collection(db, 'tenants', TENANT_ID, 'supportTickets'),
    orderBy('lastReplyAt', 'desc'),
    limit(n),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchTicket(ticketId) {
  const s = await getDoc(doc(db, 'tenants', TENANT_ID, 'supportTickets', ticketId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Live thread of replies for an open ticket.
export function subscribeToReplies(ticketId, callback) {
  const q = query(
    collection(db, 'tenants', TENANT_ID, 'supportTickets', ticketId, 'replies'),
    orderBy('at', 'asc'),
  );
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
