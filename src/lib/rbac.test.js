import { describe, it, expect } from 'vitest';
import { normalizeRole, roleCan, roleCaps, roleLabel, isManagementRole, isOwner, ROLE_CAPS, CAPS, resolveRoleCaps, sanitizeCaps, roleExists, CAP_GROUPS, DELEGATED_RULE_CAPS, OWNER_ONLY } from './rbac';

describe('normalizeRole', () => {
  it('maps legacy aliases to canonical roles', () => {
    expect(normalizeRole('admin')).toBe('owner');
    expect(normalizeRole('tech')).toBe('staff');
    expect(normalizeRole('front_desk')).toBe('scheduler');
  });
  it('passes canonical roles through (case/space-insensitive)', () => {
    expect(normalizeRole('Owner')).toBe('owner');
    expect(normalizeRole(' manager ')).toBe('manager');
    expect(normalizeRole('scheduler')).toBe('scheduler');
  });
  it('returns null for unknown/empty so typos grant nothing', () => {
    expect(normalizeRole('superadmin')).toBeNull();
    expect(normalizeRole('')).toBeNull();
    expect(normalizeRole(null)).toBeNull();
  });
});

describe('owner-only boundary (Manager cannot do these)', () => {
  for (const cap of ['hr', 'settings', 'users', 'billing']) {
    it(`owner can ${cap}, manager cannot`, () => {
      expect(roleCan('owner', cap)).toBe(true);
      expect(roleCan('manager', cap)).toBe(false);
    });
  }
});

describe('owner has every capability', () => {
  it('owner ⊇ all caps', () => {
    // owner's cap list is the full CAPS set
    expect(roleCan('owner', 'refund')).toBe(true);
    expect(roleCan('owner', 'reports')).toBe(true);
    expect(roleCan('owner', 'billing')).toBe(true);
  });
});

describe('manager', () => {
  it('runs full operations: reports, refunds, schedule_all, gift cards, inventory, employees', () => {
    for (const c of ['pos', 'refund', 'reports', 'schedule_all', 'giftcards_manage', 'products_edit', 'employees', 'marketing', 'earnings_all'])
      expect(roleCan('manager', c)).toBe(true);
  });
});

describe('staff (tech)', () => {
  it('checkout, own schedule, clients, own earnings — but not all-schedule/reports/refund', () => {
    expect(roleCan('staff', 'pos')).toBe(true);
    expect(roleCan('staff', 'schedule')).toBe(true);
    expect(roleCan('staff', 'clients')).toBe(true);     // view + edit (confirmed)
    expect(roleCan('staff', 'earnings_own')).toBe(true);
    expect(roleCan('staff', 'schedule_all')).toBe(false);
    expect(roleCan('staff', 'earnings_all')).toBe(false);
    expect(roleCan('staff', 'reports')).toBe(false);
    expect(roleCan('staff', 'refund')).toBe(false);
  });
});

describe('scheduler (front desk)', () => {
  it('checkout, all schedules, clients, sell gift cards, walk-ins — but NO reports/earnings', () => {
    expect(roleCan('scheduler', 'pos')).toBe(true);
    expect(roleCan('scheduler', 'schedule_all')).toBe(true);
    expect(roleCan('scheduler', 'clients')).toBe(true);
    expect(roleCan('scheduler', 'giftcards_sell')).toBe(true);
    expect(roleCan('scheduler', 'walkin')).toBe(true);
    expect(roleCan('scheduler', 'reports')).toBe(false);   // confirmed: no reports
    expect(roleCan('scheduler', 'earnings_own')).toBe(false);
    expect(roleCan('scheduler', 'giftcards_manage')).toBe(false);
    expect(roleCan('scheduler', 'refund')).toBe(false);
  });
});

describe('kiosk (privilege-escalation guard)', () => {
  it('has zero capabilities and is not a management role', () => {
    expect(roleCaps('kiosk')).toEqual([]);
    expect(isManagementRole('kiosk')).toBe(false);
    for (const c of ['pos', 'settings', 'users', 'reports', 'clients'])
      expect(roleCan('kiosk', c)).toBe(false);
  });
});

describe('readonly', () => {
  it('can view schedule/clients/reports, no edit/action caps', () => {
    expect(roleCan('readonly', 'reports')).toBe(true);
    expect(roleCan('readonly', 'clients')).toBe(true);
    expect(roleCan('readonly', 'pos')).toBe(false);
    expect(roleCan('readonly', 'refund')).toBe(false);
    expect(roleCan('readonly', 'schedule_all')).toBe(false);
  });
});

describe('helpers', () => {
  it('isOwner survives the admin→owner rename', () => {
    expect(isOwner('admin')).toBe(true);
    expect(isOwner('owner')).toBe(true);
    expect(isOwner('manager')).toBe(false);
  });
  it('roleLabel + unknown → No access', () => {
    expect(roleLabel('admin')).toBe('Owner');
    expect(roleLabel('bogus')).toBe('No access');
    expect(roleCan('bogus', 'pos')).toBe(false);
  });
  it('isManagementRole true for staff/scheduler/manager/owner, false for kiosk/unknown', () => {
    for (const r of ['owner', 'manager', 'staff', 'scheduler', 'readonly']) expect(isManagementRole(r)).toBe(true);
    expect(isManagementRole('kiosk')).toBe(false);
    expect(isManagementRole('bogus')).toBe(false);
  });
});

