import { describe, it, expect } from 'vitest';
import {
  apptRevenue, apptToSyntheticReceipt, buildTransactions, computeMetrics, computeRetention, techPayAdjust,
  doneTransactions, txMethodKey, txMethodAmount, defaultWalkIn, walkInClass,
} from './metrics';

const TODAY = '2026-05-04';

// Build a minimal "transaction" (receipt-shaped row) for testing.
function tx(over = {}) {
  return {
    id: 'tx_' + Math.random(),
    date: '2026-05-01',
    status: 'done',
    clientId: 'c1',
    clientName: 'Jane',
    techName: 'Yasmin',
    services: [{ name: 'Manicure', price: 50 }],
    ...over,
  };
}

describe('apptRevenue', () => {
  it('sums prices across services', () => {
    expect(apptRevenue({ services: [{ price: 30 }, { price: 50 }] })).toBe(80);
  });
  it('returns 0 for no services', () => expect(apptRevenue({})).toBe(0));
  it('coerces string prices', () => {
    expect(apptRevenue({ services: [{ price: '45.50' }, { price: '4.50' }] })).toBe(50);
  });
  it('skips invalid prices without crashing', () => {
    expect(apptRevenue({ services: [{ price: 'abc' }, { price: 10 }] })).toBe(10);
  });
  it('counts add-on lines (addOnOf set) toward revenue like any other line', () => {
    // Add-ons are independent services[] lines, so they sum into revenue with
    // no special handling — Gel-X $70 + Removal add-on $15 + Mani add-on $20.
    expect(apptRevenue({ services: [
      { id: 'gelx', price: 70 },
      { id: 'removal', price: 15, addOnOf: 'gelx' },
      { id: 'mani', price: 20, addOnOf: 'gelx' },
    ] })).toBe(105);
  });
});

describe('apptToSyntheticReceipt', () => {
  it('mirrors core fields and stamps status: done', () => {
    const a = {
      id: 'a1', date: '2026-04-30', startTime: '10:30',
      clientId: 'c1', clientName: 'Jane',
      techName: 'Tess',
      services: [{ name: 'Pedicure', price: 60 }],
    };
    const r = apptToSyntheticReceipt(a);
    expect(r.id).toBe('appt:a1');
    expect(r.apptIds).toEqual(['a1']);
    expect(r.status).toBe('done');
    expect(r.techName).toBe('Tess');
    expect(r.services[0].techName).toBe('Tess');
    expect(r.payment.subtotal).toBe(60);
    expect(r.payment.total).toBe(60);
    expect(r.payment._synthetic).toBe(true);
  });
  it('honors existing payment.paidAt as createdAt', () => {
    const a = { id: 'a1', date: '2026-04-30', services: [],
      payment: { paidAt: '2026-04-30T15:00:00.000Z' } };
    const r = apptToSyntheticReceipt(a);
    expect(r.createdAt).toBe('2026-04-30T15:00:00.000Z');
    expect(r.payment._synthetic).toBe(false);
  });
  it('propagates the appointment locationId so per-location revenue scopes', () => {
    const r = apptToSyntheticReceipt({ id: 'a1', date: '2026-04-30', services: [], locationId: 'north' });
    expect(r.locationId).toBe('north');
  });
  it('leaves locationId null for an untagged (legacy) appointment', () => {
    const r = apptToSyntheticReceipt({ id: 'a1', date: '2026-04-30', services: [] });
    expect(r.locationId).toBe(null);
  });
});

describe('buildTransactions', () => {
  it('includes all receipts unchanged', () => {
    const receipts = [{ id: 'r1', apptIds: [], date: '2026-04-30' }];
    const result = buildTransactions(receipts, []);
    expect(result).toEqual(receipts);
  });
  it('synthesizes from done appts that have no covering receipt', () => {
    const receipts = [];
    const appts = [{ id: 'a1', status: 'done', date: '2026-04-30', services: [{ price: 50 }] }];
    const result = buildTransactions(receipts, appts);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('appt:a1');
  });
  it('skips done appts already covered by a receipt (apptIds match)', () => {
    const receipts = [{ id: 'r1', apptIds: ['a1'], date: '2026-04-30' }];
    const appts = [{ id: 'a1', status: 'done', date: '2026-04-30', services: [] }];
    const result = buildTransactions(receipts, appts);
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('r1');
  });
  it('skips non-done appointments (scheduled, cancelled)', () => {
    const appts = [
      { id: 'a1', status: 'scheduled', date: '2026-04-30', services: [] },
      { id: 'a2', status: 'cancelled', date: '2026-04-30', services: [] },
    ];
    expect(buildTransactions([], appts)).toEqual([]);
  });
});

