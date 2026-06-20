import { describe, it, expect } from 'vitest';
import { buildIntakeToken, verifyIntakeToken } from './intakeToken.js';
import { buildApptManageToken } from './apptManage.js';

const SECRET = 'test-secret-abc';
const future = Math.floor(Date.now() / 1000) + 3600;
const past   = Math.floor(Date.now() / 1000) - 10;

describe('intake token', () => {
  it('round-trips a valid token', () => {
    const t = buildIntakeToken(SECRET, 'tid1', 'form1', 'client1', future);
    expect(verifyIntakeToken(SECRET, 'tid1', 'form1', 'client1', future, t)).toBe(true);
  });
  it('rejects a tampered tenant / form / client', () => {
    const t = buildIntakeToken(SECRET, 'tid1', 'form1', 'client1', future);
    expect(verifyIntakeToken(SECRET, 'tidX', 'form1', 'client1', future, t)).toBe(false);
    expect(verifyIntakeToken(SECRET, 'tid1', 'formX', 'client1', future, t)).toBe(false);
    expect(verifyIntakeToken(SECRET, 'tid1', 'form1', 'clientX', future, t)).toBe(false);
  });
  it('rejects an expired token', () => {
    const t = buildIntakeToken(SECRET, 'tid1', 'form1', 'client1', past);
    expect(verifyIntakeToken(SECRET, 'tid1', 'form1', 'client1', past, t)).toBe(false);
  });
  it('rejects a wrong secret and missing args', () => {
    const t = buildIntakeToken(SECRET, 'tid1', 'form1', 'client1', future);
    expect(verifyIntakeToken('other', 'tid1', 'form1', 'client1', future, t)).toBe(false);
    expect(verifyIntakeToken(SECRET, '', 'form1', 'client1', future, t)).toBe(false);
    expect(verifyIntakeToken(SECRET, 'tid1', 'form1', 'client1', future, '')).toBe(false);
  });
  it('is NOT interchangeable with an appointment-manage token (namespaced payload)', () => {
    // Same secret + same id positions, but the appt token signs a different
    // payload prefix — it must not validate as an intake token.
    const apptTok = buildApptManageToken(SECRET, 'tid1', 'form1', future);
    expect(verifyIntakeToken(SECRET, 'tid1', 'form1', 'form1', future, apptTok)).toBe(false);
  });
});