describe('matrix integrity', () => {
  it('every role maps to a defined cap list', () => {
    for (const r of Object.keys(ROLE_CAPS)) expect(Array.isArray(ROLE_CAPS[r])).toBe(true);
  });
});

describe('server matrix is in sync (functions/lib/rbac.js)', () => {
  it('ROLE_CAPS identical to the web copy — server is the security boundary', async () => {
    const server = await import('../../functions/lib/rbac.js');
    expect(Object.keys(server.ROLE_CAPS).sort()).toEqual(Object.keys(ROLE_CAPS).sort());
    for (const r of Object.keys(ROLE_CAPS)) {
      expect(server.ROLE_CAPS[r].slice().sort()).toEqual(ROLE_CAPS[r].slice().sort());
    }
  });
  it('overlay resolution matches across copies (custom role + override)', async () => {
    const server = await import('../../functions/lib/rbac.js');
    const overlay = { roles: [{ key: 'custom_x', caps: ['pos', 'clients'] }], overrides: { manager: { caps: ['reports'] } } };
    for (const role of ['owner', 'admin', 'manager', 'staff', 'custom_x', 'kiosk', 'nope']) {
      for (const cap of ['pos', 'reports', 'hr', 'clients']) {
        expect(server.roleCan(role, cap, overlay)).toBe(roleCan(role, cap, overlay));
      }
    }
  });
  it('DELEGATED_RULE_CAPS in sync across copies, all real + none owner-only', async () => {
    const server = await import('../../functions/lib/rbac.js');
    expect(server.DELEGATED_RULE_CAPS.slice().sort()).toEqual(DELEGATED_RULE_CAPS.slice().sort());
    for (const cap of DELEGATED_RULE_CAPS) {
      expect(CAPS).toContain(cap);
      // A delegated cap must NOT be owner-only — else the rules would hand an
      // owner-only collection to a non-owner via capEmails.
      expect(OWNER_ONLY).not.toContain(cap);
    }
  });
});

// ── Custom-roles overlay (new) ───────────────────────────────────────────────
describe('overlay: no overlay = original static behavior (fast path)', () => {
  it('built-ins resolve identically with overlay undefined', () => {
    expect(roleCan('manager', 'marketing')).toBe(true);
    expect(roleCan('manager', 'hr')).toBe(false);
    expect(roleCan('admin', 'billing')).toBe(true);  // alias → owner
    expect(roleCan('custom_x', 'pos')).toBe(false);  // unknown custom w/o overlay → no access (fail closed)
    expect(resolveRoleCaps('custom_x', undefined)).toEqual([]);
  });
});

describe('overlay: overriding a built-in role', () => {
  const overlay = { overrides: { manager: { caps: ['reports', 'clients'] } } };
  it('override REPLACES the role caps', () => {
    expect(roleCan('manager', 'reports', overlay)).toBe(true);
    expect(roleCan('manager', 'marketing', overlay)).toBe(false);
  });
  it('owner can NEVER be weakened by an overlay', () => {
    const evil = { overrides: { owner: { caps: [] }, admin: { caps: [] } } };
    expect(resolveRoleCaps('owner', evil)).toEqual([...CAPS]);
    expect(roleCan('owner', 'billing', evil)).toBe(true);
    expect(roleCan('admin', 'users', evil)).toBe(true);
  });
});

describe('overlay: custom roles', () => {
  const overlay = { roles: [{ key: 'custom_seniortech', label: 'Senior Tech', caps: ['clients', 'pos', 'reports'] }] };
  it('resolves to its own caps', () => {
    expect(roleCan('custom_seniortech', 'reports', overlay)).toBe(true);
    expect(roleCan('custom_seniortech', 'hr', overlay)).toBe(false);
    expect(resolveRoleCaps('custom_seniortech', overlay)).toEqual(['clients', 'pos', 'reports']);
  });
  it('roleExists / isManagementRole recognize custom keys', () => {
    expect(roleExists('custom_seniortech', overlay)).toBe(true);
    expect(roleExists('custom_unknown', overlay)).toBe(false);
    expect(roleExists('manager')).toBe(true);
    expect(isManagementRole('custom_seniortech', overlay)).toBe(true);
    expect(isManagementRole('kiosk', overlay)).toBe(false);
    expect(isManagementRole('custom_empty', { roles: [{ key: 'custom_empty', caps: [] }] })).toBe(false);
  });
});

describe('overlay: cap-injection defense', () => {
  it('sanitizeCaps drops anything not in CAPS', () => {
    expect(sanitizeCaps(['clients', '__hack__', 'billing', 42, null])).toEqual(['clients', 'billing']);
  });
  it('a custom role smuggling a bogus cap only resolves real ones', () => {
    const overlay = { roles: [{ key: 'custom_x', caps: ['__superuser__', 'clients'] }] };
    expect(resolveRoleCaps('custom_x', overlay)).toEqual(['clients']);
  });
});

describe('CAP_GROUPS metadata covers every capability exactly once', () => {
  it('union of grouped caps === CAPS, no dupes', () => {
    const grouped = CAP_GROUPS.flatMap(g => g.caps.map(c => c.cap));
    expect([...grouped].sort()).toEqual([...CAPS].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});