describe('computeMetrics — totals', () => {
  it('totalRevenue, totalAppts, avgTicket from completed transactions', () => {
    const m = computeMetrics([
      tx({ services: [{ price: 60 }] }),
      tx({ services: [{ price: 40 }] }),
    ], TODAY);
    expect(m.totalRevenue).toBe(100);
    expect(m.totalAppts).toBe(2);
    expect(m.avgTicket).toBe(50);
  });
  it('excludes cancelled transactions', () => {
    const m = computeMetrics([
      tx({ services: [{ price: 50 }] }),
      tx({ status: 'cancelled', services: [{ price: 999 }] }),
    ], TODAY);
    expect(m.totalRevenue).toBe(50);
    expect(m.totalAppts).toBe(1);
  });
  it('includes future-dated receipts (real receipts have completed already)', () => {
    // Real receipts represent completed sales; if their `date` is somehow
    // in the future, that's a data quirk but we still count them. Only
    // synthesized appointments (payment._synthetic) get the future-cutoff.
    const m = computeMetrics([
      tx({ date: '2026-04-01' }),
      tx({ date: '2099-01-01' }),
    ], TODAY);
    expect(m.totalAppts).toBe(2);
  });
  it('excludes future-dated synthesized appointments', () => {
    const m = computeMetrics([
      tx({ date: '2026-04-01' }),
      tx({ date: '2099-01-01', payment: { _synthetic: true } }),
    ], TODAY);
    expect(m.totalAppts).toBe(1);
  });
  it('excludes rows with missing date', () => {
    const m = computeMetrics([tx({ date: null })], TODAY);
    expect(m.totalAppts).toBe(0);
  });
});

describe('computeMetrics — walk-ins vs scheduled', () => {
  it('counts an explicit walk-in flag as a walk-in', () => {
    const m = computeMetrics([tx({ walkIn: true })], TODAY);
    expect(m.walkIns).toBe(1);
    expect(m.scheduledVisits).toBe(0);
    expect(m.trackedVisits).toBe(1);
  });
  it('counts an explicit scheduled flag as scheduled', () => {
    const m = computeMetrics([tx({ walkIn: false })], TODAY);
    expect(m.scheduledVisits).toBe(1);
    expect(m.walkIns).toBe(0);
  });
  it('does NOT guess walk-in from a receipt with no flag — that is untracked (regression: checkout-time createdAt is not booking time)', () => {
    // createdAt same-day as the visit (a receipt is created at checkout) must
    // NOT be read as a same-day walk-in.
    const m = computeMetrics([tx({ date: '2026-05-01', createdAt: '2026-05-01T11:00:00Z' })], TODAY);
    expect(m.walkIns).toBe(0);
    expect(m.scheduledVisits).toBe(0);
    expect(m.untrackedVisits).toBe(1);
    expect(m.trackedVisits).toBe(0);
  });
  it('reports imported history as untracked, not walk-in or scheduled', () => {
    const m = computeMetrics([tx({ walkIn: true, _glossgeniusSource: 'Appointment' })], TODAY);
    expect(m.untrackedVisits).toBe(1);
    expect(m.walkIns).toBe(0);
    expect(m.scheduledVisits).toBe(0);
    expect(m.trackedVisits).toBe(0);
  });
  it('excludes non-service sales (gift card / retail) from walk-in classification', () => {
    const m = computeMetrics([
      tx({ services: [], walkIn: true, giftCardsSold: [{ code: 'X' }], payment: { total: 100, method: 'card' } }),
    ], TODAY);
    expect(m.walkIns).toBe(0);
    expect(m.scheduledVisits).toBe(0);
    expect(m.untrackedVisits).toBe(0);
  });
});

describe('walk-in helpers', () => {
  it('defaultWalkIn: same-day booking is a walk-in, advance booking is not', () => {
    expect(defaultWalkIn('2026-05-01T09:00:00Z', '2026-05-01')).toBe(true);
    expect(defaultWalkIn('2026-04-25T09:00:00Z', '2026-05-01')).toBe(false);
    expect(defaultWalkIn(null, '2026-05-01')).toBe(false);
  });
  it('walkInClass trusts only the explicit flag — never derives from createdAt', () => {
    expect(walkInClass({ services: [] })).toBe(null);
    expect(walkInClass({ services: [{ price: 1 }], walkIn: true, _importedFrom: 'glossgenius' })).toBe('untracked');
    expect(walkInClass({ services: [{ price: 1 }], walkIn: true })).toBe('walkin');
    expect(walkInClass({ services: [{ price: 1 }], walkIn: false })).toBe('scheduled');
    // No flag → untracked, regardless of createdAt vs date.
    expect(walkInClass({ services: [{ price: 1 }], createdAt: '2026-05-01T10:00:00Z', date: '2026-05-01' })).toBe('untracked');
  });
});

