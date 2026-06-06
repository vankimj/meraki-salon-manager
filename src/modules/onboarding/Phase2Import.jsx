import { useState, useCallback } from 'react';
import { useApp } from '../../context/AppContext';
import { createService } from '../../lib/firestore';
import { SERVICE_TEMPLATES } from '../../data/serviceTemplates';
import { logActivity, logError } from '../../lib/logger';
import CsvImportSection from '../../components/CsvImportSection';

// Phase 2 — Bring your stuff. Branches by onboarding.branch:
//   - migrate: source picker + CSV importer. GlossGenius is fully wired
//     via the existing CsvImportSection. Other competitors (Vagaro,
//     Square, Boulevard, Mindbody) are stubs that say "Contact us — we'll
//     hand-import for you" while we build per-source parsers.
//   - fresh:   services-template picker (Nail Salon has full polish;
//     Hair / Both / None / Other are placeholders or skip-this-step).

const SOURCES = [
  { id: 'glossgenius', label: 'GlossGenius', supported: true, icon: '💎',
    notes: 'Full importer. Walk through Contacts → Payment Details → Checkout Line Items below.' },
  { id: 'vagaro',      label: 'Vagaro',      supported: false, icon: '🌸' },
  { id: 'square',      label: 'Square',      supported: false, icon: '⬛' },
  { id: 'boulevard',   label: 'Boulevard',   supported: false, icon: '🎯' },
  { id: 'mindbody',    label: 'Mindbody',    supported: false, icon: '🧘' },
  { id: 'fresha',      label: 'Fresha',      supported: false, icon: '✨' },
  { id: 'other',       label: 'Something else / generic CSV', supported: false, icon: '📋' },
];

export default function Phase2Import({ onboarding, onAdvance, saving }) {
  const branch = onboarding?.branch || 'fresh';
  if (branch === 'migrate') return <MigratePath onboarding={onboarding} onAdvance={onAdvance} saving={saving} />;
  return <FreshPath onboarding={onboarding} onAdvance={onAdvance} saving={saving} />;
}

