import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { saveWebfrontConfig, fetchWebfrontConfig } from '../../lib/firestore';
import { logActivity, logError } from '../../lib/logger';
import WelcomeStylePreview from './WelcomeStylePreview';

// Phase 4 (UI step 5 of 8) — Look & feel.
//
// Brand name + short tagline, brand color, optional logo URL, and the
// pre-login welcome screen style (centered/hairlineSplit/stacked/photo/
// photoSplit — see project_welcome_styles memory).
//
// Dual-writes to settings (staff-visible) + webfront (pre-login visible)
// per the standard branding pattern, so the booking page + splash both
// pick up the changes without an extra Save click.
const WELCOME_STYLES = [
  { id: 'centered',      label: 'Boutique — centered (default)' },
  { id: 'hairlineSplit', label: 'Boutique — split (hairline)'   },
  { id: 'stacked',       label: 'Boutique — stacked card'       },
  { id: 'photo',         label: 'Photo backdrop — centered'     },
  { id: 'photoSplit',    label: 'Photo backdrop — split'        },
  { id: 'merakiSite',    label: 'Editorial homepage — full landing page' },
];

export default function Phase4Branding({ onboarding, onAdvance, saving }) {
  const { settings, updateSettings, showToast } = useApp();
  // markOnboardingPhase stores phaseData flat in the phase entry —
  // values live at phases.branding.{field}, not nested under phaseData.
  const stored = onboarding?.phases?.branding || {};

  const [brandName,        setBrandName]        = useState(stored.brandName        ?? settings?.brandName        ?? '');
  const [brandTagline,     setBrandTagline]     = useState(stored.brandTagline     ?? settings?.brandTagline     ?? '');
  const [brandTaglineTop,  setBrandTaglineTop]  = useState(stored.brandTaglineTop  ?? settings?.brandTaglineTop  ?? '');
  const [brandColor,       setBrandColor]       = useState(stored.brandColor       ?? settings?.brandColor       ?? '#2D7A5F');
  const [brandLogoUrl,     setBrandLogoUrl]     = useState(stored.brandLogoUrl     ?? settings?.brandLogoUrl     ?? '');
  const [welcomeStyle,     setWelcomeStyle]     = useState(stored.welcomeStyle     ?? settings?.welcomeStyle     ?? 'centered');
  const [err, setErr] = useState('');

  async function save({ skip } = {}) {
    if (skip) { onAdvance({ skip: true }); return; }
    setErr('');
    try {
      const bName = brandName.trim()       || null;
      const bTag  = brandTagline.trim()    || null;
      const bTop  = brandTaglineTop.trim() || null;
      const bLogo = brandLogoUrl.trim()    || null;
      // Dual-write — settings (staff UI) + webfront (pre-login surfaces).
      await Promise.all([
        updateSettings({
          ...settings,
          brandName: bName, brandTagline: bTag, brandTaglineTop: bTop,
          brandColor, brandLogoUrl: bLogo, welcomeStyle,
        }),
        fetchWebfrontConfig().then(wf => saveWebfrontConfig({
          ...(wf || {}),
          brandName: bName, brandTagline: bTag, brandTaglineTop: bTop,
          brandColor, brandLogoUrl: bLogo, welcomeStyle,
        })),
      ]);
      logActivity('onboarding_branding_saved', `${bName || '(no brand name)'} · ${welcomeStyle}`);
      showToast('Branding saved', 2500);
      onAdvance({
        phaseData: { brandName: bName, brandTagline: bTag, brandTaglineTop: bTop, brandColor, brandLogoUrl: bLogo, welcomeStyle },
      });
    } catch (e) {
      setErr(e?.message || String(e));
      logError('onboarding_branding_save', e);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        How you show up on the splash screen, the booking page, and every email. You can
        tweak any of this later from Admin → Settings → Branding.
      </div>

      <Section title="Brand identity">
        <Row label="Brand name (short)">
          <input value={brandName} onChange={e => setBrandName(e.target.value)} placeholder="e.g. Meraki" maxLength={40} style={inp} />
          <Hint>The cursive name on the splash. Usually the first word of your salon name.</Hint>
        </Row>
        <Row label="Tagline above brand name (optional)">
          <input value={brandTaglineTop} onChange={e => setBrandTaglineTop(e.target.value)} placeholder="e.g. Welcome to" maxLength={40} style={inp} />
        </Row>
        <Row label="Tagline below brand name (optional)">
          <input value={brandTagline} onChange={e => setBrandTagline(e.target.value)} placeholder="e.g. Nail Studio" maxLength={40} style={inp} />
        </Row>
        <Row label="Logo URL (optional)">
          <input value={brandLogoUrl} onChange={e => setBrandLogoUrl(e.target.value)} placeholder="https://…/logo.png" style={inp} />
          <Hint>Square PNG works best. Defaults to the Plume Nexus Camellia if blank.</Hint>
        </Row>
      </Section>

      <Section title="Brand color">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <input type="color" value={brandColor} onChange={e => setBrandColor(e.target.value)}
            style={{ width: 56, height: 40, border: '1px solid var(--pn-border-strong)', borderRadius: 8, cursor: 'pointer', padding: 2, background: 'var(--pn-surface)' }} />
          <input type="text" value={brandColor} onChange={e => setBrandColor(e.target.value)}
            style={{ ...inp, width: 140 }} placeholder="#2D7A5F" />
          <div style={{ flex: 1, padding: '8px 14px', borderRadius: 8, background: brandColor, color: '#fff', fontSize: 13, fontWeight: 700 }}>
            Sample button
          </div>
        </div>
        <Hint>Drives the primary CTA color across buttons, headers, and gradient accents.</Hint>
      </Section>

      <Section title="Pre-login welcome screen">
        <Row label="Welcome layout">
          <select value={welcomeStyle} onChange={e => setWelcomeStyle(e.target.value)} style={{ ...inp, width: 320 }}>
            {WELCOME_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Row>
        <Hint>"Centered" is the safe default. Photo backdrop variants need a real photo URL set later.</Hint>
        <WelcomeStylePreview
          style={welcomeStyle}
          brandName={brandName}
          brandTagline={brandTagline}
          brandTaglineTop={brandTaglineTop}
          brandColor={brandColor}
          brandLogoUrl={brandLogoUrl}
        />
      </Section>

      {err && (
        <div style={{ padding: 10, background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', borderRadius: 8, color: 'var(--pn-danger)', fontSize: 12, marginBottom: 12 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={() => save({ skip: true })} disabled={saving} style={btnSecondary}>Skip for now</button>
        <button onClick={() => save()} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#6a4fa0', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function Hint({ children }) {
  return <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>{children}</div>;
}

const inp = { boxSizing: 'border-box', width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid var(--pn-border-strong)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--pn-surface)' };
const btnPrimary   = { padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#6a4fa0', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
