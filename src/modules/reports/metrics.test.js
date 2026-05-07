import { describe, it, expect } from 'vitest';
import {
  apptRevenue, apptToSyntheticReceipt, buildTransactions, computeMetrics,
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
  it('classifies clientId presence as scheduled', () => {
    const m = computeMetrics([tx({ clientId: 'c1' })], TODAY);
    expect(m.scheduled).toBe(1);
    expect(m.walkIns).toBe(0);
  });
  it('counts no-clientId as walk-in', () => {
    const m = computeMetrics([tx({ clientId: null, clientName: 'Walk-in' })], TODAY);
    expect(m.walkIns).toBe(1);
    expect(m.anonymous).toBe(1);
    expect(m.namedWalkIns).toBe(0);
  });
  it('separates anonymous from named walk-ins', () => {
    const m = computeMetrics([
      tx({ clientId: null, clientName: 'Walk-in' }),
      tx({ clientId: null, clientName: 'Sue Phone-In' }),
    ], TODAY);
    expect(m.walkIns).toBe(2);
    expect(m.anonymous).toBe(1);
    expect(m.namedWalkIns).toBe(1);
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
