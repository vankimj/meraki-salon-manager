import { useState } from 'react';
import { C, FONT, FOUNDERS_YEAR_END_LONG, grad, shadow, radius } from '../theme.js';
import Section from './Section.jsx';
import ComparisonTable from './ComparisonTable.jsx';

// ── Base tiers ─────────────────────────────────────────────────────
// `price` = monthly. `annual` = effective monthly when billed yearly
// (14% off, matches GG's annual discount structure so prospects
// comparing the two pricing pages see the same shape).
const TIERS = [
  {
    name: 'Solo',
    price: 49, annual: 42,
    blurb: 'Perfect for the single-chair stylist.',
    foundersFree: true,
    features: [
      '1 staff member',
      'Scheduling + online booking',
      'POS, gift cards, promo codes',
      'Email + booking page',
      'AI-powered reports',
      'Full data export, every plan',
      'Email support · 5-business-day SLA',
    ],
    cta: 'Claim Founders\' Year',
  },
  {
    name: 'Studio',
    price: 79, annual: 68,
    featured: true,
    blurb: 'For growing salons with a full team. Includes the Comms Pack.',
    features: [
      'Up to 8 staff members',
      'Everything in Solo, plus:',
      'SMS reminders + 2-way (Comms Pack — included)',
      'Multi-tech credit splits',
      'Smart walk-in management',
      'Custom domain for booking',
      'Priority email + chat support',
    ],
    cta: 'Start free 30-day trial',
  },
  {
    name: 'Salon Pro',
    price: 149, annual: 128,
    blurb: 'Unlimited staff + 4 Power Packs bundled. Best value at scale.',
    features: [
      'Unlimited staff + multi-location',
      'Everything in Studio, plus:',
      'Gusto payroll integration (Operations Pack) — included',
      'Marketing Pack (loyalty + auto-rebook) — included',
      'AI Pack (voice + drafted copy) — included',
      'Founder-direct support',
      'Dedicated onboarding',
    ],
    cta: 'Talk to founder',
  },
];

// ── Power Packs (mix and match, on any tier) ───────────────────────
const PACKS = [
  {
    icon: '💬',
    name: 'Comms Pack',
    price: 19,
    body: 'Two-way SMS + dedicated phone number + email reply parsing + STOP keyword handling. The full client communication suite.',
  },
  {
    icon: '📣',
    name: 'Marketing Pack',
    price: 19,
    body: 'Loyalty + tiers + auto-rebook nudges + send-time optimizer + advanced audience segments. Replace your separate marketing tool.',
  },
  {
    icon: '✨',
    name: 'AI Pack',
    price: 19,
    body: 'Voice-command booking + AI-drafted marketing copy + conflict-resolution drafts when a tech calls in sick. Three hours of busywork back per week.',
  },
  {
    icon: '💼',
    name: 'Operations Pack',
    price: 29,
    body: 'One-click Gusto payroll integration, advanced earnings reports, and multi-location. Bring your existing Gusto account or set one up in onboarding. Gusto handles W-2 + 1099-NEC filing end-to-end. Included on Salon Pro.',
  },
  {
    icon: '🎨',
    name: 'Brand Pack',
    price: 39,
    body: 'White-label client app + custom-branded TipFlow kiosk + custom email sender domain. Look like the premium brand you are.',
  },
];

// ── Atomic add-ons (escape hatch — for power users) ────────────────
const ATOMS = [
  { feature: 'SMS (dedicated number + two-way)', price: 15, partOf: 'Comms Pack' },
  { feature: 'Voice commands',                   price: 15, partOf: 'AI Pack' },
  { feature: 'Loyalty + tiers',                  price: 15, partOf: 'Marketing Pack' },
  { feature: 'Gusto payroll sync',               price: 25, partOf: 'Operations Pack' },
  { feature: 'Custom email sender domain',       price: 15, partOf: 'Brand Pack' },
];

