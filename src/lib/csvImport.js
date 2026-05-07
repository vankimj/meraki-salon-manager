// GlossGenius CSV importer.
// Pure parsing/mapping in this file — caller (CsvImportSection) handles
// Firestore writes + progress UI.

// ── CSV parser ─────────────────────────────────────────
// Handles quoted fields with commas/newlines inside, doubled quotes ("").
// Returns an array of objects keyed by the header row.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (c === '"') { inQuotes = false; i++; continue; }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  if (rows.length === 0) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim());
  const records = rows.slice(1)
    .filter(r => r.some(v => (v || '').trim() !== ''))
    .map(r => {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = (r[j] || '').trim(); });
      return obj;
    });
  return { headers, records };
}

// ── Column lookup helpers ──────────────────────────────
// Find the first matching column for a list of candidate names (case-insensitive).
function getCol(record, candidates) {
  const keys = Object.keys(record);
  for (const cand of candidates) {
    const k = keys.find(x => x.toLowerCase() === cand.toLowerCase());
    if (k && record[k]) return record[k];
  }
  return '';
}

function pickFullName(record) {
  // Most-common GG layouts: "Client Name" single field; or "First Name" + "Last Name".
  const single = getCol(record, ['Client Name', 'Customer Name', 'Name', 'Full Name']);
  if (single) return single;
  const f = getCol(record, ['First Name', 'Firstname', 'First']);
  const l = getCol(record, ['Last Name', 'Lastname', 'Last', 'Surname']);
  return [f, l].filter(Boolean).join(' ').trim();
}

// Normalize "5/2/2026" or "2026-05-02" → "2026-05-02"
function normalizeDate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  // M/D/YYYY or MM/DD/YYYY
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [_, mm, dd, yy] = m;
    if (yy.length === 2) yy = '20' + yy;
    return `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  // Try Date parse fallback
  const d = new Date(raw);
  if (!isNaN(d)) {
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return '';
}

// GG combined timestamp like "11-13-24, 7:57 PM" → { date, time, iso }.
// Falls back to plain date parsing.
export function parseGgDateTime(raw) {
  if (!raw) return { date: '', time: '', iso: '' };
  const m = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4}),?\s*(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?/);
  if (m) {
    let [, mm, dd, yy, h, min, ap] = m;
    if (yy.length === 2) yy = '20' + yy;
    const date = `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    let hh = parseInt(h, 10);
    if (ap && ap.toUpperCase() === 'PM' && hh !== 12) hh += 12;
    if (ap && ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
    const time = `${String(hh).padStart(2, '0')}:${min}`;
    const iso = `${date}T${time}:00.000Z`;
    return { date, time, iso };
  }
  const date = normalizeDate(raw);
  return { date, time: '', iso: date ? `${date}T12:00:00.000Z` : '' };
}

// "10:30 AM" or "13:45" → "13:45"
function normalizeTime(raw) {
  if (!raw) return '';
  const ampmMatch = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/);
  if (ampmMatch) {
    let [_, h, m, ap] = ampmMatch;
    let hh = parseInt(h, 10);
    if (ap.toUpperCase() === 'PM' && hh !== 12) hh += 12;
    if (ap.toUpperCase() === 'AM' && hh === 12) hh = 0;
    return `${String(hh).padStart(2, '0')}:${m}`;
  }
  const isoMatch = raw.match(/^(\d{1,2}):(\d{2})/);
  if (isoMatch) return `${isoMatch[1].padStart(2, '0')}:${isoMatch[2]}`;
  return '';
}

