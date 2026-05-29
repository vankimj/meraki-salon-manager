import { describe, it, expect } from 'vitest';
import { buildStaffEmails, buildAdminEmails, buildScheduleViewOnlyEmails } from './userProjections';

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
