// Pure helpers for session-credit packs. Kept free of firebase so the
// pack-selection + decrement-decision logic is unit-testable.

// Choose which of a client's packs to redeem a completed session against:
// the OLDEST still-active pack that has sessions remaining (FIFO — use up the
// pack they bought first). Returns null when none qualify.
function pickActivePack(packs) {
  const eligible = (packs || []).filter(p => p && (p.status === 'active') && Number(p.remaining) > 0);
  if (!eligible.length) return null;
  eligible.sort((a, b) => String(a.grantedAt || a.createdAt || '').localeCompare(String(b.grantedAt || b.createdAt || '')));
  return eligible[0];
}

// Given a pack's current remaining, compute the post-decrement state.
function decrementState(remaining) {
  const next = Math.max(0, Number(remaining) - 1);
  return { remaining: next, status: next === 0 ? 'depleted' : 'active', low: next > 0 && next <= 2 };
}

module.exports = { pickActivePack, decrementState };
