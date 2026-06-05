import { PHASES, completedCount, isOnboardingComplete } from '../lib/onboarding';

// Persistent yellow banner shown across all module shells until the
// tenant finishes onboarding. Click to re-open the wizard. Soft-block
// pattern — the rest of the app is fully usable while this is visible.
export default function OnboardingBanner({ onboarding, onOpen }) {
  if (isOnboardingComplete(onboarding)) return null;

  const done  = completedCount(onboarding); // 0 when onboarding is null
  const total = PHASES.length;
  const pct   = Math.round((done / total) * 100);

  return (
    <button onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 16px',
        background: 'var(--pn-warning-bg)',
        border: 'none', borderBottom: '1px solid #fbbf24',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        color: 'var(--pn-warning)', fontSize: 12, fontWeight: 600,
      }}>
      <span style={{ fontSize: 14 }}>🎯</span>
      <span style={{ flex: 1 }}>
        Onboarding {done}/{total} complete — finish setup
      </span>
      <div style={{ width: 80, height: 4, borderRadius: 2, background: 'rgba(120, 53, 15, 0.18)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--pn-warning)', transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
    </button>
  );
}
