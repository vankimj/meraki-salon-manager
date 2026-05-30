import { describe, it, expect, beforeEach } from 'vitest';
import { tenantBaseUrl, _resetTenantUrlCache } from './tenantUrl.js';

// Minimal Firestore double: db.doc(path) → { get() }. The `store` map is the
// docs-by-path; we also count reads so the cache-hit test can assert no extra
// fetch after the first miss.
function makeDb(store = new Map()) {
  let reads = 0;
  return {
    store,
    get reads() { return reads; },
    doc(path) {
      return {
        async get() {
          reads++;
          return { exists: store.has(path), data: () => store.get(path) };
        },
      };
    },
  };
}

describe('tenantBaseUrl', () => {
  beforeEach(() => _resetTenantUrlCache());

  it('returns null when no tenantId is given', async () => {
    expect(await tenantBaseUrl(makeDb(), '')).toBe(null);
    expect(await tenantBaseUrl(makeDb(), null)).toBe(null);
  });

  it('uses tenant.subdomain when set', async () => {
    const db = makeDb(new Map([['tenants/meraki', { subdomain: 'merakinailstudio' }]]));
    expect(await tenantBaseUrl(db, 'meraki')).toBe('https://merakinailstudio.plumenexus.com');
  });

  it('falls back to tenantId when subdomain is missing on the doc', async () => {
    const db = makeDb(new Map([['tenants/glow', { name: 'Glow Nails' }]]));
    expect(await tenantBaseUrl(db, 'glow')).toBe('https://glow.plumenexus.com');
  });

  it('falls back to tenantId when the tenant doc does not exist', async () => {
    expect(await tenantBaseUrl(makeDb(), 'newcomer')).toBe('https://newcomer.plumenexus.com');
  });

  it('falls back to tenantId when subdomain is an empty string', async () => {
    const db = makeDb(new Map([['tenants/x', { subdomain: '   ' }]]));
    expect(await tenantBaseUrl(db, 'x')).toBe('https://x.plumenexus.com');
  });

  it('caches the lookup — second call does not re-read Firestore', async () => {
    const db = makeDb(new Map([['tenants/meraki', { subdomain: 'merakinailstudio' }]]));
    await tenantBaseUrl(db, 'meraki');
    await tenantBaseUrl(db, 'meraki');
    await tenantBaseUrl(db, 'meraki');
    expect(db.reads).toBe(1);
  });

  it('does not cache across distinct tenants', async () => {
    const db = makeDb(new Map([
      ['tenants/a', { subdomain: 'ay' }],
      ['tenants/b', { subdomain: 'bee' }],
    ]));
    expect(await tenantBaseUrl(db, 'a')).toBe('https://ay.plumenexus.com');
    expect(await tenantBaseUrl(db, 'b')).toBe('https://bee.plumenexus.com');
    expect(db.reads).toBe(2);
  });

  it('falls back gracefully when the read throws', async () => {
    const db = {
      doc: () => ({ async get() { throw new Error('permission-denied'); } }),
    };
    expect(await tenantBaseUrl(db, 'meraki')).toBe('https://meraki.plumenexus.com');
  });
});
