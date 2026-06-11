import { describe, it, expect } from 'vitest';
import {
  LAUNCH_GROUPS, FLAVORS, SOS_LINKS, SOS_FALLBACK,
  sosLinkForState, resolveHref, deriveAutoStatus, effectiveItemStatus,
  auditGaps, overallProgress, allItems,
} from './launchGuide';

describe('sosLinkForState', () => {
  it('returns the verified URL for a known state (case-insensitive)', () => {
    expect(sosLinkForState('OH')).toBe(SOS_LINKS.OH);
    expect(sosLinkForState('ca')).toBe(SOS_LINKS.CA);
  });
  it('falls back to the SBA directory for unknown/empty', () => {
    expect(sosLinkForState('ZZ')).toBe(SOS_FALLBACK);
    expect(sosLinkForState('')).toBe(SOS_FALLBACK);
    expect(sosLinkForState(null)).toBe(SOS_FALLBACK);
  });
  it('maps all 50 states + DC to https URLs', () => {
    expect(Object.keys(SOS_LINKS).length).toBe(51);
    Object.values(SOS_LINKS).forEach(u => expect(u).toMatch(/^https:\/\//));
  });
});

describe('resolveHref', () => {
  it('state-aware links resolve to the tenant’s SoS link', () => {
    expect(resolveHref({ stateAware: true }, { state: 'OH' })).toBe(SOS_LINKS.OH);
  });
  it('static links resolve to their href', () => {
    expect(resolveHref({ href: 'https://x.test' })).toBe('https://x.test');
  });
});

describe('deriveAutoStatus', () => {
  it('einCaptured: done when settings.ein present', () => {
    expect(deriveAutoStatus({ autoStatus: 'einCaptured' }, { settings: { ein: '12-3456789' } })).toBe('done');
    expect(deriveAutoStatus({ autoStatus: 'einCaptured' }, { settings: {} })).toBe(null);
  });
  it('paymentsReady: done when stripe chargesEnabled', () => {
    expect(deriveAutoStatus({ autoStatus: 'paymentsReady' }, { settings: { stripeConnect: { chargesEnabled: true } } })).toBe('done');
  });
  it('smsReady: reflects the sms status', () => {
    expect(deriveAutoStatus({ autoStatus: 'smsReady' }, { sms: { status: 'approved' } })).toBe('done');
    expect(deriveAutoStatus({ autoStatus: 'smsReady' }, { sms: { status: 'pending_carrier' } })).toBe('in_progress');
    expect(deriveAutoStatus({ autoStatus: 'smsReady' }, { sms: { status: 'draft' } })).toBe(null);
  });
  it('socialsAdded: done when any webfront handle is present', () => {
    expect(deriveAutoStatus({ autoStatus: 'socialsAdded' }, { webfront: { instagram: '@x' } })).toBe('done');
    expect(deriveAutoStatus({ autoStatus: 'socialsAdded' }, { webfront: {} })).toBe(null);
  });
  it('returns null when the item has no autoStatus', () => {
    expect(deriveAutoStatus({}, {})).toBe(null);
  });
});

describe('effectiveItemStatus', () => {
  it('auto status wins when further along than manual', () => {
    expect(effectiveItemStatus({ autoStatus: 'einCaptured' }, { status: 'pending' }, { settings: { ein: 'x' } })).toBe('done');
  });
  it('a manual "done" is never downgraded by auto', () => {
    expect(effectiveItemStatus({ autoStatus: 'einCaptured' }, { status: 'done' }, { settings: {} })).toBe('done');
  });
  it('defaults to pending', () => {
    expect(effectiveItemStatus({}, undefined, {})).toBe('pending');
  });
});

describe('auditGaps', () => {
  it('excludes done items and sorts high-risk first', () => {
    const gaps = auditGaps(LAUNCH_GROUPS, {}, {});
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps[0].risk).toBe('high');
    expect(gaps.every(g => g.status !== 'done')).toBe(true);
  });
  it('a completed item drops out of the gaps', () => {
    const first = allItems(LAUNCH_GROUPS)[0];
    const gaps = auditGaps(LAUNCH_GROUPS, { [first.id]: { status: 'done' } }, {});
    expect(gaps.find(g => g.id === first.id)).toBeUndefined();
  });
});

describe('content integrity', () => {
  it('every item has a unique id, a valid flavor, and a why', () => {
    const ids = new Set();
    for (const g of LAUNCH_GROUPS) {
      expect(g.items.length).toBeGreaterThan(0);
      for (const it of g.items) {
        expect(ids.has(it.id)).toBe(false);
        ids.add(it.id);
        expect(Object.values(FLAVORS)).toContain(it.flavor);
        expect(typeof it.why).toBe('string');
        expect(it.why.length).toBeGreaterThan(0);
      }
    }
    expect(LAUNCH_GROUPS.length).toBeGreaterThanOrEqual(13);
  });
  it('overallProgress is 0% on empty progress with a real total', () => {
    const o = overallProgress(LAUNCH_GROUPS, {}, {});
    expect(o.pct).toBe(0);
    expect(o.total).toBeGreaterThan(10);
  });
});
