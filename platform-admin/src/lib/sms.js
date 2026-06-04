// Platform SMS callables: shared-TFN marker + inbound-orphan triage.
// Wraps the four server callables added in functions/index.js.

import { fns, httpsCallable } from './firebase.js';

const _markSharedTfn        = httpsCallable(fns, 'markSharedTfn');
const _listInboundOrphans   = httpsCallable(fns, 'listInboundOrphans');
const _forwardInboundOrphan = httpsCallable(fns, 'forwardInboundOrphan');
const _deleteInboundOrphan  = httpsCallable(fns, 'deleteInboundOrphan');

export async function markSharedTfn(phone) {
  const res = await _markSharedTfn({ phone });
  return res.data;
}

export async function listInboundOrphans(limit = 50) {
  const res = await _listInboundOrphans({ limit });
  return res.data?.orphans || [];
}

export async function forwardInboundOrphan(orphanId, tenantId) {
  const res = await _forwardInboundOrphan({ orphanId, tenantId });
  return res.data;
}

export async function deleteInboundOrphan(orphanId) {
  const res = await _deleteInboundOrphan({ orphanId });
  return res.data;
}
