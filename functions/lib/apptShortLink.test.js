import { describe, it, expect } from 'vitest';
import { COLLECTION, generateShortCode, mintShortLink, lookupShortLink } from './apptShortLink.js';

function makeDb(store = new Map()) {
  return {
    store,
    doc(path) {
      return {
        async set(data) { store.set(path, data); },
        async get() { return { exists: store.has(path), data: () => store.get(path) }; },
      };
    },
  };
}

const PAYLOAD = {
  tenantId: 'meraki',
  apptId:   'appt_abc123',
  exp:      1900000000,
  token:    'abcd1234efgh5678',
};

describe('generateShortCode', () => {
  it('returns a URL-safe string of ~12 chars', () => {
    const code = generateShortCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeGreaterThanOrEqual(10);
    expect(code.length).toBeLessThanOrEqual(16);
  });
  it('produces distinct codes on successive calls (random)', () => {
    const a = generateShortCode();
    const b = generateShortCode();
    expect(a).not.toBe(b);
  });
});

describe('mintShortLink', () => {
  it('writes the doc and returns the code', async () => {
    const db = makeDb();
    const fixedCode = 'fixedcode01';
    const code = await mintShortLink(db, PAYLOAD, () => fixedCode);
    expect(code).toBe(fixedCode);
    const doc = db.store.get(`${COLLECTION}/${fixedCode}`);
    expect(doc).toMatchObject({
      tenantId: 'meraki', apptId: 'appt_abc123', exp: 1900000000, token: 'abcd1234efgh5678',
    });
    expect(typeof doc.createdAt).toBe('string');
  });
  it('sets expiresAt to a Date 24h past the token exp (for the Firestore TTL policy)', async () => {
    const db = makeDb();
    await mintShortLink(db, PAYLOAD, () => 'ttlcheck001');
    const doc = db.store.get(`${COLLECTION}/ttlcheck001`);
    expect(doc.expiresAt).toBeInstanceOf(Date);
    // exp = 1900000000 (unix seconds); +24h grace = +86400 seconds
    expect(doc.expiresAt.getTime()).toBe((1900000000 + 86400) * 1000);
  });
  it('writes to a 2-segment doc path (apptShortLinks/{code}) — even-segment required', async () => {
    const db = makeDb();
    await mintShortLink(db, PAYLOAD, () => 'pathcheck01');
    expect(Array.from(db.store.keys())[0]).toBe('apptShortLinks/pathcheck01');
  });
  it('returns null when any required field is missing', async () => {
    const db = makeDb();
    expect(await mintShortLink(db, { ...PAYLOAD, tenantId: '' })).toBe(null);
    expect(await mintShortLink(db, { ...PAYLOAD, apptId: '' })).toBe(null);
    expect(await mintShortLink(db, { ...PAYLOAD, exp: 0 })).toBe(null);
    expect(await mintShortLink(db, { ...PAYLOAD, token: '' })).toBe(null);
    expect(db.store.size).toBe(0);
  });
  it('returns null and does not throw when the write fails', async () => {
    const db = { doc: () => ({ async set() { throw new Error('permission-denied'); } }) };
    const code = await mintShortLink(db, PAYLOAD);
    expect(code).toBe(null);
  });
});

describe('lookupShortLink', () => {
  it('returns the payload for a known code', async () => {
    const db = makeDb();
    const code = await mintShortLink(db, PAYLOAD, () => 'xyz12345');
    const looked = await lookupShortLink(db, code);
    expect(looked).toMatchObject({
      tenantId: 'meraki', apptId: 'appt_abc123', exp: 1900000000, token: 'abcd1234efgh5678',
    });
  });
  it('returns null for an unknown code', async () => {
    expect(await lookupShortLink(makeDb(), 'nope-nope')).toBe(null);
  });
  it('returns null for missing or empty code', async () => {
    expect(await lookupShortLink(makeDb(), '')).toBe(null);
    expect(await lookupShortLink(makeDb(), null)).toBe(null);
  });
  it('returns null when the doc is missing required fields', async () => {
    const db = makeDb();
    db.store.set(`${COLLECTION}/partial`, { tenantId: 'meraki' /* apptId/exp/token missing */ });
    expect(await lookupShortLink(db, 'partial')).toBe(null);
  });
  it('returns null and does not throw when the read fails', async () => {
    const db = { doc: () => ({ async get() { throw new Error('permission-denied'); } }) };
    expect(await lookupShortLink(db, 'any')).toBe(null);
  });
});
