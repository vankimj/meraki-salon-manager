import { describe, it, expect } from 'vitest';
import { genSessionToken, kioskHandoffAvailable, buildKioskHandoff } from './kioskHandoff';

describe('genSessionToken', () => {
  it('returns the requested length from the safe alphabet', () => {
    const t = genSessionToken(16);
    expect(t).toHaveLength(16);
    expect(t).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]+$/);
  });
});

describe('kioskHandoffAvailable', () => {
  it('is available for a plain services/products cart', () => {
    expect(kioskHandoffAvailable({ promo: null, giftCard: null, gcSales: [] })).toBe(true);
  });
  it('is NOT available with a promo, gift card, or gift-card sale', () => {
    expect(kioskHandoffAvailable({ promo: { code: 'X' }, giftCard: null, gcSales: [] })).toBe(false);
    expect(kioskHandoffAvailable({ promo: null, giftCard: { code: 'GC' }, gcSales: [] })).toBe(false);
    expect(kioskHandoffAvailable({ promo: null, giftCard: null, gcSales: [{ amount: 50 }] })).toBe(false);
  });
});

describe('buildKioskHandoff', () => {
  const appts = [{
    clientName: 'Jane Doe', clientId: 'c1', clientPhone: '6145550101', techName: 'Tess D',
    services: [
      { name: 'Spa Manicure', price: 0, techName: 'Tess D', taxable: true, id: 's1' },
      { name: 'Gel Manicure', price: 0, techName: 'Tess D', taxable: true, id: 's2' },
    ],
  }];
  const serviceLines = [
    { apptIdx: 0, svcIdx: 0, taxable: true },
    { apptIdx: 0, svcIdx: 1, taxable: true },
  ];

  it('prices services from the live prices[]/techNames[] (the edited values)', () => {
    const p = buildKioskHandoff({
      appts, serviceLines, prices: ['35', '40'], techNames: ['Tess D', 'Yan W'],
      cartItems: [], primaryClient: { id: 'c1', name: 'Jane Doe' }, sessionId: 'SID',
    });
    expect(p.cart.appts[0].services[0]).toMatchObject({ name: 'Spa Manicure', price: 35, techName: 'Tess D' });
    expect(p.cart.appts[0].services[1]).toMatchObject({ name: 'Gel Manicure', price: 40, techName: 'Yan W' });
    expect(p.priced).toBe(true);
    expect(p.sessionId).toBe('SID');
    expect(p.clientId).toBe('c1');
    expect(p.status).toBe('pending');
  });

  it('encodes a discount as a fixed $ amount and never carries promo/giftCard', () => {
    const p = buildKioskHandoff({
      appts, serviceLines, prices: ['35', '40'], techNames: ['Tess D', 'Tess D'],
      discountAmount: 11.25, applyCredit: true,
      primaryClient: { id: 'c1', name: 'Jane Doe' }, sessionId: 'SID',
    });
    expect(p.discType).toBe('amount');
    expect(p.discVal).toBe(11.25);
    expect(p.applyCredit).toBe(true);
    expect(p.promo).toBeNull();
    expect(p.giftCard).toBeNull();
  });

  it('uses discType none when there is no discount', () => {
    const p = buildKioskHandoff({ appts, serviceLines, prices: ['35', '40'], techNames: ['Tess D', 'Tess D'], sessionId: 'SID' });
    expect(p.discType).toBe('none');
    expect(p.discVal).toBe(0);
  });

  it('maps products to { product:{id,name,price,taxable}, qty }', () => {
    const p = buildKioskHandoff({
      appts: [], serviceLines: [], prices: [], techNames: [],
      cartItems: [{ product: { id: 'p1', name: 'Polish', price: 12, taxable: true }, qty: 2 }],
      sessionId: 'SID',
    });
    expect(p.cart.products[0]).toEqual({ product: { id: 'p1', name: 'Polish', price: 12, taxable: true }, qty: 2 });
  });

  it('defaults flow to card, and honors cashReview', () => {
    const base = { appts, serviceLines, prices: ['35', '40'], techNames: ['Tess D', 'Tess D'], sessionId: 'SID' };
    expect(buildKioskHandoff(base).flow).toBe('card');
    expect(buildKioskHandoff({ ...base, flow: 'cashReview' }).flow).toBe('cashReview');
    expect(buildKioskHandoff({ ...base, flow: 'bogus' }).flow).toBe('card');
  });

  it('falls back to walk-in client name when no primary client', () => {
    const p = buildKioskHandoff({
      appts: [{ clientName: 'Walk-in', services: [{ name: 'Polish change', price: 0 }] }],
      serviceLines: [{ apptIdx: 0, svcIdx: 0 }], prices: ['15'], techNames: ['Ana P'],
      sessionId: 'SID',
    });
    expect(p.clientName).toBe('Walk-in');
    expect(p.clientId).toBeNull();
  });
});
