import { describe, it, expect, beforeEach } from 'vitest';
import {
  indexRef, setClientLastSalon, lookupClientLastSalon, _resetClientSalonCache,
} from './clientSalonIndex.js';

// Minimal in-memory Firestore double; same shape used by tfnRegistry.test.js.
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

describe('clientSalonIndex', () => {
  beforeEach(() => _resetClientSalonCache());

  it('builds the top-level doc path from the normalized phone', () => {
    let captured;
    indexRef({ doc: (p) => (captured = p) }, '+16145551234');
    expect(captured).toBe('clientSalonIndex/+16145551234');
  });

  it('lookupClientLastSalon returns null when phone is unmapped', async () => {
    expect(await lookupClientLastSalon(makeDb(), '+16145559999')).toBe(null);
  });

  it('set then lookup returns the most recent salon + clientId', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '+16145551234', 'meraki', 'client_xyz');
    const entry = await lookupClientLastSalon(db, '+16145551234');
    expect(entry?.tenantId).toBe('meraki');
    expect(entry?.clientId).toBe('client_xyz');
    expect(entry?.lastOutboundAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('subsequent set updates the tenant (last-write-wins for routing)', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '+16145551234', 'meraki', 'c1');
    _resetClientSalonCache(); // clear so we hit Firestore on the re-lookup
    await setClientLastSalon(db, '+16145551234', 'sparklenails', 'c2');
    _resetClientSalonCache();
    const entry = await lookupClientLastSalon(db, '+16145551234');
    expect(entry?.tenantId).toBe('sparklenails');
    expect(entry?.clientId).toBe('c2');
  });

  it('clientId is optional — null is recorded when not provided', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '+16145551234', 'meraki');
    const entry = await lookupClientLastSalon(db, '+16145551234');
    expect(entry?.tenantId).toBe('meraki');
    expect(entry?.clientId).toBe(null);
  });

  it('refuses to write when phone or tenantId is missing', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '', 'meraki');
    await setClientLastSalon(db, '+16145551234', '');
    expect(db.store.size).toBe(0);
  });

  it('refuses to write the SHARED_TFN_SENTINEL as a tenant (defends the index)', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '+16145551234', '__shared__', 'c1');
    expect(db.store.size).toBe(0);
  });

  it('lookup uses the 5-min in-process cache (no extra Firestore reads)', async () => {
    const db = makeDb();
    await setClientLastSalon(db, '+16145551234', 'meraki');
    await lookupClientLastSalon(db, '+16145551234'); // populates cache

    // Simulate a Firestore that throws on subsequent reads — cache must serve.
    let reads = 0;
    const cachedDb = {
      doc() {
        return {
          async get() { reads++; throw new Error('should not be called'); },
        };
      },
    };
    const entry = await lookupClientLastSalon(cachedDb, '+16145551234');
    expect(entry?.tenantId).toBe('meraki');
    expect(reads).toBe(0);
  });
});
