import { describe, it, expect } from 'vitest';
import {
  parseCsv, detectType, parseGgDateTime, clientKey,
  mapClientRow, mapAppointmentRow, mapSaleRow,
  buildReceiptsFromGg,
} from './csvImport';

// ── parseCsv ───────────────────────────────────────────
describe('parseCsv', () => {
  it('parses a simple CSV', () => {
    const text = 'a,b,c\n1,2,3\n4,5,6';
    const { headers, records } = parseCsv(text);
    expect(headers).toEqual(['a', 'b', 'c']);
    expect(records).toEqual([{ a: '1', b: '2', c: '3' }, { a: '4', b: '5', c: '6' }]);
  });
  it('handles quoted fields with commas', () => {
    const text = 'name,address\n"Smith, John","123 Main, Apt 4"';
    const { records } = parseCsv(text);
    expect(records[0].name).toBe('Smith, John');
    expect(records[0].address).toBe('123 Main, Apt 4');
  });
  it('handles doubled quotes inside quoted fields', () => {
    const text = 'name\n"She said ""hi"""';
    const { records } = parseCsv(text);
    expect(records[0].name).toBe('She said "hi"');
  });
  it('strips CR before LF', () => {
    const text = 'a,b\r\n1,2\r\n';
    const { records } = parseCsv(text);
    expect(records).toEqual([{ a: '1', b: '2' }]);
  });
  it('skips blank lines', () => {
    const text = 'a,b\n1,2\n\n3,4';
    const { records } = parseCsv(text);
    expect(records.length).toBe(2);
  });
  it('returns empty result for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], records: [] });
  });
});

// ── detectType ─────────────────────────────────────────
describe('detectType', () => {
  it('identifies GG Payment Details', () => {
    expect(detectType(['Charge ID', 'Amount', 'Payment Method', 'Payment Processing Fee'])).toBe('ggPayments');
  });
  it('identifies GG Checkout Line Items', () => {
    expect(detectType(['Charge ID', 'Descriptor', 'Item Type', 'Price'])).toBe('ggLineItems');
  });
  it('identifies generic sales', () => {
    expect(detectType(['Total', 'Tip', 'Payment Method', 'Transaction Date'])).toBe('sales');
  });
  it('identifies appointments by date + service + provider', () => {
    expect(detectType(['Appointment Date', 'Service', 'Provider'])).toBe('appointments');
  });
  it('identifies clients by email/phone with no date/service', () => {
    expect(detectType(['Name', 'Email', 'Phone'])).toBe('clients');
  });
  it('returns "unknown" for unrecognized headers', () => {
    expect(detectType(['Foo', 'Bar'])).toBe('unknown');
  });
});

// ── parseGgDateTime ────────────────────────────────────
describe('parseGgDateTime', () => {
  it('parses GG combined timestamp', () => {
    const r = parseGgDateTime('11-13-24, 7:57 PM');
    expect(r.date).toBe('2024-11-13');
    expect(r.time).toBe('19:57');
    expect(r.iso).toBe('2024-11-13T19:57:00.000Z');
  });
  it('handles AM hour 12 → 0', () => {
    expect(parseGgDateTime('1-1-25, 12:30 AM').time).toBe('00:30');
  });
  it('handles PM hour 12 → 12', () => {
    expect(parseGgDateTime('1-1-25, 12:30 PM').time).toBe('12:30');
  });
  it('falls back to date-only for plain dates', () => {
    const r = parseGgDateTime('5/2/2026');
    expect(r.date).toBe('2026-05-02');
  });
  it('returns empty for invalid input', () => {
    expect(parseGgDateTime('')).toEqual({ date: '', time: '', iso: '' });
  });
});

// ── clientKey ──────────────────────────────────────────
describe('clientKey', () => {
  it('lowercases and trims', () => expect(clientKey('  Jonathan VanKim ')).toBe('jonathan vankim'));
  it('collapses whitespace', () => expect(clientKey('Jonathan   Van  Kim')).toBe('jonathan van kim'));
  it('returns empty for null/undefined', () => expect(clientKey(null)).toBe(''));
});

// ── mapClientRow ───────────────────────────────────────
describe('mapClientRow', () => {
  it('maps the standard GG client export', () => {
    const r = mapClientRow({
      'First Name': 'Jane',
      'Last Name':  'Doe',
      'Email':      'jane@example.com',
      'Phone':      '555-1234',
      'Birthday':   '5/2/1990',
    });
    expect(r.name).toBe('Jane Doe');
    expect(r.email).toBe('jane@example.com');
    expect(r.phone).toBe('555-1234');
    expect(r.birthday).toBe('1990-05-02');
    expect(r._importedFrom).toBe('glossgenius');
  });
  it('uses single-field "Client Name" when present', () => {
    const r = mapClientRow({ 'Client Name': 'Sole Owner', Email: '' });
    expect(r.name).toBe('Sole Owner');
  });
  it('returns null when no name is parseable', () => {
    expect(mapClientRow({ Email: 'no@name.com' })).toBeNull();
  });
});