describe('computeMetrics — byTech', () => {
  it('groups single-tech revenue by techName', () => {
    const m = computeMetrics([
      tx({ techName: 'Yasmin', services: [{ name: 'Manicure', price: 30 }] }),
      tx({ techName: 'Tess',   services: [{ name: 'Pedicure', price: 60 }] }),
      tx({ techName: 'Yasmin', services: [{ name: 'Manicure', price: 30 }] }),
    ], TODAY);
    expect(m.byTech.Yasmin.revenue).toBe(60);
    expect(m.byTech.Yasmin.count).toBe(2);
    expect(m.byTech.Tess.revenue).toBe(60);
  });
  it('attributes via techSplit when present', () => {
    const m = computeMetrics([
      tx({
        techName: 'Yasmin',
        services: [{ name: 'Manicure', price: 30, techName: 'Yasmin' }, { name: 'Pedicure', price: 60, techName: 'Tess' }],
        payment: { techSplit: [{ techName: 'Yasmin', revenue: 30 }, { techName: 'Tess', revenue: 60 }] },
      }),
    ], TODAY);
    expect(m.byTech.Yasmin.revenue).toBe(30);
    expect(m.byTech.Tess.revenue).toBe(60);
    expect(m.byTech.Yasmin.count).toBe(1);
    expect(m.byTech.Tess.count).toBe(1);
  });
  it('transfers redo revenue from the original tech to the redo tech (salon net $0)', () => {
    const m = computeMetrics([
      tx({
        techName: 'Yasmin',
        services: [{ name: 'Manicure', price: 40, techName: 'Yasmin' }],
        payment: { techSplit: [{ techName: 'Yasmin', revenue: 40 }], total: 40, subtotal: 40 },
        redos: [{ services: [{ name: 'Manicure', amount: 40, fromTech: 'Yasmin' }], toTech: 'Tess', amount: 40, reason: 'chip' }],
      }),
    ], TODAY);
    expect(m.byTech.Yasmin.revenue).toBe(0);   // original tech loses the redone service
    expect(m.byTech.Tess.revenue).toBe(40);    // redo tech gains it
    expect(m.totalRevenue).toBe(40);           // salon total unchanged
  });
  it('counts unique clients per tech', () => {
    const m = computeMetrics([
      tx({ techName: 'Yasmin', clientId: 'c1' }),
      tx({ techName: 'Yasmin', clientId: 'c2' }),
      tx({ techName: 'Yasmin', clientId: 'c1' }), // duplicate
    ], TODAY);
    expect(m.byTech.Yasmin.clientCount).toBe(2);
  });
});

describe('computeMetrics — byClient', () => {
  it('aggregates revenue per client and skips walk-ins', () => {
    const m = computeMetrics([
      tx({ clientId: 'c1', services: [{ price: 50 }] }),
      tx({ clientId: 'c1', services: [{ price: 60 }] }),
      tx({ clientId: null, services: [{ price: 999 }] }),
    ], TODAY);
    expect(m.byClient.c1.count).toBe(2);
    expect(m.byClient.c1.revenue).toBe(110);
    expect(Object.keys(m.byClient)).toEqual(['c1']);
  });
});

describe('computeMetrics — byDay', () => {
  it('sums revenue per date string', () => {
    const m = computeMetrics([
      tx({ date: '2026-05-01', services: [{ price: 30 }] }),
      tx({ date: '2026-05-02', services: [{ price: 50 }] }),
      tx({ date: '2026-05-01', services: [{ price: 20 }] }),
    ], TODAY);
    expect(m.byDay['2026-05-01']).toBe(50);
    expect(m.byDay['2026-05-02']).toBe(50);
  });
});

describe('computeMetrics — byService', () => {
  it('counts and sums revenue per service name', () => {
    const m = computeMetrics([
      tx({ services: [{ name: 'Manicure', price: 30 }] }),
      tx({ services: [{ name: 'Manicure', price: 35 }] }),
      tx({ services: [{ name: 'Pedicure', price: 60 }] }),
    ], TODAY);
    expect(m.byService.Manicure).toEqual({ count: 2, revenue: 65 });
    expect(m.byService.Pedicure).toEqual({ count: 1, revenue: 60 });
  });
});

