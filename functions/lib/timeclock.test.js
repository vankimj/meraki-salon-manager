import { describe, it, expect } from 'vitest';
import {
  STATES, computeCurrentState, validateTransition, isDuplicate,
  summarizeDay, buildEvent,
  generateSalt, hashPin, verifyPin, isValidPinFormat,
} from './timeclock.js';

const ev = (at, kind, extras = {}) => ({ at, kind, via: 'kiosk', ...extras });

// ── State derivation ────────────────────────────────────────────────────

describe('computeCurrentState', () => {
  it('treats empty / null / undefined as OUT', () => {
    expect(computeCurrentState([])).toBe(STATES.OUT);
    expect(computeCurrentState(null)).toBe(STATES.OUT);
    expect(computeCurrentState(undefined)).toBe(STATES.OUT);
  });
  it('last event is the live state', () => {
    expect(computeCurrentState([ev('2026-05-30T13:00:00Z', 'in')])).toBe(STATES.IN);
    expect(computeCurrentState([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T16:00:00Z', 'break_start'),
    ])).toBe(STATES.ON_BREAK);
    expect(computeCurrentState([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T16:00:00Z', 'break_start'),
      ev('2026-05-30T16:30:00Z', 'break_end'),
    ])).toBe(STATES.IN);
    expect(computeCurrentState([ev('2026-05-30T22:00:00Z', 'out')])).toBe(STATES.OUT);
  });
  it('unknown kind falls back to OUT (defensive)', () => {
    expect(computeCurrentState([ev('2026-05-30T13:00:00Z', 'garbage')])).toBe(STATES.OUT);
  });
});

// ── Transition rules ────────────────────────────────────────────────────

