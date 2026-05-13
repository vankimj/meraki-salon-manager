import { PHASES, completedCount, isOnboardingComplete } from '../lib/onboarding';

// Persistent yellow banner shown across all module shells until the
// tenant finishes onboarding. Click to re-open the wizard. Soft-block
// pattern — the rest of the app is fully usable while this is visible.
export default function OnboardingBanner({ onboarding, onOpen }) {
  if (!onboarding)              return null;  // never started — wizard auto-opens
  if (isOnboardingComplete(onboarding)) return null;

  const done  = completedCount(onboarding);
  const total = PHASES.length;
  const pct   = Math.round((done / total) * 100);

  return (
    <button onClick={onOpen}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', padding: '8px 16px',
        background: 'linear-gradient(90deg, #fef3c7 0%, #fde68a 100%)',
        border: 'none', borderBottom: '1px solid #fbbf24',
        cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left',
        color: '#78350f', fontSize: 12, fontWeight: 600,
      }}>
      <span style={{ fontSize: 14 }}>🎯</span>
      <span style={{ flex: 1 }}>
        Onboarding {done}/{total} complete — finish setup
      </span>
      <div style={{ width: 80, height: 4, borderRadius: 2, background: 'rgba(120, 53, 15, 0.18)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: '#78350f', transition: 'width .3s' }} />
      </div>
      <span style={{ fontSize: 11, opacity: 0.7 }}>→</span>
    </button>
  );
}
