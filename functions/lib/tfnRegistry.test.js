import { describe, it, expect, beforeEach } from 'vitest';
import {
  tfnRegistryRef, registerTfnForTenant, unregisterTfn, findTenantByTfn, _resetTfnCache,
} from './tfnRegistry.js';

// Minimal in-memory Firestore double: db.doc(path) → { set(data, {merge}), get(), delete() }.
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

describe('tfnRegistry', () => {
  beforeEach(() => _resetTfnCache());

  it('builds the platform registry doc path from the E.164 phone', () => {
    let captured;
    tfnRegistryRef({ doc: (p) => (captured = p) }, '+18445551234');
    expect(captured).toBe('platform/smsTfnRegistry/+18445551234');
  });

  it('findTenantByTfn returns null when the number is unmapped', async () => {
    expect(await findTenantByTfn(makeDb(), '+18445550000')).toBe(null);
  });

  it('register then find returns the tenant (sandbox defaults false)', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '+18445551111', 'glow');
    expect(await findTenantByTfn(db, '+18445551111')).toBe('glow');
    expect(db.store.get('platform/smsTfnRegistry/+18445551111'))
      .toMatchObject({ tenantId: 'glow', sandbox: false });
  });

  it('stores the sandbox flag when provided', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '+15005550006', 'demo', true);
    expect(db.store.get('platform/smsTfnRegistry/+15005550006'))
      .toMatchObject({ tenantId: 'demo', sandbox: true });
  });

  it('unregister then find returns null (after cache expiry)', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '+18445552222', 'lux');
    expect(await findTenantByTfn(db, '+18445552222')).toBe('lux');
    await unregisterTfn(db, '+18445552222');
    _resetTfnCache(); // mirror the 5-min lookup-cache expiry
    expect(await findTenantByTfn(db, '+18445552222')).toBe(null);
  });

  it('caches lookups — a delete is not observed until the cache clears', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '+18445553333', 'cached');
    expect(await findTenantByTfn(db, '+18445553333')).toBe('cached');
    db.store.delete('platform/smsTfnRegistry/+18445553333'); // underlying doc gone
    expect(await findTenantByTfn(db, '+18445553333')).toBe('cached'); // still cached
    _resetTfnCache();
    expect(await findTenantByTfn(db, '+18445553333')).toBe(null);
  });

  it('no-ops on missing phone/tenant and never throws', async () => {
    const db = makeDb();
    await registerTfnForTenant(db, '', 'x');
    await registerTfnForTenant(db, '+1', '');
    expect(db.store.size).toBe(0);
    await unregisterTfn(db, '');
    expect(await findTenantByTfn(db, '')).toBe(null);
  });
});
