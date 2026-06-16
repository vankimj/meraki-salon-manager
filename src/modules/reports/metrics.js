// Pure aggregation helpers used by Reports → Overview.
// Extracted from ReportsAdmin.jsx so they can be unit-tested without
// rendering the full admin module (which transitively pulls Firebase).

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function apptRevenue(a) {
  const raw = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
  // Refund receipts net against the original sale: a $50 sale on Day 1
  // plus a $50 refund on Day 5 should sum to $0, not $50. We use abs() of
  // the service prices so this works whether GG exports refund line items
  // as positive or negative amounts.
  if (a.transactionType === 'refund') return -Math.abs(raw);
  return raw;
}

// ── Walk-in vs scheduled classification ────────────────
// A walk-in is a visit booked the same day it happens; a scheduled visit was
// booked in advance. We derive this from booking lead time (createdAt vs the
// visit date) rather than asking staff to remember a flag, but checkout can
// stamp an explicit `walkIn` boolean that overrides the derivation. Imported
// and demo history has a synthetic createdAt (≈ the visit date), so it can't
// be classified honestly and is reported separately as "not tracked".
export function isImportedTxn(a) {
  return !!(a._importedFrom || a._glossgeniusSource || a._glossgeniusTransactionId || a._demo || a.source === 'imported');
}

// True = walk-in. Booked on or after the visit day (lead time ≤ 0) is a
// walk-in; booked earlier is a scheduled appointment.
export function defaultWalkIn(createdAt, date) {
  if (!createdAt || !date) return false;
  return String(createdAt).slice(0, 10) >= String(date).slice(0, 10);
}

// 'walkin' | 'scheduled' | 'untracked' for a completed sale, or null when the
// sale isn't a service visit (gift card / retail only — not counted either way).
// Trusts ONLY the explicit `walkIn` flag, which is stamped at checkout (and on
// synthesized receipts) from the APPOINTMENT's booking lead time. We must not
// derive it here from a receipt's createdAt — that's the checkout time (≈ the
// visit day), so it would misread every past sale as a same-day walk-in.
export function walkInClass(a) {
  if (!(a.services?.length > 0)) return null;
  if (isImportedTxn(a)) return 'untracked';
  if (typeof a.walkIn === 'boolean') return a.walkIn ? 'walkin' : 'scheduled';
  return 'untracked';
}

// Build a receipt-shaped row from a done appointment for legacy/demo data
// without a corresponding receipt. Mirrors Transactions tab behavior so
// Overview reflects the same unified record set.
export function apptToSyntheticReceipt(a) {
  const sales = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
  const p = a.payment || {};
  const startISO = `${a.date}T${(a.startTime || '12:00')}:00.000Z`;
  return {
    id:           `appt:${a.id}`,
    apptIds:      [a.id],
    locationId:   a.locationId || null,
    clientId:     a.clientId || null,
    clientName:   a.clientName || '',
    clientEmail:  a.clientEmail || null,
    techName:     a.techName || '',
    date:         a.date,
    startTime:    a.startTime || '',
    services:     (a.services || []).map(sv => ({ name: sv.name, price: sv.price, techName: sv.techName || a.techName })),
    retailProducts: p.retailProducts || null,
    giftCardsSold:  null,
    createdAt:    p.paidAt || startISO,
    status:       'done',
    // Carry import/booking provenance so walk-in classification can run:
    // walk-in vs scheduled is derived from the appointment's booking lead time
    // (a.createdAt vs a.date), not the synthetic receipt's payment time.
    _importedFrom: a._importedFrom || null,
    _demo:        a._demo || false,
    walkIn:       typeof a.walkIn === 'boolean'
      ? a.walkIn
      : (isImportedTxn(a) ? undefined : defaultWalkIn(a.createdAt, a.date)),
    payment: {
      subtotal:     p.subtotal     ?? sales,
      discountAmount: p.discountAmount ?? 0,
      promoAmount:  p.promoAmount  ?? 0,
      tax:          p.tax          ?? 0,
      taxRate:      p.taxRate      ?? 0,
      tip:          p.tip          ?? 0,
      total:        p.total        ?? sales,
      method:       p.method       ?? 'other',
      ccFee:        p.ccFee        ?? 0,
      gcSalesTotal: p.gcSalesTotal ?? 0,
      techSplit:    p.techSplit    || null,
      _synthetic:   !p.paidAt,
    },
  };
}

