// Structured bonus-rules engine — PURE, dependency-free, React-Native-safe so
// the identical file can be copied to mobile/src/lib/bonusRules.js.
//
// A rule = AND-ed criteria → a payout, evaluated per tech per pay period.
// It is evaluated as a PREVIEW at payroll time; it never writes bonus docs,
// so re-running payroll can never double-pay. See HRAdmin payroll wiring.
//
// Rule shape (Firestore `bonusRules` collection):
//   {
//     name: string,
//     enabled: boolean,
//     scopeTechNames: string[],          // empty = all techs
//     criteria: [{ metric, value }],     // op is always >= (gte)
//     payoutType: 'fixed' | 'pctRevenue' | 'perAppt',
//     payoutValue: number,
//     payoutMax: number | null,          // cap; 0/null = uncapped
//   }

export const BONUS_METRICS = [
  { key: 'serviceRevenue', label: 'Service revenue', unit: '$',     hint: 'Net service revenue this period' },
  { key: 'apptCount',      label: 'Appointments',    unit: 'count', hint: 'Completed appointments this period' },
  { key: 'rebookRate',     label: 'Rebooking rate',  unit: '%',     hint: '% of served clients with a future appointment' },
  { key: 'newClientCount', label: 'New clients',     unit: 'count', hint: 'First-time clients served this period' },
  { key: 'retailSales',    label: 'Retail sales',    unit: '$',     hint: 'Retail/product sales attributed to the tech' },
  { key: 'ratingAvg',      label: 'Avg client rating', unit: '★',   hint: 'Average service rating (0–5) this period' },
  { key: 'tenureMonths',   label: 'Tenure',          unit: 'months', hint: 'Months since hire date' },
];

export const PAYOUT_TYPES = [
  { key: 'fixed',      label: 'Flat amount',     unit: '$',          hint: 'Pay a fixed dollar amount' },
  { key: 'pctRevenue', label: '% of revenue',    unit: '% of rev',   hint: 'Pay a percentage of service revenue' },
  { key: 'perAppt',    label: 'Per appointment', unit: '$ / appt',   hint: 'Pay an amount for each appointment' },
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

function monthsBetween(fromISO, toISO) {
  if (!fromISO || !toISO) return 0;
  const a = new Date(fromISO.length === 10 ? `${fromISO}T00:00:00` : fromISO);
  const b = new Date(toISO.length === 10 ? `${toISO}T00:00:00` : toISO);
  if (isNaN(a) || isNaN(b)) return 0;
  let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (b.getDate() < a.getDate()) m -= 1;
  return Math.max(0, m);
}

function retailForTech(receipts, techName) {
  return (receipts || []).reduce((sum, r) => {
    const owner = r.primaryTechName || r.tech || '';
    if (owner !== techName) return sum;
    const ret = (r.retailProducts || []).reduce((s, x) => s + num(x.price) * (num(x.qty) || 1), 0);
    return sum + ret;
  }, 0);
}

// Build the per-tech metric context the rules are evaluated against.
// Missing inputs degrade gracefully to 0 (documented behaviour).
export function buildBonusContext({
  techName,
  serviceRevenue = 0,
  techAppts = [],
  allAppts = [],
  receipts = [],
  ratings = [],
  hireDate = '',
  startDate = '',
  endDate = '',
} = {}) {
  const served = new Set(techAppts.filter(a => a.clientId).map(a => a.clientId));

  // Prior (before period) and future (after period) client sets, across ALL
  // techs, from a wider appointment window supplied by the caller.
  const priorIds  = new Set();
  const futureIds = new Set();
  for (const a of allAppts) {
    if (!a.clientId || !a.date) continue;
    if (startDate && a.date < startDate) priorIds.add(a.clientId);
    if (endDate   && a.date > endDate)   futureIds.add(a.clientId);
  }

  let newClientCount = 0;
  let rebooked = 0;
  served.forEach(cid => {
    if (!priorIds.has(cid)) newClientCount += 1;
    if (futureIds.has(cid)) rebooked += 1;
  });
  const rebookRate = served.size ? round2((rebooked / served.size) * 100) : 0;

  const myRatings = (ratings || []).filter(r => r.techName === techName && num(r.rating) > 0);
  const ratingAvg = myRatings.length
    ? round2(myRatings.reduce((s, r) => s + num(r.rating), 0) / myRatings.length)
    : 0;

  return {
    techName,
    serviceRevenue: round2(serviceRevenue),
    apptCount:      techAppts.length,
    rebookRate,
    newClientCount,
    retailSales:    round2(retailForTech(receipts, techName)),
    ratingAvg,
    tenureMonths:   monthsBetween(hireDate, endDate || startDate),
  };
}

function ruleApplies(rule, ctx) {
  if (!rule || !rule.enabled) return false;
  const scope = Array.isArray(rule.scopeTechNames) ? rule.scopeTechNames : [];
  if (scope.length && !scope.includes(ctx.techName)) return false;
  const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
  if (!criteria.length) return false; // a rule with no criteria never auto-pays
  return criteria.every(c => num(ctx[c.metric]) >= num(c.value));
}

function payoutAmount(rule, ctx) {
  let amt = 0;
  if (rule.payoutType === 'fixed')      amt = num(rule.payoutValue);
  else if (rule.payoutType === 'pctRevenue') amt = num(ctx.serviceRevenue) * num(rule.payoutValue) / 100;
  else if (rule.payoutType === 'perAppt')    amt = num(ctx.apptCount) * num(rule.payoutValue);
  const max = num(rule.payoutMax);
  if (max > 0) amt = Math.min(amt, max);
  return round2(Math.max(0, amt));
}

// Evaluate a single rule against a context.
export function evaluateRule(rule, ctx) {
  if (!ruleApplies(rule, ctx)) return { matched: false, amount: 0, name: rule?.name || '' };
  return { matched: true, amount: payoutAmount(rule, ctx), name: rule.name || 'Bonus' };
}

// Evaluate every rule; returns the total and the per-rule lines that paid out.
export function evaluateBonusRules(rules, ctx) {
  const lines = [];
  let ruleBonusTotal = 0;
  for (const rule of rules || []) {
    const res = evaluateRule(rule, ctx);
    if (res.matched && res.amount > 0) {
      lines.push({ name: res.name, amount: res.amount });
      ruleBonusTotal += res.amount;
    }
  }
  return { ruleBonusTotal: round2(ruleBonusTotal), ruleBonusLines: lines };
}
