import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  PHASES,
  subscribeOnboarding,
  markOnboardingPhase,
  phaseStatus,
  nextPendingPhase,
  isOnboardingComplete,
} from '../../lib/onboarding';
import Phase0Welcome  from './Phase0Welcome';
import Phase1Profile  from './Phase1Profile';
import Phase2Import   from './Phase2Import';
import Phase3Money    from './Phase3Money';
import Phase4Branding from './Phase4Branding';
import Phase5Team     from './Phase5Team';
import Phase6Reach    from './Phase6Reach';
import Phase7Launch   from './Phase7Launch';
import { logActivity, logError } from '../../lib/logger';

// Renders the 7-phase onboarding wizard. Reads + writes state at
// tenants/{tid}/data/onboarding via the markOnboardingPhase Cloud
// Function. Re-entry resumes at the next pending phase. Audit mode for
// existing tenants comes via Phase 7's status grid: ✓ done · ⚠ pending.
export default function OnboardingWizard({ onDismiss }) {
  const { showToast, pauseLogoutTimer, resumeLogoutTimer } = useApp();

  // Pause the auto-logout timer while the wizard is open. Owners often
  // pause to dig up an EIN, paste a CSV, or walk away mid-flow — the
  // default 5-min idle logout will eat their work otherwise. We resume
  // when the wizard unmounts (close button or completion).
  useEffect(() => {
    pauseLogoutTimer?.();
    return () => { resumeLogoutTimer?.(); };
  }, [pauseLogoutTimer, resumeLogoutTimer]);
  // `undefined` = subscription hasn't fired yet (loading).
  // `null`      = subscription fired and the tenant has no onboarding doc.
  // `object`    = doc exists.
  const [onboarding, setOnboarding] = useState(undefined);
  const [currentKey, setCurrentKey] = useState('welcome');
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState('');

  useEffect(() => subscribeOnboarding(setOnboarding), []);

  // When state first loads, jump to the next pending phase. Manual
  // navigation (Back / phase strip clicks) is preserved after first
  // mount via `currentKey`. `null` (no doc) means start at 'welcome'.
  const [bootstrapped, setBootstrapped] = useState(false);
  useEffect(() => {
    if (bootstrapped) return;
    if (onboarding === undefined) return; // still loading
    const next = nextPendingPhase(onboarding) || 'welcome';
    setCurrentKey(next);
    setBootstrapped(true);
  }, [onboarding, bootstrapped]);

  const idx = PHASES.findIndex(p => p.key === currentKey);
  const curPhase = PHASES[idx] || PHASES[0];

  async function advance(payload = {}) {
    setError('');
    setSaving(true);
    try {
      const res = await markOnboardingPhase(currentKey, payload);
      logActivity('onboarding_phase_saved', `${currentKey}: ${payload.skip ? 'skipped' : 'done'}`);
      if (res.completedAt) {
        showToast('Onboarding complete 🎉', 5000);
        onDismiss?.();
        return;
      }
      const nextIdx = idx + 1;
      if (nextIdx < PHASES.length) setCurrentKey(PHASES[nextIdx].key);
      else onDismiss?.();
    } catch (e) {
      setError(e?.message || String(e));
      logError('onboarding_phase_save', e, { phase: currentKey });
    } finally {
      setSaving(false);
    }
  }

  function back() {
    if (idx > 0) setCurrentKey(PHASES[idx - 1].key);
  }

  function jumpTo(key) {
    setCurrentKey(key);
  }

  if (onboarding === undefined && !bootstrapped) {
    return (
      <Overlay>
        <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading…</div>
      </Overlay>
    );
  }

  const done = isOnboardingComplete(onboarding);

  // Phase-specific render. Sprint 1 implements 0, 1, 7. Other phases
  // present a "Skip for now" CTA so the audit-mode user can advance.
  let phaseNode = null;
  if (currentKey === 'welcome') {
    phaseNode = <Phase0Welcome onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'profile') {
    phaseNode = <Phase1Profile onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'import') {
    phaseNode = <Phase2Import  onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'money') {
    phaseNode = <Phase3Money    onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'branding') {
    phaseNode = <Phase4Branding onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'team') {
    phaseNode = <Phase5Team     onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'reach') {
    phaseNode = <Phase6Reach    onboarding={onboarding} onAdvance={advance} saving={saving} />;
  } else if (currentKey === 'launch') {
    phaseNode = <Phase7Launch onboarding={onboarding} onAdvance={advance} saving={saving} onJump={jumpTo} />;
  } else {
    phaseNode = (
      <ComingSoonPhase
        title={curPhase.label}
        onAdvance={advance}
        saving={saving}
      />
    );
  }

  return (
    <Overlay>
      <div style={{ width: '94%', maxWidth: 820, maxHeight: '92vh', background: '#fff', borderRadius: 16, boxShadow: '0 20px 60px rgba(0,0,0,.3)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ padding: '14px 22px', borderBottom: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.18em', textTransform: 'uppercase' }}>
              Onboarding · Step {idx + 1} of {PHASES.length}
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', marginTop: 2 }}>
              {curPhase.label}
            </div>
          </div>
          <button onClick={() => onDismiss?.()} disabled={saving}
            title="Close — your progress is saved"
            style={{ background: 'none', border: 'none', fontSize: 22, color: '#999', cursor: 'pointer', padding: 4, lineHeight: 1 }}>
            ×
          </button>
        </div>

        {/* Progress strip */}
        <div style={{ padding: '12px 22px', borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {PHASES.map((p, i) => {
              const s = phaseStatus(onboarding, p.key);
              const isCur = p.key === currentKey;
              const color = isCur ? '#5b3b8c'
                : s === 'done' ? '#10b981'
                : s === 'skipped' ? '#cbd5e1'
                : '#e5e5e5';
              return (
                <button key={p.key} onClick={() => jumpTo(p.key)} disabled={saving}
                  title={`${p.label}${s === 'done' ? ' (done)' : s === 'skipped' ? ' (skipped)' : ''}`}
                  style={{
                    flex: 1, height: 6, borderRadius: 3, background: color,
                    border: 'none', padding: 0, cursor: saving ? 'default' : 'pointer',
                    transition: 'background .2s',
                  }} />
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 22px' }}>
          {phaseNode}
          {error && (
            <div style={{ marginTop: 14, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 22px', borderTop: '1px solid #e8e8e8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fafafa' }}>
          <button onClick={back} disabled={saving || idx === 0}
            style={{ padding: '8px 14px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, color: idx === 0 ? '#bbb' : '#555', cursor: saving || idx === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            ← Back
          </button>
          <div style={{ fontSize: 11, color: '#888' }}>
            {done ? '✓ Onboarding complete' : 'Your progress is saved automatically.'}
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function Overlay({ children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: 16 }}>
      {children}
    </div>
  );
}

function ComingSoonPhase({ title, onAdvance, saving }) {
  return (
    <div>
      <div style={{ padding: 18, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, lineHeight: 1.55 }}>
        <strong>{title}</strong> — this step is part of the wizard and ships in a later sprint. For now, you can skip it and configure {title.toLowerCase()} from the regular Admin sections.
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
        <button onClick={() => onAdvance({ skip: true })} disabled={saving}
          style={{ padding: '9px 16px', fontSize: 13, fontWeight: 600, background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, color: '#555', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Saving…' : 'Skip for now →'}
        </button>
      </div>
    </div>
  );
}
