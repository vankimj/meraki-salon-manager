// Web entry for the Message Templates editor. Re-exports the EXACT same pure
// renderer + defaults the Cloud Functions use (functions/lib), so the editor's
// live preview is byte-for-byte what the server will send. No second copy of
// the copy = no drift.
//
// functions/lib/* are CommonJS (module.exports). Vite's dev server only applies
// CJS->ESM interop to deps in node_modules, not to CJS files in the source tree,
// so these are force-pre-bundled via optimizeDeps.include in vite.config.js —
// without that, importing them here white-screened /manage in dev.
export {
  DEFAULT_TEMPLATES, TEMPLATE_GROUPS, renderMessage, resolvePhrases,
} from '../../functions/lib/messageTemplates.js';
export { segmentInfo, interpolate } from '../../functions/lib/emailShell.js';

// Realistic sample values per variable so previews look like a real message.
export const SAMPLE_VARS = {
  clientName: 'Jordan', recipientName: 'Jordan', name: 'Jordan Lee',
  salonName: 'Meraki Nail Studio', salonShort: 'Meraki',
  date: 'Tuesday, June 16', time: '2:00 PM',
  dateShort: 'Tue Jun 16', timeShort: '2:00 PM', when: 'Tue Jun 16 2:00 PM',
  service: 'Gel Manicure', tech: 'Sammy', rating: 5,
  location: 'Meraki Nail Studio, 123 Main St, Columbus OH',
  manageLink: 'https://merakinailstudio.plumenexus.com/m/abc123',
  reviewLink: 'https://merakinailstudio.plumenexus.com/rev/abc',
  bookingLink: '<a href="https://merakinailstudio.plumenexus.com/book" style="color:#2D7A5F;">our online booking page</a>',
  rebookUrl: 'https://merakinailstudio.plumenexus.com/book',
  paymentLink: 'https://buy.stripe.com/test', priceLine: '$45/month', planName: 'VIP',
  amount: '50.00', total: '64.00', email: 'jordan@example.com',
  intro: "We're sorry — your appointment below has been cancelled. We'd love to find you a new time whenever you're ready.",
  apology: "we're sorry — ", helpLine: 'Need help? Reply to this email or call the salon.',
  questionsLine: 'Questions? Just reply to this email.',
  bookingKind: 'New online booking', subtitleLine: 'New Online Booking',
  introLine: 'A new appointment was booked online.',
  title: 'Refund issued', detail: 'A $25.00 card refund was issued to Jordan Lee by you.',
  viewLink: 'https://merakinailstudio.plumenexus.com/r/abc',
  techSuffix: ' with Sammy', manageSuffix: ' Manage: https://mrk.co/abc',
  confirmSuffix: ' Confirm/reschedule: https://mrk.co/abc',
  rebookSuffix: ' Rebook anytime: https://merakinailstudio.plumenexus.com/book',
};

// Trusted HTML blocks used in previews so structured emails (receipt, booking)
// look complete in the editor. Keyed by var name.
export const SAMPLE_BLOCKS = {
  detailsCard: '<div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;font-size:13px;color:#555;">📅 Tuesday, June 16 at 2:00 PM<br>💅 Gel Manicure<br>👩‍💼 With Sammy</div>',
  policies: '<p style="font-size:11px;line-height:1.6;color:#999;margin:18px 0 0;"><strong style="color:#888;">Cancellation policy:</strong> Please give 24 hours notice.</p>',
  receiptTable: '<table style="width:100%;border-collapse:collapse;margin-bottom:12px;font-size:13px;color:#333;"><tr><td style="padding:6px 0;">Gel Manicure</td><td style="text-align:right;">$45.00</td></tr><tr style="border-top:1px solid #e8e8e8;"><td style="padding:10px 0 0;font-weight:700;">Total</td><td style="text-align:right;padding:10px 0 0;font-weight:700;color:#2D7A5F;">$64.00</td></tr></table>',
  ratingBlock: '<div style="text-align:center;margin-top:8px;color:#aaa;font-size:12px;">★ ★ ★ ★ ★ &nbsp;Rate your visit</div>',
  codeBlock: '<div style="background:#f0faf6;border:2px dashed #7c3aed;border-radius:12px;padding:20px;text-align:center;margin:18px 0;"><div style="font-size:11px;color:#7c3aed;font-weight:700;text-transform:uppercase;">Your gift card code</div><div style="font-size:26px;font-weight:800;letter-spacing:.16em;font-family:monospace;">MRK-7H3K-9Q2</div><div style="color:#7c3aed;font-weight:600;margin-top:10px;">$50.00 balance</div></div>',
  messageCard: '<div style="background:#f8f9fa;border-radius:8px;padding:14px 16px;border:1px solid #e8e8e8;margin:12px 0;"><div style="font-size:13px;color:#555;font-style:italic;">"Hi! Can I move my appointment to 3pm?"</div></div>',
  reviewCard: '<div style="background:#fffbeb;border-radius:8px;padding:14px 16px;border:1px solid #fde68a;margin:12px 0;"><div style="font-size:20px;color:#f59e0b;letter-spacing:2px;">★★★★★</div><div style="font-size:13px;color:#555;">Serviced by <strong>Sammy</strong></div></div>',
};

export const PREVIEW_BRAND = { salonName: 'Meraki Nail Studio', footerLine: 'Meraki Nail Studio · 123 Main St, Columbus OH' };

// Build the full var bag (sample values + sample blocks) a template needs.
export function sampleVarsFor(def) {
  const out = {};
  for (const v of def.vars || []) out[v] = (v in SAMPLE_VARS) ? SAMPLE_VARS[v] : `{${v}}`;
  for (const v of def.htmlVars || []) out[v] = SAMPLE_BLOCKS[v] || `[${v}]`;
  // subtitle vars (not in the editable vars list) used by some shells:
  for (const v of ['subtitleLine', 'salonName']) if (v in SAMPLE_VARS && !(v in out)) out[v] = SAMPLE_VARS[v];
  return out;
}