export default function Pricing() {
  const [showAtoms, setShowAtoms] = useState(false);
  const [billing, setBilling]     = useState('annual');

  return (
    <Section
      id="pricing"
      eyebrow={`Founders' Year · sign up by ${FOUNDERS_YEAR_END_LONG}`}
      title="Free for Founders. Pick a plan, then add what you need."
      subtitle={`Sign up before ${FOUNDERS_YEAR_END_LONG} and Solo is free for life. Pair any plan with the Power Packs you actually want — no forced bundles, no add-on tax.`}
      alt
    >
      {/* ── Billing toggle (Monthly / Annual) ── */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-flex',
          gap: 0,
          padding: 4,
          background: '#fff',
          border: `1px solid ${C.rule}`,
          borderRadius: 999,
        }}>
          {['monthly', 'annual'].map(b => (
            <button key={b} type="button" onClick={() => setBilling(b)}
              style={{
                padding: '8px 18px', fontSize: 13, fontWeight: 600,
                background: billing === b ? grad.primary : 'transparent',
                color:      billing === b ? '#fff' : C.muted,
                border: 'none', borderRadius: 999, cursor: 'pointer',
                fontFamily: FONT.body,
              }}>
              {b === 'monthly' ? 'Monthly' : 'Annual'}
              {b === 'annual' && (
                <span style={{ fontSize: 10, marginLeft: 6, color: billing === 'annual' ? 'rgba(255,255,255,.85)' : C.success }}>
                  save 14%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Base tiers ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: 20,
        maxWidth: 1080, margin: '0 auto',
      }}>
        {TIERS.map(t => <Tier key={t.name} {...t} billing={billing} />)}
      </div>

      {/* ── Power Packs ── */}
      <div style={{ marginTop: 64, maxWidth: 1080, margin: '64px auto 0' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            display: 'inline-block', padding: '4px 12px', borderRadius: 999,
            background: 'rgba(106,79,160,.1)', color: C.plum,
            fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
            textTransform: 'uppercase', marginBottom: 12,
          }}>Power Packs · stack on any plan</div>
          <h3 style={{
            fontFamily: FONT.display, fontSize: 'clamp(22px, 2.4vw, 28px)',
            fontWeight: 600, color: C.ink, margin: '0 0 8px', letterSpacing: '-.005em',
          }}>Add only what your salon actually needs.</h3>
          <p style={{ fontSize: 15, color: C.muted, margin: 0, maxWidth: 620, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
            No 8-tier matrix. No "must upgrade to Studio for one feature." Pick your packs, or build from individual add-ons below.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 14,
        }}>
          {PACKS.map(p => <Pack key={p.name} {...p} />)}
        </div>

        {/* Atom toggle */}
        <div style={{ textAlign: 'center', marginTop: 28 }}>
          <button onClick={() => setShowAtoms(s => !s)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 600,
            background: 'transparent', color: C.plum,
            border: `1px solid ${C.plum}40`,
            borderRadius: 999, cursor: 'pointer', fontFamily: FONT.body,
          }}>
            {showAtoms ? '↑ Hide individual add-ons' : '↓ Want just one feature? Build from atoms'}
          </button>
        </div>

        {showAtoms && (
          <div style={{
            marginTop: 18,
            background: '#fff',
            border: `1px solid ${C.rule}`,
            borderRadius: radius.md,
            overflow: 'hidden',
          }}>
            <div style={{ padding: '12px 18px', background: C.bgSoft, borderBottom: `1px solid ${C.ruleSoft}`, fontSize: 12, color: C.muted }}>
              Build your own combo. Atoms are slightly cheaper than the pack they belong to — meaningful only if you want exactly one feature from a pack. For most salons, the pack is a better deal.
            </div>
            {ATOMS.map((a, i) => (
              <div key={a.feature} style={{
                display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 16,
                padding: '12px 18px',
                borderTop: i === 0 ? 'none' : `1px solid ${C.ruleSoft}`,
                alignItems: 'center', fontSize: 13,
              }}>
                <div>
                  <div style={{ color: C.ink, fontWeight: 600 }}>{a.feature}</div>
                  <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 2 }}>part of <strong>{a.partOf}</strong></div>
                </div>
                <div style={{ color: C.text, fontWeight: 600 }}>${a.price}/mo</div>
                <div style={{ fontSize: 10, color: C.mutedSoft }}>{/* spacer */}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Full feature comparison matrix ── */}
      <ComparisonTable />

      <div style={{
        marginTop: 36, textAlign: 'center',
        fontSize: 13, color: C.muted,
      }}>
        Need help deciding? <a href="#contact" style={{ color: C.plum, fontWeight: 600 }}>Talk to the founder.</a>
      </div>

      <div style={{
        marginTop: 18, padding: '14px 20px',
        maxWidth: 720, margin: '18px auto 0',
        background: 'rgba(45,122,95,.06)',
        border: '1px solid rgba(45,122,95,.18)',
        borderRadius: 12,
        textAlign: 'center',
        fontSize: 13, color: C.text, lineHeight: 1.55,
      }}>
        <strong style={{ color: C.success }}>Data export is free, on every plan, forever.</strong>{' '}
        <span style={{ color: C.muted }}>
          If our service ever stops working for you, walking out the door with everything intact is one click — never a paywall.
        </span>
      </div>
    </Section>
  );
}

// ── Components ─────────────────────────────────────────────────────
function Tier({ name, price, annual, blurb, features, cta, featured, foundersFree, billing = 'annual' }) {
  // `price` is monthly sticker; `annual` is effective monthly when billed
  // yearly. Display the active billing's number; show the other crossed
  // out as a value hint.
  const shown    = billing === 'annual' ? annual : price;
  const struck   = billing === 'annual' ? price  : annual;
  const suffix   = billing === 'annual' ? '/mo · billed annually' : '/mo';
  return (
    <div style={{
      position: 'relative',
      background: featured ? grad.primaryDeep : '#fff',
      color: featured ? '#fff' : C.text,
      border: foundersFree ? `2px solid ${C.success}` : (featured ? 'none' : `1px solid ${C.rule}`),
      borderRadius: radius.lg,
      padding: '32px 28px 28px',
      boxShadow: featured ? shadow.brand : shadow.sm,
      transform: featured ? 'translateY(-8px)' : 'none',
    }}>
      {featured && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 14px', borderRadius: 999,
          background: '#fff', color: C.plum,
          fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase',
          boxShadow: '0 4px 12px rgba(0,0,0,.15)',
          whiteSpace: 'nowrap',
        }}>Most popular</div>
      )}
      {foundersFree && (
        <div style={{
          position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
          padding: '5px 14px', borderRadius: 999,
          background: C.success, color: '#fff',
          fontSize: 11, fontWeight: 700, letterSpacing: '.06em',
          textTransform: 'uppercase',
          boxShadow: '0 4px 12px rgba(45,122,95,.32)',
          whiteSpace: 'nowrap',
        }}>Founders' Year — Free for life</div>
      )}

      <div style={{
        fontFamily: FONT.display, fontSize: 22, fontWeight: 600,
        color: featured ? '#fff' : C.ink,
        marginBottom: 6,
      }}>{name}</div>
      <div style={{ fontSize: 13, color: featured ? 'rgba(255,255,255,.7)' : C.muted, marginBottom: 22, minHeight: 38 }}>
        {blurb}
      </div>

      {foundersFree ? (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{
              fontFamily: FONT.display, fontSize: 48, fontWeight: 700,
              color: C.success, lineHeight: 1,
            }}>Free</span>
            <span style={{ fontSize: 13, color: C.mutedSoft, fontWeight: 500, textDecoration: 'line-through' }}>${price}/mo</span>
          </div>
          <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 6, lineHeight: 1.4 }}>
            For Founders' Members who join by {FOUNDERS_YEAR_END_LONG}. Lifetime lock-in.
          </div>
        </div>
      ) : (
        <div style={{ marginBottom: 26 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 18, color: featured ? 'rgba(255,255,255,.7)' : C.mutedSoft, fontWeight: 600 }}>$</span>
            <span style={{
              fontFamily: FONT.display, fontSize: 48, fontWeight: 700,
              color: featured ? '#fff' : C.ink,
              lineHeight: 1,
            }}>{shown}</span>
            <span style={{ fontSize: 14, color: featured ? 'rgba(255,255,255,.7)' : C.mutedSoft, fontWeight: 500 }}>{suffix}</span>
          </div>
          {billing === 'annual' && (
            <div style={{ fontSize: 11, color: featured ? 'rgba(255,255,255,.6)' : C.mutedSoft, marginTop: 4 }}>
              <span style={{ textDecoration: 'line-through' }}>${struck}/mo</span> billed monthly
            </div>
          )}
        </div>
      )}

      <a href="#contact" style={{
        display: 'block', textAlign: 'center',
        padding: '12px 18px', fontSize: 14, fontWeight: 600,
        background: featured ? '#fff' : grad.primary,
        color: featured ? C.plumDeep : '#fff',
        borderRadius: 999, textDecoration: 'none',
        marginBottom: 24,
        transition: 'transform .12s',
      }}
        onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
      >{cta}</a>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {features.map(f => (
          <li key={f} style={{
            padding: '8px 0',
            fontSize: 13.5, lineHeight: 1.5,
            color: featured ? 'rgba(255,255,255,.85)' : C.text,
            display: 'flex', alignItems: 'flex-start', gap: 9,
          }}>
            <span style={{ color: featured ? '#8b6fc4' : C.success, fontSize: 13, marginTop: 2 }}>✓</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pack({ icon, name, price, body }) {
  return (
    <div style={{
      padding: 22,
      background: '#fff',
      border: `1px solid ${C.rule}`,
      borderRadius: radius.md,
      transition: 'transform .15s, box-shadow .15s, border-color .15s',
    }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = shadow.md;
        e.currentTarget.style.borderColor = `${C.plum}40`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'none';
        e.currentTarget.style.borderColor = C.rule;
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div style={{ fontSize: 28 }}>{icon}</div>
        <div style={{
          padding: '4px 10px', borderRadius: 999,
          background: `${C.plum}10`, color: C.plumDeep,
          fontSize: 12, fontWeight: 700,
        }}>+${price}/mo</div>
      </div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{name}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55 }}>{body}</div>
    </div>
  );
}