// ─── MIGRATE PATH ──────────────────────────────────────────────────
function MigratePath({ onboarding, onAdvance, saving }) {
  const [source, setSource] = useState(onboarding?.phases?.import?.source || 'glossgenius');
  // Tracks whether the embedded CsvImportSection has a long-running import
  // in flight. We gate the bottom "Skip / Done importing" buttons on this
  // so the owner can't advance the wizard mid-import and lose visibility
  // into the progress + cancel controls.
  const [importBusy, setImportBusy] = useState(false);
  const onBusyChange = useCallback((b) => setImportBusy(b), []);
  const picked = SOURCES.find(s => s.id === source);

  function complete() {
    if (importBusy) return;
    onAdvance({ phaseData: { source } });
  }
  function skip() {
    if (importBusy) return;
    onAdvance({ skip: true, phaseData: { source } });
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Bring your existing clients, appointment history, and revenue records in via CSV.
        Pick where you're migrating from — we'll show the right importer.
      </div>

      <Section title="Where are you coming from?">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {SOURCES.map(s => (
            <SourceCard key={s.id} src={s} selected={s.id === source} onClick={() => setSource(s.id)} />
          ))}
        </div>
      </Section>

      {picked?.supported && (
        <Section title="GlossGenius import">
          <div style={{ padding: 14, borderRadius: 10, background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 14 }}>
            <strong>Export steps (open GlossGenius in another tab):</strong>
            <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
              <li>Reports → Exports → download <strong>Clients</strong> CSV</li>
              <li>Reports → Exports → download <strong>Payment Details</strong> CSV</li>
              <li>Reports → Exports → download <strong>Checkout Line Items</strong> CSV</li>
            </ol>
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pn-text-faint)' }}>
              The importer dedupes by name (clients) and by GlossGenius Transaction ID (receipts),
              so re-running it is safe.
            </div>
          </div>

          {/* The existing CsvImportSection is the full 3-step GG flow. It
              writes directly to Firestore with its own dedup + diff +
              progress UI. We embed it inline so onboarding owns the
              presentation but reuses the battle-tested logic. */}
          <CsvImportSection onBusyChange={onBusyChange} />
        </Section>
      )}

      {picked && !picked.supported && (
        <Section title={`${picked.label} import`}>
          <div style={{ padding: 14, borderRadius: 10, background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', fontSize: 13, color: 'var(--pn-warning)', lineHeight: 1.55 }}>
            <strong>{picked.label} importer — coming soon.</strong>
            <div style={{ marginTop: 6 }}>
              We're building per-source parsers as tenants need them. For now, email <a href="mailto:hello@plumenexus.com" style={{ color: 'var(--pn-warning)', fontWeight: 600 }}>hello@plumenexus.com</a> with
              your {picked.label} export and we'll hand-import it for you within one business day.
            </div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Or skip this step and add data manually as it comes in — you can always import later from Admin → Settings → Import.
            </div>
          </div>
        </Section>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, alignItems: 'center' }}>
        {importBusy && (
          <span style={{ fontSize: 11, color: '#6a4fa0', fontStyle: 'italic', marginRight: 6 }}>
            Finish or cancel the import to continue
          </span>
        )}
        <button onClick={skip} disabled={saving || importBusy}
          style={{ ...btnSecondary, opacity: (saving || importBusy) ? 0.45 : 1, cursor: (saving || importBusy) ? 'not-allowed' : 'pointer' }}>
          Skip for now
        </button>
        <button onClick={complete} disabled={saving || importBusy}
          style={{ ...btnPrimary, opacity: (saving || importBusy) ? 0.45 : 1, cursor: (saving || importBusy) ? 'not-allowed' : 'pointer' }}>
          {saving ? 'Saving…' : 'Done importing — continue →'}
        </button>
      </div>
    </div>
  );
}

function SourceCard({ src, selected, onClick }) {
  return (
    <button onClick={onClick} type="button"
      style={{
        textAlign: 'left', padding: '10px 12px',
        border: `1.5px solid ${selected ? '#6a4fa0' : 'var(--pn-border)'}`,
        borderRadius: 10, background: selected ? '#f5efff' : 'var(--pn-surface)', cursor: 'pointer',
        fontFamily: 'inherit', position: 'relative',
      }}>
      <div style={{ fontSize: 18 }}>{src.icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginTop: 2 }}>{src.label}</div>
      {!src.supported && (
        <div style={{ position: 'absolute', top: 6, right: 8, fontSize: 9, fontWeight: 700, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', padding: '1px 6px', borderRadius: 6, letterSpacing: '.06em' }}>
          SOON
        </div>
      )}
    </button>
  );
}

// ─── FRESH PATH ────────────────────────────────────────────────────
function FreshPath({ onboarding, onAdvance, saving }) {
  const { showToast } = useApp();
  const stored = onboarding?.phases?.import || {};
  const [templateId, setTemplateId] = useState(stored.templateId || 'nail-salon');
  const [seedSample, setSeedSample] = useState(Boolean(stored.seedSample));
  const [importing,  setImporting]  = useState(false);
  const [importedCount, setImportedCount] = useState(stored.servicesImported || 0);
  const [error, setError] = useState('');

  const TEMPLATE_OPTIONS = [
    ...SERVICE_TEMPLATES.map(t => ({ id: t.id, label: t.label, desc: t.description, icon: t.icon, supported: t.id === 'nail-salon' })),
    { id: 'none', label: 'None — I\'ll add my own', desc: 'Start with an empty service menu', icon: '✍️', supported: true },
  ];

  async function runImport() {
    if (templateId === 'none') return;
    const tpl = SERVICE_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    if (!window.confirm(`Seed ${tpl.services.length} services from the "${tpl.label}" template? You can edit/delete any of them later.`)) return;

    setImporting(true);
    setError('');
    let count = 0;
    try {
      for (const svc of tpl.services) {
        await createService({
          ...svc,
          active: svc.active !== false,
          updatedAt: new Date().toISOString(),
        });
        count++;
      }
      setImportedCount(count);
      logActivity('onboarding_services_seeded', `${count}× from ${tpl.label}`);
      showToast(`Imported ${count} services from ${tpl.label}`, 4000);
    } catch (e) {
      setError(e?.message || String(e));
      logError('onboarding_services_seed', e, { templateId });
    } finally {
      setImporting(false);
    }
  }

  function complete() {
    onAdvance({
      phaseData: { templateId, seedSample, servicesImported: importedCount },
    });
  }
  function skip() {
    onAdvance({ skip: true, phaseData: { templateId, seedSample } });
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        We'll seed a starter service menu so you have something to book against. Edit or delete
        any of it anytime from <strong>Services</strong>.
      </div>

      <Section title="Pick a services template">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {TEMPLATE_OPTIONS.map(t => (
            <TemplateCard key={t.id} t={t} selected={t.id === templateId}
              onClick={() => t.supported && setTemplateId(t.id)} />
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 8 }}>
          Hair / Brows / Massage templates are placeholders today — you'll likely want to customize heavily.
        </div>
      </Section>

      {templateId !== 'none' && (
        <Section title="Ready to seed">
          {importedCount > 0 ? (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--pn-success-bg)', border: '1px solid #6ee7b7', color: 'var(--pn-success)', fontSize: 13 }}>
              ✓ {importedCount} services imported. You can re-run if you picked a different template.
            </div>
          ) : (
            <div style={{ padding: 12, borderRadius: 8, background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', fontSize: 13, color: 'var(--pn-text-muted)' }}>
              Click <strong>Seed services</strong> below to import the template. Existing services aren't deleted — new ones are added on top.
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={runImport} disabled={importing || templateId === 'none'} style={btnPrimary}>
              {importing ? 'Importing…' : importedCount > 0 ? 'Re-seed' : 'Seed services'}
            </button>
          </div>
        </Section>
      )}

      {error && (
        <div style={{ marginTop: 12, padding: 10, background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', borderRadius: 8, color: 'var(--pn-danger)', fontSize: 12 }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={skip} disabled={saving || importing} style={btnSecondary}>Skip for now</button>
        <button onClick={complete} disabled={saving || importing} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

function TemplateCard({ t, selected, onClick }) {
  return (
    <button onClick={onClick} type="button" disabled={!t.supported}
      style={{
        textAlign: 'left', padding: '12px 14px',
        border: `1.5px solid ${selected ? '#6a4fa0' : 'var(--pn-border)'}`,
        borderRadius: 10, background: selected ? '#f5efff' : 'var(--pn-surface)',
        cursor: t.supported ? 'pointer' : 'not-allowed',
        opacity: t.supported ? 1 : 0.55,
        fontFamily: 'inherit', position: 'relative',
      }}>
      <div style={{ fontSize: 18 }}>{t.icon}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginTop: 2 }}>{t.label}</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.4 }}>{t.desc}</div>
      {!t.supported && (
        <div style={{ position: 'absolute', top: 8, right: 10, fontSize: 9, fontWeight: 700, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', padding: '1px 6px', borderRadius: 6, letterSpacing: '.06em' }}>
          SOON
        </div>
      )}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#6a4fa0', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

const btnPrimary   = { padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#6a4fa0', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
