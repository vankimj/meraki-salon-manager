import { describe, it, expect } from 'vitest';
import { getGroupedModules, getVisibleModules, MODULES, MODULE_GROUPS } from './modules';

describe('getGroupedModules', () => {
  it('buckets every visible module into exactly one of core/grow/admin', () => {
    const opts = { isAdmin: true };
    const settings = { plan: 'pro' };
    const groups = getGroupedModules(settings, opts);
    const total = groups.core.length + groups.grow.length + groups.admin.length;
    expect(total).toBe(getVisibleModules(settings, opts).length);
  });

  it('puts the daily-driver tiles in Core, in MODULES order', () => {
    const groups = getGroupedModules({ plan: 'pro' }, { isAdmin: true });
    expect(groups.core.map(m => m.id)).toEqual(['schedule', 'clients', 'services', 'reports', 'receipts']);
    expect(groups.admin.map(m => m.id)).toContain('admin');
    expect(groups.grow.length).toBeGreaterThan(0);
  });

  it('respects plan gating (starter hides studio/pro tiles)', () => {
    const groups = getGroupedModules({ plan: 'starter' }, { isAdmin: true });
    const ids = [...groups.core, ...groups.grow, ...groups.admin].map(m => m.id);
    expect(ids).toContain('schedule');   // starter
    expect(ids).not.toContain('reports');   // studio-only
    expect(ids).not.toContain('marketing'); // pro-only
  });

  it('every module in the catalog declares a valid group', () => {
    for (const m of MODULES) {
      expect(MODULE_GROUPS).toContain(m.group);
    }
  });
});