// GG records 100%-discount / comped services with Amount=$0.00 even though
// the line items still carry pre-discount prices. byMethod must respect the
// authoritative payment.total=0 and not inflate the bucket with the
// services array. Synthesized receipts (no payment.total at all) still fall
// back to summing services so done appts without a receipt aren't dropped.
describe('computeMetrics — byMethod with $0 receipts', () => {
  it('respects payment.total=0 instead of falling back to services sum', () => {
    const m = computeMetrics([
      tx({ services: [{ price: 50 }], payment: { method: 'cash', total: 50 } }),
      tx({ services: [{ price: 60 }], payment: { method: 'cash', total: 0 } }), // free service
    ], TODAY);
    expect(m.byMethod.cash.total).toBe(50); // not 110
    expect(m.byMethod.cash.count).toBe(2);  // both still count as transactions
  });
  it('falls back to services sum when payment.total is missing entirely (synthesized)', () => {
    const m = computeMetrics([
      tx({ services: [{ price: 40 }], payment: { method: 'cash' } }), // no total field
    ], TODAY);
    expect(m.byMethod.cash.total).toBe(40);
    expect(m.byMethod.cash.count).toBe(1);
  });
  it('skips rows with neither payment.total nor any services', () => {
    const m = computeMetrics([
      tx({ services: [], payment: { method: 'cash' } }),
    ], TODAY);
    expect(m.byMethod.cash.total).toBe(0);
    expect(m.byMethod.cash.count).toBe(0);
  });
});

describe('techPayAdjust — payroll refund + redo adjustments', () => {
  it("withholds a tech's revenue share of a withheld refund", () => {
    const a = techPayAdjust([{
      payment: { techSplit: [{ techName: 'Yasmin', revenue: 40 }, { techName: 'Tess', revenue: 60 }] },
      refunds: [{ amount: 50, commissionByTech: { Yasmin: 'withhold', Tess: 'goodwill' } }],
    }], 'Yasmin');
    expect(a.refundWithheld).toBe(20); // (40/100) * 50
  });
  it('leaves a goodwill refund alone', () => {
    const a = techPayAdjust([{
      payment: { techSplit: [{ techName: 'Tess', revenue: 60 }] },
      refunds: [{ amount: 30, commissionByTech: { Tess: 'goodwill' } }],
    }], 'Tess');
    expect(a.refundWithheld).toBe(0);
  });
  it('counts redos given (out) and received (in)', () => {
    const recs = [{ redos: [{ services: [{ amount: 40, fromTech: 'Yasmin' }], toTech: 'Tess', amount: 40 }] }];
    expect(techPayAdjust(recs, 'Yasmin').redoOut).toBe(40);
    expect(techPayAdjust(recs, 'Yasmin').redoIn).toBe(0);
    expect(techPayAdjust(recs, 'Tess').redoIn).toBe(40);
    expect(techPayAdjust(recs, 'Tess').redoOut).toBe(0);
  });
});

