import { describe, it, expect } from 'vitest';
import { effectivePlan, isModuleAvailableForPlan, getVisibleModules, MODULES, PLAN_RANK } from './modules';

describe('effectivePlan', () => {
  it('falls back to pro when no plan is set (grandfathered tenants)', () => {
    expect(effectivePlan({})).toBe('pro');
    expect(effectivePlan(null)).toBe('pro');
    expect(effectivePlan(undefined)).toBe('pro');
  });
  it('returns the explicit plan when set', () => {
    expect(effectivePlan({ plan: 'starter' })).toBe('starter');
    expect(effectivePlan({ plan: 'pro' })).toBe('pro');
    expect(effectivePlan({ plan: 'enterprise' })).toBe('enterprise');
  });
});

describe('isModuleAvailableForPlan', () => {
  it('starter plan can see only starter modules', () => {
    expect(isModuleAvailableForPlan('schedule', 'starter')).toBe(true);
    expect(isModuleAvailableForPlan('clients',  'starter')).toBe(true);
    expect(isModuleAvailableForPlan('reports',  'starter')).toBe(false);
    expect(isModuleAvailableForPlan('marketing','starter')).toBe(false);
    expect(isModuleAvailableForPlan('hr',       'starter')).toBe(false);
  });
  it('pro plan unlocks all pro-tier modules in addition to starter', () => {
    expect(isModuleAvailableForPlan('schedule', 'pro')).toBe(true);
    expect(isModuleAvailableForPlan('reports',  'pro')).toBe(true);
    expect(isModuleAvailableForPlan('marketing','pro')).toBe(true);
    expect(isModuleAvailableForPlan('hr',       'pro')).toBe(true);
  });
  it('returns false for unknown module ids', () => {
    expect(isModuleAvailableForPlan('not-a-real-module', 'pro')).toBe(false);
  });
  it('accepts a module object directly (not just its id)', () => {
    const reports = MODULES.find(m => m.id === 'reports');
    expect(isModuleAvailableForPlan(reports, 'pro')).toBe(true);
    expect(isModuleAvailableForPlan(reports, 'starter')).toBe(false);
  });
});

describe('getVisibleModules', () => {
  const adminCtx = { isAdmin: true };
  const techCtx  = { isAdmin: false };

  it('admin on starter sees only starter modules', () => {
    const ids = getVisibleModules({ plan: 'starter' }, adminCtx).map(m => m.id);
    expect(ids).toContain('schedule');
    expect(ids).toContain('clients');
    expect(ids).not.toContain('reports');
    expect(ids).not.toContain('marketing');
  });

  it('admin on pro sees all modules (none hidden)', () => {
    const ids = getVisibleModules({ plan: 'pro' }, adminCtx).map(m => m.id);
    expect(ids).toContain('reports');
    expect(ids).toContain('marketing');
    expect(ids).toContain('hr');
    expect(ids.length).toBe(MODULES.length);
  });

  it('non-admin (e.g. tech) on pro hides admin-only modules', () => {
    const ids = getVisibleModules({ plan: 'pro' }, techCtx).map(m => m.id);
    expect(ids).toContain('schedule');
    expect(ids).not.toContain('hr');
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('giftcards');
  });

  it('respects hiddenTiles preference (user-hidden tiles)', () => {
    const ids = getVisibleModules(
      { plan: 'pro', hiddenTiles: ['marketing', 'giftcards'] },
      adminCtx,
    ).map(m => m.id);
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('giftcards');
    expect(ids).toContain('reports'); // not hidden, still shown
  });

  it('hiddenTiles param overrides settings.hiddenTiles when provided', () => {
    const ids = getVisibleModules(
      { plan: 'pro', hiddenTiles: ['reports'] },
      { isAdmin: true, hiddenTiles: ['marketing'] },
    ).map(m => m.id);
    // explicit hiddenTiles arg (marketing) wins over settings.hiddenTiles (reports)
    expect(ids).not.toContain('marketing');
    expect(ids).toContain('reports');
  });

  it('plan-locked module cannot be force-shown by removing it from hiddenTiles', () => {
    const ids = getVisibleModules({ plan: 'starter', hiddenTiles: [] }, adminCtx).map(m => m.id);
    expect(ids).not.toContain('marketing'); // pro-tier; plan gate wins
  });

  it('grandfathered tenant (no plan) gets pro-equivalent visibility', () => {
    const ids = getVisibleModules({}, adminCtx).map(m => m.id);
    expect(ids).toContain('reports');
    expect(ids).toContain('marketing');
  });
});

describe('PLAN_RANK', () => {
  it('preserves the starter < pro < enterprise ordering', () => {
    expect(PLAN_RANK.starter).toBeLessThan(PLAN_RANK.pro);
    expect(PLAN_RANK.pro).toBeLessThan(PLAN_RANK.enterprise);
  });
});
