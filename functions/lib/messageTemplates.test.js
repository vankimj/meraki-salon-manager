import { describe, it, expect } from 'vitest';
import {
  esc, interpolate, renderEmailBody, emailShell, segmentInfo,
} from './emailShell.js';
import {
  renderMessage, resolvePhrases, DEFAULT_TEMPLATES, TEMPLATE_KEYS,
} from './messageTemplates.js';

const BRAND = { salonName: 'Meraki Nail Studio', footerLine: 'Meraki Nail Studio · 123 Main St' };

describe('interpolate', () => {
  it('HTML-escapes ordinary vars', () => {
    expect(interpolate('Hi {name}', { name: '<b>x</b>' }, { escapeFn: esc }))
      .toBe('Hi &lt;b&gt;x&lt;/b&gt;');
  });
  it('inserts htmlVars raw', () => {
    expect(interpolate('{block}', { block: '<div>ok</div>' }, { escapeFn: esc, htmlVars: ['block'] }))
      .toBe('<div>ok</div>');
  });
  it('leaves unknown placeholders literal', () => {
    expect(interpolate('Hi {who}', {}, { escapeFn: esc })).toBe('Hi {who}');
  });
  it('does not escape when escapeFn is identity (SMS)', () => {
    expect(interpolate("it's {x}", { x: 'a&b' }, { escapeFn: (v) => String(v) })).toBe("it's a&b");
  });
});

describe('renderEmailBody light markup', () => {
  it('renders headings, prose, notes, bold and blocks', () => {
    const out = renderEmailBody(
      '# Hi {name}!\n\nBody **bold** here.\n\n{card}\n\n> footnote',
      { name: 'Sam', card: '<div id="c">CARD</div>' },
      ['card'],
    );
    expect(out).toContain('font-weight:600');           // heading style
    expect(out).toContain('Hi Sam!');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<div id="c">CARD</div>');    // raw trusted block
    expect(out).toContain('footnote');
  });
  it('renders a CTA button only for safe urls', () => {
    const ok = renderEmailBody('[[Go|{u}]]', { u: 'https://x.test/a' }, []);
    expect(ok).toContain('href="https://x.test/a"');
    expect(ok).toContain('>Go</a>');
    const bad = renderEmailBody('[[Go|{u}]]', { u: 'javascript:alert(1)' }, []);
    expect(bad).not.toContain('<a');
    const empty = renderEmailBody('[[Go|{u}]]', { u: '' }, []);
    expect(empty).not.toContain('<a');
  });
});

describe('emailShell', () => {
  it('puts brand + subtitle + footer in the chrome', () => {
    const html = emailShell(BRAND, { subtitle: 'Receipt', bodyHtml: '<p>x</p>' });
    expect(html).toContain('Meraki Nail Studio');
    expect(html).toContain('Receipt');
    expect(html).toContain('Meraki Nail Studio · 123 Main St');
    expect(html).toMatch(/^<!DOCTYPE html>/);
  });
});

describe('segmentInfo', () => {
  it('counts GSM-7 single segment', () => {
    const r = segmentInfo('Hello there');
    expect(r.encoding).toBe('GSM-7');
    expect(r.segments).toBe(1);
  });
  it('switches to UCS-2 on emoji and shortens segments', () => {
    const r = segmentInfo('Happy Birthday 🎂');
    expect(r.encoding).toBe('UCS-2');
    expect(r.segments).toBe(1);
  });
  it('multi-segments long GSM-7', () => {
    const r = segmentInfo('a'.repeat(200));
    expect(r.segments).toBe(2);
  });
});

describe('renderMessage — every template renders', () => {
  it('renders all keys without throwing', () => {
    for (const key of TEMPLATE_KEYS) {
      const def = DEFAULT_TEMPLATES[key];
      const vars = {};
      for (const v of [...(def.vars || []), ...(def.htmlVars || [])]) vars[v] = `[${v}]`;
      const out = renderMessage(key, vars, BRAND);
      if (def.channel === 'email') {
        expect(out.subject.length).toBeGreaterThan(0);
        expect(out.html).toContain('<!DOCTYPE html>');
      } else {
        expect(typeof out.body).toBe('string');
      }
    }
  });
});

