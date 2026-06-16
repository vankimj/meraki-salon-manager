import { C, FONT, radius, shadow } from '../theme.js';

// Full feature × plan matrix. Mirrors the app's entitlement engine
// (src/lib/modules.js + src/lib/planEntitlements.js) so what we advertise is
// exactly what the app enforces. Cell values:
//   true   → included (✓)
//   false  → not included (—)
//   'pack' → available as a Power Pack add-on on this tier
//   string → a literal value (staff counts, support SLA)
const PLANS = [
  { id: 'solo',     name: 'Solo',      note: '$49/mo' },
  { id: 'studio',   name: 'Studio',    note: '$79/mo', featured: true },
  { id: 'salonPro', name: 'Salon Pro', note: '$149/mo' },
];

const GROUPS = [
  {
    title: 'Run the day',
    rows: [
      { label: 'Scheduling + online booking',     solo: true, studio: true, salonPro: true },
      { label: 'Client CRM + visit history',       solo: true, studio: true, salonPro: true },
      { label: 'Services menu & pricing',          solo: true, studio: true, salonPro: true },
      { label: 'POS & checkout (Stripe)',          solo: true, studio: true, salonPro: true },
      { label: 'Gift cards & promo codes',         solo: true, studio: true, salonPro: true },
      { label: 'AI-powered reports',               solo: true, studio: true, salonPro: true },
      { label: 'Walk-in manager',                  solo: true, studio: true, salonPro: true },
      { label: 'TipFlow tip kiosk',                solo: true, studio: true, salonPro: true },
      { label: 'Full data export — always free',   solo: true, studio: true, salonPro: true },
    ],
  },
  {
    title: 'Team & locations',
    rows: [
      { label: 'Staff members',                    solo: '1', studio: 'Up to 8', salonPro: 'Unlimited' },
      { label: 'Roles & permissions',              solo: true,  studio: true,  salonPro: true },
      { label: 'Attendance (clock in/out)',        solo: false, studio: true,  salonPro: true },
      { label: 'Team meetings',                    solo: false, studio: true,  salonPro: true },
      { label: 'Retail inventory',                 solo: false, studio: true,  salonPro: true },
      { label: 'Multi-location',                   solo: false, studio: false, salonPro: true },
    ],
  },
  {
    title: 'Client communication',
    rows: [
      { label: 'Email + booking page',             solo: true,   studio: true, salonPro: true },
      { label: 'SMS reminders + 2-way (rolling out)', solo: 'pack', studio: true, salonPro: true },
      { label: 'Dedicated phone number',           solo: 'pack', studio: true, salonPro: true },
    ],
  },
  {
    title: 'Grow revenue',
    rows: [
      { label: 'Marketing campaigns',              solo: 'pack', studio: 'pack', salonPro: true },
      { label: 'Loyalty + tiers + segments',       solo: 'pack', studio: 'pack', salonPro: true },
      { label: 'AI voice + drafted copy',          solo: 'pack', studio: 'pack', salonPro: true },
      { label: 'Memberships (recurring revenue)',  solo: false,  studio: false, salonPro: true },
    ],
  },
  {
    title: 'Back office',
    rows: [
      { label: 'Gusto payroll + HR',               solo: 'pack', studio: 'pack', salonPro: true },
      { label: 'Custom email sender domain + branding', solo: 'pack', studio: 'pack', salonPro: 'pack' },
    ],
  },
  {
    title: 'Support',
    rows: [
      { label: 'Email support · 5-day SLA',        solo: true,  studio: false, salonPro: false },
      { label: 'Priority email + chat',            solo: false, studio: true,  salonPro: false },
      { label: 'Founder-direct + onboarding',      solo: false, studio: false, salonPro: true },
    ],
  },
];

function Cell({ value, featured }) {
  if (value === true)  return <span style={{ color: C.success, fontWeight: 700, fontSize: 15 }}>✓</span>;
  if (value === false) return <span style={{ color: C.mutedSoft, fontSize: 15 }}>—</span>;
  if (value === 'pack') return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: `${C.plum}12`, color: C.plumDeep,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase',
    }}>Pack</span>
  );
  return <span style={{ color: featured ? C.plumDeep : C.text, fontSize: 12.5, fontWeight: 600 }}>{value}</span>;
}

export default function ComparisonTable() {
  return (
    <div style={{ marginTop: 64, maxWidth: 1080, margin: '64px auto 0' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <div style={{
          display: 'inline-block', padding: '4px 12px', borderRadius: 999,
          background: 'rgba(45,122,95,.1)', color: C.success,
          fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
          textTransform: 'uppercase', marginBottom: 12,
        }}>Compare every plan</div>
        <h3 style={{
          fontFamily: FONT.display, fontSize: 'clamp(22px, 2.4vw, 28px)',
          fontWeight: 600, color: C.ink, margin: '0 0 8px', letterSpacing: '-.005em',
        }}>Everything, side by side.</h3>
        <p style={{ fontSize: 15, color: C.muted, margin: 0, maxWidth: 620, marginLeft: 'auto', marginRight: 'auto', lineHeight: 1.55 }}>
          A <strong style={{ color: C.plumDeep }}>Pack</strong> badge means the feature is available on that tier as a Power Pack add-on. Everything Salon Pro bundles, lower tiers can still add à la carte.
        </p>
      </div>

      <div style={{ overflowX: 'auto', borderRadius: radius.lg, border: `1px solid ${C.rule}`, boxShadow: shadow.sm, background: '#fff' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, fontFamily: FONT.body }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '16px 18px', fontSize: 12, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.05em', borderBottom: `1px solid ${C.rule}`, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                Feature
              </th>
              {PLANS.map(p => (
                <th key={p.id} style={{
                  textAlign: 'center', padding: '16px 14px', borderBottom: `1px solid ${C.rule}`,
                  background: p.featured ? `${C.plum}08` : '#fff', minWidth: 120,
                }}>
                  <div style={{ fontFamily: FONT.display, fontSize: 16, fontWeight: 700, color: p.featured ? C.plumDeep : C.ink }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: C.mutedSoft, marginTop: 2 }}>{p.note}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {GROUPS.map(group => (
              <FragmentGroup key={group.title} group={group} />
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ textAlign: 'center', fontSize: 13, color: C.muted, marginTop: 18 }}>
        Founders' Members get <strong style={{ color: C.success }}>Solo free for life</strong>. Paid plans include a 30-day free trial.
      </div>
    </div>
  );
}

function FragmentGroup({ group }) {
  return (
    <>
      <tr>
        <td colSpan={4} style={{
          padding: '14px 18px 8px', fontSize: 12, fontWeight: 700,
          color: C.plum, textTransform: 'uppercase', letterSpacing: '.06em',
          background: C.bgSoft, borderBottom: `1px solid ${C.ruleSoft}`,
        }}>{group.title}</td>
      </tr>
      {group.rows.map((row, i) => (
        <tr key={row.label} style={{ borderBottom: i === group.rows.length - 1 ? 'none' : `1px solid ${C.ruleSoft}` }}>
          <td style={{ padding: '11px 18px', fontSize: 13.5, color: C.text, position: 'sticky', left: 0, background: '#fff' }}>{row.label}</td>
          <td style={{ padding: '11px 14px', textAlign: 'center' }}><Cell value={row.solo} /></td>
          <td style={{ padding: '11px 14px', textAlign: 'center', background: `${C.plum}05` }}><Cell value={row.studio} featured /></td>
          <td style={{ padding: '11px 14px', textAlign: 'center' }}><Cell value={row.salonPro} /></td>
        </tr>
      ))}
    </>
  );
}
