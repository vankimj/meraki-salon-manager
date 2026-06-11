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

// Receipts are the canonical record. For done appts without one, synthesize.
export function buildTransactions(receipts, appointments) {
  const covered = new Set();
  receipts.forEach(r => (r.apptIds || []).forEach(id => covered.add(id)));
  const synthesized = appointments
    .filter(a => a.status === 'done' && !covered.has(a.id))
    .map(apptToSyntheticReceipt);
  return [...receipts, ...synthesized];
}

// New vs Returning classification — see the web copy in
// src/modules/reports/metrics.js for the full rationale. Keep them in sync.
//   returningCount/newCount — distinct CLIENTS. "Returning" = visited before
//     this period (`priorClientIds`) OR on 2+ distinct dates within it (the
//     within-period check is what makes "All time" correct, where nothing
//     precedes the window so prior-history is empty by construction).
//   walkIn/giftRetail/unlinked — clientless TRANSACTIONS, split so a gift-card
//     sale isn't mislabeled an anonymous walk-in. Refund/void rows are excluded
//     from the visit tally so a same-day sale+refund isn't read as two visits.
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
export function computeMetrics(transactions, today = todayStr()) {
  // A transaction counts toward revenue when it's a real sale OR a refund.
  // Refunds are included so they net against the original sale (apptRevenue
  // returns a negative number for them). Cancellations and voids are
  // excluded entirely — no money moved. Same for cancelled appointments.
  // The `date <= today` guard only applies to synthesized appointments
  // (future-scheduled appts marked done by mistake), not real receipts —
  // a receipt is a completed transaction so the date should always count.
  const done = transactions.filter(a => {
    if (a.status === 'cancelled') return false;
    if (a.transactionType && a.transactionType !== 'sale' && a.transactionType !== 'refund') return false;
    if (!a.date) return false;
    if (a.payment?._synthetic && a.date > today) return false;
    return true;
  });

  const totalRevenue  = done.reduce((s, a) => s + apptRevenue(a), 0);
  const totalAppts    = done.length;
  const walkInAppts   = done.filter(a => !a.clientId);
  const walkIns       = walkInAppts.length;
  const anonymous     = walkInAppts.filter(a => !a.clientName || a.clientName === 'Walk-in').length;
  const namedWalkIns  = walkIns - anonymous;
  const scheduled     = totalAppts - walkIns;
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

  return { totalRevenue, totalAppts, walkIns, anonymous, namedWalkIns, scheduled, avgTicket, byDay, byTech, byService, byClient, byMethod, methodTotal,
    ccFeeTotal, cardTxnCount, cardRevenue,
    tipTotal, tipTxnCount, tipsByMethod, tipsByTech,
  };
}

// Refunds & commission for the period (verbatim port of web metrics). For each
// refund, allocate the commission withheld-from-tech vs absorbed-as-goodwill by
// the tech's revenue share, honoring per-tech commissionByTech overrides.
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
