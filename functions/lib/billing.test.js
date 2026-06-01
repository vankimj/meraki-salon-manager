import { describe, it, expect, vi } from 'vitest';
import {
  buildRefundRecord,
  buildTenantRefundEmailHtml,
  buildMemberRefundEmailHtml,
  handleChargeRefunded,
  buildDisputeRecord,
  buildPlatformDisputeAlertHtml,
  buildTenantDisputeAlertHtml,
  buildDisputeClosedEmailHtml,
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
  formatDueBy,
  buildPaymentFailedEmailHtml,
  buildSubscriptionCanceledEmailHtml,
  handleInvoicePaymentFailedSaas,
  handleSubscriptionDeletedSaas,
} from './billing.js';

// ── Fixtures ─────────────────────────────────────────────────────────────
function makeCharge(overrides = {}) {
  return {
    id:               'ch_test_abc',
    invoice:          'in_test_123',
    payment_intent:   'pi_test_xyz',
    customer:         'cus_test_owner',
    amount:           4900,
    amount_refunded:  4900,
    currency:         'usd',
    refunds: {
      data: [
        { id: 're_test_001', reason: 'requested_by_customer' },
      ],
    },
    ...overrides,
  };
}

// Stripe client fake — only implements what handleChargeRefunded calls.
function makeStripe({ subscriptionMetadata }) {
  return {
    invoices: {
      retrieve: vi.fn(async (id) => ({ id, subscription: 'sub_test_001' })),
    },
    subscriptions: {
      retrieve: vi.fn(async (id) => ({ id, metadata: subscriptionMetadata })),
    },
  };
}

// In-memory Firestore stub. Tracks set() calls per doc path so tests can
// assert what was written. Reads return any seeded data + a synthesized
// `exists` flag matching whether the path was seeded.
function makeFakeDb(seed = {}) {
  const docs = { ...seed };
  const writes = [];
  const dbRef = {
    doc(path) {
      return {
        path,
        async get() {
          return {
            exists: Object.prototype.hasOwnProperty.call(docs, path),
            data:   () => docs[path],
          };
        },
        async set(value, opts) {
          writes.push({ path, value, opts: opts || null });
          docs[path] = { ...(docs[path] || {}), ...value };
        },
      };
    },
    _writes: writes,
    _docs:   docs,
  };
  return dbRef;
}

