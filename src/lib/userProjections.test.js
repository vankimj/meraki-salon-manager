import { describe, it, expect } from 'vitest';
import { buildStaffEmails, buildAdminEmails, buildScheduleViewOnlyEmails, buildCapEmails } from './userProjections';
import { DELEGATED_RULE_CAPS, CAPS } from './rbac';

const USERS = [
  { email: 'Owner@Meraki.com',  role: 'admin' },
  { email: 'desk@meraki.com',   role: 'scheduler' },
  { email: 'view@meraki.com',   role: 'readonly' },
  { email: 'tess@meraki.com',   role: 'tech', scheduleAccess: 'edit' },
  { email: 'ana@meraki.com',    role: 'tech', scheduleAccess: 'view' },
  { email: 'jen@meraki.com',    role: 'tech' },                       // no scheduleAccess → defaults to edit
  { email: 'pending@meraki.com', role: 'pending' },
  { email: 'denied@meraki.com',  role: 'denied' },
];

describe('buildStaffEmails', () => {
  it('includes admin/readonly/tech/scheduler, lowercased, excludes pending/denied', () => {
    expect(buildStaffEmails(USERS).sort()).toEqual(
      ['ana@meraki.com', 'desk@meraki.com', 'jen@meraki.com', 'owner@meraki.com', 'tess@meraki.com', 'view@meraki.com'].sort(),
    );
  });
  it('handles empty/missing input', () => {
    expect(buildStaffEmails([])).toEqual([]);
    expect(buildStaffEmails(undefined)).toEqual([]);
  });
});

describe('buildAdminEmails', () => {
  it('includes only admins', () => {
    expect(buildAdminEmails(USERS)).toEqual(['owner@meraki.com']);
  });
});

describe('manager role (RBAC)', () => {
  const WITH_MGR = [...USERS, { email: 'mgr@meraki.com', role: 'manager' }];
  it('manager is STAFF (data access) but NOT admin (no owner-only writes)', () => {
    expect(buildStaffEmails(WITH_MGR)).toContain('mgr@meraki.com');
    expect(buildAdminEmails(WITH_MGR)).not.toContain('mgr@meraki.com');
  });
  it('kiosk is neither staff nor admin (blanket access withheld — see RBAC #8)', () => {
    const withKiosk = [...USERS, { email: 'kiosk@meraki.com', role: 'kiosk' }];
    expect(buildStaffEmails(withKiosk)).not.toContain('kiosk@meraki.com');
    expect(buildAdminEmails(withKiosk)).not.toContain('kiosk@meraki.com');
  });
});

describe('buildCapEmails (capability delegation — rules hasCap())', () => {
  const WITH_MGR = [...USERS, { email: 'mgr@meraki.com', role: 'manager' }];

  it('DELEGATED_RULE_CAPS are all real capabilities', () => {
    for (const cap of DELEGATED_RULE_CAPS) expect(CAPS).toContain(cap);
  });

  it('emits an array for every delegated cap (so a revoke clears it)', () => {
    const out = buildCapEmails(USERS);
    expect(Object.keys(out).sort()).toEqual([...DELEGATED_RULE_CAPS].sort());
    for (const cap of DELEGATED_RULE_CAPS) expect(Array.isArray(out[cap])).toBe(true);
  });

  it('manager (has attendance + marketing) lands in both lists; owner too', () => {
    const out = buildCapEmails(WITH_MGR);
    expect(out.attendance).toContain('mgr@meraki.com');
    expect(out.marketing).toContain('mgr@meraki.com');
    expect(out.attendance).toContain('owner@meraki.com');   // owner ⊇ all caps
  });

  it('tech / scheduler / readonly / kiosk are NOT delegated attendance or marketing', () => {
    const out = buildCapEmails(USERS);
    for (const e of ['tess@meraki.com', 'desk@meraki.com', 'view@meraki.com']) {
      expect(out.attendance).not.toContain(e);
      expect(out.marketing).not.toContain(e);
    }
  });

  it('honors a custom-role overlay (attendance granted to a custom key)', () => {
    const users = [{ email: 'lead@x.com', role: 'custom_lead' }];
    const overlay = { roles: [{ key: 'custom_lead', caps: ['attendance', 'clients'] }] };
    const out = buildCapEmails(users, overlay);
    expect(out.attendance).toEqual(['lead@x.com']);
    expect(out.marketing).toEqual([]);
  });

  it('handles empty/missing input', () => {
    const out = buildCapEmails(undefined);
    for (const cap of DELEGATED_RULE_CAPS) expect(out[cap]).toEqual([]);
  });
});

describe('buildScheduleViewOnlyEmails', () => {
  it('includes only techs explicitly set to view-only', () => {
    expect(buildScheduleViewOnlyEmails(USERS)).toEqual(['ana@meraki.com']);
  });
  it('a tech with no scheduleAccess is NOT view-only (defaults to edit)', () => {
    expect(buildScheduleViewOnlyEmails([{ email: 'jen@meraki.com', role: 'tech' }])).toEqual([]);
  });
  it('view-only setting on a non-tech role is ignored', () => {
    const users = [
      { email: 'a@x.com', role: 'admin',     scheduleAccess: 'view' },
      { email: 'b@x.com', role: 'scheduler', scheduleAccess: 'view' },
      { email: 'c@x.com', role: 'readonly',  scheduleAccess: 'view' },
    ];
    expect(buildScheduleViewOnlyEmails(users)).toEqual([]);
  });
  it('lowercases + dedupes emails', () => {
    const users = [
      { email: 'Ana@Meraki.com', role: 'tech', scheduleAccess: 'view' },
      { email: 'ana@meraki.com', role: 'tech', scheduleAccess: 'view' },
    ];
    expect(buildScheduleViewOnlyEmails(users)).toEqual(['ana@meraki.com']);
  });
  it('handles empty/missing input', () => {
    expect(buildScheduleViewOnlyEmails([])).toEqual([]);
    expect(buildScheduleViewOnlyEmails(undefined)).toEqual([]);
  });
});