function normalizeMoney(raw) {
  if (!raw) return 0;
  const n = parseFloat(String(raw).replace(/[$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

function normalizeStatus(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (s.includes('complete') || s.includes('done') || s.includes('paid'))    return 'done';
  if (s.includes('cancel'))                                                  return 'cancelled';
  if (s.includes('no show') || s.includes('no-show'))                        return 'no_show';
  return 'scheduled';
}

function normalizeMethod(raw) {
  const s = (raw || '').toLowerCase();
  if (!s) return 'other';
  if (s.includes('card') || s.includes('credit') || s.includes('visa') || s.includes('mastercard') || s.includes('amex')) return 'card';
  if (s.includes('cash')) return 'cash';
  if (s.includes('venmo')) return 'venmo';
  if (s.includes('zelle')) return 'zelle';
  return 'other';
}

// ── Type detection ─────────────────────────────────────
export function detectType(headers) {
  const lower = headers.map(h => h.toLowerCase());
  const has = (...cands) => cands.some(c => lower.includes(c.toLowerCase()));

  // GG-specific: Payment Details file (one row per transaction)
  if (has('charge id') && has('amount') && has('payment method') && has('payment processing fee')) {
    return 'ggPayments';
  }
  // GG-specific: Checkout Line Items file (multiple rows per transaction)
  if (has('charge id') && has('descriptor') && has('item type')) {
    return 'ggLineItems';
  }
  // Sales / receipts (generic single-file)
  if (has('total', 'tip', 'payment method', 'transaction date')) return 'sales';
  // Appointments: presence of date + service + provider/staff
  if (has('appointment date', 'service date', 'service') &&
      has('provider', 'staff', 'stylist', 'service provider')) return 'appointments';
  if ((has('date') || has('appointment date')) && has('service')) return 'appointments';
  // Clients: presence of email/phone but no date/service
  if ((has('email') || has('phone') || has('mobile')) && !has('date', 'service')) return 'clients';
  return 'unknown';
}

// ── GG two-file joiner ─────────────────────────────────
// Joins a Payment Details record with all Checkout Line Items sharing the
// same Charge ID, building one Meraki receipt doc per transaction.
//
// Line item types observed in GG exports:
//   - Service     → goes into receipt.services[]
//   - Other       → treated as retail product (receipt.retailProducts[])
//   - Gratuity    → payment.tip
//   - Sales Tax   → payment.tax
//   - Discount    → payment.discountAmount (price comes through negative)
export function buildReceiptsFromGg(payments, lineItems, clientLookup) {
  // Index line items by charge id
  const linesByCharge = {};
  lineItems.forEach(li => {
    const cid = getCol(li, ['Charge ID']);
    if (!cid) return;
    if (!linesByCharge[cid]) linesByCharge[cid] = [];
    linesByCharge[cid].push(li);
  });

  const receipts = [];
  payments.forEach(p => {
    const chargeId = getCol(p, ['Charge ID']);
    if (!chargeId) return;
    const lines = linesByCharge[chargeId] || [];
    const r = mapJoinedReceipt(p, lines, clientLookup);
    if (r) receipts.push(r);
  });
  return receipts;
}

// Normalize a name for case/whitespace-insensitive lookup.
export function clientKey(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Normalize GG's "Transaction Type" column. Values seen in the wild:
//   Sale / Charge / Payment        → 'sale' (real revenue)
//   Cancellation / Cancelled       → 'cancellation'
//   Refund / Partial Refund        → 'refund'
//   Void / Voided                  → 'void'
// Cancellation/refund/void records still create a receipt (so the
// transaction history is preserved) but they're flagged so reports can
// exclude them from revenue and surface them on the cancellation card.
function normalizeTxType(raw) {
  const s = (raw || '').toLowerCase().trim();
  if (!s) return 'sale';
  if (s.includes('cancel'))      return 'cancellation';
  if (s.includes('refund'))      return 'refund';
  if (s.includes('void'))        return 'void';
  return 'sale';
}

function mapJoinedReceipt(payment, lines, clientLookup) {
  const txDateRaw = getCol(payment, ['Transaction Date', 'Date']);
  const { date, iso } = parseGgDateTime(txDateRaw);
  if (!date) return null;

  const total      = normalizeMoney(getCol(payment, ['Amount', 'Total']));
  const ccFee      = normalizeMoney(getCol(payment, ['Payment Processing Fee', 'Processor Fee']));
  const methodRaw  = getCol(payment, ['Payment Method']);
  const method     = normalizeMethod(methodRaw);
  const txId       = getCol(payment, ['Payment Transaction ID', 'Transaction ID']);
  const chargeId   = getCol(payment, ['Charge ID']);
  const source     = getCol(payment, ['Payment Source']); // "Retail Purchase" | "Appointment"
  const txTypeRaw  = getCol(payment, ['Transaction Type', 'Type']);
  const txType     = normalizeTxType(txTypeRaw);

  // Pull client + tech from the first line item that has them.
  const firstWithClient = lines.find(l => getCol(l, ['Client']));
  const firstWithProv   = lines.find(l => getCol(l, ['Provider']));
  const clientName = firstWithClient ? getCol(firstWithClient, ['Client']) : '';
  const techName   = firstWithProv   ? getCol(firstWithProv,   ['Provider']) : '';

  const services = [];
  const retailProducts = [];
  let tip = 0, tax = 0, discountAmount = 0;

  lines.forEach(l => {
    const itemType = (getCol(l, ['Item Type']) || '').toLowerCase();
    const desc     = getCol(l, ['Descriptor']);
    const price    = normalizeMoney(getCol(l, ['Price']));
    const provider = getCol(l, ['Provider']);
    if (itemType === 'service') {
      services.push({ name: desc, price, techName: provider || techName });
    } else if (itemType === 'other') {
      retailProducts.push({ name: desc, price, qty: 1 });
    } else if (itemType === 'gratuity') {
      tip += price;
    } else if (itemType === 'sales tax') {
      tax += price;
    } else if (itemType === 'discount') {
      // Price is typically negative in GG exports
      discountAmount += Math.abs(price);
    }
  });

  const subtotal = services.reduce((s, sv) => s + sv.price, 0)
                 + retailProducts.reduce((s, p) => s + p.price * p.qty, 0);

  const clientId = clientLookup && clientName ? (clientLookup[clientKey(clientName)] || null) : null;

  return {
    clientId,
    clientName: clientName || (source === 'Retail Purchase' ? 'Walk-in retail' : 'Walk-in'),
    clientEmail: null,
    techName: techName || '',
    date,
    startTime: '',
    services,
    retailProducts: retailProducts.length > 0 ? retailProducts : null,
    giftCardsSold: null,
    apptIds: [],
    createdAt: iso,
    payment: {
      subtotal,
      tax, taxRate: 0,
      discountAmount, promoAmount: 0,
      tip,
      charged: total - tip,
      total,
      method,
      ccFee, ccFeePct: 0, ccFeeFlat: 0,
      techSplit: null,
      gcSalesTotal: 0,
      paidAt: iso,
    },
    transactionType: txType,
    _importedFrom: 'glossgenius',
    _glossgeniusChargeId: chargeId,
    _glossgeniusTransactionId: txId,
    _glossgeniusSource: source || null,
    _glossgeniusTransactionTypeRaw: txTypeRaw || null,
  };
}

// ── Mappers ────────────────────────────────────────────
// Each returns the Firestore document shape for a single row.
// `null` = skip this row (missing critical field).

export function mapClientRow(record) {
  const name = pickFullName(record);
  if (!name) return null;
  const email = getCol(record, ['Email', 'Email Address']);
  const phone = getCol(record, ['Phone', 'Mobile', 'Phone Number', 'Mobile Phone']);
  const birthday = normalizeDate(getCol(record, ['Birthday', 'Birth Date', 'DOB', 'Date of Birth']));
  const address = getCol(record, ['Address', 'Street', 'Street Address']);
  const notes = getCol(record, ['Notes', 'Internal Notes', 'Client Notes']);
  return {
    name,
    email: email || '',
    phone: phone || '',
    birthday: birthday || '',
    address: address || '',
    notes: notes || '',
    picture: '',
    instagram: '', facebook: '', tiktok: '', venmo: '',
    instagramTags: [],
    googleReviews: [],
    visits: [],
    _importedFrom: 'glossgenius',
    _importedAt: new Date().toISOString(),
  };
}

export function mapAppointmentRow(record, clientLookup) {
  const date = normalizeDate(getCol(record, ['Appointment Date', 'Service Date', 'Date']));
  const startTime = normalizeTime(getCol(record, ['Start Time', 'Time', 'Appointment Time']));
  const clientName = pickFullName(record);
  const techName = getCol(record, ['Provider', 'Staff', 'Stylist', 'Service Provider', 'Tech', 'Technician']);
  const serviceName = getCol(record, ['Service', 'Service Name', 'Services']);
  const price = normalizeMoney(getCol(record, ['Price', 'Service Price', 'Amount', 'Service Total']));
  const duration = parseInt(getCol(record, ['Duration', 'Duration (mins)', 'Length']), 10) || 60;
  const status = normalizeStatus(getCol(record, ['Status', 'Appointment Status']));
  const notes = getCol(record, ['Notes', 'Appointment Notes', 'Client Notes']);
  if (!date || !clientName || !serviceName) return null;
  const clientId = clientLookup ? (clientLookup[clientKey(clientName)] || null) : null;
  return {
    date,
    startTime: startTime || '12:00',
    duration,
    techName: techName || 'TBD',
    techId: null,
    clientId,
    clientName,
    services: [{ id: null, name: serviceName, price, duration }],
    status,
    notes: notes || '',
    techRequestType: 'scheduler',
    source: 'imported',
    _importedFrom: 'glossgenius',
    _importedAt: new Date().toISOString(),
  };
}

export function mapSaleRow(record) {
  const date = normalizeDate(getCol(record, ['Transaction Date', 'Date', 'Sale Date']));
  const clientName = pickFullName(record) || 'Walk-in';
  const techName = getCol(record, ['Provider', 'Staff', 'Stylist']);
  const total = normalizeMoney(getCol(record, ['Total', 'Total Amount', 'Amount']));
  const tip = normalizeMoney(getCol(record, ['Tip', 'Tip Amount', 'Gratuity']));
  const tax = normalizeMoney(getCol(record, ['Tax', 'Sales Tax']));
  const method = normalizeMethod(getCol(record, ['Payment Method', 'Payment Type', 'Payment']));
  const serviceName = getCol(record, ['Service', 'Item', 'Description']);
  if (!date || total === 0) return null;
  const subtotal = Math.max(total - tax - tip, 0);
  return {
    clientId: null,
    clientName,
    clientEmail: null,
    techName: techName || '',
    date,
    startTime: '',
    services: serviceName ? [{ name: serviceName, price: subtotal, techName: techName || '' }] : [],
    retailProducts: null,
    giftCardsSold: null,
    apptIds: [],
    createdAt: `${date}T12:00:00.000Z`,
    payment: {
      subtotal, tax, taxRate: 0,
      discountAmount: 0, promoAmount: 0,
      tip, charged: total - tip, total,
      method, ccFee: 0, ccFeePct: 0, ccFeeFlat: 0,
      techSplit: null, gcSalesTotal: 0,
      paidAt: `${date}T12:00:00.000Z`,
    },
    _importedFrom: 'glossgenius',
    _importedAt: new Date().toISOString(),
  };
}
