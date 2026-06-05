import { useState } from 'react';

// Phase 0 — Welcome. Pick:
//   - Branch: migrate (have existing data from GG / Vagaro / etc.) vs fresh
//   - Industry: nails / hair / both / other (template selection downstream)
// Subdomain selection is deferred to Phase 1 (Salon profile) where it
// belongs next to the legal-name + address fields.
const INDUSTRIES = [
  { id: 'nails', label: 'Nail salon',         desc: 'Manicures, pedicures, gel, nail art' },
  { id: 'hair',  label: 'Hair salon',         desc: 'Cuts, color, styling' },
  { id: 'both',  label: 'Nails + hair',       desc: 'Mixed service salon' },
  { id: 'other', label: 'Something else',     desc: 'Brows, lashes, massage, spa' },
];

export default function Phase0Welcome({ onboarding, onAdvance, saving }) {
  const [branch,   setBranch]   = useState(onboarding?.branch   || 'fresh');
  const [industry, setIndustry] = useState(onboarding?.industry || 'nails');

  function save() {
    onAdvance({ branch, industry });
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Welcome to Plume Nexus 👋 — let's get your salon set up. This takes ~20 minutes
        and you can skip any step. Your progress saves automatically as you go.
      </div>

      <Section title="Where are you starting from?">
        <Card
          selected={branch === 'fresh'}
          onClick={() => setBranch('fresh')}
          icon="✨"
          title="I'm starting fresh"
          desc="No prior system, or starting from scratch. We'll seed a starter service menu you can adjust."
        />
        <Card
          selected={branch === 'migrate'}
          onClick={() => setBranch('migrate')}
          icon="📦"
          title="I'm migrating from another system"
          desc="Bringing your clients, appointments, and service history from GlossGenius, Vagaro, Square, or similar via CSV."
        />
      </Section>

      <Section title="What kind of salon?">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {INDUSTRIES.map(i => (
            <Card
              key={i.id}
              compact
              selected={industry === i.id}
              onClick={() => setIndustry(i.id)}
              title={i.label}
              desc={i.desc}
            />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 8 }}>
          The nail-salon template has full polish today; other industries seed a starter list you'll likely customize.
        </div>
      </Section>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={save} disabled={saving}
          style={btnPrimary}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  );
}

function Card({ selected, onClick, icon, title, desc, compact }) {
  return (
    <button onClick={onClick}
      style={{
        textAlign: 'left',
        padding: compact ? '10px 14px' : '14px 16px',
        border: `1.5px solid ${selected ? '#5b3b8c' : 'var(--pn-border)'}`,
        borderRadius: 10,
        background: selected ? '#f5efff' : 'var(--pn-surface)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        transition: 'border-color .15s, background .15s',
      }}>
      {icon && <span style={{ fontSize: 22, lineHeight: 1, marginTop: 2 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 3 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>{desc}</div>
      </div>
      {selected && <span style={{ fontSize: 16, color: '#5b3b8c', marginTop: 2 }}>✓</span>}
    </button>
  );
}

const btnPrimary = {
  padding: '9px 18px',
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 8,
  border: 'none',
  background: '#5b3b8c',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