// ── mapAppointmentRow ──────────────────────────────────
describe('mapAppointmentRow', () => {
  const lookup = { 'jane doe': 'client123' };

  it('maps a complete appointment row', () => {
    const r = mapAppointmentRow({
      'First Name': 'Jane', 'Last Name': 'Doe',
      'Appointment Date': '2026-05-02',
      'Start Time': '10:30 AM',
      'Provider': 'Yasmin',
      'Service':  'Manicure',
      'Price':    '$45',
      'Duration': '60',
      'Status':   'Completed',
    }, lookup);
    expect(r.date).toBe('2026-05-02');
    expect(r.startTime).toBe('10:30');
    expect(r.techName).toBe('Yasmin');
    expect(r.services[0]).toMatchObject({ name: 'Manicure', price: 45, duration: 60 });
    expect(r.status).toBe('done');
    expect(r.clientId).toBe('client123');
  });
  it('returns null when date is missing', () => {
    expect(mapAppointmentRow({ 'Client Name': 'X', Service: 'Y' })).toBeNull();
  });
  it('returns null when service is missing', () => {
    expect(mapAppointmentRow({ Date: '2026-05-02', 'Client Name': 'X' })).toBeNull();
  });
  it('keeps clientId null when name does not match lookup', () => {
    const r = mapAppointmentRow({
      'Client Name': 'Stranger', Date: '2026-05-02', Service: 'Manicure',
    }, lookup);
    expect(r.clientId).toBeNull();
  });
});

// ── mapSaleRow ─────────────────────────────────────────
describe('mapSaleRow', () => {
  it('maps tip and tax out of total', () => {
    const r = mapSaleRow({
      'Transaction Date': '2026-05-02',
      'Client Name': 'Jane Doe',
      'Total': '110.00',
      'Tip':   '15.00',
      'Tax':    '5.00',
      'Payment Method': 'Visa',
      'Service': 'Pedicure',
    });
    expect(r.payment.total).toBe(110);
    expect(r.payment.tip).toBe(15);
    expect(r.payment.tax).toBe(5);
    expect(r.payment.subtotal).toBe(90);   // total - tax - tip
    expect(r.payment.method).toBe('card');
    expect(r.createdAt).toBe('2026-05-02T12:00:00.000Z');
  });
  it('returns null when total is zero or missing', () => {
    expect(mapSaleRow({ 'Transaction Date': '2026-05-02', Total: '0' })).toBeNull();
    expect(mapSaleRow({ 'Transaction Date': '2026-05-02' })).toBeNull();
  });
});

