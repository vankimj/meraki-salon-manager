'use strict';

// Tech time-clock state machine, day summary, and PIN hashing.
//
// Pure module — `db` and firebase-admin are intentionally NOT imported.
// The callable in functions/index.js owns Firestore reads/writes and feeds
// events through these helpers so the transitions, idempotency, and PIN
// verification are unit-testable against a fake event list / fake employee.
//
// Data model (lives on tenants/{tid}/attendance/{date}.entries[i].events):
//   events: [
//     { at: ISO, kind: 'in' | 'break_start' | 'break_end' | 'out',
//       via: 'kiosk' | 'admin_override' | 'admin_edit' | 'auto_close',
//       byUserId?: <admin uid for override/edit>,
//       note?: <free text for auto_close reason>
//     }
//   ]
//
// The old `clockInAt` / `clockOutAt` snapshot shape is preserved by the
// AttendanceAdmin read path (firstIn / lastOut derived from events) until
// every consumer is migrated.

const crypto = require('crypto');

// ── State machine ────────────────────────────────────────────────────────

const STATES = {
  OUT:      'out',
  IN:       'in',
  ON_BREAK: 'on_break',
};

const KINDS = ['in', 'break_start', 'break_end', 'out'];

// Maps "last event kind" → current state. Missing / unknown → 'out'.
function computeCurrentState(events) {
  if (!Array.isArray(events) || events.length === 0) return STATES.OUT;
  const last = events[events.length - 1];
  switch (last && last.kind) {
    case 'in':          return STATES.IN;
    case 'break_start': return STATES.ON_BREAK;
    case 'break_end':   return STATES.IN;
    case 'out':         return STATES.OUT;
    default:            return STATES.OUT;
  }
}

// Returns { ok: true } on a valid transition, { ok: false, reason } otherwise.
// Treats clock-out from `on_break` as valid — it closes the open break and
// ends the shift (a tech who walked out mid-break, captured later).
function validateTransition(currentState, requestedKind) {
  if (!KINDS.includes(requestedKind)) {
    return { ok: false, reason: `unknown kind "${requestedKind}"` };
  }
  switch (requestedKind) {
    case 'in':
      if (currentState === STATES.IN)       return { ok: false, reason: 'already clocked in' };
      if (currentState === STATES.ON_BREAK) return { ok: false, reason: 'already clocked in (currently on break) — end break first' };
      return { ok: true };
    case 'out':
      if (currentState === STATES.OUT) return { ok: false, reason: 'already clocked out' };
      return { ok: true };
    case 'break_start':
      if (currentState !== STATES.IN) return { ok: false, reason: `cannot start break while ${currentState}` };
      return { ok: true };
    case 'break_end':
      if (currentState !== STATES.ON_BREAK) return { ok: false, reason: 'not currently on break' };
      return { ok: true };
  }
  return { ok: false, reason: 'unreachable' };
}

// Idempotency: a repeat of the same kind within `windowMs` of the previous
// event is a duplicate (handles kiosk double-tap, webhook re-delivery, the
// admin clicking twice). Different kinds always pass.
function isDuplicate(lastEvent, newKind, newAtIso, windowMs = 30 * 1000) {
  if (!lastEvent || lastEvent.kind !== newKind) return false;
  const lastMs = new Date(lastEvent.at).getTime();
  const newMs  = new Date(newAtIso).getTime();
  if (!Number.isFinite(lastMs) || !Number.isFinite(newMs)) return false;
  return Math.abs(newMs - lastMs) < windowMs;
}

// ── Day summary ──────────────────────────────────────────────────────────

// Walks the events in chronological order and computes totals:
//   state         — current state from the last event
//   firstIn       — ISO of the earliest 'in' (or break_end starting a shift)
//   lastOut       — ISO of the last 'out', or null if still working
//   workedMinutes — total clocked-in minutes (excludes breaks)
//   breakMinutes  — total break minutes (closed breaks only — open break
//                   tail is counted up to `nowIso`)
//
// Open shift / open break tails count up to `nowIso` so the admin live-now
// view can show "Tess — 5h 23m worked, on break for 47 min" mid-day.
function summarizeDay(events, nowIso) {
  const sorted = (Array.isArray(events) ? events : [])
    .slice()
    .sort((a, b) => String(a && a.at || '').localeCompare(String(b && b.at || '')));
  let firstIn = null, lastOut = null;
  let workedMs = 0, breakMs = 0;
  let inAt = null, breakAt = null;
  const nowMs = nowIso
    ? new Date(nowIso).getTime()
    : (sorted.length ? new Date(sorted[sorted.length - 1].at).getTime() : Date.now());
  for (const ev of sorted) {
    const t = new Date(ev.at).getTime();
    if (!Number.isFinite(t)) continue;
    if (ev.kind === 'in') {
      if (!firstIn) firstIn = ev.at;
      if (!inAt) inAt = t;
    } else if (ev.kind === 'break_start') {
      if (inAt)    { workedMs += (t - inAt); inAt = null; }
      if (!breakAt) breakAt = t;
    } else if (ev.kind === 'break_end') {
      if (breakAt) { breakMs  += (t - breakAt); breakAt = null; }
      if (!inAt)   inAt = t;
    } else if (ev.kind === 'out') {
      if (inAt)    { workedMs += (t - inAt); inAt = null; }
      if (breakAt) { breakMs  += (t - breakAt); breakAt = null; }
      lastOut = ev.at;
    }
  }
  if (inAt)    workedMs += Math.max(0, nowMs - inAt);
  if (breakAt) breakMs  += Math.max(0, nowMs - breakAt);
  return {
    state:         computeCurrentState(sorted),
    firstIn,
    lastOut,
    workedMinutes: Math.max(0, Math.round(workedMs / 60000)),
    breakMinutes:  Math.max(0, Math.round(breakMs  / 60000)),
  };
}

// ── Event builder ────────────────────────────────────────────────────────

function buildEvent(kind, via, options) {
  const opts = options || {};
  const ev = {
    at:   opts.at || new Date().toISOString(),
    kind,
    via,
  };
  if (opts.byUserId) ev.byUserId = opts.byUserId;
  if (opts.note)     ev.note     = opts.note;
  return ev;
}

// ── PIN hashing (scrypt) ─────────────────────────────────────────────────
//
// 4-digit PINs have only 10,000 possibilities so the threat model is
// realistic-only: a stolen DB shouldn't reveal PINs to a buddy-puncher.
// scrypt with N=2^14 is ~50ms per hash on a Cloud Functions instance,
// which makes a full DB-wide PIN crack take >10 min per employee and
// keeps the kiosk verify path under 100ms total.

const SCRYPT_N   = 1 << 14;
const SCRYPT_R   = 8;
const SCRYPT_P   = 1;
const SCRYPT_LEN = 32;

function generateSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPin(pin, salt) {
  if (pin == null || pin === '' || !salt) return null;
  const buf = crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), SCRYPT_LEN, {
    N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P,
  });
  return buf.toString('hex');
}

function verifyPin(pin, salt, expectedHash) {
  if (!pin || !salt || !expectedHash) return false;
  const got = hashPin(pin, salt);
  if (!got) return false;
  const a = Buffer.from(got, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Basic PIN format guard — 4 digits, leading zeros allowed. Trims first.
function isValidPinFormat(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin.trim());
}

module.exports = {
  STATES,
  KINDS,
  computeCurrentState,
  validateTransition,
  isDuplicate,
  summarizeDay,
  buildEvent,
  generateSalt,
  hashPin,
  verifyPin,
  isValidPinFormat,
};
