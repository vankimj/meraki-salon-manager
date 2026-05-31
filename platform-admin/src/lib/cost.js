// Cost dashboard data layer. Reads pre-aggregated rollup docs written by
// the nightly aggregator cron — no raw event reads here, so the UI never
// touches per-customer signal (per principle #10).
//
// Two surfaces:
//   - fetchTenantDailies(tenantId, days)   → array of daily cost docs for the chart
//   - fetchTenantMonthly(tenantId, month)  → single monthly rollup doc (MTD card)
//   - fetchPlatformDailies(days)           → cross-tenant daily totals
//   - fetchPlatformMonthly(month)          → cross-tenant monthly rollup
//   - fetchAllTenantMTD()                  → MTD per tenant, for the list bar chart
//
// All read directly via the client SDK; Firestore rules gate read to
// isPlatformAdmin() for platform docs and tenant rollup docs.

import { db, doc, getDoc, getDocs, collection, query, where } from './firebase.js';

function dayKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function monthKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

function dayKeyOffset(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return dayKeyUTC(d);
}

// Returns array of { dayKey, sms, email, ai, tfn, gcp, totalCostUsd }
// covering the last `days` days (oldest first). Missing days are filled
// with zeros so the chart axis is continuous.
export async function fetchTenantDailies(tenantId, days = 30) {
  const startKey = dayKeyOffset(days - 1);
  const snap = await getDocs(query(
    collection(db, 'tenants', tenantId, 'usageDaily'),
    where('dayKey', '>=', startKey),
  ));
  const byDay = new Map();
  snap.forEach(d => byDay.set(d.id, d.data()));
  return fillDays(byDay, days);
}

export async function fetchTenantMonthly(tenantId, monthKey = monthKeyUTC()) {
  const ref = doc(db, 'tenants', tenantId, 'usageMonthly', monthKey);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : null;
}

export async function fetchPlatformDailies(days = 30) {
  const startKey = dayKeyOffset(days - 1);
  const snap = await getDocs(query(
    collection(db, 'platform', 'usage', 'daily'),
    where('dayKey', '>=', startKey),
  ));
  const byDay = new Map();
  snap.forEach(d => byDay.set(d.id, d.data()));
  return fillDays(byDay, days);
}

export async function fetchPlatformMonthly(monthKey = monthKeyUTC()) {
  const ref = doc(db, 'platform', 'usage', 'monthly', monthKey);
  const s = await getDoc(ref);
  return s.exists() ? s.data() : null;
}

// MTD cost per active tenant. Single query against the collection group
// `usageMonthly` filtered by current month key — Firestore returns docs
// across all tenant subcollections. Rules already gate platform-admin
// read access, so this is one call instead of N.
export async function fetchAllTenantMTD(tenants, monthKey = monthKeyUTC()) {
  // Use per-tenant reads (no collection group needed) so we don't
  // require an extra index. Tenant list is small (under ~50 in the
  // foreseeable future).
  const results = await Promise.all(tenants.map(async t => {
    try {
      const m = await fetchTenantMonthly(t.id, monthKey);
      return {
        id:    t.id,
        name:  t.name || t.id,
        plan:  t.plan || 'unset',
        totalCostUsd: m?.totalCostUsd || 0,
        breakdown: m ? {
          sms:   m.sms?.costUsd   || 0,
          email: m.email?.costUsd || 0,
          ai:    m.ai?.costUsd    || 0,
          tfn:   m.tfn?.costUsd   || 0,
          gcp:   m.gcp?.costUsd   || 0,
        } : null,
        hasData: !!m,
      };
    } catch (_) {
      return { id: t.id, name: t.name || t.id, plan: t.plan || 'unset', totalCostUsd: 0, breakdown: null, hasData: false };
    }
  }));
  return results.sort((a, b) => b.totalCostUsd - a.totalCostUsd);
}

// Pad a sparse map of day docs into a contiguous array, oldest first.
function fillDays(byDay, days) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKeyOffset(i);
    const d = byDay.get(k) || {};
    out.push({
      dayKey: k,
      label:  formatDayLabel(k),
      sms:    Number(d.sms?.costUsd   || 0),
      email:  Number(d.email?.costUsd || 0),
      ai:     Number(d.ai?.costUsd    || 0),
      tfn:    Number(d.tfn?.costUsd   || 0),
      gcp:    Number(d.gcp?.costUsd   || d.gcp?.allocatedUsd || 0),
      total:  Number(d.totalCostUsd   || 0),
      smsSends:   Number(d.sms?.sends    || 0),
      emailSends: Number(d.email?.sends   || 0),
      aiCalls:    Number(d.ai?.calls    || 0),
    });
  }
  return out;
}

function formatDayLabel(dayKey) {
  // YYYY-MM-DD → "May 30"
  const [y, m, d] = dayKey.split('-').map(Number);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${d}`;
}

export function fmtUsd(n) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 100)   return `$${n.toFixed(0)}`;
  if (Math.abs(n) >= 1)     return `$${n.toFixed(2)}`;
  if (Math.abs(n) >= 0.01)  return `$${n.toFixed(3)}`;
  if (n === 0)              return '$0';
  return `$${n.toFixed(4)}`;
}

export { monthKeyUTC, dayKeyUTC };