// ── buildReceiptsFromGg ───────────────────────────────
describe('buildReceiptsFromGg', () => {
  const payments = [
    {
      'Charge ID': 'ch_1',
      'Transaction Date': '11-13-24, 2:30 PM',
      'Amount': '110.00',
      'Payment Processing Fee': '3.50',
      'Payment Method': 'Visa',
      'Payment Source': 'Appointment',
    },
  ];
  const lineItems = [
    { 'Charge ID': 'ch_1', 'Item Type': 'Service',   'Descriptor': 'Manicure',  'Price': '45',  'Provider': 'Yasmin', 'Client': 'Jane Doe' },
    { 'Charge ID': 'ch_1', 'Item Type': 'Service',   'Descriptor': 'Pedicure',  'Price': '50',  'Provider': 'Yasmin', 'Client': 'Jane Doe' },
    { 'Charge ID': 'ch_1', 'Item Type': 'Sales Tax', 'Descriptor': 'Tax',        'Price': '5.00' },
    { 'Charge ID': 'ch_1', 'Item Type': 'Gratuity',  'Descriptor': 'Tip',        'Price': '10.00' },
  ];

  it('joins payment + line items into a single receipt', () => {
    const [r] = buildReceiptsFromGg(payments, lineItems);
    expect(r.services.length).toBe(2);
    expect(r.services.map(s => s.name)).toEqual(['Manicure', 'Pedicure']);
    expect(r.payment.tip).toBe(10);
    expect(r.payment.tax).toBe(5);
    expect(r.payment.total).toBe(110);
    expect(r.payment.charged).toBe(100); // total - tip
    expect(r.payment.ccFee).toBe(3.5);
  });
  it('extracts client + tech from line items', () => {
    const [r] = buildReceiptsFromGg(payments, lineItems);
    expect(r.clientName).toBe('Jane Doe');
    expect(r.techName).toBe('Yasmin');
  });
  it('treats "Other" item type as retail product', () => {
    const liWithRetail = [
      ...lineItems,
      { 'Charge ID': 'ch_1', 'Item Type': 'Other', 'Descriptor': 'Cuticle Oil', 'Price': '12' },
    ];
    const [r] = buildReceiptsFromGg(payments, liWithRetail);
    expect(r.retailProducts).toEqual([{ name: 'Cuticle Oil', price: 12, qty: 1 }]);
  });
  it('absolute-values negative discount line items', () => {
    const liWithDiscount = [
      ...lineItems,
      { 'Charge ID': 'ch_1', 'Item Type': 'Discount', 'Descriptor': 'F&F', 'Price': '-15' },
    ];
    const [r] = buildReceiptsFromGg(payments, liWithDiscount);
    expect(r.payment.discountAmount).toBe(15);
  });
  it('sets createdAt from the transaction date (preserves history)', () => {
    const [r] = buildReceiptsFromGg(payments, lineItems);
    expect(r.createdAt).toBe('2024-11-13T14:30:00.000Z');
    expect(r.payment.paidAt).toBe('2024-11-13T14:30:00.000Z');
  });
  it('marks receipts as imported from GlossGenius with ids preserved', () => {
    const [r] = buildReceiptsFromGg(payments, lineItems);
    expect(r._importedFrom).toBe('glossgenius');
    expect(r._glossgeniusChargeId).toBe('ch_1');
    expect(r._glossgeniusSource).toBe('Appointment');
  });
  it('falls back to "Walk-in" client when no line item carries Client', () => {
    const liNoClient = lineItems.map(li => {
      const { Client, ...rest } = li;
      return rest;
    });
    const [r] = buildReceiptsFromGg(payments, liNoClient);
    expect(r.clientName).toBe('Walk-in');
  });
  it('uses "Walk-in retail" when source is Retail Purchase and no client', () => {
    const retailPayment = [{ ...payments[0], 'Payment Source': 'Retail Purchase' }];
    const liNoClient = lineItems.map(li => {
      const { Client, ...rest } = li;
      return rest;
    });
    const [r] = buildReceiptsFromGg(retailPayment, liNoClient);
    expect(r.clientName).toBe('Walk-in retail');
  });
  it('links clientId via clientLookup when name matches', () => {
    const lookup = { 'jane doe': 'client_xyz' };
    const [r] = buildReceiptsFromGg(payments, lineItems, lookup);
    expect(r.clientId).toBe('client_xyz');
  });
  it('clientId is null when name is missing or not in lookup', () => {
    const lookup = { 'someone else': 'other_id' };
    const [r] = buildReceiptsFromGg(payments, lineItems, lookup);
    expect(r.clientId).toBeNull();
  });
  it('ignores line items with no Charge ID match', () => {
    const liExtra = [
      ...lineItems,
      { 'Charge ID': 'ch_orphan', 'Item Type': 'Service', 'Descriptor': 'Lonely', 'Price': '99' },
    ];
    const [r] = buildReceiptsFromGg(payments, liExtra);
    expect(r.services.find(s => s.name === 'Lonely')).toBeUndefined();
  });
  it('skips payments with no Charge ID', () => {
    const noId = [{ 'Transaction Date': '1-1-25, 10:00 AM', Amount: '50' }];
    expect(buildReceiptsFromGg(noId, [])).toEqual([]);
  });
  // GG re-uses one Charge ID for a payment + later refund. Each row must
  // become its own receipt so the refund nets against the payment in
  // reports — otherwise refunds silently disappear at dedup time.
  it('produces a separate receipt for each payment row sharing a Charge ID (refund pair)', () => {
    const pair = [
      { 'Charge ID': 'ch_1', 'Transaction Date': '11-20-25, 6:56 PM', 'Amount': '108',  'Payment Method': 'Cash', 'Transaction Type': 'Payment', 'Payment Transaction ID': 'tx_pay'    },
      { 'Charge ID': 'ch_1', 'Transaction Date': '11-20-25, 7:58 PM', 'Amount': '-108', 'Payment Method': 'Cash', 'Transaction Type': 'Refund',  'Payment Transaction ID': 'tx_refund' },
    ];
    const lines = [
      { 'Charge ID': 'ch_1', 'Item Type': 'Service', 'Descriptor': 'Mani', 'Price': '108', 'Provider': 'Yas', 'Client': 'Jane' },
    ];
    const out = buildReceiptsFromGg(pair, lines);
    expect(out.length).toBe(2);
    expect(out.map(r => r._glossgeniusTransactionId).sort()).toEqual(['tx_pay', 'tx_refund']);
    expect(out.map(r => r.transactionType).sort()).toEqual(['refund', 'sale']);
  });
});
