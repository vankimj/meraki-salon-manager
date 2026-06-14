import { describe, it, expect } from 'vitest';
import { effectivePlan, isModuleAvailableForPlan, hasModuleAccess, isModuleEnabled, modulesLostOnDowngrade, getVisibleModules, getEntitlements, MODULES, PLAN_RANK, isInTrial, trialDaysRemaining } from './modules';

describe('effectivePlan', () => {
  it('falls back to salonPro when no plan is set (grandfathered tenants)', () => {
    expect(effectivePlan({})).toBe('salonPro');
    expect(effectivePlan(null)).toBe('salonPro');
    expect(effectivePlan(undefined)).toBe('salonPro');
  });
  it('returns the explicit plan when set', () => {
    expect(effectivePlan({ plan: 'solo' })).toBe('solo');
    expect(effectivePlan({ plan: 'studio' })).toBe('studio');
    expect(effectivePlan({ plan: 'salonPro' })).toBe('salonPro');
    expect(effectivePlan({ plan: 'enterprise' })).toBe('enterprise');
  });
  it('maps legacy plan ids (starter→solo, pro→salonPro)', () => {
    expect(effectivePlan({ plan: 'starter' })).toBe('solo');
    expect(effectivePlan({ plan: 'pro' })).toBe('salonPro');
  });
  it('downgrades to solo when trial has expired', () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePlan({ plan: 'salonPro', trialEndsAt: pastDate })).toBe('solo');
    expect(effectivePlan({ plan: 'studio', trialEndsAt: pastDate })).toBe('solo');
  });
  it('honors plan while trial is still active', () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(effectivePlan({ plan: 'salonPro', trialEndsAt: futureDate })).toBe('salonPro');
  });
});

