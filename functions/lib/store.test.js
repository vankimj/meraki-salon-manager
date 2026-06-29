import { describe, it, expect } from 'vitest';
import {
  clampFeePercent,
  computeApplicationFeeCents,
  buildStoreCheckoutSessionParams,
  storeOrderStatusForSub,
} from './store.js';

const ACCT = 'acct_trainer123';
const base = {
  priceId:          'price_abc',
  customerId:       'cus_xyz',
  connectAccountId: ACCT,
  tenantId:         'merakinailstudio',
  storeOrderId:     'order_1',
  clientId:         'client_1',
  successUrl:       'https://app/?store=success',
  cancelUrl:        'https://app/?store=cancel',
};

const oneTime   = { id: 'p1', name: 'Protein tub', price: 49.99, billingType: 'one_time' };
const recurring = { id: 'p2', name: 'Monthly protein', price: 30, billingType: 'recurring', interval: 'month' };

describe('clampFeePercent', () => {
  it('passes through in-range values', () => {
    expect(clampFeePercent(0)).toBe(0);
    expect(clampFeePercent(10)).toBe(10);
    expect(clampFeePercent(100)).toBe(100);
  });
  it('clamps out-of-range + coerces junk to 0', () => {
    expect(clampFeePercent(150)).toBe(100);
    expect(clampFeePercent(-5)).toBe(0);
    expect(clampFeePercent('abc')).toBe(0);
    expect(clampFeePercent(undefined)).toBe(0);
    expect(clampFeePercent(null)).toBe(0);
  });
});

describe('computeApplicationFeeCents', () => {
  it('is 0 when percent is 0 (default — trainer keeps 100%)', () => {
    expect(computeApplicationFeeCents(4999, 0)).toBe(0);
  });
  it('computes a rounded cents cut', () => {
    expect(computeApplicationFeeCents(4999, 10)).toBe(500); // round(499.9)
    expect(computeApplicationFeeCents(3000, 10)).toBe(300);
  });
  it('clamps the percent before computing', () => {
    expect(computeApplicationFeeCents(1000, 150)).toBe(1000);
    expect(computeApplicationFeeCents(1000, -5)).toBe(0);
  });
});

describe('buildStoreCheckoutSessionParams — one-time', () => {
  it('routes a destination charge with no fee by default', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: oneTime, platformFeePercent: 0 });
    expect(p.mode).toBe('payment');
    expect(p.line_items).toEqual([{ price: 'price_abc', quantity: 1 }]);
    expect(p.payment_intent_data.on_behalf_of).toBe(ACCT);
    expect(p.payment_intent_data.transfer_data).toEqual({ destination: ACCT });
    expect(p.payment_intent_data).not.toHaveProperty('application_fee_amount');
    expect(p.metadata.type).toBe('store_product');
    expect(p.metadata.storeOrderId).toBe('order_1');
    expect(p.metadata.mode).toBe('payment');
  });
  it('adds application_fee_amount when a cut is configured', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: oneTime, platformFeePercent: 10 });
    expect(p.payment_intent_data.application_fee_amount).toBe(500); // round(4999*0.1)
    expect(p.payment_intent_data.transfer_data).toEqual({ destination: ACCT });
  });
  it('never lets the fee meet or exceed the charge', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: oneTime, platformFeePercent: 100 });
    expect(p.payment_intent_data).not.toHaveProperty('application_fee_amount');
  });
});

describe('buildStoreCheckoutSessionParams — recurring', () => {
  it('routes a subscription destination charge with no fee by default', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: recurring, platformFeePercent: 0 });
    expect(p.mode).toBe('subscription');
    expect(p.subscription_data.on_behalf_of).toBe(ACCT);
    expect(p.subscription_data.transfer_data).toEqual({ destination: ACCT });
    expect(p.subscription_data).not.toHaveProperty('application_fee_percent');
    expect(p.subscription_data.metadata.type).toBe('store_product');
    expect(p.metadata.mode).toBe('subscription');
  });
  it('adds application_fee_percent when a cut is configured', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: recurring, platformFeePercent: 10 });
    expect(p.subscription_data.application_fee_percent).toBe(10);
  });
  it('clamps an out-of-range fee percent', () => {
    const p = buildStoreCheckoutSessionParams({ ...base, product: recurring, platformFeePercent: 150 });
    expect(p.subscription_data.application_fee_percent).toBe(100);
  });
});

describe('buildStoreCheckoutSessionParams — guards', () => {
  it('throws when no connect account (money-transmitter safeguard)', () => {
    expect(() => buildStoreCheckoutSessionParams({ ...base, connectAccountId: '', product: oneTime }))
      .toThrow(/connectAccountId required/);
  });
  it('throws on a non-positive price', () => {
    expect(() => buildStoreCheckoutSessionParams({ ...base, product: { ...oneTime, price: 0 } }))
      .toThrow(/positive amount/);
  });
  it('throws when storeOrderId is missing (webhook could not route)', () => {
    expect(() => buildStoreCheckoutSessionParams({ ...base, storeOrderId: '', product: oneTime }))
      .toThrow(/storeOrderId required/);
  });
});

describe('storeOrderStatusForSub', () => {
  it('maps Stripe statuses to the store vocabulary', () => {
    expect(storeOrderStatusForSub('active')).toBe('active');
    expect(storeOrderStatusForSub('trialing')).toBe('active');
    expect(storeOrderStatusForSub('past_due')).toBe('past_due');
    expect(storeOrderStatusForSub('unpaid')).toBe('past_due');
    expect(storeOrderStatusForSub('canceled')).toBe('cancelled');
    expect(storeOrderStatusForSub('paused')).toBe('paused');
  });
});
