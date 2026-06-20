import { describe, it, expect } from 'vitest';
import { normalizeVertical, membershipPlansForVertical, VERTICAL_MEMBERSHIP_PLANS, KNOWN_VERTICALS } from './verticals.js';
import { VERTICALS } from '../../src/data/verticals.js';

describe('normalizeVertical', () => {
  it('keeps known vertical keys', () => {
    expect(normalizeVertical('personalTraining')).toBe('personalTraining');
    expect(normalizeVertical('makeupArtist')).toBe('makeupArtist');
    expect(normalizeVertical('nails')).toBe('nails');
  });
  it('clamps unknown / legacy industries to nails (so they keep NO vertical field)', () => {
    for (const v of ['hair', 'both', 'other', '', undefined, null, 'spa']) {
      expect(normalizeVertical(v)).toBe('nails');
    }
  });
});

describe('membershipPlansForVertical', () => {
  it('seeds three recurring plans for personal training', () => {
    const plans = membershipPlansForVertical('personalTraining');
    expect(plans).toHaveLength(3);
    for (const p of plans) {
      expect(typeof p.name).toBe('string');
      expect(typeof p.price).toBe('number');
      expect(['monthly', 'yearly']).toContain(p.billingPeriod);
      expect(p.active).toBe(true);
    }
  });
  it('seeds nothing for nails / makeup (no recurring templates by default)', () => {
    expect(membershipPlansForVertical('nails')).toEqual([]);
    expect(membershipPlansForVertical('makeupArtist')).toEqual([]);
  });
  it('returns [] for an unknown key', () => {
    expect(membershipPlansForVertical('nope')).toEqual([]);
  });
});

// Drift guard: the server mirror (CJS, this file's module) is hand-synced with
// the client registry src/data/verticals.js. If a plan is edited in one place
// and not the other, the onboarding seed and the in-app display disagree.
describe('server mirror stays in sync with the client registry', () => {
  it('exposes the same vertical keys the client registry defines', () => {
    for (const key of Object.keys(VERTICALS)) {
      expect(KNOWN_VERTICALS).toContain(key);
    }
  });
  it('seeds the exact membership plans the client registry advertises', () => {
    for (const key of KNOWN_VERTICALS) {
      const client = (VERTICALS[key]?.membershipPlans || []).map(p => ({
        name: p.name, price: p.price, billingPeriod: p.billingPeriod, description: p.description, active: p.active,
      }));
      const server = (VERTICAL_MEMBERSHIP_PLANS[key] || []).map(p => ({
        name: p.name, price: p.price, billingPeriod: p.billingPeriod, description: p.description, active: p.active,
      }));
      expect(server).toEqual(client);
    }
  });
});