describe('isInTrial / trialDaysRemaining', () => {
  it('isInTrial returns false when no trialEndsAt set', () => {
    expect(isInTrial({ plan: 'salonPro' })).toBe(false);
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
  it('solo plan includes core ops + POS + reports/gift cards, not comms/marketing/hr', () => {
    expect(isModuleAvailableForPlan('schedule',  'solo')).toBe(true);
    expect(isModuleAvailableForPlan('clients',   'solo')).toBe(true);
    expect(isModuleAvailableForPlan('reports',   'solo')).toBe(true);
    expect(isModuleAvailableForPlan('receipts',  'solo')).toBe(true);
    expect(isModuleAvailableForPlan('giftcards', 'solo')).toBe(true);
    expect(isModuleAvailableForPlan('chat',      'solo')).toBe(false);
    expect(isModuleAvailableForPlan('marketing', 'solo')).toBe(false);
    expect(isModuleAvailableForPlan('hr',        'solo')).toBe(false);
  });
  it('studio adds communications/attendance/products but not marketing/hr/memberships', () => {
    expect(isModuleAvailableForPlan('chat',       'studio')).toBe(true);
    expect(isModuleAvailableForPlan('attendance', 'studio')).toBe(true);
    expect(isModuleAvailableForPlan('products',   'studio')).toBe(true);
    expect(isModuleAvailableForPlan('marketing',  'studio')).toBe(false);
    expect(isModuleAvailableForPlan('hr',         'studio')).toBe(false);
    expect(isModuleAvailableForPlan('memberships','studio')).toBe(false);
  });
  it('salonPro plan unlocks everything', () => {
    expect(isModuleAvailableForPlan('schedule',   'salonPro')).toBe(true);
    expect(isModuleAvailableForPlan('chat',       'salonPro')).toBe(true);
    expect(isModuleAvailableForPlan('marketing',  'salonPro')).toBe(true);
    expect(isModuleAvailableForPlan('hr',         'salonPro')).toBe(true);
    expect(isModuleAvailableForPlan('memberships','salonPro')).toBe(true);
  });
  it('accepts legacy plan ids', () => {
    expect(isModuleAvailableForPlan('reports', 'starter')).toBe(true); // starter→solo
    expect(isModuleAvailableForPlan('hr', 'pro')).toBe(true);          // pro→salonPro
  });
  it('returns false for unknown module ids', () => {
    expect(isModuleAvailableForPlan('not-a-real-module', 'salonPro')).toBe(false);
  });
  it('accepts a module object directly (not just its id)', () => {
    const chat = MODULES.find(m => m.id === 'chat');
    expect(isModuleAvailableForPlan(chat, 'studio')).toBe(true);
    expect(isModuleAvailableForPlan(chat, 'solo')).toBe(false);
  });
});

describe('hasModuleAccess (packs)', () => {
  it('a Solo tenant with the Comms Pack unlocks Communications', () => {
    expect(hasModuleAccess({ plan: 'solo' }, 'chat')).toBe(false);
    expect(hasModuleAccess({ plan: 'solo', packs: ['comms'] }, 'chat')).toBe(true);
  });
  it('the Operations Pack unlocks HR on a Studio base', () => {
    expect(hasModuleAccess({ plan: 'studio' }, 'hr')).toBe(false);
    expect(hasModuleAccess({ plan: 'studio', packs: ['operations'] }, 'hr')).toBe(true);
  });
  it('atomic add-ons unlock too (sms → chat)', () => {
    expect(hasModuleAccess({ plan: 'solo', atomicAddOns: ['sms'] }, 'chat')).toBe(true);
  });
});

describe('getEntitlements', () => {
  it('returns effective plan + unlocked module set', () => {
    const ent = getEntitlements({ plan: 'solo', packs: ['comms', 'marketing'] });
    expect(ent.plan).toBe('solo');
    expect(ent.unlocked.has('chat')).toBe(true);
    expect(ent.unlocked.has('marketing')).toBe(true);
  });
});

describe('getVisibleModules', () => {
  const adminCtx = { isAdmin: true };
  const techCtx  = { isAdmin: false };

  it('admin on solo sees solo modules (incl. reports/gift cards) but not comms/marketing', () => {
    const ids = getVisibleModules({ plan: 'solo' }, adminCtx).map(m => m.id);
    expect(ids).toContain('schedule');
    expect(ids).toContain('reports');
    expect(ids).toContain('giftcards');
    expect(ids).not.toContain('chat');
    expect(ids).not.toContain('marketing');
  });

  it('admin on studio adds communications but not marketing/hr', () => {
    const ids = getVisibleModules({ plan: 'studio' }, adminCtx).map(m => m.id);
    expect(ids).toContain('chat');
    expect(ids).toContain('attendance');
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('hr');
  });

  it('admin on salonPro sees all modules except flag-gated ones (none hidden)', () => {
    const ids = getVisibleModules({ plan: 'salonPro' }, adminCtx).map(m => m.id);
    expect(ids).toContain('marketing');
    expect(ids).toContain('hr');
    expect(ids).not.toContain('grow'); // flag-gated, hidden until the flag is on
    expect(ids.length).toBe(MODULES.filter(m => !m.flag).length);
  });

  it('a purchased pack reveals the unlocked tile on a lower tier', () => {
    const ids = getVisibleModules({ plan: 'solo', packs: ['comms'] }, adminCtx).map(m => m.id);
    expect(ids).toContain('chat');
  });

  it('a flag-gated module appears only when hasFeature enables its flag', () => {
    const off = getVisibleModules({ plan: 'salonPro' }, adminCtx).map(m => m.id);
    expect(off).not.toContain('grow');
    const on = getVisibleModules({ plan: 'salonPro' }, { ...adminCtx, hasFeature: (f) => f === 'launchGrow' }).map(m => m.id);
    expect(on).toContain('grow');
    expect(on.length).toBe(MODULES.length);
  });

  it('non-admin (e.g. tech) on salonPro hides admin-only modules', () => {
    const ids = getVisibleModules({ plan: 'salonPro' }, techCtx).map(m => m.id);
    expect(ids).toContain('schedule');
    expect(ids).not.toContain('hr');
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('giftcards');
  });

  it('respects hiddenTiles preference (user-hidden tiles)', () => {
    const ids = getVisibleModules(
      { plan: 'salonPro', hiddenTiles: ['marketing', 'giftcards'] },
      adminCtx,
    ).map(m => m.id);
    expect(ids).not.toContain('marketing');
    expect(ids).not.toContain('giftcards');
    expect(ids).toContain('reports'); // not hidden, still shown
  });

  it('hiddenTiles param overrides settings.hiddenTiles when provided', () => {
    const ids = getVisibleModules(
      { plan: 'salonPro', hiddenTiles: ['reports'] },
      { isAdmin: true, hiddenTiles: ['marketing'] },
    ).map(m => m.id);
    // explicit hiddenTiles arg (marketing) wins over settings.hiddenTiles (reports)
    expect(ids).not.toContain('marketing');
    expect(ids).toContain('reports');
  });

  it('plan-locked module cannot be force-shown by removing it from hiddenTiles', () => {
    const ids = getVisibleModules({ plan: 'solo', hiddenTiles: [] }, adminCtx).map(m => m.id);
    expect(ids).not.toContain('marketing'); // salonPro-tier; plan gate wins
  });

  it('grandfathered tenant (no plan) gets salonPro-equivalent visibility', () => {
    const ids = getVisibleModules({}, adminCtx).map(m => m.id);
    expect(ids).toContain('reports');
    expect(ids).toContain('marketing');
  });
});

describe('isModuleEnabled', () => {
  it('returns true when disabledModules is absent', () => {
    expect(isModuleEnabled({}, 'memberships')).toBe(true);
    expect(isModuleEnabled({ plan: 'salonPro' }, 'hr')).toBe(true);
  });
  it('returns false for a module the owner turned off', () => {
    expect(isModuleEnabled({ disabledModules: ['memberships'] }, 'memberships')).toBe(false);
    expect(isModuleEnabled({ disabledModules: ['memberships'] }, 'hr')).toBe(true);
  });
});

describe('modulesLostOnDowngrade', () => {
  it('salonPro → studio drops the three salonPro modules', () => {
    const ids = modulesLostOnDowngrade('salonPro', 'studio').map(m => m.id);
    expect(ids.sort()).toEqual(['hr', 'marketing', 'memberships']);
  });
  it('salonPro → solo drops salonPro and studio modules', () => {
    const ids = modulesLostOnDowngrade('salonPro', 'solo').map(m => m.id);
    expect(ids).toContain('memberships'); // salonPro
    expect(ids).toContain('chat');        // studio
    expect(ids).not.toContain('schedule'); // solo stays
    expect(ids).not.toContain('reports');  // solo stays
  });
  it('studio → solo drops only studio modules', () => {
    const ids = modulesLostOnDowngrade('studio', 'solo').map(m => m.id);
    expect(ids).toContain('chat');
    expect(ids).not.toContain('memberships'); // wasn't available on studio anyway
    expect(ids).not.toContain('reports');     // solo-tier, retained
  });
  it('a module kept by a retained pack is not lost', () => {
    const ids = modulesLostOnDowngrade('salonPro', 'solo', new Set(['chat', 'hr'])).map(m => m.id);
    expect(ids).not.toContain('chat');
    expect(ids).not.toContain('hr');
    expect(ids).toContain('marketing');
  });
  it('upgrades and same-plan return nothing', () => {
    expect(modulesLostOnDowngrade('studio', 'salonPro')).toEqual([]);
    expect(modulesLostOnDowngrade('salonPro', 'salonPro')).toEqual([]);
  });
});

describe('getVisibleModules with disabledModules', () => {
  it('hides a module the owner turned off even though the plan includes it', () => {
    const ids = getVisibleModules({ plan: 'salonPro', disabledModules: ['memberships'] }, { isAdmin: true }).map(m => m.id);
    expect(ids).not.toContain('memberships');
    expect(ids).toContain('hr'); // not disabled, still shown
  });
});

describe('PLAN_RANK', () => {
  it('preserves the solo < studio < salonPro < enterprise ordering', () => {
    expect(PLAN_RANK.solo).toBeLessThan(PLAN_RANK.studio);
    expect(PLAN_RANK.studio).toBeLessThan(PLAN_RANK.salonPro);
    expect(PLAN_RANK.salonPro).toBeLessThan(PLAN_RANK.enterprise);
  });
});
