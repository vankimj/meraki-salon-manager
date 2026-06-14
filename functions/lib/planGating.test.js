import { describe, it, expect } from 'vitest';
import {
  isBlockingMembership, modulesLostOnDowngrade, buildDowngradeBlockers, SAAS_PLAN_RANK, normalizePlan,
} from './planGating.js';

describe('normalizePlan', () => {
  it('maps legacy ids and defaults missing to salonPro', () => {
    expect(normalizePlan('starter')).toBe('solo');
    expect(normalizePlan('pro')).toBe('salonPro');
    expect(normalizePlan('studio')).toBe('studio');
    expect(normalizePlan('solo')).toBe('solo');
    expect(normalizePlan(undefined)).toBe('salonPro');
    expect(normalizePlan('garbage')).toBe('salonPro');
  });
});

describe('isBlockingMembership', () => {
  it('treats active / past_due / paused / trialing as still-billing', () => {
    for (const status of ['active', 'past_due', 'paused', 'trialing', 'ACTIVE']) {
      expect(isBlockingMembership({ status })).toBe(true);
    }
  });
  it('does not block on cancelled or tombstoned docs', () => {
    expect(isBlockingMembership({ status: 'cancelled' })).toBe(false);
    expect(isBlockingMembership({ status: 'active', _deleted: true })).toBe(false);
    expect(isBlockingMembership(null)).toBe(false);
    expect(isBlockingMembership({})).toBe(false);
  });
});

describe('modulesLostOnDowngrade', () => {
  it('salonPro → studio drops the three salonPro modules', () => {
    expect(modulesLostOnDowngrade('salonPro', 'studio').sort()).toEqual(['hr', 'marketing', 'memberships']);
  });
  it('salonPro → solo drops salonPro + studio modules but keeps solo', () => {
    const lost = modulesLostOnDowngrade('salonPro', 'solo');
    expect(lost).toContain('memberships');
    expect(lost).toContain('chat');
    expect(lost).not.toContain('schedule');
    expect(lost).not.toContain('reports');
  });
  it('honors legacy plan ids', () => {
    expect(modulesLostOnDowngrade('pro', 'studio').sort()).toEqual(['hr', 'marketing', 'memberships']);
  });
  it('a module kept by a retained pack is not lost', () => {
    const lost = modulesLostOnDowngrade('salonPro', 'solo', new Set(['chat', 'hr']));
    expect(lost).not.toContain('chat');
    expect(lost).not.toContain('hr');
    expect(lost).toContain('marketing');
  });
  it('upgrade / same returns empty', () => {
    expect(modulesLostOnDowngrade('studio', 'salonPro')).toEqual([]);
    expect(modulesLostOnDowngrade('salonPro', 'salonPro')).toEqual([]);
  });
});

describe('buildDowngradeBlockers', () => {
  it('blocks memberships while client subs are still billing', () => {
    const { blockers } = buildDowngradeBlockers('salonPro', 'studio', { activeMembershipCount: 3, disabledModules: ['hr', 'marketing'] });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ moduleId: 'memberships', count: 3 });
    expect(blockers[0].reason).toMatch(/cancel them first/);
  });
  it('singular wording for one membership', () => {
    const { blockers } = buildDowngradeBlockers('salonPro', 'studio', { activeMembershipCount: 1, disabledModules: ['hr', 'marketing'] });
    expect(blockers[0].reason).toMatch(/1 active membership .*cancel it first/);
  });
  it('blocks every dropped module that is still enabled', () => {
    const { blockers } = buildDowngradeBlockers('salonPro', 'studio', { activeMembershipCount: 0, disabledModules: [] });
    const ids = blockers.map(b => b.moduleId).sort();
    expect(ids).toEqual(['hr', 'marketing']); // memberships clear (count 0)
  });
  it('is clear once all dropped modules are off and no active memberships', () => {
    const { blockers } = buildDowngradeBlockers('salonPro', 'studio', { activeMembershipCount: 0, disabledModules: ['hr', 'marketing', 'memberships'] });
    expect(blockers).toEqual([]);
  });
  it('a retained pack removes its module from the blocker list', () => {
    // Downgrade salonPro → studio but the tenant keeps the Operations Pack (hr).
    const { blockers } = buildDowngradeBlockers('salonPro', 'studio', { activeMembershipCount: 0, disabledModules: ['marketing'], packs: ['operations'] });
    expect(blockers).toEqual([]);
  });
  it('memberships count is ignored when the downgrade does not drop memberships', () => {
    // studio → solo never had memberships available; count must not matter.
    const { blockers } = buildDowngradeBlockers('studio', 'solo', { activeMembershipCount: 5, disabledModules: ['chat', 'attendance', 'meetings', 'products'] });
    expect(blockers).toEqual([]);
  });
});

describe('SAAS_PLAN_RANK', () => {
  it('orders the tiers', () => {
    expect(SAAS_PLAN_RANK.solo).toBeLessThan(SAAS_PLAN_RANK.studio);
    expect(SAAS_PLAN_RANK.studio).toBeLessThan(SAAS_PLAN_RANK.salonPro);
  });
});