describe('computeRetention', () => {
  const NONE = new Set();

  it('classifies a client with prior history as returning', () => {
    const r = computeRetention([tx({ clientId: 'c1' })], new Set(['c1']), TODAY);
    expect(r).toMatchObject({ returningCount: 1, newCount: 0, clientTotal: 1 });
  });

  it('classifies a first-ever single visit as new', () => {
    const r = computeRetention([tx({ clientId: 'c1' })], NONE, TODAY);
    expect(r).toMatchObject({ returningCount: 0, newCount: 1, clientTotal: 1 });
  });

  it('treats 2+ distinct visit-dates within the window as returning even with no prior history (the All-time case)', () => {
    const rows = [
      tx({ clientId: 'c1', date: '2026-05-01' }),
      tx({ clientId: 'c1', date: '2026-05-03' }),
    ];
    const r = computeRetention(rows, NONE, TODAY);
    expect(r).toMatchObject({ returningCount: 1, newCount: 0, clientTotal: 1 });
  });

  it('does NOT promote a one-day client to returning when a same-day refund pairs with the sale', () => {
    const rows = [
      tx({ clientId: 'c1', date: '2026-05-01', transactionType: 'sale' }),
      tx({ clientId: 'c1', date: '2026-05-01', transactionType: 'refund' }),
    ];
    const r = computeRetention(rows, NONE, TODAY);
    expect(r).toMatchObject({ returningCount: 0, newCount: 1 });
  });

  it('buckets a gift-card sale as gift/retail, not a walk-in', () => {
    const rows = [tx({ clientId: null, clientName: '', services: [], giftCardsSold: [{ code: 'ABC' }] })];
    const r = computeRetention(rows, NONE, TODAY);
    expect(r).toMatchObject({ giftRetailCount: 1, walkInCount: 0, unlinkedCount: 0, clientTotal: 0 });
  });

  it('buckets a retail-only clientless sale as gift/retail', () => {
    const rows = [tx({ clientId: null, clientName: 'Walk-in retail', services: [], retailProducts: [{ name: 'Polish' }] })];
    expect(computeRetention(rows, NONE, TODAY).giftRetailCount).toBe(1);
  });

  it('buckets an anonymous service walk-in as walkIn', () => {
    const rows = [tx({ clientId: null, clientName: 'Walk-in' })];
    expect(computeRetention(rows, NONE, TODAY)).toMatchObject({ walkInCount: 1, unlinkedCount: 0 });
  });

  it('buckets a named-but-unmatched receipt as unlinked', () => {
    const rows = [tx({ clientId: null, clientName: 'Maria Sanchez' })];
    expect(computeRetention(rows, NONE, TODAY)).toMatchObject({ unlinkedCount: 1, walkInCount: 0, giftRetailCount: 0 });
  });

  it('excludes cancelled and future-dated rows from every bucket', () => {
    const rows = [
      tx({ clientId: 'c1', status: 'cancelled' }),
      tx({ clientId: 'c2', date: '2026-05-10' }), // after TODAY
    ];
    expect(computeRetention(rows, NONE, TODAY)).toMatchObject({ newCount: 0, returningCount: 0, clientTotal: 0 });
  });

  it('returns the actual rows for each clientless bucket', () => {
    const gc   = tx({ id: 'g1', clientId: null, clientName: '', services: [], giftCardsSold: [{ code: 'X' }] });
    const anon = tx({ id: 'w1', clientId: null, clientName: 'Walk-in' });
    const named = tx({ id: 'u1', clientId: null, clientName: 'Maria Sanchez' });
    const r = computeRetention([gc, anon, named], NONE, TODAY);
    expect(r.giftRetailRows.map(x => x.id)).toEqual(['g1']);
    expect(r.walkInRows.map(x => x.id)).toEqual(['w1']);
    expect(r.unlinkedRows.map(x => x.id)).toEqual(['u1']);
    expect(r.unlinkedCount).toBe(r.unlinkedRows.length);
  });

  it('keeps clientless gift/retail out of the new/returning denominator', () => {
    const rows = [
      tx({ clientId: 'c1' }),
      tx({ clientId: null, clientName: '', services: [], giftCardsSold: [{ code: 'X' }] }),
    ];
    const r = computeRetention(rows, NONE, TODAY);
    expect(r.clientTotal).toBe(1);
    expect(r.giftRetailCount).toBe(1);
  });
});

describe('payment-method helpers', () => {
  it('buckets card/cash by method, everything else as other', () => {
    expect(txMethodKey({ payment: { method: 'card' } })).toBe('card');
    expect(txMethodKey({ payment: { method: 'cash' } })).toBe('cash');
    expect(txMethodKey({ payment: { method: 'venmo' } })).toBe('other');
    expect(txMethodKey({ payment: { method: 'giftcard' } })).toBe('other');
    expect(txMethodKey({})).toBe('other');
  });

  it('signs a refund negative and a sale positive', () => {
    expect(txMethodAmount({ payment: { total: 50 } })).toBe(50);
    expect(txMethodAmount({ payment: { total: 50 }, transactionType: 'refund' })).toBe(-50);
  });

  it('honors an explicit zero total and skips a no-data row', () => {
    expect(txMethodAmount({ payment: { total: 0 }, services: [{ price: 40 }] })).toBe(0);
    expect(txMethodAmount({ services: [] })).toBe(null);
  });

  it('per-method amounts sum to the byMethod totals (drill-down matches aggregate)', () => {
    const rows = [
      tx({ payment: { method: 'card', total: 100 } }),
      tx({ payment: { method: 'venmo', total: 60 } }),
      tx({ payment: { method: 'venmo', total: 27 }, transactionType: 'refund' }),
    ];
    const m = computeMetrics(rows, TODAY);
    const sumOther = doneTransactions(rows, TODAY)
      .filter(a => txMethodKey(a) === 'other')
      .reduce((s, a) => s + txMethodAmount(a), 0);
    expect(sumOther).toBe(m.byMethod.other.total); // 60 - 27 = 33
    expect(sumOther).toBe(33);
  });
});
