// Pure aggregation helpers for the recurring-revenue canned reports
// (Memberships & Session Packs) and Client Value. Kept free of React/Firestore
// so they're unit-testable. Membership docs follow firestore.js createMembership
// ({ status, price, billingPeriod, planName }); session-pack docs follow
// grantSessionPack ({ status, totalSessions, remaining }).

// Monthly-normalized value of one membership (yearly → /12).
function monthlyValue(m) {
  const price = Number(m.price) || 0;
  return m.billingPeriod === 'yearly' ? price / 12 : price;
}

export function computeMembershipStats(memberships = []) {
  const live = memberships.filter(m => m && m._deleted !== true);
  let active = 0, paused = 0, cancelled = 0, mrr = 0;
  const byPlan = {};
  for (const m of live) {
    const status = m.status || 'active';
    if (status === 'active') {
      active++;
      const mv = monthlyValue(m);
      mrr += mv;
      const k = m.planName || 'Plan';
      (byPlan[k] || (byPlan[k] = { name: k, count: 0, mrr: 0 }));
      byPlan[k].count++;
      byPlan[k].mrr += mv;
    } else if (status === 'paused')    paused++;
    else if (status === 'cancelled' || status === 'ended') cancelled++;
  }
  return {
    active, paused, cancelled,
    mrr, arr: mrr * 12,
    avgValue: active ? mrr / active : 0,
    // Simple churn ratio over the lifetime population we can see (cancelled vs
    // the ever-active base). Not a windowed rate — labelled accordingly in UI.
    churnRate: (active + cancelled) ? cancelled / (active + cancelled) : 0,
    plans: Object.values(byPlan).sort((a, b) => b.mrr - a.mrr),
  };
}

export function computeSessionPackStats(packs = []) {
  const live = packs.filter(p => p && p._deleted !== true);
  let active = 0, depleted = 0, sessionsSold = 0, sessionsRemaining = 0;
  for (const p of live) {
    const total = Number(p.totalSessions) || 0;
    const rem   = Math.max(0, Number(p.remaining) || 0);
    sessionsSold += total;
    sessionsRemaining += rem;
    if ((p.status || 'active') === 'active' && rem > 0) active++;
    else depleted++;
  }
  const sessionsUsed = Math.max(0, sessionsSold - sessionsRemaining);
  return {
    totalPacks: live.length,
    active, depleted,
    sessionsSold, sessionsRemaining, sessionsUsed,
    // Outstanding sessions are a delivery liability (already paid, not yet given).
    utilization: sessionsSold ? sessionsUsed / sessionsSold : 0,
  };
}

// Client lifetime value from computeMetrics()'s byClient dict ({ name, revenue,
// count } keyed by clientId). Returns a sorted list with average ticket.
export function computeClientValue(byClient = {}) {
  return Object.entries(byClient)
    .map(([clientId, c]) => ({
      clientId,
      name: c.name || 'Client',
      revenue: c.revenue || 0,
      visits: c.count || 0,
      avgTicket: c.count ? (c.revenue || 0) / c.count : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
}
