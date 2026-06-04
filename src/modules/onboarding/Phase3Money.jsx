import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../../context/AppContext';
import { logActivity, logError } from '../../lib/logger';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';
import { EmbeddedOnboarding, EmbeddedAccountManagement } from './ConnectEmbedded';

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
  // CC processing rate is dictated by Stripe (2.9% + $0.30 for online
  // cards) — not user-configurable here. Removal-upcharge moved out of
  // the wizard (it's a service-pricing decision, not a compliance one).
  // Admin → Settings still exposes overridable inputs for the rare
  // custom-rate platform-negotiated case.
  const [noCardTips,   setNoCardTips]   = useState(stored.noCardTips   ?? Boolean(settings?.noCardTips));

  // Compliance
  const origin     = typeof window !== 'undefined' ? window.location.origin : '';
  const privacyUrl = `${origin}/privacy`;
  const termsUrl   = `${origin}/terms`;
  const [privacyOk, setPrivacyOk] = useState(Boolean(stored.privacyOk));
  const [termsOk,   setTermsOk]   = useState(Boolean(stored.termsOk));
  // Stripe Connect: two paths share one tenant doc field — Express
  // (Plume-managed, default) and Standard (salon manages their own
  // stripe.com login). The mirror lives in settings.stripeConnect.
  const stripeConnect = settings?.stripeConnect || null;
  const stripeConnected = Boolean(stripeConnect?.accountId);

  const [err, setErr] = useState('');

  async function save({ skip } = {}) {
    setErr('');
    if (skip) { onAdvance({ skip: true }); return; }
    try {
      // Default the CC rate fields to Stripe's published rate if the
      // tenant doesn't already have a value. This keeps CheckoutModal +
      // reports working (they read settings.ccFeePct / ccFeeFlat) without
      // forcing the salon to type a number Stripe already fixed.
      await updateSettings({
        ...settings,
        ccFeePct:   Number(settings?.ccFeePct  ?? 2.9),
        ccFeeFlat:  Number(settings?.ccFeeFlat ?? 0.30),
        noCardTips: Boolean(noCardTips),
      });
      logActivity('onboarding_money_saved', `tips-on-cards=${!noCardTips}`);
      onAdvance({ phaseData: { noCardTips, privacyOk, termsOk } });
    } catch (e) {
      setErr(e?.message || String(e));
      logError('onboarding_money_save', e);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Set your financial defaults and confirm the legal pages are published. Every salon needs
        these dialed before the first paid appointment — but Stripe Connect can wait until you're ready.
      </div>

      <Section title="Financial defaults">
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
      </Section>

      <Section title="Stripe Connect">
        <StripeConnectStep stripeConnect={stripeConnect} showToast={showToast} settings={settings} updateSettings={updateSettings} />
      </Section>

      {err && (
        <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center', marginTop: 18 }}>
        {!(privacyOk && termsOk) && (
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginRight: 'auto' }}>
            Confirm the privacy and terms boxes above to continue.
          </div>
        )}
        <button onClick={() => save({ skip: true })} disabled={saving} style={btnSecondary}>
          Skip for now
        </button>
        <button onClick={() => save()} disabled={saving || !(privacyOk && termsOk)} style={btnPrimary(saving || !(privacyOk && termsOk))}>
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
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function Hint({ children }) {
  return <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--pn-text-faint)' }}>{children}</span>;
}

function ToggleRow({ checked, onChange, label, desc }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 10, border: '1px solid var(--pn-border)', borderRadius: 8, cursor: 'pointer', background: 'var(--pn-surface)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#5b3b8c' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

function CheckRow({ checked, onChange, label, desc }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 10, border: '1px solid var(--pn-border)', borderRadius: 8, cursor: 'pointer', background: checked ? '#ecfdf5' : 'var(--pn-surface)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ marginTop: 2, accentColor: '#10b981' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text)', lineHeight: 1.5 }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

function Link({ href, children }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#5b3b8c', fontWeight: 600, textDecoration: 'underline' }}>{children}</a>;
}

// Side-by-side trade-off table. Renders ABOVE the two picker cards so
// the salon owner sees the substantive differences at decision time
// (cost, ownership, login surface, dispute handling, portability).
// Rates + Connect fees verified against stripe.com/pricing and
// stripe.com/connect/pricing via WebFetch on 2026-06-03.
function ConnectComparisonTable() {
  const ROWS = [
    {
      label: 'Setup time',
      std:   '~5 min on stripe.com',
      exp:   '~5 min embedded in Plume',
    },
    {
      label: 'Where you log in',
      std:   'stripe.com (separate account)',
      exp:   'Plume only — no stripe.com login',
    },
    {
      label: 'Processing rate',
      std:   '2.9% + $0.30 online · 2.7% + $0.05 Terminal',
      exp:   'Same',
    },
    {
      label: 'Per-payout fee',
      std:   <span style={{ color: '#065f46', fontWeight: 600 }}>None</span>,
      exp:   <>~0.25% + $0.25 <em style={{ opacity: 0.7 }}>per payout</em></>,
    },
    {
      label: 'Monthly account fee',
      std:   <span style={{ color: '#065f46', fontWeight: 600 }}>None</span>,
      exp:   <>$2/mo <em style={{ opacity: 0.7 }}>for the whole salon (not per staff or client)</em></>,
    },
    {
      label: 'Disputes / chargebacks',
      std:   'You handle directly with Stripe',
      exp:   'Plume coordinates',
    },
    {
      label: 'Account ownership',
      std:   <span style={{ color: '#065f46', fontWeight: 600 }}>You own it forever</span>,
      exp:   'Plume owns it (sub-account)',
    },
    {
      label: 'If you ever leave Plume',
      std:   <span style={{ color: '#065f46', fontWeight: 600 }}>Keep your Stripe account</span>,
      exp:   'Sub-account closes',
    },
  ];

  const cellBase = {
    padding: '8px 10px', fontSize: 12, lineHeight: 1.45,
    borderBottom: '1px solid var(--pn-border)', verticalAlign: 'top',
  };

  return (
    <details open style={{ marginBottom: 14, borderRadius: 10, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)' }}>
      <summary style={{ padding: '10px 14px', fontSize: 12, fontWeight: 600, color: '#5b3b8c', cursor: 'pointer', userSelect: 'none' }}>
        Compare the two options side-by-side
      </summary>
      <div style={{ overflowX: 'auto', padding: '0 4px 10px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: 'var(--pn-text)' }}>
          <thead>
            <tr>
              <th style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: '#5b3b8c', background: 'var(--pn-bg)', borderBottom: '2px solid var(--pn-border)', width: '32%' }}></th>
              <th style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: '#065f46', background: '#f0fdf4', borderBottom: '2px solid #6ee7b7' }}>
                ✓ Your own Stripe (Standard)
              </th>
              <th style={{ ...cellBase, textAlign: 'left', fontWeight: 700, color: 'var(--pn-text)', background: 'var(--pn-bg)', borderBottom: '2px solid var(--pn-border)' }}>
                Plume-managed (Express)
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(r => (
              <tr key={r.label}>
                <td style={{ ...cellBase, color: 'var(--pn-text-muted)', fontWeight: 600 }}>{r.label}</td>
                <td style={cellBase}>{r.std}</td>
                <td style={cellBase}>{r.exp}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: '8px 10px 0', fontSize: 11, color: 'var(--pn-text-faint)' }}>
          Rates set by Stripe ·{' '}
          <a href="https://stripe.com/pricing" target="_blank" rel="noopener noreferrer" style={{ color: '#5b3b8c', textDecoration: 'underline' }}>stripe.com/pricing</a> ·{' '}
          <a href="https://stripe.com/connect/pricing" target="_blank" rel="noopener noreferrer" style={{ color: '#5b3b8c', textDecoration: 'underline' }}>stripe.com/connect/pricing</a>
        </div>
      </div>
    </details>
  );
}

// Card-processing rates display. Same rates apply to both account
// types (Stripe sets them); the footnote differs by accountType so
// each card explains what the salon's effective cost actually is.
// Rates verified against stripe.com/pricing via WebFetch on 2026-06-03.
function RateCard({ accountType, color = 'inherit', borderColor = 'rgba(0,0,0,0.12)', background = 'rgba(255,255,255,0.6)' }) {
  return (
    <div style={{
      padding: 10, borderRadius: 8, background,
      border: `1px dashed ${borderColor}`, fontSize: 12, lineHeight: 1.55, marginBottom: 8,
      color,
    }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>Card processing rates</div>
      <div style={{ marginBottom: 4 }}>
        <strong>Online (booking page):</strong> 2.9% + $0.30 per transaction
      </div>
      <div style={{ marginBottom: 6 }}>
        <strong>In-person (Stripe Terminal):</strong> 2.7% + $0.05 per transaction
      </div>
      <div style={{ fontSize: 11, opacity: 0.85 }}>
        {accountType === 'express'
          ? "Same base rates as Standard, plus Stripe's per-payout Connect fee (~0.25% + $0.25 each time funds reach your bank) and a flat $2/month for your salon — that's one Stripe account for the whole business, not per nail tech or per client. Passed through, not absorbed. "
          : "You pay Stripe directly at these rates — Plume does not add a fee. "}
        <a href="https://stripe.com/pricing" target="_blank" rel="noopener noreferrer"
          style={{ color: 'inherit', textDecoration: 'underline' }}>
          See stripe.com/pricing ↗
        </a>
      </div>
    </div>
  );
}

// ── Stripe Connect step (Express + Standard) ─────────────────────────────
// Two paths share one downstream charge architecture. The salon picks
// during onboarding:
//   Express  Plume-managed; no stripe.com login; 5-min Stripe-hosted form
//   Standard Salon manages their own stripe.com account; full Stripe UX
function StripeConnectStep({ stripeConnect, showToast, settings, updateSettings }) {
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState('');
  // When true, render the Stripe Embedded Connect onboarding component
  // inline instead of redirecting to connect.stripe.com. Express only —
  // Standard accounts still use OAuth redirect.
  const [embeddedOnboardingOpen, setEmbeddedOnboardingOpen] = useState(false);
  const [embeddedManagementOpen, setEmbeddedManagementOpen] = useState(false);

  // Note: the Stripe Connect OAuth callback handler lives in App.jsx
  // (AppShell) so it fires at the routing level regardless of which view
  // the user is on. Don't duplicate it here.

  // Trigger from the "Set up payments" card. One click: create the Stripe
  // Express account with the bare minimum we already know (tenant name,
  // owner name, owner email) and open the EMBEDDED onboarding flow inline.
  // Stripe's hosted form collects everything else (EIN, DOB, address, bank,
  // SSN-4) — we don't double-ask. Plume-branded, never redirects to
  // connect.stripe.com.
  async function startExpress() {
    setBusy(true); setErr('');
    try {
      await callFn('createExpressAccount')({ tenantId: TENANT_ID });
      setEmbeddedOnboardingOpen(true);
      setBusy(false);
    } catch (e) {
      setErr(e.message || 'Failed to start Express onboarding');
      setBusy(false);
    }
  }

  async function openManagement() {
    setErr('');
    setEmbeddedManagementOpen(true);
  }

  async function handleEmbeddedExit() {
    // Salon completed (or exited) the embedded onboarding. Refresh the
    // server mirror AND push the result through updateSettings — without
    // the local push, the React settings cache stays stale and the panel
    // doesn't repaint until the next page refresh. Same bug pattern the
    // OAuth callback hook handles via onSuccess.
    setEmbeddedOnboardingOpen(false);
    try {
      const { data } = await callFn('getStripeConnectStatus')({ tenantId: TENANT_ID });
      if (data?.status && updateSettings && settings) {
        await updateSettings({ ...settings, stripeConnect: {
          accountId:                data.status.accountId,
          accountType:              data.status.accountType,
          chargesEnabled:           data.status.chargesEnabled,
          payoutsEnabled:           data.status.payoutsEnabled,
          detailsSubmitted:         data.status.detailsSubmitted,
          businessName:             data.status.businessName,
          statementDescriptor:      data.status.statementDescriptor,
          requirementsCurrentlyDue: data.status.requirementsCurrentlyDue,
          updatedAt:                data.status.updatedAt,
        }});
        showToast?.(`✓ Stripe ${data.status.accountType || 'account'} connected`, 5000);
      }
    } catch (e) {
      console.warn('[Connect] post-onboarding status refresh failed:', e?.message);
    }
  }

  async function deleteAccount() {
    const isStandard = stripeConnect?.accountType === 'standard';
    const isLiveNow  = stripeConnect?.chargesEnabled && stripeConnect?.payoutsEnabled;
    let msg;
    if (isStandard) {
      msg = 'Disconnect your Stripe account from Plume? Your Stripe account itself (and its data on stripe.com) stays intact — only Plume loses access. You can reconnect any time.';
    } else if (isLiveNow) {
      msg = 'DELETE this Stripe account?\n\nThis permanently removes the merchant account from Stripe. All transaction history, payout schedules, and any stored customer cards on this account will be gone — no undo. Type-and-click carefully.';
    } else {
      msg = 'Delete this Stripe account and start over? This wipes any in-progress onboarding.';
    }
    if (!window.confirm(msg)) return;
    setBusy(true); setErr('');
    try {
      await callFn('deleteConnectAccount')({ tenantId: TENANT_ID });
      // Clear the cached mirror locally so the UI flips to the green
      // "Connect Stripe account" card without a page refresh. Server
      // already cleared the Firestore mirror; this just syncs the React
      // state. updateSettings ignores undefined fields when persisting,
      // so we don't double-write the cleared field.
      if (updateSettings && settings) {
        const next = { ...settings };
        delete next.stripeConnect;
        await updateSettings(next);
      }
      showToast?.(isStandard ? 'Stripe disconnected — pick a path below' : 'Stripe account cleared — pick a path below');
    } catch (e) {
      setErr(e.message || 'Failed to delete account');
    } finally {
      setBusy(false);
    }
  }

  async function startStandard() {
    setBusy(true); setErr('');
    try {
      // Pass our current origin so the server uses the SAME subdomain
      // as the redirect target. Otherwise the server falls back to
      // publicAppUrl and the user lands on a domain they're not
      // authenticated on, breaking the callback.
      const origin = (typeof window !== 'undefined') ? window.location.origin : undefined;
      const { data } = await callFn('getStripeConnectOAuthUrl')({ tenantId: TENANT_ID, origin });
      if (data?.url) {
        // Stash where to re-open the wizard after the OAuth round-trip.
        // AppShell's OAuth callback hook reads this and re-mounts the
        // wizard at the same phase, so the salon owner sees the result
        // inline instead of landing on the home tile grid.
        sessionStorage.setItem('connect-return-to-wizard', 'money');
        window.location.href = data.url;        // Stripe OAuth
      } else {
        throw new Error('No OAuth URL returned');
      }
    } catch (e) {
      setErr(e.message || 'Failed to start Standard OAuth');
      setBusy(false);
    }
  }

  // Resume an in-progress Express onboarding (account exists but Stripe
  // still needs more — e.g. bank account, ToS acceptance, ID upload).
  // Calls createExpressAccount first because it's idempotent — returns
  // the existing account if one is still on the tenant doc, or creates
  // a fresh one if the doc drifted (e.g. mirror says "exists" but the
  // top-level tenant doc lost the accountId, which we saw in the wild).
  // Either way the modal opens against a known-good account.
  async function continueOnboarding() {
    return startExpress();
  }

  async function openDashboard() {
    setBusy(true); setErr('');
    try {
      const { data } = await callFn('createExpressLoginLink')({ tenantId: TENANT_ID });
      if (data?.url) window.open(data.url, '_blank', 'noopener');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  // Render the body content based on connect state. We compute it as a
  // variable instead of early-returning so the embedded modals (rendered
  // at the bottom of this function) are reachable in BOTH paths — a
  // previous version had two early returns and modals only existed in
  // the "not connected" branch, so clicking "Continue setup" or
  // "Manage payments" on the connected branch did nothing.
  let body;
  if (stripeConnect?.accountId) {
    const { chargesEnabled, payoutsEnabled, detailsSubmitted, accountType,
            businessName, statementDescriptor, requirementsCurrentlyDue = [] } = stripeConnect;
    const isLive = chargesEnabled && payoutsEnabled;
    const needsMore = requirementsCurrentlyDue.length > 0 || !detailsSubmitted;

    // Map Stripe's machine requirement keys to salon-friendly descriptions.
    // Anything not in this map shows up verbatim (rare; only when Stripe
    // adds new requirement types we haven't seen yet).
    const FIELD_LABEL = {
      'business_profile.product_description': { label: 'What you sell',         where: 'on stripe.com' },
      'business_profile.support_phone':       { label: 'Customer support phone', where: 'on stripe.com' },
      'business_profile.support_email':       { label: 'Customer support email', where: 'on stripe.com' },
      'business_profile.url':                 { label: 'Business website',       where: 'on stripe.com' },
      'business_profile.mcc':                 { label: 'Industry / category',    where: 'on stripe.com' },
      'tos_acceptance.date':                  { label: "Accept Stripe's service agreement", where: 'on stripe.com' },
      'tos_acceptance.ip':                    { label: "Accept Stripe's service agreement", where: 'on stripe.com' },
      'external_account':                     { label: 'Bank account for payouts', where: 'on stripe.com' },
      'individual.dob.day':                   { label: 'Date of birth',          where: 'on stripe.com' },
      'individual.dob.month':                 { label: 'Date of birth',          where: 'on stripe.com' },
      'individual.dob.year':                  { label: 'Date of birth',          where: 'on stripe.com' },
      'individual.ssn_last_4':                { label: 'Last 4 of SSN',          where: 'on stripe.com' },
      'individual.id_number':                 { label: 'Full SSN',               where: 'on stripe.com' },
      'individual.verification.document':     { label: 'Government ID photo',    where: 'on stripe.com' },
      'individual.address.line1':             { label: 'Home address',           where: 'on stripe.com' },
      'company.tax_id':                       { label: 'EIN (business tax ID)',  where: 'on stripe.com' },
      'company.address.line1':                { label: 'Business address',       where: 'on stripe.com' },
      'company.verification.document':        { label: 'Business verification docs', where: 'on stripe.com' },
    };
    // Dedupe by label so DOB doesn't show 3 times for day/month/year.
    const friendlyItems = [];
    const seenLabels = new Set();
    for (const k of requirementsCurrentlyDue) {
      const info = FIELD_LABEL[k] || { label: k, where: '' };
      if (seenLabels.has(info.label)) continue;
      seenLabels.add(info.label);
      friendlyItems.push(info);
    }
    const needsStripeSide = friendlyItems.length > 0;

    // Deep-link target: the public-details page covers business_profile.*
    // (URL, support phone, product description). Other field categories
    // live at different paths, but public-details is the most common
    // landing for the requirements we see on a freshly-connected account.
    //
    // CRITICAL: include the connected account ID. Without it, Stripe
    // routes to whatever workspace the user is currently logged into —
    // typically the wrong one (we saw this with the EvieSoft sandbox
    // bleeding through). Stripe's accounts.retrieve does NOT return a
    // livemode field, so we infer it from our publishable key prefix:
    // pk_test_xxx → test mode, pk_live_xxx → live. Verified that
    // dashboard.stripe.com/<acctId>/test/settings/public-details returns
    // 303 to login → on login lands the user on the right account.
    const isTestMode = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').startsWith('pk_test_');
    const stripeDashUrl = `https://dashboard.stripe.com/${stripeConnect.accountId}${isTestMode ? '/test' : ''}/settings/public-details`;

    body = (
      <div style={{ padding: 12, borderRadius: 8,
        background: isLive ? '#ecfdf5' : needsMore ? '#fff7ed' : '#fffbeb',
        border: `1px solid ${isLive ? '#6ee7b7' : needsMore ? '#fed7aa' : '#fde68a'}`,
        fontSize: 13, color: isLive ? '#065f46' : needsMore ? '#7c2d12' : '#92400e',
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          {isLive ? '✓ Payments are live' : needsMore ? 'More info needed' : 'Stripe reviewing your account'}
        </div>
        <div style={{ marginBottom: 8 }}>
          {accountType === 'express' ? 'Plume-managed' : 'You manage at stripe.com'}
          {businessName ? ` · ${businessName}` : ''}
          {statementDescriptor ? ` · "${statementDescriptor}" on receipts` : ''}
        </div>
        <div style={{ fontSize: 12, marginBottom: 8 }}>
          Charges: {chargesEnabled ? '✓' : '✗'}{' · '}
          Payouts: {payoutsEnabled ? '✓' : '✗'}{' · '}
          KYC submitted: {detailsSubmitted ? '✓' : '✗'}
        </div>

        <RateCard accountType={accountType} color={isLive ? '#065f46' : needsMore ? '#7c2d12' : '#92400e'} />
        {friendlyItems.length > 0 && (
          <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.6 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Still needed:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {friendlyItems.map((i, idx) => (
                <li key={idx}>
                  {i.label}
                  {i.where && <span style={{ color: '#92400e', opacity: 0.7, fontSize: 11 }}> — {i.where}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
          {needsMore && accountType === 'express' && (
            <button onClick={continueOnboarding} disabled={busy} style={btnPrimary(busy)} type="button">
              {busy ? 'Loading…' : 'Continue setup'}
            </button>
          )}
          {accountType === 'express' && (
            <button onClick={openManagement} disabled={busy} style={btnSecondary} type="button">
              Manage payments
            </button>
          )}
          {accountType === 'standard' && needsStripeSide && (
            <a href={stripeDashUrl} target="_blank" rel="noopener noreferrer"
              style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
              Open stripe.com to finish ↗
            </a>
          )}
          <button onClick={deleteAccount} disabled={busy} type="button"
            style={{ background: 'none', border: 'none', color: '#a16207', fontSize: 11, fontWeight: 600, cursor: busy ? 'default' : 'pointer', textDecoration: 'underline', padding: 6 }}>
            {accountType === 'standard' ? 'Disconnect' : (isLive ? 'Delete account' : 'Start over')}
          </button>
        </div>
        {/* Standard-only edge-case helper. Stripe doesn't honor deep-links
            to accounts the logged-in user can't access — it silently
            redirects to whatever workspace they're already in. Surfaces
            the target account so the owner knows which identity to log
            in as, plus a one-click sign-out-and-retry path. */}
        {accountType === 'standard' && needsStripeSide && (
          <div style={{ fontSize: 11, color: '#92400e', opacity: 0.85, marginTop: 10, paddingTop: 8, borderTop: '1px dashed #fed7aa', lineHeight: 1.55 }}>
            Connecting to <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, background: '#fff7ed', padding: '1px 4px', borderRadius: 3 }}>{stripeConnect.accountId}</code>
            {businessName && <> ({businessName})</>}.
            <br />
            Wrong account on stripe.com?{' '}
            <a
              href={`https://dashboard.stripe.com/logout?redirect=${encodeURIComponent(stripeDashUrl.replace('https://dashboard.stripe.com', ''))}`}
              target="_blank" rel="noopener noreferrer"
              style={{ color: '#7c2d12', textDecoration: 'underline', fontWeight: 600 }}
            >
              Sign out + sign back in as the salon owner
            </a>.
          </div>
        )}
        {err && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{err}</div>}
      </div>
    );
  } else {
    // Not connected: show the two-path picker
    body = (
    <div>
      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 12 }}>
        You can take cards once Stripe is connected. Pick how you want to handle payments —
        both work the same for charging customers; the difference is whether you ever have to
        deal with stripe.com directly.
      </div>

      <ConnectComparisonTable />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {/* Standard card — now recommended */}
        <div style={{ border: '2px solid #6ee7b7', borderRadius: 10, padding: 14, background: '#f0fdf4', position: 'relative' }}>
          <div style={{ position: 'absolute', top: -10, right: 12,
            background: '#065f46', color: '#fff', fontSize: 9, fontWeight: 700,
            padding: '3px 8px', borderRadius: 8, letterSpacing: 0.5 }}>
            RECOMMENDED
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#065f46', marginBottom: 4 }}>✓ Your own Stripe account</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            Connect (or create) a Stripe account in your salon's name. You own it,
            you keep it if you ever leave Plume, and there's no per-payout fee.
          </div>
          <ul style={{ fontSize: 11, color: 'var(--pn-text-muted)', padding: '0 0 0 16px', margin: '0 0 10px', lineHeight: 1.7 }}>
            <li>You own the merchant account</li>
            <li>Full Stripe Dashboard at stripe.com</li>
            <li>No per-payout fee</li>
            <li>Stripe handles your disputes directly</li>
          </ul>
          <RateCard accountType="standard" color="#065f46" borderColor="#a7f3d0" background="rgba(255,255,255,0.7)" />
          <button onClick={startStandard} disabled={busy} style={btnPrimary(busy)} type="button">
            {busy ? 'Loading…' : 'Connect Stripe account'}
          </button>
        </div>

        {/* Express card — alternative */}
        <div style={{ border: '1px solid var(--pn-border)', borderRadius: 10, padding: 14, background: 'var(--pn-surface)' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>Plume-managed</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10, lineHeight: 1.5 }}>
            We create + manage a sub-account for you. Dashboard lives inside Plume,
            no stripe.com login. Small per-payout fee covers it.
          </div>
          <ul style={{ fontSize: 11, color: 'var(--pn-text-muted)', padding: '0 0 0 16px', margin: '0 0 10px', lineHeight: 1.7 }}>
            <li>Dashboard inside Plume</li>
            <li>No separate stripe.com account</li>
            <li>Small per-payout fee</li>
            <li>Disputes routed through Plume</li>
          </ul>
          <RateCard accountType="express" color="var(--pn-text-muted)" borderColor="var(--pn-border)" background="var(--pn-bg)" />
          <button onClick={startExpress} disabled={busy} style={btnSecondary} type="button">
            {busy ? 'Loading…' : 'Use Plume-managed'}
          </button>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 12, lineHeight: 1.5 }}>
        You can skip this for now — the calendar, walk-in queue, and all non-payment features
        work without Stripe. Connect before your first paid appointment.
      </div>

      {err && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>{err}</div>}
    </div>
    );
  }

  // Single return that wraps the body content + global modals (prefill
  // and embedded). Modals MUST render here, not inside either body
  // branch, because state updates from buttons in either branch need
  // to be able to mount the corresponding modal.
  return (
    <>
      {body}

      {/* Hidden state marker — used by Phase3Money.test.jsx to verify
          that click handlers update the modal-open flags. Costs nothing
          at runtime since it's display:none. */}
      <div data-testid="connect-state-marker"
        data-embedded-onboarding-open={String(embeddedOnboardingOpen)}
        data-embedded-management-open={String(embeddedManagementOpen)}
        style={{ display: 'none' }}
      />

      {embeddedOnboardingOpen && (
        <EmbeddedModal title="Set up payments" onClose={handleEmbeddedExit}>
          <EmbeddedOnboarding onExit={handleEmbeddedExit} />
        </EmbeddedModal>
      )}

      {embeddedManagementOpen && (
        <EmbeddedModal title="Manage payments" onClose={() => setEmbeddedManagementOpen(false)}>
          <EmbeddedAccountManagement />
        </EmbeddedModal>
      )}
    </>
  );
}

// Full-screen overlay that hosts an embedded Connect component.
// Rendered via React Portal to document.body so it escapes the onboarding
// wizard's stacking context (the wizard is a modal too — without the
// portal, our modal mounts INSIDE its container and gets trapped).
// We mount the portal target inside a useEffect so SSR / test environments
// without a document don't crash, and so the portal target is consistent
// across re-renders (createPortal target switching can drop the child).
function EmbeddedModal({ title, children, onClose }) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    setTarget(document.body);
  }, []);

  const content = (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 100000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 16px', overflowY: 'auto' }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 12, padding: 0, width: '100%', maxWidth: 760, boxShadow: '0 12px 36px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--pn-border)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)' }}>{title}</div>
          <button onClick={onClose} type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: 'var(--pn-text-faint)', padding: 4, lineHeight: 1 }}>×</button>
        </div>
        <div style={{ padding: 14 }}>
          {children}
        </div>
      </div>
    </div>
  );

  if (!target) {
    // First render before useEffect fires — render inline so tests can
    // find the content, and so the user sees the modal immediately on
    // production (one extra synchronous render with inline content).
    return content;
  }
  return createPortal(content, target);
}

const inp = { boxSizing: 'border-box', padding: '7px 10px', fontSize: 13, border: '1px solid var(--pn-border-strong)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--pn-surface)' };
const btnPrimary = (disabled) => ({ padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: disabled ? '#cfc2e3' : '#5b3b8c', color: '#fff', cursor: disabled ? 'default' : 'pointer', fontFamily: 'inherit' });
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
