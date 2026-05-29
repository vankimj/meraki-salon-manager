import { describe, it, expect } from 'vitest';
import { apptExpUnix, buildApptManageToken, verifyApptManageToken } from './apptManage.js';

const SECRET = 'unit-test-secret-do-not-use-in-prod';
const TID    = 'meraki';
const APPT   = 'appt_abc123';

describe('apptExpUnix', () => {
  it('returns 24h after parsed appt start time', () => {
    // 2026-06-01T14:00:00 (server-local) → +24h
    const expected = Math.floor(new Date('2026-06-01T14:00:00').getTime() / 1000) + 24 * 3600;
    expect(apptExpUnix({ date: '2026-06-01', startTime: '14:00' })).toBe(expected);
  });
  it('handles missing startTime by treating it as midnight', () => {
    const expected = Math.floor(new Date('2026-06-01T00:00:00').getTime() / 1000) + 24 * 3600;
    expect(apptExpUnix({ date: '2026-06-01' })).toBe(expected);
  });
  it('handles null appt without throwing', () => {
    expect(() => apptExpUnix(null)).not.toThrow();
  });
});

describe('buildApptManageToken', () => {
  it('is deterministic for the same inputs', () => {
    const a = buildApptManageToken(SECRET, TID, APPT, 1900000000);
    const b = buildApptManageToken(SECRET, TID, APPT, 1900000000);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });
  it('differs when any of tid/apptId/exp/secret differ', () => {
    const base = buildApptManageToken(SECRET, TID, APPT, 1900000000);
    expect(buildApptManageToken(SECRET, 'other',    APPT, 1900000000)).not.toBe(base);
    expect(buildApptManageToken(SECRET, TID, 'appt_xyz', 1900000000)).not.toBe(base);
    expect(buildApptManageToken(SECRET, TID, APPT,       1900000001)).not.toBe(base);
    expect(buildApptManageToken('other-secret', TID, APPT, 1900000000)).not.toBe(base);
  });
});

describe('verifyApptManageToken', () => {
  const future = 1900000000; // year 2030+
  const past   = 1500000000; // year 2017
  const token  = buildApptManageToken(SECRET, TID, APPT, future);

  it('accepts a valid token with a future exp', () => {
    expect(verifyApptManageToken(SECRET, TID, APPT, future, token)).toBe(true);
  });
  it('rejects an expired token', () => {
    const pastToken = buildApptManageToken(SECRET, TID, APPT, past);
    expect(verifyApptManageToken(SECRET, TID, APPT, past, pastToken)).toBe(false);
  });
  it('rejects exp exactly equal to now (boundary)', () => {
    const now = 1700000000;
    const t   = buildApptManageToken(SECRET, TID, APPT, now);
    expect(verifyApptManageToken(SECRET, TID, APPT, now, t, now)).toBe(false);
  });
  it('rejects when token is tampered', () => {
    expect(verifyApptManageToken(SECRET, TID, APPT, future, 'aaaaaaaaaaaaaaaa')).toBe(false);
  });
  it('rejects when tenantId is tampered (cross-tenant replay)', () => {
    expect(verifyApptManageToken(SECRET, 'other', APPT, future, token)).toBe(false);
  });
  it('rejects when apptId is tampered (cross-appt replay)', () => {
    expect(verifyApptManageToken(SECRET, TID, 'other-appt', future, token)).toBe(false);
  });
  it('rejects when exp is tampered without re-signing', () => {
    expect(verifyApptManageToken(SECRET, TID, APPT, future + 1, token)).toBe(false);
  });
  it('rejects when signing secret rotates', () => {
    expect(verifyApptManageToken('rotated-secret', TID, APPT, future, token)).toBe(false);
  });
  it('rejects when any arg is missing', () => {
    expect(verifyApptManageToken('',     TID, APPT, future, token)).toBe(false);
    expect(verifyApptManageToken(SECRET, '',  APPT, future, token)).toBe(false);
    expect(verifyApptManageToken(SECRET, TID, '',   future, token)).toBe(false);
    expect(verifyApptManageToken(SECRET, TID, APPT, null,   token)).toBe(false);
    expect(verifyApptManageToken(SECRET, TID, APPT, future, '')).toBe(false);
  });
  it('rejects non-numeric exp', () => {
    expect(verifyApptManageToken(SECRET, TID, APPT, 'soon', token)).toBe(false);
  });
});
