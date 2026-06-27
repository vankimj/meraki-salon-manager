import { describe, it, expect } from 'vitest';
import {
  PLAN_RANK, PLAN_IDS, PLAN_META, normalizePlan,
  PACKS, ATOMS, unlockedModulesFor, unlockedCapsFor,
} from './planEntitlements';

describe('PLAN_RANK / PLAN_IDS / PLAN_META', () => {
  it('orders solo < studio < salonPro < enterprise', () => {
    expect(PLAN_RANK.solo).toBeLessThan(PLAN_RANK.studio);
    expect(PLAN_RANK.studio).toBeLessThan(PLAN_RANK.salonPro);
    expect(PLAN_RANK.salonPro).toBeLessThan(PLAN_RANK.enterprise);
  });
  it('publishes the three sellable plan ids', () => {
    expect(PLAN_IDS).toEqual(['solo', 'studio', 'salonPro']);
  });
  it('carries the published prices (must match the marketing pricing page)', () => {
    expect(PLAN_META.solo.monthly).toBe(19);
    expect(PLAN_META.studio.monthly).toBe(49);
    expect(PLAN_META.salonPro.monthly).toBe(149);
  });
});

describe('normalizePlan', () => {
  it('maps legacy ids', () => {
    expect(normalizePlan('starter')).toBe('solo');
    expect(normalizePlan('pro')).toBe('salonPro');
  });
  it('passes through new ids', () => {
    expect(normalizePlan('solo')).toBe('solo');
    expect(normalizePlan('studio')).toBe('studio');
    expect(normalizePlan('salonPro')).toBe('salonPro');
    expect(normalizePlan('enterprise')).toBe('enterprise');
  });
  it('defaults missing / unknown to salonPro (grandfathered full access)', () => {
    expect(normalizePlan(undefined)).toBe('salonPro');
    expect(normalizePlan(null)).toBe('salonPro');
    expect(normalizePlan('mystery')).toBe('salonPro');
  });
});

describe('PACKS / ATOMS metadata', () => {
  it('has the five Power Packs at their published prices', () => {
    const byId = Object.fromEntries(PACKS.map(p => [p.id, p.price]));
    expect(byId).toEqual({ comms: 19, marketing: 19, ai: 19, operations: 29, brand: 39 });
  });
  it('has the atomic add-ons at their published prices', () => {
    const byId = Object.fromEntries(ATOMS.map(a => [a.id, a.price]));
    expect(byId).toEqual({ sms: 15, voice: 15, loyalty: 15, gusto: 25, customDomain: 15, insurance: 19 });
  });
});

describe('unlockedModulesFor', () => {
  it('Comms Pack unlocks chat', () => {
    expect(unlockedModulesFor(['comms'], []).has('chat')).toBe(true);
  });
  it('Operations Pack unlocks hr, Marketing Pack unlocks marketing', () => {
    const set = unlockedModulesFor(['operations', 'marketing'], []);
    expect(set.has('hr')).toBe(true);
    expect(set.has('marketing')).toBe(true);
  });
  it('atoms unlock modules too (sms → chat, gusto → hr)', () => {
    const set = unlockedModulesFor([], ['sms', 'gusto']);
    expect(set.has('chat')).toBe(true);
    expect(set.has('hr')).toBe(true);
  });
  it('ignores unknown pack/atom ids', () => {
    expect(unlockedModulesFor(['nope'], ['nope']).size).toBe(0);
  });
});

describe('unlockedCapsFor', () => {
  it('AI Pack grants voice + copy capabilities', () => {
    const caps = unlockedCapsFor(['ai'], []);
    expect(caps.has('aiVoice')).toBe(true);
    expect(caps.has('aiCopy')).toBe(true);
  });
  it('Brand Pack grants white-label + custom domain', () => {
    const caps = unlockedCapsFor(['brand'], []);
    expect(caps.has('whiteLabel')).toBe(true);
    expect(caps.has('customDomain')).toBe(true);
  });
  it('Insurance-intake add-on (atom) grants the insurance capability; off by default', () => {
    expect(unlockedCapsFor([], ['insurance']).has('insurance')).toBe(true);
    expect(unlockedCapsFor([], []).has('insurance')).toBe(false);
  });
});