describe('validateTransition', () => {
  it('rejects unknown kinds', () => {
    expect(validateTransition(STATES.OUT, 'lunch').ok).toBe(false);
  });

  it('in: OK from OUT', () => {
    expect(validateTransition(STATES.OUT, 'in').ok).toBe(true);
  });
  it('in: rejected when already in', () => {
    expect(validateTransition(STATES.IN, 'in')).toMatchObject({ ok: false });
  });
  it('in: rejected when on break (must end break first)', () => {
    expect(validateTransition(STATES.ON_BREAK, 'in')).toMatchObject({ ok: false });
  });

  it('out: OK from IN', () => {
    expect(validateTransition(STATES.IN, 'out').ok).toBe(true);
  });
  it('out: OK from ON_BREAK (closes the open break)', () => {
    expect(validateTransition(STATES.ON_BREAK, 'out').ok).toBe(true);
  });
  it('out: rejected from OUT', () => {
    expect(validateTransition(STATES.OUT, 'out')).toMatchObject({ ok: false });
  });

  it('break_start: only valid from IN', () => {
    expect(validateTransition(STATES.IN, 'break_start').ok).toBe(true);
    expect(validateTransition(STATES.OUT, 'break_start').ok).toBe(false);
    expect(validateTransition(STATES.ON_BREAK, 'break_start').ok).toBe(false);
  });
  it('break_end: only valid from ON_BREAK', () => {
    expect(validateTransition(STATES.ON_BREAK, 'break_end').ok).toBe(true);
    expect(validateTransition(STATES.IN, 'break_end').ok).toBe(false);
    expect(validateTransition(STATES.OUT, 'break_end').ok).toBe(false);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────

describe('isDuplicate', () => {
  it('returns false when there is no previous event', () => {
    expect(isDuplicate(null, 'in', '2026-05-30T13:00:00Z')).toBe(false);
  });
  it('returns false for different kinds even at the same time', () => {
    const last = ev('2026-05-30T13:00:00Z', 'in');
    expect(isDuplicate(last, 'break_start', '2026-05-30T13:00:00Z')).toBe(false);
  });
  it('returns true for same kind within the default 30s window', () => {
    const last = ev('2026-05-30T13:00:00Z', 'in');
    expect(isDuplicate(last, 'in', '2026-05-30T13:00:25Z')).toBe(true);
  });
  it('returns false for same kind outside the window', () => {
    const last = ev('2026-05-30T13:00:00Z', 'in');
    expect(isDuplicate(last, 'in', '2026-05-30T13:01:00Z')).toBe(false);
  });
  it('symmetric: works when the new event is BEFORE the last (clock skew)', () => {
    const last = ev('2026-05-30T13:00:30Z', 'in');
    expect(isDuplicate(last, 'in', '2026-05-30T13:00:15Z')).toBe(true);
  });
});

// ── Day summary ─────────────────────────────────────────────────────────

describe('summarizeDay', () => {
  it('empty events: OUT, no totals', () => {
    expect(summarizeDay([])).toMatchObject({
      state: STATES.OUT, firstIn: null, lastOut: null, workedMinutes: 0, breakMinutes: 0,
    });
  });

  it('in → out: counts the gap as worked', () => {
    const s = summarizeDay([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T21:00:00Z', 'out'),  // 8 hours
    ]);
    expect(s.workedMinutes).toBe(8 * 60);
    expect(s.breakMinutes).toBe(0);
    expect(s.firstIn).toBe('2026-05-30T13:00:00Z');
    expect(s.lastOut).toBe('2026-05-30T21:00:00Z');
  });

  it('in → break → end → out: break time excluded from worked', () => {
    const s = summarizeDay([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T16:00:00Z', 'break_start'),
      ev('2026-05-30T16:30:00Z', 'break_end'),  // 30 min break
      ev('2026-05-30T21:00:00Z', 'out'),
    ]);
    // worked: 13-16 (3h) + 16:30-21 (4.5h) = 7.5h = 450
    expect(s.workedMinutes).toBe(450);
    expect(s.breakMinutes).toBe(30);
  });

  it('two breaks in one shift', () => {
    const s = summarizeDay([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T14:00:00Z', 'break_start'),
      ev('2026-05-30T14:15:00Z', 'break_end'),    // 15
      ev('2026-05-30T17:00:00Z', 'break_start'),
      ev('2026-05-30T17:45:00Z', 'break_end'),    // 45
      ev('2026-05-30T21:00:00Z', 'out'),
    ]);
    expect(s.breakMinutes).toBe(15 + 45);
    expect(s.workedMinutes).toBe(8 * 60 - 60);   // 8h total span − 1h break
  });

  it('open shift (still working) counts up to nowIso', () => {
    const s = summarizeDay(
      [ev('2026-05-30T13:00:00Z', 'in')],
      '2026-05-30T15:00:00Z',
    );
    expect(s.state).toBe(STATES.IN);
    expect(s.workedMinutes).toBe(2 * 60);
    expect(s.lastOut).toBe(null);
  });

  it('open break counts up to nowIso, current state is ON_BREAK', () => {
    const s = summarizeDay([
      ev('2026-05-30T13:00:00Z', 'in'),
      ev('2026-05-30T14:00:00Z', 'break_start'),
    ], '2026-05-30T14:45:00Z');
    expect(s.state).toBe(STATES.ON_BREAK);
    expect(s.workedMinutes).toBe(60);  // 13-14 only
    expect(s.breakMinutes).toBe(45);
  });

  it('handles out-of-order events by sorting before walking', () => {
    const s = summarizeDay([
      ev('2026-05-30T21:00:00Z', 'out'),
      ev('2026-05-30T13:00:00Z', 'in'),
    ]);
    expect(s.workedMinutes).toBe(8 * 60);
    expect(s.firstIn).toBe('2026-05-30T13:00:00Z');
    expect(s.lastOut).toBe('2026-05-30T21:00:00Z');
  });
});

// ── Event builder ───────────────────────────────────────────────────────

describe('buildEvent', () => {
  it('uses now when no `at` provided', () => {
    const e = buildEvent('in', 'kiosk');
    expect(e.kind).toBe('in');
    expect(e.via).toBe('kiosk');
    expect(typeof e.at).toBe('string');
    expect(e.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('passes through `at`, byUserId, note', () => {
    const e = buildEvent('out', 'admin_override', {
      at: '2026-05-30T22:00:00Z', byUserId: 'admin_uid_1', note: 'forgot',
    });
    expect(e).toEqual({
      at: '2026-05-30T22:00:00Z',
      kind: 'out',
      via: 'admin_override',
      byUserId: 'admin_uid_1',
      note: 'forgot',
    });
  });
});

// ── PIN format guard ────────────────────────────────────────────────────

describe('isValidPinFormat', () => {
  it('accepts a 4-digit string with leading zeros', () => {
    expect(isValidPinFormat('0000')).toBe(true);
    expect(isValidPinFormat('1234')).toBe(true);
    expect(isValidPinFormat('9999')).toBe(true);
  });
  it('rejects wrong length', () => {
    expect(isValidPinFormat('123')).toBe(false);
    expect(isValidPinFormat('12345')).toBe(false);
  });
  it('rejects non-digits', () => {
    expect(isValidPinFormat('12a4')).toBe(false);
    expect(isValidPinFormat('    ')).toBe(false);
  });
  it('rejects non-strings', () => {
    expect(isValidPinFormat(1234)).toBe(false);
    expect(isValidPinFormat(null)).toBe(false);
  });
});

// ── Salt + hash + verify ────────────────────────────────────────────────

describe('generateSalt', () => {
  it('returns 32 hex chars (16 random bytes)', () => {
    const s = generateSalt();
    expect(s).toMatch(/^[0-9a-f]{32}$/);
  });
  it('successive calls differ', () => {
    expect(generateSalt()).not.toBe(generateSalt());
  });
});

describe('hashPin + verifyPin', () => {
  const salt = generateSalt();

  it('hash → verify roundtrip with correct PIN', () => {
    const h = hashPin('1234', salt);
    expect(verifyPin('1234', salt, h)).toBe(true);
  });
  it('verify fails for wrong PIN', () => {
    const h = hashPin('1234', salt);
    expect(verifyPin('0000', salt, h)).toBe(false);
  });
  it('verify fails for wrong salt (same PIN, different salt)', () => {
    const h = hashPin('1234', salt);
    expect(verifyPin('1234', generateSalt(), h)).toBe(false);
  });
  it('hash returns null on missing args', () => {
    expect(hashPin(null, salt)).toBe(null);
    expect(hashPin('1234', null)).toBe(null);
    expect(hashPin('', salt)).toBe(null);
  });
  it('verify rejects missing args without throwing', () => {
    expect(verifyPin(null, salt, 'abc')).toBe(false);
    expect(verifyPin('1234', null, 'abc')).toBe(false);
    expect(verifyPin('1234', salt, null)).toBe(false);
    expect(verifyPin('', salt, 'abc')).toBe(false);
  });
  it('produces a 64-char hex hash (32 bytes)', () => {
    expect(hashPin('1234', salt)).toMatch(/^[0-9a-f]{64}$/);
  });
});
