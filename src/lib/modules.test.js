import { describe, it, expect } from 'vitest';
import { effectivePlan, isModuleAvailableForPlan, isModuleEnabled, modulesLostOnDowngrade, getVisibleModules, MODULES, PLAN_RANK, isInTrial, trialDaysRemaining } from './modules';

describe('effectivePlan', () => {
  it('falls back to pro when no plan is set (grandfathered tenants)', () => {
    expect(effectivePlan({})).toBe('pro');
    expect(effectivePlan(null)).toBe('pro');
    expect(effectivePlan(undefined)).toBe('pro');
  });
  it('returns the explicit plan when set', () => {
    expect(effectivePlan({ plan: 'starter' })).toBe('starter');
    expect(effectivePlan({ plan: 'studio' })).toBe('studio');
    expect(effectivePlan({ plan: 'pro' })).toBe('pro');
    expect(effectivePlan({ plan: 'enterprise' })).toBe('enterprise');
  });
  it('downgrades to starter when trial has expired', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePlan({ plan: 'pro', trialEndsAt: pastDate })).toBe('starter');
    expect(effectivePlan({ plan: 'studio', trialEndsAt: pastDate })).toBe('starter');
  });
  it('honors plan while trial is still active', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePlan({ plan: 'pro', trialEndsAt: futureDate })).toBe('pro');
  });
});

describe('isInTrial / trialDaysRemaining', () => {
  it('isInTrial returns false when no trialEndsAt set', () => {
    expect(isInTrial({ plan: 'pro' })).toBe(false);
  });
  it('isInTrial returns true while trial is in the future', () => {
    const futureDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(isInTrial({ trialEndsAt: futureDate })).toBe(true);
  });
  it('trialDaysRemaining returns rounded-up days left', () => {
    const futureDate = new Date(Date.now() + 13.4 * 24 * 60 * 60 * 1000).toISOString();
    expect(trialDaysRemaining({ trialEndsAt: futureDate })).toBe(14);
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
  it('studio plan unlocks reports/earnings/inventory but not communications/marketing/hr', () => {
    expect(isModuleAvailableForPlan('schedule',  'studio')).toBe(true);
    expect(isModuleAvailableForPlan('reports',   'studio')).toBe(true);
    expect(isModuleAvailableForPlan('earnings',  'studio')).toBe(true);
    expect(isModuleAvailableForPlan('giftcards', 'studio')).toBe(true);
    expect(isModuleAvailableForPlan('products',  'studio')).toBe(true);
    expect(isModuleAvailableForPlan('chat',      'studio')).toBe(false);
    expect(isModuleAvailableForPlan('marketing', 'studio')).toBe(false);
    expect(isModuleAvailableForPlan('hr',        'studio')).toBe(false);
    expect(isModuleAvailableForPlan('memberships','studio')).toBe(false);
  });
  it('pro plan unlocks everything', () => {
    expect(isModuleAvailableForPlan('schedule',   'pro')).toBe(true);
    expect(isModuleAvailableForPlan('reports',    'pro')).toBe(true);
    expect(isModuleAvailableForPlan('chat',       'pro')).toBe(true);
    expect(isModuleAvailableForPlan('marketing',  'pro')).toBe(true);
    expect(isModuleAvailableForPlan('hr',         'pro')).toBe(true);
    expect(isModuleAvailableForPlan('memberships','pro')).toBe(true);
  });
  it('returns false for unknown module ids', () => {
    expect(isModuleAvailableForPlan('not-a-real-module', 'pro')).toBe(false);
  });
  it('accepts a module object directly (not just its id)', () => {
    const reports = MODULES.find(m => m.id === 'reports');
    expect(isModuleAvailableForPlan(reports, 'studio')).toBe(true);
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

  it('admin on studio sees starter + studio modules but not pro modules', () => {
    const ids = getVisibleModules({ plan: 'studio' }, adminCtx).map(m => m.id);
    expect(ids).toContain('schedule');
    expect(ids).toContain('reports');
    expect(ids).toContain('giftcards');
    expect(ids).not.toContain('chat');
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('hr');
  });

  it('admin on pro sees all modules except flag-gated ones (none hidden)', () => {
    const ids = getVisibleModules({ plan: 'pro' }, adminCtx).map(m => m.id);
    expect(ids).toContain('reports');
    expect(ids).toContain('marketing');
    expect(ids).toContain('hr');
    expect(ids).not.toContain('grow'); // flag-gated, hidden until the flag is on
    expect(ids.length).toBe(MODULES.filter(m => !m.flag).length);
  });

  it('a flag-gated module appears only when hasFeature enables its flag', () => {
    const off = getVisibleModules({ plan: 'pro' }, adminCtx).map(m => m.id);
    expect(off).not.toContain('grow');
    const on = getVisibleModules({ plan: 'pro' }, { ...adminCtx, hasFeature: (f) => f === 'launchGrow' }).map(m => m.id);
    expect(on).toContain('grow');
    expect(on.length).toBe(MODULES.length);
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

describe('isModuleEnabled', () => {
  it('returns true when disabledModules is absent', () => {
    expect(isModuleEnabled({}, 'memberships')).toBe(true);
    expect(isModuleEnabled({ plan: 'pro' }, 'hr')).toBe(true);
  });
  it('returns false for a module the owner turned off', () => {
    expect(isModuleEnabled({ disabledModules: ['memberships'] }, 'memberships')).toBe(false);
    expect(isModuleEnabled({ disabledModules: ['memberships'] }, 'hr')).toBe(true);
  });
});

describe('modulesLostOnDowngrade', () => {
  it('pro → studio drops the four pro modules', () => {
    const ids = modulesLostOnDowngrade('pro', 'studio').map(m => m.id);
    expect(ids.sort()).toEqual(['chat', 'hr', 'marketing', 'memberships']);
  });
  it('pro → starter drops both pro and studio modules', () => {
    const ids = modulesLostOnDowngrade('pro', 'starter').map(m => m.id);
    expect(ids).toContain('memberships'); // pro
    expect(ids).toContain('reports');     // studio
    expect(ids).not.toContain('schedule'); // starter stays
  });
  it('studio → starter drops only studio modules', () => {
    const ids = modulesLostOnDowngrade('studio', 'starter').map(m => m.id);
    expect(ids).toContain('reports');
    expect(ids).not.toContain('memberships'); // wasn't available on studio anyway
  });
  it('upgrades and same-plan return nothing', () => {
    expect(modulesLostOnDowngrade('studio', 'pro')).toEqual([]);
    expect(modulesLostOnDowngrade('pro', 'pro')).toEqual([]);
  });
});

describe('getVisibleModules with disabledModules', () => {
  it('hides a module the owner turned off even though the plan includes it', () => {
    const ids = getVisibleModules({ plan: 'pro', disabledModules: ['memberships'] }, { isAdmin: true }).map(m => m.id);
    expect(ids).not.toContain('memberships');
    expect(ids).toContain('hr'); // not disabled, still shown
  });
});

describe('PLAN_RANK', () => {
  it('preserves the starter < studio < pro < enterprise ordering', () => {
    expect(PLAN_RANK.starter).toBeLessThan(PLAN_RANK.studio);
    expect(PLAN_RANK.studio).toBeLessThan(PLAN_RANK.pro);
    expect(PLAN_RANK.pro).toBeLessThan(PLAN_RANK.enterprise);
  });
});
