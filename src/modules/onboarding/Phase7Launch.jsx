import { PHASES, phaseStatus } from '../../lib/onboarding';

// Phase 7 — Launch. Sprint 1 stub.
//
// Shows the status of every phase as a grid (audit mode), lets the
// owner jump to any pending phase to finish it, and offers a final
// "Launch" button that marks the launch phase done — completing
// onboarding.
//
// Sprint 4 will expand this with the launch-kit generator: QR code,
// announcement email + SMS templates, social-bio link generator,
// in-salon signage PDF.
export default function Phase7Launch({ onboarding, onAdvance, saving, onJump }) {
  const remaining = PHASES.filter(p => {
    const s = phaseStatus(onboarding, p.key);
    return s !== 'done' && s !== 'skipped';
  });

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Here's where everything stands. Anything pending below can be finished now or later —
        you can come back to this wizard from <strong>Admin → Onboarding</strong> any time.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
        {PHASES.map(p => {
          const s = phaseStatus(onboarding, p.key);
          const icon  = s === 'done'    ? '✓' : s === 'skipped' ? '○' : '⚠';
          const color = s === 'done'    ? '#10b981' : s === 'skipped' ? '#9ca3af' : '#f59e0b';
          const bg    = s === 'done'    ? '#ecfdf5' : s === 'skipped' ? 'var(--pn-bg)' : '#fffbeb';
          const label = s === 'done'    ? 'Complete' : s === 'skipped' ? 'Skipped' : 'Pending';
          return (
            <button key={p.key} onClick={() => p.key !== 'launch' && onJump?.(p.key)}
              disabled={p.key === 'launch'}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${color}33`, background: bg,
                cursor: p.key === 'launch' ? 'default' : 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}>
              <span style={{ width: 20, textAlign: 'center', fontSize: 14, color, fontWeight: 700 }}>{icon}</span>
              <span style={{ flex: 1, fontSize: 13, color: 'var(--pn-text)' }}>{p.label}</span>
              <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
            </button>
          );
        })}
      </div>

      {remaining.length > 0 && remaining.some(r => r.key !== 'launch') && (
        <div style={{ padding: 12, borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 12, marginBottom: 14, lineHeight: 1.55 }}>
          <strong>{remaining.filter(r => r.key !== 'launch').length} step{remaining.filter(r => r.key !== 'launch').length === 1 ? '' : 's'} still pending.</strong> You can finish them anytime — or launch now and circle back later.
        </div>
      )}

      <div style={{ padding: 16, borderRadius: 10, background: 'linear-gradient(135deg, #f5efff 0%, #eaf3fc 100%)', border: '1px solid #d8d0e8' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#5b3b8c', marginBottom: 6 }}>🚀 Launch artifacts (coming soon)</div>
        <div style={{ fontSize: 12, color: '#5b3b8c', lineHeight: 1.55 }}>
          Sprint 4 of this wizard will generate everything you need for launch day:
          a QR code linking to your booking page, an email + SMS announcement template,
          a "we've moved" Instagram bio template, and a printable in-salon signage PDF.
          For now, click <strong>Launch</strong> to mark onboarding complete.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <button onClick={() => onAdvance({ skip: true })} disabled={saving}
          style={btnSecondary}>
          Skip — finish later
        </button>
        <button onClick={() => onAdvance({ phaseData: { launchedAt: new Date().toISOString() } })} disabled={saving}
          style={btnPrimary}>
          {saving ? 'Saving…' : '🚀 Launch'}
        </button>
      </div>
    </div>
  );
}

const btnPrimary   = { padding: '9px 22px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
