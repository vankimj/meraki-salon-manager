// Mobile port of src/lib/support.js. Same Cloud Functions + Firestore reads as
// web; tenant resolved at call time via getCurrentTenant(). Diagnostics are a
// minimal RN snapshot (no browser env / diagnostics.js on mobile).

import { Platform } from 'react-native';
import { db, callFn } from './firebase';
import { getCurrentTenant } from './currentTenant';
import {
  collection, query, orderBy, limit, getDocs, doc, getDoc, onSnapshot,
} from 'firebase/firestore';

const _submitTicket  = callFn('submitSupportTicket');
const _submitReply   = callFn('submitTicketReply');
const _chatWithAdmin = callFn('chatWithSalonAdmin');

export async function submitSupportTicket({ subject, body, priority }) {
  const tenantId = getCurrentTenant();
  let recentLogs = [];
  try {
    const snap = await getDocs(query(
      collection(db, 'tenants', tenantId, 'logs'), orderBy('at', 'desc'), limit(20),
    ));
    recentLogs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) {
    // Best-effort; tickets still file without logs.
  }
  const diagnostics = { surface: 'mobile', platform: Platform.OS, recentLogs };
  const r = await _submitTicket({ tenantId, subject, body, priority, diagnostics });
  return r.data;
}

// AI assistant. The function may return `actions` (navigations the web chat
// executes); on mobile we surface them as confirmations only — we don't run
// web-route navigations from the app.
export async function chatWithSalonAdmin({ sessionId, messages, currentView }) {
  const r = await _chatWithAdmin({
    tenantId: getCurrentTenant(), sessionId, currentView: currentView || null, messages,
  });
  return r.data;
}

export async function submitOwnerReply({ ticketId, body }) {
  const r = await _submitReply({ tenantId: getCurrentTenant(), ticketId, body });
  return r.data;
}

export async function fetchRecentTickets(n = 50) {
  const snap = await getDocs(query(
    collection(db, 'tenants', getCurrentTenant(), 'supportTickets'),
    orderBy('lastReplyAt', 'desc'), limit(n),
  ));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fetchTicket(ticketId) {
  const s = await getDoc(doc(db, 'tenants', getCurrentTenant(), 'supportTickets', ticketId));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

export function subscribeToReplies(ticketId, callback) {
  const q = query(
    collection(db, 'tenants', getCurrentTenant(), 'supportTickets', ticketId, 'replies'),
    orderBy('at', 'asc'),
  );
  return onSnapshot(q, snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
}
