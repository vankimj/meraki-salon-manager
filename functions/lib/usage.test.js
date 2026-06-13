import { describe, it, expect, vi } from 'vitest';
import {
  PRICING,
  dayKeyUTC, monthKeyUTC,
  estimateSmsSegments, maskPhone, maskEmail,
  logSmsUsage, logEmailUsage, logAiUsage,
} from './usage.js';

describe('estimateSmsSegments', () => {
  it('returns 0 for empty body', () => {
    expect(estimateSmsSegments('')).toBe(0);
    expect(estimateSmsSegments(null)).toBe(0);
  });
  it('counts ASCII single-segment', () => {
    expect(estimateSmsSegments('hello')).toBe(1);
    expect(estimateSmsSegments('a'.repeat(160))).toBe(1);
  });
  it('counts ASCII multi-segment at 153 chars/seg', () => {
    expect(estimateSmsSegments('a'.repeat(161))).toBe(Math.ceil(161 / 153));
    expect(estimateSmsSegments('a'.repeat(306))).toBe(2);
    expect(estimateSmsSegments('a'.repeat(307))).toBe(3);
  });
  it('switches to UCS-2 sizing when non-GSM chars are present', () => {
    expect(estimateSmsSegments('hello 🌸')).toBe(1);
    expect(estimateSmsSegments('a'.repeat(71) + '🌸')).toBeGreaterThan(1);
  });
});

describe('maskPhone', () => {
  it('masks E.164 to last 4', () => {
    expect(maskPhone('+16145551234')).toBe('****1234');
  });
  it('masks formatted to last 4', () => {
    expect(maskPhone('(614) 555-1234')).toBe('****1234');
  });
  it('returns sentinel for missing/short', () => {
    expect(maskPhone('')).toBe('****');
    expect(maskPhone(null)).toBe('****');
    expect(maskPhone('12')).toBe('****');
  });
});

describe('maskEmail', () => {
  it('keeps first 2 chars of local + domain', () => {
    expect(maskEmail('jvankim@gmail.com')).toBe('jv***@gmail.com');
  });
  it('keeps 1 char for 1-char locals', () => {
    expect(maskEmail('a@x.io')).toBe('a***@x.io');
  });
  it('handles missing @ defensively', () => {
    expect(maskEmail('not-an-email')).toBe('****');
    expect(maskEmail('')).toBe('****');
  });
});

describe('dayKeyUTC / monthKeyUTC', () => {
  it('formats YYYY-MM-DD and YYYY-MM', () => {
    const d = new Date('2026-05-31T23:45:00Z');
    expect(dayKeyUTC(d)).toBe('2026-05-31');
    expect(monthKeyUTC(d)).toBe('2026-05');
  });
});

// Minimal Firestore-doc-collection stub. Lets us assert that the logger
// writes the expected shape without spinning up the admin SDK.
function fakeDb() {
  const adds = [];
  return {
    adds,
    collection(path) {
      return {
        add(obj) { adds.push({ path, doc: obj }); return Promise.resolve({ id: 'fake' }); },
      };
    },
  };
}