// Cancellation/no-show stats from raw appointments + GG cancellation receipts.
// Pulls from two sources:
//   1. Appointments collection — status='cancelled' / 'no_show' / 'done' / 'scheduled'
//   2. Receipts collection — transactionType='cancellation' / 'refund' / 'void'
//      (set by the GG Payment Details importer when the row's Transaction
//      Type column says "Cancellation" etc.)
// We don't filter by `date <= today` — a future appointment that was
// cancelled is still a cancellation and the lost revenue is real.
export function computeCancellations(appointments, receipts) {
  const inPeriod = (appointments || []).filter(a => a.date);
  const cancelled = inPeriod.filter(a => a.status === 'cancelled');
  const noShows   = inPeriod.filter(a => a.status === 'no_show');
  const done      = inPeriod.filter(a => a.status === 'done');
  const scheduled = inPeriod.filter(a => a.status === 'scheduled' || (a.status !== 'done' && a.status !== 'cancelled' && a.status !== 'no_show'));

  // GG cancellation/refund/void receipts (tagged at import).
  const ggReceipts = (receipts || []).filter(r => r && r.date);
  const ggCancellations = ggReceipts.filter(r => r.transactionType === 'cancellation');
  const ggRefunds       = ggReceipts.filter(r => r.transactionType === 'refund');
  const ggVoids         = ggReceipts.filter(r => r.transactionType === 'void');

  const lostFor = (a) => (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
  const lostCancelled = cancelled.reduce((s, a) => s + lostFor(a), 0);
  const lostNoShow    = noShows.reduce((s, a) => s + lostFor(a), 0);
  const lostGgCxl  = ggCancellations.reduce((s, r) => s + Math.abs(Number(r.payment?.total) || lostFor(r)), 0);
  const lostRefund = ggRefunds.reduce((s, r) => s + Math.abs(Number(r.payment?.total) || lostFor(r)), 0);
  const lostVoid   = ggVoids.reduce((s, r) => s + Math.abs(Number(r.payment?.total) || lostFor(r)), 0);

  const decisive = cancelled.length + noShows.length + done.length;
  const cancelRate  = decisive ? cancelled.length / decisive : 0;
  const noShowRate  = decisive ? noShows.length / decisive   : 0;

  const byTech = {};
  [...cancelled, ...noShows].forEach(a => {
    const name = a.techName || '—';
    if (!byTech[name]) byTech[name] = { cancelled: 0, noShow: 0, lostRevenue: 0 };
    if (a.status === 'cancelled') byTech[name].cancelled++; else byTech[name].noShow++;
    byTech[name].lostRevenue += lostFor(a);
  });

  // Histogram of every status found in the period — useful when 0 cancels
  // looks suspicious (e.g. the Appointments CSV wasn't imported, or the
  // status field uses a value the importer doesn't normalize).
  const statusCounts = {};
  inPeriod.forEach(a => {
    const s = a.status || '(blank)';
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });

  return {
    // Appointment-collection counts
    cancelCount: cancelled.length,
    noShowCount: noShows.length,
    completedCount: done.length,
    scheduledCount: scheduled.length,
    cancelRate, noShowRate,
    lostCancelled, lostNoShow,
    // Receipt-collection cancellation/refund/void (from GG Payment Details "Transaction Type")
    ggCancellationCount: ggCancellations.length,
    ggRefundCount:       ggRefunds.length,
    ggVoidCount:         ggVoids.length,
    lostGgCxl, lostRefund, lostVoid,
    // Combined lost revenue across all sources
    lostRevenue: lostCancelled + lostNoShow + lostGgCxl + lostRefund + lostVoid,
    byTech,
    statusCounts,
    totalInPeriod: inPeriod.length,
  };
}

// Refund breakdown over receipts: total refunded, and how the commission was
// handled — WITHHELD (clawed back from techs) vs GOODWILL (salon absorbed).
// Per refund, each tech's withheld share = their revenue share × the refund
// amount when their commissionByTech is 'withhold'; the rest is goodwill.
// Refunds with no techSplit fall to all-withheld unless every tech is goodwill.
export function computeRefundBreakdown(receipts) {
  let refunded = 0, withheld = 0, goodwill = 0, count = 0;
  (receipts || []).forEach(r => {
    const list = Array.isArray(r.refunds) ? r.refunds : (r.refund ? [r.refund] : []);
    if (!list.length) return;
    const split = (r.payment && Array.isArray(r.payment.techSplit)) ? r.payment.techSplit : null;
    const totalRev = split ? split.reduce((a, s) => a + (Number(s.revenue) || 0), 0) : 0;
    list.forEach(rf => {
      const amt = Number(rf.amount) || 0;
      if (amt <= 0) return;
      refunded += amt; count += 1;
      if (split && totalRev > 0) {
        let w = 0;
        split.forEach(s => {
          const treat = (rf.commissionByTech && rf.commissionByTech[s.techName]) || 'withhold';
          if (treat === 'withhold') w += (Number(s.revenue) || 0) / totalRev * amt;
        });
        withheld += w; goodwill += (amt - w);
      } else {
        const treats = Object.values(rf.commissionByTech || {});
        if (treats.length > 0 && treats.every(t => t === 'goodwill')) goodwill += amt;
        else withheld += amt;
      }
    });
  });
  return { refunded, withheld, goodwill, count };
}

// Per-tech PAYROLL adjustment from receipts: the attributed revenue a tech LOSES
// to withheld refunds + redos they gave away, and GAINS from redos received.
// Mirrors the tech-dashboard math so payroll (commission) matches what each tech
// sees. Returns gross-dollar adjustments; the caller nets them against the tech's
// service revenue before applying their commission %.
export function techPayAdjust(receipts, techName) {
  let refundWithheld = 0, redoOut = 0, redoIn = 0;
  (receipts || []).forEach(r => {
    const p = r.payment || {};
    const split = Array.isArray(p.techSplit) ? p.techSplit : null;
    const totalRev = split ? split.reduce((a, s) => a + (Number(s.revenue) || 0), 0) : 0;
    const myRev = split
      ? split.filter(s => s.techName === techName).reduce((a, s) => a + (Number(s.revenue) || 0), 0)
      : (r.techName === techName ? (Number(p.subtotal) || (r.services || []).reduce((x, sv) => x + (Number(sv.price) || 0), 0)) : 0);
    const refundList = Array.isArray(r.refunds) ? r.refunds : (r.refund ? [r.refund] : []);
    if (myRev > 0 && totalRev > 0) {
      refundList.forEach(rf => {
        const treat = (rf.commissionByTech && rf.commissionByTech[techName]) || 'withhold';
        if (treat === 'withhold') refundWithheld += (myRev / totalRev) * (Number(rf.amount) || 0);
      });
    }
    (Array.isArray(r.redos) ? r.redos : []).forEach(rd => {
      (rd.services || []).forEach(it => { if (it.fromTech === techName) redoOut += Number(it.amount) || 0; });
      if (rd.toTech === techName) redoIn += Number(rd.amount) || 0;
    });
  });
  return { refundWithheld, redoOut, redoIn };
}

// Receipts are the canonical record. For done appts without one, synthesize.
export function buildTransactions(receipts, appointments) {
  const covered = new Set();
  receipts.forEach(r => (r.apptIds || []).forEach(id => covered.add(id)));
  const synthesized = appointments
    .filter(a => a.status === 'done' && !covered.has(a.id))
    .map(apptToSyntheticReceipt);
  return [...receipts, ...synthesized];
}

// Classify a period's transactions for the "New vs Returning Clients" card.
//
// Client buckets (deduped by clientId — these are PEOPLE):
//   returningCount — visited at the salon before this period (`priorClientIds`)
//                    OR on 2+ distinct dates within it. The within-period check
//                    is what makes "All time" correct: there, nothing precedes
//                    the window so prior-history is empty by construction, and
//                    repeat visits are the only signal of a returning client.
//   newCount       — a single first-ever visit, no prior history.
//
// Clientless buckets (these are TRANSACTIONS, not people — a sale never linked
// to a client profile). Split so a gift-card purchase isn't mislabeled an
// anonymous walk-in:
//   giftRetailCount — sold a gift card, or retail-only with no service.
//   walkInCount     — a service with an anonymous "Walk-in" name.
//   unlinkedCount   — carries a real client name we couldn't match to a profile
//                     (typically GlossGenius receipts whose name didn't resolve).
//
// Refund/void receipts are excluded from the visit tally so a same-day
// sale+refund pair isn't read as two visits (which would falsely promote a
// one-time client to "returning").
export function computeRetention(transactions, priorClientIds, today = todayStr()) {
  const prior = priorClientIds || new Set();
  const rows = (transactions || []).filter(a =>
    a && a.status !== 'cancelled' && a.date && a.date <= today &&
    (!a.transactionType || a.transactionType === 'sale'));

  const visitDates = {};
  const walkInRows = [], giftRetailRows = [], unlinkedRows = [];
  rows.forEach(a => {
    if (a.clientId) {
      if (!visitDates[a.clientId]) visitDates[a.clientId] = new Set();
      visitDates[a.clientId].add(a.date);
      return;
    }
    const soldGc    = a.giftCardsSold?.length > 0 || a.payment?.giftCardsSold?.length > 0 || Number(a.payment?.gcSalesTotal) > 0;
    const hasRetail = a.retailProducts?.length > 0;
    const hasSvc    = a.services?.length > 0;
    const name      = String(a.clientName || '').trim().toLowerCase();
    const isWalkName = !name || name === 'walk-in' || name === 'walk in' || name === 'walk-in retail';
    if (soldGc || (hasRetail && !hasSvc)) giftRetailRows.push(a);
    else if (isWalkName) walkInRows.push(a);
    else unlinkedRows.push(a);
  });

  let newCount = 0, returningCount = 0;
  Object.keys(visitDates).forEach(id => {
    if (prior.has(id) || visitDates[id].size >= 2) returningCount++;
    else newCount++;
  });

  return {
    newCount, returningCount,
    walkInCount: walkInRows.length, giftRetailCount: giftRetailRows.length, unlinkedCount: unlinkedRows.length,
    walkInRows, giftRetailRows, unlinkedRows,
    clientTotal: newCount + returningCount,
  };
}

// `today` is parameterized for deterministic tests; production callers can
// omit it and the live date is used.
// A transaction counts toward revenue when it's a real sale OR a refund.
// Refunds are included so they net against the original sale. Cancellations
// and voids are excluded entirely — no money moved. The `date <= today` guard
// only applies to synthesized appointments (future-scheduled appts marked done
// by mistake), not real receipts. Shared so drill-downs match the aggregates.
export function doneTransactions(transactions, today = todayStr()) {
  return (transactions || []).filter(a => {
    if (a.status === 'cancelled') return false;
    if (a.transactionType && a.transactionType !== 'sale' && a.transactionType !== 'refund') return false;
    if (!a.date) return false;
    if (a.payment?._synthetic && a.date > today) return false;
    return true;
  });
}

// Which payment-method bucket a transaction lands in. Anything that isn't a
// plain card or cash sale is collapsed into "other" (gift card, etc.).
export function txMethodKey(a) {
  const m = a?.payment?.method;
  return (m === 'card' || m === 'cash') ? m : 'other';
}

// Signed amount a transaction contributes to its method bucket — mirrors the
// byMethod math in computeMetrics so a per-method drill-down sums to the same
// total. Returns null when the transaction contributes nothing.
export function txMethodAmount(a) {
  const p = a.payment || {};
  let total;
  if (p.total !== undefined && p.total !== null) total = Number(p.total) || 0;
  else { total = Math.abs(apptRevenue(a)); if (total === 0) return null; }
  return a.transactionType === 'refund' ? -Math.abs(total) : total;
}

export function computeMetrics(transactions, today = todayStr()) {
  const done = doneTransactions(transactions, today);

  const totalRevenue  = done.reduce((s, a) => s + apptRevenue(a), 0);
  const totalAppts    = done.length;
  // Walk-in vs scheduled, over service visits only. "Untracked" = imported or
  // pre-feature sales we can't classify (see walkInClass). Counts are distinct
  // visits, so a salon can read "X walk-ins, Y scheduled, Z not yet tracked".
  let walkIns = 0, scheduledVisits = 0, untrackedVisits = 0;
  done.forEach(a => {
    const k = walkInClass(a);
    if (k === 'walkin') walkIns++;
    else if (k === 'scheduled') scheduledVisits++;
    else if (k === 'untracked') untrackedVisits++;
  });
  const trackedVisits = walkIns + scheduledVisits;
  const avgTicket     = totalAppts ? totalRevenue / totalAppts : 0;

  const byDay = {};
  done.forEach(a => { byDay[a.date] = (byDay[a.date] || 0) + apptRevenue(a); });

  const byTech = {};
  function ensureTech(name) {
    if (!byTech[name]) byTech[name] = { revenue: 0, count: 0, services: {}, clients: new Set() };
  }
  done.forEach(a => {
    if (a.payment?.techSplit) {
      a.payment.techSplit.forEach(split => {
        ensureTech(split.techName);
        byTech[split.techName].revenue += split.revenue || 0;
        byTech[split.techName].count++;
        if (a.clientId) byTech[split.techName].clients.add(a.clientId);
        const techServices = (a.services || []).filter(sv => (sv.techName || a.techName) === split.techName);
        techServices.forEach(sv => {
          const k = sv.name || 'Unknown';
          if (!byTech[split.techName].services[k]) byTech[split.techName].services[k] = { count: 0, revenue: 0 };
          byTech[split.techName].services[k].count++;
          byTech[split.techName].services[k].revenue += Number(sv.price) || 0;
        });
      });
    } else {
      ensureTech(a.techName);
      const rev = apptRevenue(a);
      byTech[a.techName].revenue += rev;
      byTech[a.techName].count++;
      if (a.clientId) byTech[a.techName].clients.add(a.clientId);
      (a.services || []).forEach(sv => {
        const k = sv.name || 'Unknown';
        if (!byTech[a.techName].services[k]) byTech[a.techName].services[k] = { count: 0, revenue: 0 };
        byTech[a.techName].services[k].count++;
        byTech[a.techName].services[k].revenue += Number(sv.price) || 0;
      });
    }
  });
  // Redo transfer: a redone service moves its revenue (and the commission it
  // drives) from the original tech to the redo tech. Salon total is unchanged
  // (net $0) — this only re-attributes between techs.
  done.forEach(a => (Array.isArray(a.redos) ? a.redos : []).forEach(rd => {
    (rd.services || []).forEach(it => { if (byTech[it.fromTech]) byTech[it.fromTech].revenue -= Number(it.amount) || 0; });
    if (rd.toTech) { ensureTech(rd.toTech); byTech[rd.toTech].revenue += Number(rd.amount) || 0; }
  }));
  Object.values(byTech).forEach(t => { t.clientCount = t.clients.size; delete t.clients; });

  const byService = {};
  done.forEach(a => {
    (a.services || []).forEach(sv => {
      const k = sv.name || 'Unknown';
      if (!byService[k]) byService[k] = { revenue: 0, count: 0 };
      byService[k].revenue += Number(sv.price) || 0;
      byService[k].count++;
    });
  });

  const byClient = {};
  done.forEach(a => {
    if (!a.clientId) return;
    if (!byClient[a.clientId]) byClient[a.clientId] = { name: a.clientName, revenue: 0, count: 0 };
    byClient[a.clientId].revenue += apptRevenue(a);
    byClient[a.clientId].count++;
  });

  // Payment method breakdown — sum payment.total per method. Categorizes any
  // non-card/cash method (venmo, zelle, gift card, etc.) as "Other" so the
  // KPI band doesn't fragment into a long tail. Refund receipts subtract
  // (sign-flipped) so an originally-card sale that was later refunded nets
  // to $0 in the credit-card bucket. Each bucket also tracks the
  // components that add up to its total: service revenue, retail revenue,
  // tax collected, tip collected. So `total ≈ svcRev + retail + tax + tip`
  // (within rounding) for each method, exposing the math behind the sum.
  const byMethod = {
    card:  { total: 0, count: 0, svcRev: 0, retail: 0, tax: 0, tip: 0 },
    cash:  { total: 0, count: 0, svcRev: 0, retail: 0, tax: 0, tip: 0 },
    other: { total: 0, count: 0, svcRev: 0, retail: 0, tax: 0, tip: 0 },
  };
  let methodTotal = 0;
  done.forEach(a => {
    const p = a.payment || {};
    const isRefund = a.transactionType === 'refund';
    const sign = isRefund ? -1 : 1;
    // Treat an explicit p.total === 0 as authoritative ("free service /
    // 100% discount" — GG records these with Amount=$0.00 even though the
    // services array still carries the pre-discount price). Only fall back
    // to summing services when payment.total is genuinely missing
    // (synthesized receipts from done appts without a payment field). Skip
    // entirely if neither source yields any data.
    let total;
    if (p.total !== undefined && p.total !== null) {
      total = Number(p.total) || 0;
    } else {
      total = Math.abs(apptRevenue(a));
      if (total === 0) return;
    }
    if (isRefund) total = -Math.abs(total);
    const m = (p.method === 'card' || p.method === 'cash') ? p.method : 'other';
    const svcRev = Math.abs(apptRevenue(a)); // apptRevenue already flips sign for refunds; we want the magnitude here
    const retail = (a.retailProducts || []).reduce((s, x) => s + (Number(x.price) || 0) * (x.qty || 1), 0);
    byMethod[m].total  += total;
    byMethod[m].count  += isRefund ? 0 : 1; // don't inflate count by refunds
    byMethod[m].svcRev += sign * svcRev;
    byMethod[m].retail += sign * retail;
    byMethod[m].tax    += sign * (Number(p.tax) || 0);
    byMethod[m].tip    += sign * (Number(p.tip) || 0);
    methodTotal += total;
  });

  // Processing fees + tips, summed across done transactions. Fees are
  // card-only (cash/Venmo/etc. have ccFee=0). Tips are cross-method.
  let ccFeeTotal = 0, cardTxnCount = 0, cardRevenue = 0;
  let tipTotal = 0, tipTxnCount = 0;
  const tipsByMethod = { card: 0, cash: 0, other: 0 };
  const tipsByTech = {};
  done.forEach(a => {
    const p = a.payment || {};
    const fee = Number(p.ccFee) || 0;
    if (fee > 0 || p.method === 'card') {
      ccFeeTotal += a.transactionType === 'refund' ? -Math.abs(fee) : fee;
      if (p.method === 'card') {
        cardTxnCount++;
        cardRevenue += a.transactionType === 'refund'
          ? -Math.abs(Number(p.total) || 0)
          : (Number(p.total) || 0);
      }
    }
    const tipRaw = Number(p.tip) || 0;
    if (tipRaw === 0) return;
    const tip = a.transactionType === 'refund' ? -Math.abs(tipRaw) : tipRaw;
    tipTotal += tip;
    if (a.transactionType !== 'refund') tipTxnCount++;
    const m = (p.method === 'card' || p.method === 'cash') ? p.method : 'other';
    tipsByMethod[m] += tip;

    // Per-tech tips: respect techSplit when present so multi-tech bookings
    // attribute correctly.
    if (p.techSplit?.length) {
      p.techSplit.forEach(t => {
        const share = Number(t.tipShare) || 0;
        if (!t.techName) return;
        tipsByTech[t.techName] = (tipsByTech[t.techName] || 0) + (a.transactionType === 'refund' ? -Math.abs(share) : share);
      });
    } else if (a.techName) {
      const primary = a.techName.split(',')[0].trim();
      tipsByTech[primary] = (tipsByTech[primary] || 0) + tip;
    }
  });

  return { totalRevenue, totalAppts, walkIns, scheduledVisits, untrackedVisits, trackedVisits, avgTicket, byDay, byTech, byService, byClient, byMethod, methodTotal,
    ccFeeTotal, cardTxnCount, cardRevenue,
    tipTotal, tipTxnCount, tipsByMethod, tipsByTech,
  };
}