describe('default-parity — wording is preserved', () => {
  it('booking confirmation keeps its copy + manage button + injected card', () => {
    const out = renderMessage('booking_confirmation_email', {
      clientName: 'Sam', salonName: 'Meraki Nail Studio',
      date: 'Tuesday, June 11', time: '2:00 PM',
      manageLink: 'https://merakinailstudio.plumenexus.com/m/abc',
      detailsCard: '<div id="dc">DETAILS</div>', policies: '',
    }, BRAND);
    expect(out.subject).toBe('Booking confirmed — Tuesday, June 11 at 2:00 PM');
    expect(out.html).toContain("Your appointment has been booked. We can't wait to see you!");
    expect(out.html).toContain('<div id="dc">DETAILS</div>');
    expect(out.html).toContain('Reschedule or cancel');
    expect(out.html).toContain('Booking Confirmation');
  });

  it('rating request keeps its copy and review CTA', () => {
    const out = renderMessage('rating_request_email', {
      clientName: 'Sam', salonName: 'Meraki Nail Studio',
      reviewLink: 'https://review.test/x',
    }, BRAND);
    expect(out.subject).toBe("How was your visit? We'd love your feedback 💅");
    expect(out.html).toContain('leaving us a Google review would mean the world to us');
    expect(out.html).toContain('⭐ Leave a Google Review');
  });

  it('booking SMS matches the legacy string exactly', () => {
    const out = renderMessage('booking_confirmation_sms', {
      clientName: 'Sam', service: 'Gel Manicure', salonName: 'Meraki Nail Studio',
      dateShort: 'Tue Jun 11', timeShort: '2:00 PM',
      techSuffix: ' with Jen', manageSuffix: ' Manage: https://x.test/m',
    });
    expect(out.body).toBe(
      'Hi Sam! Your Gel Manicure at Meraki Nail Studio is booked for Tue Jun 11 at 2:00 PM with Jen. Manage: https://x.test/m',
    );
  });

  it('receipt SMS matches the legacy string exactly', () => {
    const out = renderMessage('receipt_sms', {
      salonName: 'Meraki Nail Studio', total: '50.00', tech: 'Jen', viewLink: 'https://x.test/r/t',
    });
    expect(out.body).toBe(
      "Meraki Nail Studio: Your receipt for today's $50.00 visit with Jen is ready — view & rate: https://x.test/r/t",
    );
  });

  it('reminder SMS (with manage link) matches the legacy string exactly', () => {
    const out = renderMessage('reminder_sms', {
      clientName: 'Sam', salonName: 'Meraki Nail Studio', timeShort: '2:00 PM',
      techSuffix: ' with Jen', confirmSuffix: ' Confirm/reschedule: https://x.test/m',
    });
    expect(out.body).toBe(
      'Meraki Nail Studio: Hi Sam! Your appt tomorrow at 2:00 PM with Jen. Confirm/reschedule: https://x.test/m',
    );
  });
});

describe('phrases (editable conditional wordings)', () => {
  it('returns defaults when there is no override', () => {
    const ph = resolvePhrases('reminder_email', null);
    expect(ph.helpLineWithReply).toBe('Need help? Reply to this email or call the salon.');
    expect(ph.helpLineNoReply).toBe('Need help? Give the salon a call.');
  });
  it('layers an override phrase over the default, keeping the others', () => {
    const ph = resolvePhrases('cancellation_notice_email', { phrases: { introStaff: 'So sorry, we had to cancel.' } });
    expect(ph.introStaff).toBe('So sorry, we had to cancel.');
    expect(ph.introSelfService).toBe('Your appointment below has been cancelled, as requested. We hope to see you again soon!');
  });
  it('ignores a blank override phrase (falls back to default)', () => {
    const ph = resolvePhrases('cancellation_sms', { phrases: { apologyStaff: '' } });
    expect(ph.apologyStaff).toBe("we're sorry — ");
  });
  it('every previewVar points at a real template var', () => {
    for (const key of TEMPLATE_KEYS) {
      const def = DEFAULT_TEMPLATES[key];
      for (const meta of Object.values(def.phrases || {})) {
        if (meta.previewVar) expect(def.vars).toContain(meta.previewVar);
      }
    }
  });
});

describe('override behavior', () => {
  it('an override replaces subject + body but keeps escaping/shell', () => {
    const out = renderMessage('rating_request_email',
      { clientName: 'Sam', salonName: 'Meraki Nail Studio', reviewLink: 'https://review.test/x' },
      BRAND,
      { subject: 'Rate us {clientName}!', body: '# Hey {clientName}\n\nPlease review:\n\n[[Review|{reviewLink}]]' });
    expect(out.subject).toBe('Rate us Sam!');
    expect(out.html).toContain('Hey Sam');
    expect(out.html).toContain('href="https://review.test/x"');
  });
  it('a blank override falls back to default', () => {
    const out = renderMessage('admin_alert', { salonName: 'Meraki', title: 'Refund', detail: 'A refund of $50 was issued.' }, BRAND, {});
    expect(out.subject).toBe('🔔 Admin Alert · Meraki: Refund');
    expect(out.html).toContain('A refund of $50 was issued.');
  });
  it('escapes a malicious var even inside an override body', () => {
    const out = renderMessage('admin_alert',
      { salonName: 'Meraki', title: 'x', detail: '<script>alert(1)</script>' },
      BRAND);
    expect(out.html).not.toContain('<script>alert(1)</script>');
    expect(out.html).toContain('&lt;script&gt;');
  });
});
