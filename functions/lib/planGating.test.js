import { describe, it, expect } from 'vitest';
import {
  isBlockingMembership, modulesLostOnDowngrade, buildDowngradeBlockers, SAAS_PLAN_RANK,
} from './planGating.js';

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
  it('pro → studio drops the four pro modules', () => {
    expect(modulesLostOnDowngrade('pro', 'studio').sort()).toEqual(['chat', 'hr', 'marketing', 'memberships']);
  });
  it('pro → starter drops pro + studio modules but keeps starter', () => {
    const lost = modulesLostOnDowngrade('pro', 'starter');
    expect(lost).toContain('memberships');
    expect(lost).toContain('reports');
    expect(lost).not.toContain('schedule');
  });
  it('upgrade / same returns empty', () => {
    expect(modulesLostOnDowngrade('studio', 'pro')).toEqual([]);
    expect(modulesLostOnDowngrade('pro', 'pro')).toEqual([]);
  });
});

describe('buildDowngradeBlockers', () => {
  it('blocks memberships while client subs are still billing', () => {
    const { blockers } = buildDowngradeBlockers('pro', 'studio', { activeMembershipCount: 3, disabledModules: ['chat', 'hr', 'marketing'] });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({ moduleId: 'memberships', count: 3 });
    expect(blockers[0].reason).toMatch(/cancel them first/);
  });
  it('singular wording for one membership', () => {
    const { blockers } = buildDowngradeBlockers('pro', 'studio', { activeMembershipCount: 1, disabledModules: ['chat', 'hr', 'marketing'] });
    expect(blockers[0].reason).toMatch(/1 active membership .*cancel it first/);
  });
  it('blocks every dropped module that is still enabled', () => {
    const { blockers } = buildDowngradeBlockers('pro', 'studio', { activeMembershipCount: 0, disabledModules: [] });
    const ids = blockers.map(b => b.moduleId).sort();
    expect(ids).toEqual(['chat', 'hr', 'marketing']); // memberships clear (count 0)
  });
  it('is clear once all dropped modules are off and no active memberships', () => {
    const { blockers } = buildDowngradeBlockers('pro', 'studio', { activeMembershipCount: 0, disabledModules: ['chat', 'hr', 'marketing', 'memberships'] });
    expect(blockers).toEqual([]);
  });
  it('memberships count is ignored when the downgrade does not drop memberships', () => {
    // studio → starter never had memberships available; count must not matter.
    const { blockers } = buildDowngradeBlockers('studio', 'starter', { activeMembershipCount: 5, disabledModules: ['reports', 'earnings', 'attendance', 'giftcards', 'meetings', 'products'] });
    expect(blockers).toEqual([]);
  });
});

describe('SAAS_PLAN_RANK', () => {
  it('orders the tiers', () => {
    expect(SAAS_PLAN_RANK.starter).toBeLessThan(SAAS_PLAN_RANK.studio);
    expect(SAAS_PLAN_RANK.studio).toBeLessThan(SAAS_PLAN_RANK.pro);
  });
});