describe('logSmsUsage', () => {
  it('writes a usageSms doc with cost = segments * pricing', async () => {
    const db = fakeDb();
    await logSmsUsage(db, 'tenant-x', {
      kind:     'reminder',
      to:       '+16145551234',
      body:     'hello',
      sid:      'SM123',
      segments: 2,
    });
    expect(db.adds).toHaveLength(1);
    const { path, doc } = db.adds[0];
    expect(path).toBe('tenants/tenant-x/usageSms');
    expect(doc.kind).toBe('reminder');
    expect(doc.to).toBe('****1234');
    expect(doc.segments).toBe(2);
    expect(doc.costUsd).toBeCloseTo(2 * PRICING.smsPerSegment, 8);
    expect(doc.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.monthKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it('estimates segments from body when not provided', async () => {
    const db = fakeDb();
    await logSmsUsage(db, 'tenant-x', {
      kind: 'reminder',
      to:   '+16145551234',
      body: 'a'.repeat(200),
    });
    expect(db.adds[0].doc.segments).toBe(2);
  });

  it('prices AWS sends at the AWS per-segment rate and tags provider', async () => {
    const db = fakeDb();
    await logSmsUsage(db, 'tenant-x', {
      kind: 'reminder', to: '+16145551234', body: 'hello', sid: 'mid-1', segments: 3, provider: 'aws',
    });
    const { doc } = db.adds[0];
    expect(doc.provider).toBe('aws');
    expect(doc.costUsd).toBeCloseTo(3 * PRICING.awsSmsPerSegment, 8);
  });

  it('defaults provider to twilio at the twilio rate', async () => {
    const db = fakeDb();
    await logSmsUsage(db, 'tenant-x', { kind: 'reminder', to: '+1', body: 'hi', segments: 1 });
    expect(db.adds[0].doc.provider).toBe('twilio');
    expect(db.adds[0].doc.costUsd).toBeCloseTo(1 * PRICING.smsPerSegment, 8);
  });

  it('does not throw if db.add fails', async () => {
    const db = { collection: () => ({ add: () => Promise.reject(new Error('boom')) }) };
    await expect(
      logSmsUsage(db, 'tenant-x', { kind: 'x', to: '+1', body: 'x', segments: 1 })
    ).resolves.toBeUndefined();
  });

  it('no-ops without tenantId', async () => {
    const db = fakeDb();
    await logSmsUsage(db, '', { kind: 'x', to: '+1', body: 'x' });
    await logSmsUsage(db, null, { kind: 'x', to: '+1', body: 'x' });
    expect(db.adds).toHaveLength(0);
  });
});

describe('logEmailUsage', () => {
  it('writes a usageEmail doc with the flat per-send cost', async () => {
    const db = fakeDb();
    await logEmailUsage(db, 't', { kind: 'receipt', to: 'a@b.com', messageId: 'M1' });
    const { path, doc } = db.adds[0];
    expect(path).toBe('tenants/t/usageEmail');
    expect(doc.kind).toBe('receipt');
    expect(doc.to).toBe('a***@b.com');
    expect(doc.costUsd).toBeCloseTo(PRICING.emailPerSend, 8);
    expect(doc.messageId).toBe('M1');
  });
});

describe('logAiUsage', () => {
  it('computes cost from input + output token counts', async () => {
    const db = fakeDb();
    await logAiUsage(db, 't', {
      endpoint: 'chatWithReports',
      model:    'claude-haiku-4-5-20251001',
      usage:    { input_tokens: 1000, output_tokens: 500 },
    });
    const { path, doc } = db.adds[0];
    expect(path).toBe('tenants/t/usageAi');
    expect(doc.endpoint).toBe('chatWithReports');
    expect(doc.inputTokens).toBe(1000);
    expect(doc.outputTokens).toBe(500);
    const expected = 1000 * PRICING.aiInputPerToken + 500 * PRICING.aiOutputPerToken;
    expect(doc.costUsd).toBeCloseTo(expected, 8);
  });

  it('rolls cache_creation + cache_read into input tokens', async () => {
    const db = fakeDb();
    await logAiUsage(db, 't', {
      endpoint: 'chatWithSalon',
      usage:    {
        input_tokens: 100,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens:     300,
        output_tokens: 50,
      },
    });
    expect(db.adds[0].doc.inputTokens).toBe(600);
  });

  it('handles missing usage object without throwing', async () => {
    const db = fakeDb();
    await logAiUsage(db, 't', { endpoint: 'x' });
    expect(db.adds[0].doc.inputTokens).toBe(0);
    expect(db.adds[0].doc.outputTokens).toBe(0);
    expect(db.adds[0].doc.costUsd).toBe(0);
  });
});
