import { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { logActivity, logError } from '../../lib/logger';

// Phase 3 (UI step 4 of 8) — Money + compliance.
//
// Money: CC fee %, CC flat fee, tips-on-CC toggle, removal upcharge.
// Compliance: confirm privacy + terms URLs reachable, legal-review
//   acknowledgment, Stripe Connect deferred link.
//
// Saves financial settings to the tenant `settings` doc (existing
// fields the rest of the app already reads). Compliance acks live in
// onboarding.phases.money.phaseData so the wizard can show them as ✓
// next time the audit-mode user reopens the wizard.
export default function Phase3Money({ onboarding, onAdvance, saving }) {
  const { settings, updateSettings, showToast } = useApp();
  // phaseData lives flat in the phase entry (see markOnboardingPhase).
  const stored = onboarding?.phases?.money || {};

  // Money
  const [ccFeePct,     setCcFeePct]     = useState(stored.ccFeePct     ?? settings?.ccFeePct     ?? 2.9);
  const [ccFeeFlat,    setCcFeeFlat]    = useState(stored.ccFeeFlat    ?? settings?.ccFeeFlat    ?? 0.30);
  const [noCardTips,   setNoCardTips]   = useState(stored.noCardTips   ?? Boolean(settings?.noCardTips));
  const [removalPrice, setRemovalPrice] = useState(stored.removalPrice ?? settings?.removalPrice ?? 15);

  // Compliance
  const origin     = typeof window !== 'undefined' ? window.location.origin : '';
  const privacyUrl = `${origin}/privacy`;
  const termsUrl   = `${origin}/terms`;
  const [privacyOk, setPrivacyOk] = useState(Boolean(stored.privacyOk));
  const [termsOk,   setTermsOk]   = useState(Boolean(stored.termsOk));
  const [legalAck,  setLegalAck]  = useState(Boolean(stored.legalAck));
  const stripeConnected = Boolean(settings?.stripeAccountId);

  const [err, setErr] = useState('');

  async function save({ skip } = {}) {
    setErr('');
    if (skip) { onAdvance({ skip: true }); return; }
    try {
      await updateSettings({
        ...settings,
        ccFeePct:     Number(ccFeePct)     || 0,
        ccFeeFlat:    Number(ccFeeFlat)    || 0,
        noCardTips:   Boolean(noCardTips),
        removalPrice: Number(removalPrice) || 0,
      });
      logActivity('onboarding_money_saved', `cc ${ccFeePct}% + $${ccFeeFlat}, removal $${removalPrice}`);
      onAdvance({
        phaseData: {
          ccFeePct, ccFeeFlat, noCardTips, removalPrice,
          privacyOk, termsOk, legalAck,
        },
      });
    } catch (e) {
      setErr(e?.message || String(e));
      logError('onboarding_money_save', e);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.55, marginBottom: 18 }}>
        Set your financial defaults and confirm the legal pages are published. Every salon needs
        these dialed before the first paid appointment — but Stripe Connect can wait until you're ready.
      </div>

      <Section title="Financial defaults">
        <Row label="Credit-card processing — percent">
          <input type="number" step="0.01" min="0" max="20" value={ccFeePct}
            onChange={e => setCcFeePct(Number(e.target.value))}
            style={{ ...inp, width: 90 }} />
          <span style={{ marginLeft: 6, fontSize: 12, color: '#888' }}>%</span>
          <Hint>Stripe default is 2.9%</Hint>
        </Row>
        <Row label="Credit-card processing — flat fee">
          <span style={{ marginRight: 4, fontSize: 13, color: '#666' }}>$</span>
          <input type="number" step="0.01" min="0" value={ccFeeFlat}
            onChange={e => setCcFeeFlat(Number(e.target.value))}
            style={{ ...inp, width: 90 }} />
          <Hint>Stripe default is $0.30</Hint>
        </Row>
        <Row label="Removal upcharge">
          <span style={{ marginRight: 4, fontSize: 13, color: '#666' }}>$</span>
          <input type="number" step="1" min="0" value={removalPrice}
            onChange={e => setRemovalPrice(Number(e.target.value))}
            style={{ ...inp, width: 90 }} />
          <Hint>Charged when a client needs old gel/dip/acrylic removed before service</Hint>
        </Row>
        <ToggleRow checked={!noCardTips} onChange={v => setNoCardTips(!v)}
          label="Allow tips on credit cards"
          desc="Off = tips must be cash-only. On = clients can tip on their card at checkout (most common)." />
      </Section>

      <Section title="Legal pages (auto-published)">
        <CheckRow
          checked={privacyOk}
          onChange={setPrivacyOk}
          label={<>Privacy policy is live at <Link href={privacyUrl}>{privacyUrl}</Link></>}
          desc="Linked from the booking page footer and every marketing email."
        />
        <CheckRow
          checked={termsOk}
          onChange={setTermsOk}
          label={<>Terms of Service is live at <Link href={termsUrl}>{termsUrl}</Link></>}
          desc="Same — footer-linked from every public surface."
        />
        <CheckRow
          checked={legalAck}
          onChange={setLegalAck}
          label="I understand these are templates and not a substitute for legal review."
          desc="Before launch, have an attorney review the cancellation, refund, and CCPA sections."
        />
      </Section>

      <Section title="Stripe Connect">
        {stripeConnected ? (
          <div style={{ padding: 12, borderRadius: 8, background: '#ecfdf5', border: '1px solid #6ee7b7', fontSize: 13, color: '#065f46' }}>
            ✓ Stripe is connected. Account ID: <code style={{ fontSize: 11, background: 'rgba(0,0,0,.05)', padding: '1px 6px', borderRadius: 4 }}>{settings.stripeAccountId}</code>
          </div>
        ) : (
          <div style={{ padding: 12, borderRadius: 8, background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: 13, lineHeight: 1.55 }}>
            <strong>You can take cards once Stripe is connected.</strong>
            <div style={{ marginTop: 4 }}>
              Skip this for now if you're not accepting card payments yet — the calendar, walk-in queue,
              and all non-payment features work without Stripe. Connect before your first paid appointment.
            </div>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => showToast('Stripe Connect launches in Sprint 3 — for now configure in Admin → Financial.', 5000)}
                style={btnSecondary} type="button">
                Connect Stripe (coming soon)
              </button>
            </div>
          </div>
        )}
      </Section>

      {err && (
        <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={() => save({ skip: true })} disabled={saving} style={btnSecondary}>
          Skip for now
        </button>
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
      <div style={{ fontSize: 12, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function Hint({ children }) {
  return <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>{children}</span>;
}

function ToggleRow({ checked, onChange, label, desc }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 10, border: '1px solid #e8e8e8', borderRadius: 8, cursor: 'pointer', background: '#fff' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#5b3b8c' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: '#666', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

function CheckRow({ checked, onChange, label, desc }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 10, border: '1px solid #e8e8e8', borderRadius: 8, cursor: 'pointer', background: checked ? '#ecfdf5' : '#fff' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#10b981' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: '#1a1a1a', lineHeight: 1.5 }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: '#666', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

function Link({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#5b3b8c', fontWeight: 600, textDecoration: 'underline' }}>{children}</a>;
}

const inp = { boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid #d8d8d8', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: '#fff' };
const btnPrimary   = { padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit' };