// ── buildRefundRecord ────────────────────────────────────────────────────
describe('buildRefundRecord', () => {
  it('maps a full-refund charge to a record with isFullRefund=true', () => {
    const rec = buildRefundRecord(makeCharge());
    expect(rec.refundId).toBe('re_test_001');
    expect(rec.chargeId).toBe('ch_test_abc');
    expect(rec.invoiceId).toBe('in_test_123');
    expect(rec.amount).toBe(4900);
    expect(rec.amountRefunded).toBe(4900);
    expect(rec.isFullRefund).toBe(true);
    expect(rec.reason).toBe('requested_by_customer');
    expect(rec.currency).toBe('usd');
    expect(rec.refundedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('flags partial refunds with isFullRefund=false', () => {
    const rec = buildRefundRecord(makeCharge({ amount_refunded: 1000 }));
    expect(rec.isFullRefund).toBe(false);
    expect(rec.amountRefunded).toBe(1000);
  });

  it('uses the newest refund (refunds.data[0]) as the doc key', () => {
    const rec = buildRefundRecord(makeCharge({
      refunds: { data: [
        { id: 're_newest', reason: 'duplicate' },
        { id: 're_older',  reason: 'fraudulent' },
      ]},
    }));
    expect(rec.refundId).toBe('re_newest');
    expect(rec.reason).toBe('duplicate');
  });

  it('returns refundId=null when refunds.data is empty (Stripe anomaly)', () => {
    const rec = buildRefundRecord(makeCharge({ refunds: { data: [] } }));
    expect(rec.refundId).toBeNull();
  });

  it('handles missing refunds field gracefully', () => {
    const rec = buildRefundRecord({ id: 'ch_x', amount: 100, amount_refunded: 100 });
    expect(rec.refundId).toBeNull();
    expect(rec.invoiceId).toBeNull();
    expect(rec.paymentIntentId).toBeNull();
  });
});

// ── Email templates ──────────────────────────────────────────────────────
describe('buildTenantRefundEmailHtml', () => {
  it('renders full-refund copy + amount + currency', () => {
    const html = buildTenantRefundEmailHtml({
      salonName:    'Acme Nails',
      amountDollars:'49.00',
      currency:     'usd',
      isFullRefund: true,
      reason:       null,
    });
    expect(html).toContain('Full refund');
    expect(html).toContain('$49.00 USD');
    expect(html).toContain('Acme Nails');
    expect(html).not.toContain('Reason:');
  });

  it('renders partial-refund copy + includes the reason when provided', () => {
    const html = buildTenantRefundEmailHtml({
      salonName:    'Salon X',
      amountDollars:'15.00',
      currency:     'usd',
      isFullRefund: false,
      reason:       'requested_by_customer',
    });
    expect(html).toContain('Partial refund');
    expect(html).toContain('Reason:');
    expect(html).toContain('requested_by_customer');
  });

  it('HTML-escapes the salon name to defend against injection', () => {
    const html = buildTenantRefundEmailHtml({
      salonName:    '<script>alert(1)</script>',
      amountDollars:'10.00',
      currency:     'usd',
      isFullRefund: true,
    });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildMemberRefundEmailHtml', () => {
  it('addresses the client by name and mentions the plan + salon', () => {
    const html = buildMemberRefundEmailHtml({
      clientName:   'Sarah Johnson',
      planName:     'Monthly Nail Plan',
      amountDollars:'29.00',
      currency:     'usd',
      isFullRefund: true,
      salonName:    'Meraki Nail Studio',
    });
    expect(html).toContain('Sarah Johnson');
    expect(html).toContain('Monthly Nail Plan');
    expect(html).toContain('Meraki Nail Studio');
    expect(html).toContain('$29.00 USD');
  });

  it('falls back to a generic greeting when clientName is missing', () => {
    const html = buildMemberRefundEmailHtml({
      clientName:   '',
      planName:     'Plan',
      amountDollars:'10.00',
      currency:     'usd',
      isFullRefund: false,
      salonName:    'Salon',
    });
    expect(html).toContain('Hi there');
  });
});

// ── handleChargeRefunded routing + Firestore writes ──────────────────────
describe('handleChargeRefunded', () => {
  it('skips charges without an invoice (one-time charges, not subs)', async () => {
    const result = await handleChargeRefunded(
      makeCharge({ invoice: null }),
      makeFakeDb(),
      makeStripe({ subscriptionMetadata: {} }),
      vi.fn(),
    );
    expect(result).toEqual({ skipped: 'no_invoice' });
  });

  it('skips events whose refunds.data is empty', async () => {
    const result = await handleChargeRefunded(
      makeCharge({ refunds: { data: [] } }),
      makeFakeDb(),
      makeStripe({ subscriptionMetadata: { tenantId: 't1' } }),
      vi.fn(),
    );
    expect(result).toEqual({ skipped: 'no_refund_data' });
  });

  it('skips when the subscription metadata is missing tenantId', async () => {
    const sendEmail = vi.fn();
    const result = await handleChargeRefunded(
      makeCharge(),
      makeFakeDb(),
      makeStripe({ subscriptionMetadata: {} }),
      sendEmail,
    );
    expect(result).toEqual({ skipped: 'no_tenant_id' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('routes a SaaS refund: writes to tenants/{tid}/billing/refunds/{rid} + emails owner', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleChargeRefunded(
      makeCharge(),
      db,
      makeStripe({ subscriptionMetadata: { tenantId: 'acme' } }),
      sendEmail,
    );

    expect(result).toEqual({ routed: 'saas', tenantId: 'acme', refundId: 're_test_001' });

    // Refund record written under tenant billing
    const refundWrite = db._writes.find(w => w.path === 'tenants/acme/refunds/re_test_001');
    expect(refundWrite).toBeDefined();
    expect(refundWrite.value.amountRefunded).toBe(4900);
    expect(refundWrite.value.isFullRefund).toBe(true);

    // Owner emailed
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailCall = sendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe('owner@acme.test');
    expect(emailCall.subject).toContain('Refund');
    expect(emailCall.tenantId).toBe('acme');
    expect(emailCall.html).toContain('Acme Salon');
    expect(emailCall.html).toContain('$49.00');
  });

  it('routes a membership refund: writes nested refund doc + emails client', async () => {
    const db = makeFakeDb({
      'tenants/acme':                      { name: 'Acme Salon' },
      'tenants/acme/memberships/mem_001':  { clientId: 'c_42', planName: 'Premium Nails' },
      'tenants/acme/clients/c_42':         { name: 'Jane Doe', email: 'jane@example.test' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleChargeRefunded(
      makeCharge({ amount_refunded: 2000 }),  // partial
      db,
      makeStripe({ subscriptionMetadata: { type: 'membership', tenantId: 'acme', membershipId: 'mem_001' } }),
      sendEmail,
    );

    expect(result).toEqual({ routed: 'membership', tenantId: 'acme', membershipId: 'mem_001', refundId: 're_test_001' });

    // Refund record nested under the membership
    const refundWrite = db._writes.find(w => w.path === 'tenants/acme/memberships/mem_001/refunds/re_test_001');
    expect(refundWrite).toBeDefined();
    expect(refundWrite.value.isFullRefund).toBe(false);
    expect(refundWrite.value.amountRefunded).toBe(2000);

    // Client emailed (not the owner)
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const emailCall = sendEmail.mock.calls[0][0];
    expect(emailCall.to).toBe('jane@example.test');
    expect(emailCall.html).toContain('Jane Doe');
    expect(emailCall.html).toContain('Premium Nails');
    expect(emailCall.html).toContain('Acme Salon');
    expect(emailCall.html).toContain('Partial refund');
  });

  it('records the membership refund but skips email when client has no email on file', async () => {
    const db = makeFakeDb({
      'tenants/acme':                      { name: 'Acme Salon' },
      'tenants/acme/memberships/mem_001':  { clientId: 'c_42', planName: 'Premium' },
      'tenants/acme/clients/c_42':         { name: 'No Email Client' },   // no email field
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleChargeRefunded(
      makeCharge(),
      db,
      makeStripe({ subscriptionMetadata: { type: 'membership', tenantId: 'acme', membershipId: 'mem_001' } }),
      sendEmail,
    );
    expect(result.routed).toBe('membership');
    expect(sendEmail).not.toHaveBeenCalled();
    // Refund record still written
    expect(db._writes.some(w => w.path === 'tenants/acme/memberships/mem_001/refunds/re_test_001')).toBe(true);
  });

  it('writes a refund record but skips email when tenant has no ownerEmail (e.g. grandfathered)', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon' },  // no ownerEmail
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    await handleChargeRefunded(
      makeCharge(),
      db,
      makeStripe({ subscriptionMetadata: { tenantId: 'acme' } }),
      sendEmail,
    );
    expect(sendEmail).not.toHaveBeenCalled();
    expect(db._writes.some(w => w.path === 'tenants/acme/refunds/re_test_001')).toBe(true);
  });

  it('is idempotent — replaying the same refund event writes to the same doc id', async () => {
    const db = makeFakeDb({ 'tenants/acme': { ownerEmail: 'o@x.test', name: 'A' } });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const charge = makeCharge();
    const stripe = makeStripe({ subscriptionMetadata: { tenantId: 'acme' } });

    await handleChargeRefunded(charge, db, stripe, sendEmail);
    await handleChargeRefunded(charge, db, stripe, sendEmail);

    // Both writes hit the same doc path — second is a no-op-equivalent overwrite.
    const writes = db._writes.filter(w => w.path === 'tenants/acme/refunds/re_test_001');
    expect(writes).toHaveLength(2);
    expect(writes[0].value.refundId).toBe(writes[1].value.refundId);
  });
});

// ── Dispute fixtures + tests ─────────────────────────────────────────────
function makeDispute(overrides = {}) {
  return {
    id:       'dp_test_001',
    charge:   'ch_disputed_xyz',
    amount:   4900,
    currency: 'usd',
    reason:   'fraudulent',
    status:   'needs_response',
    is_charge_refundable: true,
    created:  Math.floor(Date.parse('2026-05-15T10:00:00Z') / 1000),
    evidence_details: {
      due_by: Math.floor(Date.parse('2026-05-22T10:00:00Z') / 1000),  // 7 days out
    },
    ...overrides,
  };
}

// Stripe client fake that also implements charges.retrieve (disputes need it
// to resolve the chain charge → invoice → subscription → metadata).
function makeStripeForDispute({ subscriptionMetadata, chargeInvoice = 'in_disputed', invoiceSubscription = 'sub_disputed' }) {
  return {
    charges: {
      retrieve: vi.fn(async (id) => ({ id, invoice: chargeInvoice })),
    },
    invoices: {
      retrieve: vi.fn(async (id) => ({ id, subscription: invoiceSubscription })),
    },
    subscriptions: {
      retrieve: vi.fn(async (id) => ({ id, metadata: subscriptionMetadata })),
    },
  };
}

describe('buildDisputeRecord', () => {
  it('maps a dispute to a record with ISO timestamps', () => {
    const rec = buildDisputeRecord(makeDispute());
    expect(rec.disputeId).toBe('dp_test_001');
    expect(rec.chargeId).toBe('ch_disputed_xyz');
    expect(rec.amount).toBe(4900);
    expect(rec.reason).toBe('fraudulent');
    expect(rec.status).toBe('needs_response');
    expect(rec.evidenceDueBy).toBe('2026-05-22T10:00:00.000Z');
    expect(rec.createdAt).toBe('2026-05-15T10:00:00.000Z');
    expect(rec.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Routing fields default to non-membership when no second arg
    expect(rec.isMembership).toBe(false);
    expect(rec.membershipId).toBeNull();
    expect(rec.clientName).toBeNull();
  });

  it('stamps routing fields when provided (membership dispute case)', () => {
    const rec = buildDisputeRecord(makeDispute(), {
      isMembership: true,
      membershipId: 'mem_42',
      clientId:     'c_99',
      clientName:   'Jane Doe',
    });
    expect(rec.isMembership).toBe(true);
    expect(rec.membershipId).toBe('mem_42');
    expect(rec.clientId).toBe('c_99');
    expect(rec.clientName).toBe('Jane Doe');
  });

  it('handles missing evidence_details gracefully', () => {
    const rec = buildDisputeRecord(makeDispute({ evidence_details: null }));
    expect(rec.evidenceDueBy).toBeNull();
  });

  it('handles a partially-formed dispute object (no created timestamp)', () => {
    const rec = buildDisputeRecord({ id: 'dp_x', amount: 100, currency: 'usd' });
    expect(rec.disputeId).toBe('dp_x');
    expect(rec.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);  // falls back to now()
  });
});

describe('formatDueBy', () => {
  it('formats an ISO date in a human-friendly form', () => {
    const out = formatDueBy('2026-05-22T10:00:00.000Z');
    expect(out).toMatch(/Friday|May/);  // locale-dependent but contains date parts
  });
  it('returns null for missing or invalid input', () => {
    expect(formatDueBy(null)).toBeNull();
    expect(formatDueBy('not-a-date')).toBeNull();
  });
});

describe('buildPlatformDisputeAlertHtml', () => {
  it('renders urgency: includes deadline + Stripe Dashboard link + ⚠ marker', () => {
    const html = buildPlatformDisputeAlertHtml({
      tenantName: 'Acme Salon',
      tenantOwnerEmail: 'owner@acme.test',
      amountDollars: '49.00',
      currency: 'usd',
      reason: 'fraudulent',
      dueByLabel: 'Friday, May 22, 2026 at 10:00 AM',
      disputeId: 'dp_test_001',
      isMembership: false,
      clientName: '',
    });
    expect(html).toContain('Chargeback dispute opened');
    expect(html).toContain('Acme Salon');
    expect(html).toContain('owner@acme.test');
    expect(html).toContain('$49.00 USD');
    expect(html).toContain('Friday, May 22, 2026');
    expect(html).toContain('dashboard.stripe.com/disputes/dp_test_001');
    expect(html).toContain('Submit evidence');
  });

  it('renders membership-specific copy', () => {
    const html = buildPlatformDisputeAlertHtml({
      tenantName: 'Salon X',
      amountDollars: '29.00',
      currency: 'usd',
      reason: 'duplicate',
      dueByLabel: null,
      disputeId: 'dp_002',
      isMembership: true,
      clientName: 'Jane Client',
    });
    expect(html).toContain('Jane Client');
    expect(html).toContain('client of Salon X');
    expect(html).toContain('Membership');
  });

  it('HTML-escapes the tenant name and client name', () => {
    const html = buildPlatformDisputeAlertHtml({
      tenantName: '<img src=x onerror=alert(1)>',
      amountDollars: '10.00',
      currency: 'usd',
      reason: 'fraudulent',
      dueByLabel: null,
      disputeId: 'dp_x',
      isMembership: false,
      clientName: '',
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('buildTenantDisputeAlertHtml', () => {
  it('asks tenant for context-providing materials (membership case)', () => {
    const html = buildTenantDisputeAlertHtml({
      salonName: 'Acme',
      amountDollars: '49.00',
      currency: 'usd',
      reason: 'fraudulent',
      dueByLabel: 'Fri May 22',
      isMembership: true,
      clientName: 'Jane',
      disputeId: 'dp_test_001',
    });
    expect(html).toContain('Jane');
    expect(html).toContain('Action required');
    expect(html).toContain('Time-sensitive');
    expect(html).toContain('receipts');  // we ask for receipts
    expect(html).toContain('photos');     // and photos
  });

  it('SaaS dispute prompts tenant to contact us directly', () => {
    const html = buildTenantDisputeAlertHtml({
      salonName: 'Acme',
      amountDollars: '49.00',
      currency: 'usd',
      reason: 'subscription_canceled',
      dueByLabel: null,
      isMembership: false,
      clientName: '',
      disputeId: 'dp_saas',
    });
    expect(html).toContain('subscription_canceled');
    expect(html).toContain('contact our team');
  });
});

describe('buildDisputeClosedEmailHtml', () => {
  it('won outcome: green styling + reassuring copy', () => {
    const html = buildDisputeClosedEmailHtml({
      tenantName: 'Acme',
      outcome: 'won',
      amountDollars: '49.00',
      currency: 'usd',
      isMembership: false,
      clientName: '',
      disputeId: 'dp_001',
      audience: 'platform',
    });
    expect(html).toContain('Dispute resolved in your favor');
    expect(html).toContain('sided with you');
    expect(html).toContain('#15803d');  // green
    expect(html).toContain('dp_001');    // platform sees the id
  });

  it('lost outcome: red styling + funds-withdrawn copy', () => {
    const html = buildDisputeClosedEmailHtml({
      tenantName: 'Acme',
      outcome: 'lost',
      amountDollars: '49.00',
      currency: 'usd',
      isMembership: false,
      clientName: '',
      disputeId: 'dp_001',
      audience: 'tenant',
    });
    expect(html).toContain('Dispute lost');
    expect(html).toContain('withdrawn');
    expect(html).toContain('#991b1b');  // red
    expect(html).not.toContain('dp_001');  // tenant doesn't see the raw id
  });
});

describe('handleChargeDisputeCreated', () => {
  it('records SaaS dispute under tenants/{tid}/billing/disputes + emails platform AND tenant', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForDispute({ subscriptionMetadata: { tenantId: 'acme' } });

    const result = await handleChargeDisputeCreated(
      makeDispute(),
      db,
      stripe,
      sendEmail,
      'platform@plumenexus.test',
    );

    expect(result).toEqual({
      routed: 'saas',
      tenantId: 'acme',
      membershipId: null,
      disputeId: 'dp_test_001',
    });

    // Dispute record written
    const w = db._writes.find(w => w.path === 'tenants/acme/disputes/dp_test_001');
    expect(w).toBeDefined();
    expect(w.value.reason).toBe('fraudulent');
    expect(w.value.status).toBe('needs_response');

    // Both emails fired
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map(c => c[0].to);
    expect(recipients).toContain('platform@plumenexus.test');
    expect(recipients).toContain('owner@acme.test');

    // Platform email subject signals urgency
    const platformCall = sendEmail.mock.calls.find(c => c[0].to === 'platform@plumenexus.test');
    expect(platformCall[0].subject).toContain('Chargeback');
    expect(platformCall[0].subject).toMatch(/⚠|due/);
  });

  it('membership disputes still land at the flat /billing/disputes path, with isMembership=true + clientName resolved', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test' },
      'tenants/acme/memberships/m_1': { clientId: 'c_99', planName: 'Premium' },
      'tenants/acme/clients/c_99': { name: 'Jane', email: 'jane@x.test' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForDispute({
      subscriptionMetadata: { type: 'membership', tenantId: 'acme', membershipId: 'm_1' },
    });

    const result = await handleChargeDisputeCreated(
      makeDispute(),
      db,
      stripe,
      sendEmail,
      'platform@plumenexus.test',
    );

    expect(result.routed).toBe('membership');
    expect(result.membershipId).toBe('m_1');

    // Single flat location regardless of membership/SaaS — UI reads from
    // one collection. Membership context is in the record fields.
    const w = db._writes.find(w => w.path === 'tenants/acme/disputes/dp_test_001');
    expect(w).toBeDefined();
    expect(w.value.isMembership).toBe(true);
    expect(w.value.membershipId).toBe('m_1');
    expect(w.value.clientName).toBe('Jane');

    // Tenant owner gets the alert (not the client — client filed the
    // dispute, so emailing them about their own dispute is wrong)
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = sendEmail.mock.calls.map(c => c[0].to);
    expect(recipients).toContain('platform@plumenexus.test');
    expect(recipients).toContain('owner@acme.test');
    expect(recipients).not.toContain('jane@x.test');
  });

  it('still alerts platform even when no subscription / no tenant can be found', async () => {
    const db = makeFakeDb();
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    // Charge has no invoice — happens for one-time / Connect charges
    const stripe = {
      charges: { retrieve: vi.fn(async (id) => ({ id, invoice: null })) },
      invoices: { retrieve: vi.fn() },
      subscriptions: { retrieve: vi.fn() },
    };

    const result = await handleChargeDisputeCreated(
      makeDispute(),
      db,
      stripe,
      sendEmail,
      'platform@plumenexus.test',
    );
    expect(result.routed).toBe('platform_only');
    expect(result.tenantId).toBeNull();
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('platform@plumenexus.test');
  });

  it('skips when dispute has no charge attached (Stripe anomaly)', async () => {
    const result = await handleChargeDisputeCreated(
      makeDispute({ charge: null }),
      makeFakeDb(),
      { charges: { retrieve: vi.fn() } },
      vi.fn(),
      'platform@plumenexus.test',
    );
    expect(result).toEqual({ skipped: 'no_charge' });
  });

  it('does NOT email platform if platformOwnerEmail is empty (config gap)', async () => {
    const db = makeFakeDb({ 'tenants/acme': { name: 'A', ownerEmail: 'o@x.test' } });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    await handleChargeDisputeCreated(
      makeDispute(),
      db,
      makeStripeForDispute({ subscriptionMetadata: { tenantId: 'acme' } }),
      sendEmail,
      '',  // empty platform email
    );
    // Only tenant owner should be emailed
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail.mock.calls[0][0].to).toBe('o@x.test');
  });
});

describe('handleChargeDisputeClosed', () => {
  it('won outcome: updates existing record + emails outcome to both audiences', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test' },
      'tenants/acme/disputes/dp_test_001': { status: 'needs_response' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForDispute({ subscriptionMetadata: { tenantId: 'acme' } });

    const result = await handleChargeDisputeClosed(
      makeDispute({ status: 'won' }),
      db,
      stripe,
      sendEmail,
      'platform@plumenexus.test',
    );

    expect(result.outcome).toBe('won');

    // Doc updated with new status (merge semantics, so prior fields preserved)
    const w = db._writes.find(w => w.path === 'tenants/acme/disputes/dp_test_001');
    expect(w).toBeDefined();
    expect(w.value.status).toBe('won');
    expect(w.opts).toEqual({ merge: true });

    // Two outcome emails sent
    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(sendEmail.mock.calls.every(c => c[0].subject.includes('Dispute won') || c[0].subject.includes('✓'))).toBe(true);
  });

  it('lost outcome: emails reflect the loss', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme', ownerEmail: 'owner@x.test' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForDispute({ subscriptionMetadata: { tenantId: 'acme' } });

    await handleChargeDisputeClosed(
      makeDispute({ status: 'lost' }),
      db,
      stripe,
      sendEmail,
      'platform@plumenexus.test',
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const subjects = sendEmail.mock.calls.map(c => c[0].subject);
    expect(subjects.every(s => s.includes('Dispute lost') || s.includes('✗'))).toBe(true);
  });
});

// ── Payment-failure + cancellation email handlers ────────────────────────

function makeInvoice(overrides = {}) {
  return {
    id:                    'in_test_failed_001',
    subscription:          'sub_test_failed',
    amount_due:            4900,
    currency:              'usd',
    next_payment_attempt:  null,
    ...overrides,
  };
}

function makeSubscription(overrides = {}) {
  return {
    id:        'sub_test_failed',
    customer:  'cus_test_fail',
    metadata:  { tenantId: 'acme' },
    ...overrides,
  };
}

// Stripe mock that supports subscriptions.retrieve + billingPortal.sessions.create.
// `portalResult` lets a test simulate Stripe failing to mint a session.
function makeStripeForBilling({ subscriptionMetadata = { tenantId: 'acme' }, portalResult = 'ok', subscriptionCustomer = 'cus_test_fail' } = {}) {
  return {
    subscriptions: {
      retrieve: vi.fn(async (id) => ({
        id,
        customer: subscriptionCustomer,
        metadata: subscriptionMetadata,
      })),
    },
    billingPortal: {
      sessions: {
        create: vi.fn(async () => {
          if (portalResult === 'throw') throw new Error('portal API down');
          return { url: 'https://billing.stripe.test/portal/sess_xxx' };
        }),
      },
    },
  };
}

// Extend the fake db with a single-collection .where().limit().get() so the
// fallback path (subscription has no metadata.tenantId) is testable. Only one
// `where('field','==',value)` is supported and only with `limit(1)`.
function makeFakeDbWithCollection(seed = {}, collectionData = {}) {
  const base = makeFakeDb(seed);
  return {
    ...base,
    collection(path) {
      const docs = collectionData[path] || [];
      let _field = null, _value = null;
      const q = {
        where(field, _op, value) { _field = field; _value = value; return q; },
        limit() { return q; },
        async get() {
          const matched = docs.filter(d => d[_field] === _value);
          return {
            empty: matched.length === 0,
            docs:  matched.map(d => ({ id: d._id, data: () => d })),
          };
        },
      };
      return q;
    },
  };
}

describe('buildPaymentFailedEmailHtml', () => {
  it('renders salon name, amount, currency, and portal CTA', () => {
    const html = buildPaymentFailedEmailHtml({
      salonName: 'Acme Salon', amountDollars: '49.00', currency: 'usd',
      portalUrl: 'https://billing.stripe.test/portal/x', nextAttemptLabel: 'Mon, Jun 2',
    });
    expect(html).toContain('Acme Salon');
    expect(html).toContain('$49.00');
    expect(html).toContain('USD');
    expect(html).toContain('https://billing.stripe.test/portal/x');
    expect(html).toContain('Mon, Jun 2');
  });
  it('omits the next-attempt sentence when nextAttemptLabel is missing', () => {
    const html = buildPaymentFailedEmailHtml({
      salonName: 'Acme', amountDollars: '10.00', currency: 'usd', portalUrl: 'https://x',
    });
    expect(html).not.toContain('Stripe will retry automatically');
  });
  it('escapes salon name to prevent HTML injection', () => {
    const html = buildPaymentFailedEmailHtml({
      salonName: '<script>alert(1)</script>', amountDollars: '0.00', currency: 'usd', portalUrl: 'https://x',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildSubscriptionCanceledEmailHtml', () => {
  it('renders salon name + portal CTA + Starter copy', () => {
    const html = buildSubscriptionCanceledEmailHtml({
      salonName: 'Acme Salon', portalUrl: 'https://billing.stripe.test/portal/y',
    });
    expect(html).toContain('Acme Salon');
    expect(html).toContain('Starter');
    expect(html).toContain('Schedule, Clients, Services, Employees, and Walk-in Kiosk');
    expect(html).toContain('https://billing.stripe.test/portal/y');
  });
});

describe('handleInvoicePaymentFailedSaas', () => {
  it('skips invoices without a subscription (one-time payments)', async () => {
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice({ subscription: null }), makeFakeDb(), makeStripeForBilling(), vi.fn(),
    );
    expect(result).toEqual({ skipped: 'no_subscription' });
  });

  it('skips membership invoices (handled by inline branch in webhook)', async () => {
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), makeFakeDb(),
      makeStripeForBilling({ subscriptionMetadata: { type: 'membership', tenantId: 'acme' } }),
      vi.fn(),
    );
    expect(result).toEqual({ skipped: 'membership_branch' });
  });

  it('skips when the tenant cannot be resolved (no metadata, no mirror)', async () => {
    const db = makeFakeDbWithCollection({}, { 'tenants': [] });
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), db,
      makeStripeForBilling({ subscriptionMetadata: {} }),
      vi.fn(),
    );
    expect(result).toEqual({ skipped: 'no_tenant' });
  });

  it('skips when the same invoice has already been emailed (Smart Retry idempotency)', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test' },
      'tenants/acme/data/settings': { lastFailedInvoiceId: 'in_test_failed_001' },
    });
    const sendEmail = vi.fn();
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), db, makeStripeForBilling(), sendEmail,
    );
    expect(result).toEqual({ skipped: 'duplicate_retry' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('skips email when the tenant has no ownerEmail on file', async () => {
    const db = makeFakeDb({ 'tenants/acme': { name: 'Acme', ownerEmail: '' } });
    const sendEmail = vi.fn();
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), db, makeStripeForBilling(), sendEmail,
    );
    expect(result).toEqual({ skipped: 'no_owner_email' });
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('happy path: emails the owner with a portal link and records the invoice id', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test', subdomain: 'acme-salon' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForBilling();
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), db, stripe, sendEmail,
    );
    expect(result).toEqual({ emailed: 'owner@acme.test' });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe('owner@acme.test');
    expect(call.subject).toContain('Acme Salon');
    expect(call.html).toContain('https://billing.stripe.test/portal/sess_xxx');
    expect(stripe.billingPortal.sessions.create).toHaveBeenCalledWith({
      customer:   'cus_test_fail',
      return_url: 'https://acme-salon.plumenexus.com/manage',
    });
    // Tracks the invoice id so the retry idempotency check works next time.
    const settingsWrite = db._writes.find(w => w.path === 'tenants/acme/data/settings');
    expect(settingsWrite.value.lastFailedInvoiceId).toBe('in_test_failed_001');
  });

  it('falls back to subdomain URL if Stripe portal mint fails (still emails)', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test', subdomain: 'acme' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const stripe = makeStripeForBilling({ portalResult: 'throw' });
    const result = await handleInvoicePaymentFailedSaas(
      makeInvoice(), db, stripe, sendEmail,
    );
    expect(result).toEqual({ emailed: 'owner@acme.test' });
    const call = sendEmail.mock.calls[0][0];
    expect(call.html).toContain('https://acme.plumenexus.com/manage');
  });
});

describe('handleSubscriptionDeletedSaas', () => {
  it('skips when the tenant cannot be resolved', async () => {
    const db = makeFakeDbWithCollection({}, { 'tenants': [] });
    const result = await handleSubscriptionDeletedSaas(
      makeSubscription({ metadata: {} }), db, makeStripeForBilling(), vi.fn(),
    );
    expect(result).toEqual({ skipped: 'no_tenant' });
  });

  it('happy path: downgrades to starter, clears sub fields, emails the owner', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme Salon', ownerEmail: 'owner@acme.test', subdomain: 'acme' },
    });
    const sendEmail = vi.fn().mockResolvedValue({ error: null });
    const result = await handleSubscriptionDeletedSaas(
      makeSubscription(), db, makeStripeForBilling(), sendEmail,
    );
    expect(result).toEqual({ downgraded: true, emailed: 'owner@acme.test' });
    // Both tenant root + settings get the downgrade
    const settingsWrite = db._writes.find(w => w.path === 'tenants/acme/data/settings');
    expect(settingsWrite.value.plan).toBe('starter');
    const tenantWrite = db._writes.find(w => w.path === 'tenants/acme');
    expect(tenantWrite.value.plan).toBe('starter');
    // Email landed on owner with the portal link
    const call = sendEmail.mock.calls[0][0];
    expect(call.to).toBe('owner@acme.test');
    expect(call.subject).toContain('subscription ended');
  });

  it('downgrades even when ownerEmail is missing (no email, but state still cleared)', async () => {
    const db = makeFakeDb({
      'tenants/acme': { name: 'Acme', ownerEmail: '' },
    });
    const sendEmail = vi.fn();
    const result = await handleSubscriptionDeletedSaas(
      makeSubscription(), db, makeStripeForBilling(), sendEmail,
    );
    expect(result).toEqual({ downgraded: true, skipped: 'no_owner_email' });
    expect(sendEmail).not.toHaveBeenCalled();
    const tenantWrite = db._writes.find(w => w.path === 'tenants/acme');
    expect(tenantWrite.value.plan).toBe('starter');
  });
});

// ── Card-on-file helper tests ────────────────────────────────────────────
import {
  extractCardMetadata,
  buildOffSessionChargeRequest,
} from './billing.js';

function makePaymentMethod(overrides = {}) {
  return {
    id: 'pm_test_001',
    type: 'card',
    card: {
      brand:     'visa',
      last4:     '4242',
      exp_month: 12,
      exp_year:  2027,
      funding:   'credit',
      country:   'US',
    },
    ...overrides,
  };
}

describe('extractCardMetadata', () => {
  it('extracts the safe-to-store fields from a card PaymentMethod', () => {
    const meta = extractCardMetadata(makePaymentMethod());
    expect(meta).toEqual({
      id:       'pm_test_001',
      brand:    'visa',
      last4:    '4242',
      expMonth: 12,
      expYear:  2027,
      funding:  'credit',
      country:  'US',
      addedAt:  expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('does NOT include the cardholder name', () => {
    const pm = makePaymentMethod({
      billing_details: { name: 'Jane Doe', email: 'jane@x.com' },
    });
    const meta = extractCardMetadata(pm);
    expect(meta).not.toHaveProperty('name');
    expect(meta).not.toHaveProperty('email');
    expect(meta).not.toHaveProperty('billing_details');
  });

  it('does NOT include networks / three_d_secure / fingerprint', () => {
    const pm = makePaymentMethod({
      card: {
        ...makePaymentMethod().card,
        fingerprint: 'fpr_xxx',
        networks: { available: ['visa'], preferred: null },
        three_d_secure_usage: { supported: true },
      },
    });
    const meta = extractCardMetadata(pm);
    expect(meta).not.toHaveProperty('fingerprint');
    expect(meta).not.toHaveProperty('networks');
    expect(meta).not.toHaveProperty('three_d_secure_usage');
  });

  it('returns null for non-card payment methods (us_bank_account, etc.)', () => {
    expect(extractCardMetadata({ id: 'pm_x', type: 'us_bank_account' })).toBeNull();
    expect(extractCardMetadata({ id: 'pm_x' })).toBeNull();
    expect(extractCardMetadata(null)).toBeNull();
    expect(extractCardMetadata(undefined)).toBeNull();
  });

  it('falls back to "unknown" for missing card.brand and card.funding', () => {
    const pm = makePaymentMethod({ card: { last4: '0000' } });
    const meta = extractCardMetadata(pm);
    expect(meta.brand).toBe('unknown');
    expect(meta.funding).toBe('unknown');
    expect(meta.last4).toBe('0000');
  });
});

describe('buildOffSessionChargeRequest', () => {
  const valid = {
    amount:           5000,
    currency:         'usd',
    customerId:       'cus_acme_client',
    paymentMethodId:  'pm_test_001',
    connectAccountId: 'acct_meraki',
    tenantId:         'meraki',
    clientId:         'client_jane',
  };

  it('produces a charge request with all the marketplace-routing flags', () => {
    const req = buildOffSessionChargeRequest(valid);
    expect(req.amount).toBe(5000);
    expect(req.customer).toBe('cus_acme_client');
    expect(req.payment_method).toBe('pm_test_001');
    expect(req.confirm).toBe(true);
    expect(req.off_session).toBe(true);
    expect(req.on_behalf_of).toBe('acct_meraki');           // ← salon name on statement
    expect(req.transfer_data).toEqual({ destination: 'acct_meraki' }); // ← funds to salon
    expect(req.application_fee_amount).toBe(0);             // default 0 platform fee
    expect(req.metadata).toEqual({
      tenantId: 'meraki',
      clientId: 'client_jane',
      source:   'off_session_card',
    });
  });

  it('honours application_fee_amount when provided', () => {
    const req = buildOffSessionChargeRequest({ ...valid, applicationFeeAmount: 250 });
    expect(req.application_fee_amount).toBe(250);
  });

  it('coerces a negative application_fee_amount to 0 (defensive)', () => {
    const req = buildOffSessionChargeRequest({ ...valid, applicationFeeAmount: -100 });
    expect(req.application_fee_amount).toBe(0);
  });

  it('forwards description + statementDescriptorSuffix when provided', () => {
    const req = buildOffSessionChargeRequest({
      ...valid,
      description: 'No-show fee for May 30 appointment',
      statementDescriptorSuffix: 'NOSHOW',
    });
    expect(req.description).toBe('No-show fee for May 30 appointment');
    expect(req.statement_descriptor_suffix).toBe('NOSHOW');
  });

  it('truncates statement_descriptor_suffix to Stripe\'s 22-char limit', () => {
    const longSuffix = 'A'.repeat(50);
    const req = buildOffSessionChargeRequest({ ...valid, statementDescriptorSuffix: longSuffix });
    expect(req.statement_descriptor_suffix.length).toBe(22);
  });

  it('REFUSES to build a charge without connectAccountId (money-transmitter guard)', () => {
    expect(() => buildOffSessionChargeRequest({ ...valid, connectAccountId: '' }))
      .toThrow(/connectAccountId required/);
  });

  it('throws on missing amount', () => {
    expect(() => buildOffSessionChargeRequest({ ...valid, amount: 0 }))
      .toThrow(/amount must be a positive integer/);
    expect(() => buildOffSessionChargeRequest({ ...valid, amount: -100 }))
      .toThrow(/amount must be a positive integer/);
  });

  it('throws on missing customerId / paymentMethodId / currency / tenantId', () => {
    expect(() => buildOffSessionChargeRequest({ ...valid, customerId: null }))
      .toThrow(/customerId required/);
    expect(() => buildOffSessionChargeRequest({ ...valid, paymentMethodId: null }))
      .toThrow(/paymentMethodId required/);
    expect(() => buildOffSessionChargeRequest({ ...valid, currency: '' }))
      .toThrow(/currency required/);
    expect(() => buildOffSessionChargeRequest({ ...valid, tenantId: null }))
      .toThrow(/tenantId required/);
  });

  it('omits clientId from metadata when not provided (still includes the key as empty string)', () => {
    const req = buildOffSessionChargeRequest({ ...valid, clientId: undefined });
    expect(req.metadata.clientId).toBe('');
    expect(req.metadata.tenantId).toBe('meraki');
  });
});

