// Targeted tests for the shared-TFN marker added on top of tfnRegistry.
// Kept in a separate file from the main tfnRegistry.test.js so the existing
// suite stays untouched and these can be removed together with the marker
// if the shared model ever gets replaced.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTfnForTenant, findTenantByTfn, markTfnAsShared,
  SHARED_TFN_SENTINEL, _resetTfnCache,
} from './tfnRegistry.js';

function makeDb() {
  const store = new Map();
  return {
    store,
    doc(path) {
      return {
        async set(data, opts) {
          const prev = opts && opts.merge ? (store.get(path) || {}) : {};
          store.set(path, { ...prev, ...data });
        },
        async get() {
          return { exists: store.has(path), data: () => store.get(path) };
        },
        async delete() { store.delete(path); },
      };
    },
  };
}

describe('shared TFN marker', () => {
  beforeEach(() => _resetTfnCache());

  it('SHARED_TFN_SENTINEL is a non-empty string that cannot collide with real tenant ids', () => {
    expect(typeof SHARED_TFN_SENTINEL).toBe('string');
    expect(SHARED_TFN_SENTINEL.length).toBeGreaterThan(2);
    // Real tenant ids are kebab/lowercase; the sentinel has underscores.
    expect(SHARED_TFN_SENTINEL).toMatch(/__/);
  });

  it('markTfnAsShared stores the sentinel + shared:true', async () => {
    const db = makeDb();
    await markTfnAsShared(db, '+18559574235');
    const stored = db.store.get('smsTfnRegistry/+18559574235');
    expect(stored.tenantId).toBe(SHARED_TFN_SENTINEL);
    expect(stored.shared).toBe(true);
    expect(stored.registeredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('findTenantByTfn returns the sentinel for a shared TFN', async () => {
    const db = makeDb();
    await markTfnAsShared(db, '+18559574235');
    expect(await findTenantByTfn(db, '+18559574235')).toBe(SHARED_TFN_SENTINEL);
  });

  it('marking a TFN as shared clears any prior per-tenant lookup cache', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '+18559574235', 'meraki');
    expect(await findTenantByTfn(db, '+18559574235')).toBe('meraki');
    // Re-purpose the number as the shared platform line.
    await markTfnAsShared(db, '+18559574235');
    // Cache was invalidated; next lookup hits Firestore and sees the sentinel.
    expect(await findTenantByTfn(db, '+18559574235')).toBe(SHARED_TFN_SENTINEL);
  });

  it('markTfnAsShared is a no-op when phone is missing (defensive)', async () => {
    const db = makeDb();
    await markTfnAsShared(db, '');
    expect(db.store.size).toBe(0);
  });
});
