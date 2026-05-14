// Public self-serve signup. Renders at plumenexus.com/signup.
//
// Three states:
//   1. 'form'         — gathering inputs (signed-in or not)
//   2. 'provisioning' — provisionTenant in flight; show live status from
//                       provisioningJobs/{jobId}
//   3. 'done'         — success; redirect to {slug}.plumenexus.com
//
// Auth: Google sign-in upfront. Without it, the slug picker is still
// usable but submit is disabled. The signed-in user's email becomes the
// tenant's ownerEmail; their UID is captured server-side as provisionedBy.
//
// Anti-abuse: Google account (verified email) + REQUIRED Phone OTP
// (linked to the Google account via linkWithPhoneNumber) + invisible
// reCAPTCHA + per-phone duplicate check on the server + 3-per-hour IP
// rate limit + reserved-slug Firestore enforcement.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  auth, signInWithGoogle, signOutUser, watchAuth,
  checkSlugAvailability, callProvisionTenant, watchProvisioningJob,
} from '../lib/firebase';
import { RecaptchaVerifier, linkWithPhoneNumber, PhoneAuthProvider, linkWithCredential } from 'firebase/auth';
import { C, FONT, shadow, radius } from '../theme';
import Footer from './Footer.jsx';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

// Canonical pricing — must match plumenexus/src/components/Pricing.jsx so
// marketing page + signup page never show different numbers.
// Annual = 14% discount off monthly (matches GG's annual-vs-monthly delta
// so prospects comparing pricing pages see comparable structures). Math:
//   $49 mo → $42 annual ($504/yr); $79 mo → $68; $149 mo → $128.
const PLANS = [
  { id: 'solo',     name: 'Solo',      monthly: 49,  annual: 42,
    foundersFree: true,
    blurb: 'Single tech, single chair. Everything you need to run solo.' },
  { id: 'studio',   name: 'Studio',    monthly: 79,  annual: 68,
    blurb: 'Up to 8 staff. Multi-tech splits, walk-in management, custom domain.' },
  { id: 'salonPro', name: 'Salon Pro', monthly: 149, annual: 128,
    blurb: 'Unlimited staff. Founder-direct support + dedicated onboarding.' },
];

function priceTagline(plan, billing) {
  if (plan.foundersFree) return 'Free forever during Founders\' Year';
  const price = billing === 'annual' ? plan.annual : plan.monthly;
  const suffix = billing === 'annual' ? '/mo · billed annually' : '/mo · 30-day free trial';
  return `$${price}${suffix}`;
}

// Comparison rows. `section: true` makes the row a header. Power Packs
// bundle into tiers as the main value-escalation axis:
//   Solo:     core + all Packs as add-ons
//   Studio:   core+ + Comms Pack included; Marketing/AI/Operations still add-on
//   Salon Pro: everything in Studio + Marketing + AI + Operations included
//   Brand Pack stays a-la-carte at every tier (highly specialized).
//
// Security features (2FA, backups, encryption, audit log) are standard
// on every plan — surfaced as a footnote under the table, not a row,
// so the differentiators stay differentiating.
const COMPARE = [
  { section: 'Capacity' },
  { label: 'Staff members',                                       solo: '1',                          studio: 'Up to 8',                    salonPro: 'Unlimited' },
  { label: 'Locations',                                           solo: '1',                          studio: '1',                          salonPro: 'Unlimited' },

  { section: 'Core platform' },
  { label: 'Scheduling + online booking',                         solo: true,                         studio: true,                         salonPro: true },
  { label: 'POS, gift cards, promo codes',                        solo: true,                         studio: true,                         salonPro: true },
  { label: 'AI-powered Reports + tax dashboards',                 solo: true,                         studio: true,                         salonPro: true },
  { label: 'Email reminders + branded booking page',              solo: true,                         studio: true,                         salonPro: true },
  { label: 'Full data export (clients, appointments, receipts)',  solo: true,                         studio: true,                         salonPro: true },

  { section: 'Operations growth' },
  { label: 'Multi-tech credit splits',                            solo: false,                        studio: true,                         salonPro: true },
  { label: 'Smart walk-in queue management',                      solo: false,                        studio: true,                         salonPro: true },
  { label: 'Custom booking domain (book.yoursalon.com)',          solo: false,                        studio: true,                         salonPro: true },

  { section: 'Reach your clients · Power Packs' },
  { label: 'SMS reminders + 2-way (Comms Pack)',                  solo: '+$19/mo',                    studio: 'Included',                   salonPro: 'Included' },
  { label: 'Loyalty + auto-rebook + segments (Marketing Pack)',   solo: '+$19/mo',                    studio: '+$19/mo',                    salonPro: 'Included' },
  { label: 'Voice booking + AI marketing drafts (AI Pack)',       solo: '+$19/mo',                    studio: '+$19/mo',                    salonPro: 'Included' },

  { section: 'Advanced operations' },
  { label: 'Gusto payroll + 1099-NEC + multi-loc (Operations Pack)', solo: '+$29/mo',                 studio: '+$29/mo',                    salonPro: 'Included' },
  { label: 'White-label client app + branded kiosk (Brand Pack)', solo: '+$39/mo',                    studio: '+$39/mo',                    salonPro: '+$39/mo' },

  { section: 'Support' },
  { label: 'Email · 5-day SLA',                                   solo: true,                         studio: false,                        salonPro: false },
  { label: 'Priority email + chat',                               solo: false,                        studio: true,                         salonPro: false },
  { label: 'Founder-direct support',                              solo: false,                        studio: false,                        salonPro: true },
  { label: 'Dedicated onboarding session',                        solo: false,                        studio: false,                        salonPro: true },
];

function fmtPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function toE164(input) {
  const digits = String(input || '').replace(/\D/g, '');
  if (digits.length !== 10) return null;
  return `+1${digits}`;
}

function deriveSlug(salonName) {
  return String(salonName || '')
    .toLowerCase()
    .replace(/[^a-z0-9-\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

export default function SignupPage() {
  const [user, setUser] = useState(undefined); // undefined=loading, null=signed-out, object=signed-in
  useEffect(() => watchAuth(setUser), []);

  // Step state
  const [step, setStep]               = useState('form'); // 'form' | 'provisioning' | 'done'
  const [submitErr, setSubmitErr]     = useState('');

  // Form fields
  const [salonName, setSalonName]     = useState('');
  const [slug, setSlug]               = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [phone, setPhone]             = useState('');
  const [plan, setPlan]               = useState('solo');

  // Phone OTP state. Auto-marked verified if the signed-in user already
  // has a phone linked from a prior session — no re-verification needed.
  const [otpState, setOtpState]       = useState('idle'); // idle | sending | awaiting-code | verifying | verified | error
  const [otpCode, setOtpCode]         = useState('');
  const [otpError, setOtpError]       = useState('');
  const recaptcha                     = useRef(null);
  const otpConfirmation               = useRef(null);
  useEffect(() => {
    if (user?.phoneNumber) {
      setPhone(fmtPhone(user.phoneNumber.replace(/^\+1/, '')));
      setOtpState('verified');
    }
  }, [user?.phoneNumber]);
  // Annual default — better UX nudge + matches GG default. Persisted on
  // the tenant doc so Stripe wiring can pick the right price.
  const [billing, setBilling]         = useState('annual');

  // Slug availability state — debounced live check
  const [slugCheck, setSlugCheck] = useState({ state: 'idle' });
  const slugCheckTimer = useRef(null);

  // Provisioning job state — populated once submit fires
  const [jobId, setJobId] = useState(null);
  const [job, setJob]     = useState(null);
  useEffect(() => {
    if (!jobId) return undefined;
    return watchProvisioningJob(jobId, setJob);
  }, [jobId]);

  // Auto-derive slug from salon name until user manually edits the slug field
  useEffect(() => {
    if (slugTouched) return;
    setSlug(deriveSlug(salonName));
  }, [salonName, slugTouched]);

  // Debounced slug availability lookup
  useEffect(() => {
    if (slugCheckTimer.current) clearTimeout(slugCheckTimer.current);
    if (!slug) { setSlugCheck({ state: 'idle' }); return undefined; }
    if (!SLUG_RE.test(slug)) {
      setSlugCheck({ state: 'invalid' });
      return undefined;
    }
    setSlugCheck({ state: 'checking' });
    slugCheckTimer.current = setTimeout(async () => {
      try {
        const res = await checkSlugAvailability(slug);
        setSlugCheck(res.available
          ? { state: 'available' }
          : { state: 'taken', kind: res.kind });
      } catch (e) {
        setSlugCheck({ state: 'error', message: e?.message || String(e) });
      }
    }, 350);
    return () => clearTimeout(slugCheckTimer.current);
  }, [slug]);

  const formValid = useMemo(() => (
    user &&
    salonName.trim().length >= 2 &&
    SLUG_RE.test(slug) &&
    slugCheck.state === 'available' &&
    PLANS.some(p => p.id === plan) &&
    otpState === 'verified'
  ), [user, salonName, slug, slugCheck, plan, otpState]);

  async function sendOtp() {
    const e164 = toE164(phone);
    if (!e164) { setOtpError('Enter a 10-digit US phone number.'); setOtpState('error'); return; }
    if (!user) { setOtpError('Sign in first.'); setOtpState('error'); return; }
    setOtpError('');
    setOtpState('sending');
    try {
      if (!recaptcha.current) {
        recaptcha.current = new RecaptchaVerifier(auth, 'recaptcha-container', { size: 'invisible' });
      }
      otpConfirmation.current = await linkWithPhoneNumber(user, e164, recaptcha.current);
      setOtpState('awaiting-code');
    } catch (e) {
      console.error('[OTP send]', e.code, e.message);
      try { recaptcha.current?.clear(); } catch (_) {}
      recaptcha.current = null;
      if (e.code === 'auth/credential-already-in-use' || e.code === 'auth/account-exists-with-different-credential') {
        setOtpError('This phone number is linked to another account. Use a different number or sign in with that account.');
      } else if (e.code === 'auth/invalid-phone-number') {
        setOtpError('That number doesn\'t look right. Check the digits.');
      } else if (e.code === 'auth/too-many-requests') {
        setOtpError('Too many attempts. Try again in a few minutes.');
      } else if (e.code === 'auth/provider-already-linked') {
        setOtpError('Phone already verified on this account.');
        setOtpState('verified');
        return;
      } else {
        setOtpError(`Couldn't send code: ${e.message || 'try again'}`);
      }
      setOtpState('error');
    }
  }

  async function verifyOtp() {
    const code = otpCode.replace(/\D/g, '');
    if (code.length !== 6) { setOtpError('Enter the 6-digit code.'); return; }
    if (!otpConfirmation.current) return;
    setOtpError('');
    setOtpState('verifying');
    try {
      await otpConfirmation.current.confirm(code);
      // Force-refresh ID token so subsequent provisionTenant call sees
      // phone_number in the auth claims.
      await user.getIdToken(true);
      setOtpState('verified');
    } catch (e) {
      console.error('[OTP verify]', e.code, e.message);
      if (e.code === 'auth/invalid-verification-code') setOtpError('Wrong code. Try again.');
      else if (e.code === 'auth/code-expired')          setOtpError('Code expired. Tap "Send code" again.');
      else                                              setOtpError(`Couldn't verify: ${e.message || 'try again'}`);
      setOtpState('awaiting-code');
    }
  }

  async function handleSubmit() {
    if (!formValid || step !== 'form') return;
    setSubmitErr('');
    setStep('provisioning');
    try {
      const res = await callProvisionTenant({
        slug,
        salonName: salonName.trim(),
        ownerName: user?.displayName || '',
        ownerEmail: user?.email || '',
        ownerPhone: phone.replace(/\D/g, '') ? `+1${phone.replace(/\D/g, '')}` : '',
        plan,
        billing,
      });
      const data = res?.data || res;
      setJobId(data?.jobId);
      // Function returns synchronously when done, so we already have the URL
      if (data?.url) {
        setStep('done');
        // Brief pause so the user sees the success state before redirect
        setTimeout(() => { window.location.assign(data.url); }, 2500);
      }
    } catch (e) {
      setSubmitErr(e?.message || 'Something went wrong. Try again or contact support.');
      setStep('form');
    }
  }

  // Render switches on step
  if (step === 'provisioning') return <Provisioning job={job} />;
  if (step === 'done')         return <Done slug={slug} salonName={salonName} />;

  return (
    <div style={page}>
      <header style={header}>
        <a href="/" style={brandLink}>
          <BrandMark />
          <div style={brandText}>
            <div style={brandWord}>Plume Nexus</div>
            <div style={brandTag}>Salon Operating System</div>
          </div>
        </a>
        {user && (
          <button onClick={signOutUser} style={btnGhost}>Sign out</button>
        )}
      </header>

      <main style={main}>
        <h1 style={h1}>Start your salon</h1>
        <p style={lead}>Set up in under a minute. Your salon URL will be live the moment you click create.</p>

        <Section title="1 · Sign in">
          {user === undefined && <div style={muted}>Checking…</div>}
          {user === null && (
            <button onClick={signInWithGoogle} style={btnPrimary}>
              <GoogleIcon /> Continue with Google
            </button>
          )}
          {user && (
            <div style={signedInRow}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{user.displayName || user.email}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{user.email}</div>
              </div>
              <button onClick={signOutUser} style={btnGhostSmall}>Switch account</button>
            </div>
          )}
        </Section>

        <div style={formGrid}>
          <Section title="2 · Salon name">
            <input
              value={salonName}
              onChange={e => setSalonName(e.target.value.slice(0, 80))}
              placeholder="e.g. Glow Beauty Bar"
              style={input}
            />
          </Section>

          <Section title="3 · Phone verification *" hint="Required to prevent abuse. Standard SMS rates apply. Not shown to clients.">
            <PhoneVerify
              phone={phone}
              setPhone={setPhone}
              otpState={otpState}
              otpCode={otpCode}
              setOtpCode={setOtpCode}
              otpError={otpError}
              onSend={sendOtp}
              onVerify={verifyOtp}
              disabled={!user}
            />
          </Section>
        </div>

        <Section title="4 · Your salon URL" hint="Lowercase letters / numbers / hyphens. 3–30 chars.">
          <div style={slugRow}>
            <span style={slugProtocol}>https://</span>
            <input
              value={slug}
              onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase().slice(0, 30)); }}
              placeholder="your-salon"
              style={slugInput}
            />
            <span style={slugSuffix}>.plumenexus.com</span>
          </div>
          <SlugStatus state={slugCheck} />
        </Section>

        <Section title="5 · Plan">
          <BillingToggle billing={billing} onChange={setBilling} />
          <div style={planGrid}>
            {PLANS.map(p => (
              <PlanCard key={p.id} plan={p} billing={billing} selected={plan === p.id} onClick={() => setPlan(p.id)} />
            ))}
          </div>
          <PlanComparison selectedPlan={plan} />
        </Section>

        {submitErr && <div style={errBox}>{submitErr}</div>}

        <div style={{ marginTop: 24, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleSubmit} disabled={!formValid} style={{ ...btnPrimaryLg, opacity: formValid ? 1 : 0.4, cursor: formValid ? 'pointer' : 'not-allowed' }}>
            Create my salon →
          </button>
        </div>

        <p style={fineprint}>
          By creating a salon you agree to the <a href="/terms" style={link}>Terms of Service</a> and <a href="/privacy" style={link}>Privacy Policy</a>.
          Paid plans include a 30-day free trial; cancel anytime before then with no charge.
        </p>
      </main>

      {/* Invisible reCAPTCHA target — must be present in the DOM when
          linkWithPhoneNumber fires the verifier. Visibility: invisible
          challenge appears only when Firebase Auth flags suspicious
          traffic; legit users never see it. */}
      <div id="recaptcha-container" />

      <Footer />
    </div>
  );
}

function PhoneVerify({ phone, setPhone, otpState, otpCode, setOtpCode, otpError, onSend, onVerify, disabled }) {
  const verified = otpState === 'verified';
  const awaiting = otpState === 'awaiting-code' || otpState === 'verifying';
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <input
          value={phone}
          onChange={e => setPhone(fmtPhone(e.target.value))}
          placeholder="(555) 123-4567"
          style={{ ...input, flex: 1, opacity: verified ? 0.7 : 1 }}
          type="tel"
          inputMode="tel"
          disabled={verified || awaiting}
        />
        {!verified && (
          <button
            type="button"
            onClick={onSend}
            disabled={disabled || phone.replace(/\D/g, '').length !== 10 || otpState === 'sending'}
            style={{
              padding: '0 18px', fontSize: 13, fontWeight: 700, borderRadius: 8,
              border: `1px solid ${C.plum}`,
              background: '#fff', color: C.plum, cursor: 'pointer', fontFamily: 'inherit',
              opacity: (disabled || phone.replace(/\D/g, '').length !== 10) ? 0.4 : 1,
            }}>
            {otpState === 'sending' ? 'Sending…' : awaiting ? 'Resend' : 'Send code'}
          </button>
        )}
        {verified && (
          <span style={{
            padding: '10px 14px', fontSize: 13, fontWeight: 700, borderRadius: 8,
            background: '#ecfdf5', color: C.success, border: `1px solid #a7f3d0`,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>✓ Verified</span>
        )}
      </div>

      {awaiting && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'stretch' }}>
          <input
            value={otpCode}
            onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            style={{ ...input, flex: 1, fontFamily: 'monospace', letterSpacing: '.3em' }}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <button
            type="button"
            onClick={onVerify}
            disabled={otpCode.length !== 6 || otpState === 'verifying'}
            style={{
              padding: '0 18px', fontSize: 13, fontWeight: 700, borderRadius: 8,
              background: C.plum, color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              opacity: otpCode.length !== 6 ? 0.4 : 1,
            }}>
            {otpState === 'verifying' ? 'Verifying…' : 'Verify'}
          </button>
        </div>
      )}

      {otpError && <div style={{ marginTop: 8, fontSize: 12, color: C.danger, fontWeight: 600 }}>{otpError}</div>}
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section style={section}>
      <div style={sectionTitle}>{title}</div>
      <div>{children}</div>
      {hint && <div style={hintStyle}>{hint}</div>}
    </section>
  );
}

function SlugStatus({ state }) {
  if (state.state === 'idle')     return null;
  if (state.state === 'invalid')  return <div style={statusBad}>✗ Invalid format. Lowercase letters / numbers / hyphens, 3–30 chars, no leading/trailing hyphen.</div>;
  if (state.state === 'checking') return <div style={statusNeutral}>Checking availability…</div>;
  if (state.state === 'available') return <div style={statusOk}>✓ Available</div>;
  if (state.state === 'taken')    return <div style={statusBad}>✗ {state.kind === 'reserved' ? 'Reserved for the platform — pick another' : 'Already taken — pick another'}</div>;
  if (state.state === 'error')    return <div style={statusBad}>Check failed: {state.message}</div>;
  return null;
}

function PlanCard({ plan, billing, selected, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{
        textAlign: 'left',
        padding: '16px 18px',
        borderRadius: radius.md,
        border: `1.5px solid ${selected ? C.plum : C.rule}`,
        background: selected ? '#f5efff' : '#fff',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        fontFamily: 'inherit',
        transition: 'border-color .15s, background .15s',
      }}>
      <div style={{ fontFamily: FONT.display, fontWeight: 700, color: C.plumDeep, fontSize: 16, letterSpacing: '.04em', marginBottom: 4 }}>{plan.name}</div>
      <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, marginBottom: 8 }}>{priceTagline(plan, billing)}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>{plan.blurb}</div>
    </button>
  );
}

function BillingToggle({ billing, onChange }) {
  return (
    <div style={billingWrap}>
      <button
        type="button"
        onClick={() => onChange('monthly')}
        style={billing === 'monthly' ? billingPillActive : billingPill}>
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange('annual')}
        style={billing === 'annual' ? billingPillActive : billingPill}>
        Annual <span style={{ color: C.success, fontSize: 10, marginLeft: 4 }}>save 14%</span>
      </button>
    </div>
  );
}

// Comparison table — renders below the plan cards, highlights the chosen
// column so the salon owner can audit "what am I actually getting" at a
// glance before clicking Create.
function PlanComparison({ selectedPlan }) {
  function cellValue(row, key) {
    const v = row[key];
    if (v === true)  return <span style={cellCheck}>✓</span>;
    if (v === false) return <span style={cellDash}>—</span>;
    // 'Included' gets a green check + label for emphasis (it's the bundled-pack carrot)
    if (v === 'Included') return <span style={cellIncluded}>✓ Included</span>;
    return <span style={cellText}>{v}</span>;
  }
  let bodyIdx = 0;
  return (
    <div style={tableWrap}>
      <table style={table}>
        <thead>
          <tr>
            <th style={thLabel} />
            <th style={selectedPlan === 'solo'     ? thSelected : th}>Solo</th>
            <th style={selectedPlan === 'studio'   ? thSelected : th}>Studio</th>
            <th style={selectedPlan === 'salonPro' ? thSelected : th}>Salon Pro</th>
          </tr>
        </thead>
        <tbody>
          {COMPARE.map((row, i) => {
            if (row.section) {
              return (
                <tr key={`section-${i}`} style={trSection}>
                  <td colSpan={4} style={tdSection}>{row.section}</td>
                </tr>
              );
            }
            const isEven = bodyIdx++ % 2 === 0;
            return (
              <tr key={row.label} style={isEven ? trEven : trOdd}>
                <td style={tdLabel}>{row.label}</td>
                <td style={selectedPlan === 'solo'     ? tdSelected : td}>{cellValue(row, 'solo')}</td>
                <td style={selectedPlan === 'studio'   ? tdSelected : td}>{cellValue(row, 'studio')}</td>
                <td style={selectedPlan === 'salonPro' ? tdSelected : td}>{cellValue(row, 'salonPro')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={securityNote}>
        <strong>Standard on every plan</strong> · 2FA for admins · daily backups + 7-day point-in-time recovery · encryption at rest and in transit · audit logs · tenant data isolation
      </div>
    </div>
  );
}

const STEP_LABELS = {
  reserve_slug:   'Reserving your URL',
  seed_data:      'Setting up your salon',
  auth_domain:    'Configuring sign-in',
  welcome_email:  'Sending welcome email',
};

function Provisioning({ job }) {
  const steps = Object.entries(STEP_LABELS);
  return (
    <div style={page}>
      <main style={{ ...main, alignItems: 'center', textAlign: 'center', paddingTop: 80 }}>
        <BrandMark size={64} />
        <h2 style={{ ...h1, marginTop: 24 }}>Setting up your salon…</h2>
        <p style={lead}>This usually takes 5–10 seconds.</p>
        <div style={progressList}>
          {steps.map(([id, label]) => {
            const s = job?.steps?.[id];
            const isCurrent = job?.currentStep === id;
            return (
              <div key={id} style={progressRow}>
                <span style={{ width: 22, textAlign: 'center' }}>
                  {s?.ok === true  ? '✓'
                   : s?.ok === false ? '!'
                   : isCurrent       ? '…'
                   :                   '·'}
                </span>
                <span style={{ color: s?.ok === true ? C.success : isCurrent ? C.plum : C.mutedSoft }}>
                  {label}
                </span>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}

function Done({ slug, salonName }) {
  return (
    <div style={page}>
      <main style={{ ...main, alignItems: 'center', textAlign: 'center', paddingTop: 80 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🌸</div>
        <h2 style={h1}>{salonName} is ready</h2>
        <p style={lead}>Redirecting you to <strong>{slug}.plumenexus.com</strong> now…</p>
        <a href={`https://${slug}.plumenexus.com`} style={btnPrimaryLg}>Open my salon →</a>
      </main>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden style={{ verticalAlign: '-3px', marginRight: 8 }}>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.17-1.84H9v3.48h4.84a4.14 4.14 0 01-1.79 2.72v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.9-2.26c-.81.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.34A9 9 0 009 18z"/>
      <path fill="#FBBC05" d="M3.95 10.7A5.41 5.41 0 013.66 9c0-.59.1-1.16.29-1.7V4.96H.96A9 9 0 000 9c0 1.45.35 2.83.96 4.04l2.99-2.34z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A9 9 0 00.96 4.96L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z"/>
    </svg>
  );
}

function BrandMark({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g transform="translate(50 50)">
        {[0, 1, 2, 3, 4].map(i => (
          <ellipse key={i} cx="0" cy="-20" rx="14" ry="22" fill={C.plumSoft} opacity="0.85" transform={`rotate(${i * 72})`} />
        ))}
        <circle r="7" fill={C.gold} />
      </g>
    </svg>
  );
}

// ── Styles ────────────────────────────────────────────────────────────
const page = {
  minHeight: '100vh',
  background: '#fff',
  fontFamily: FONT.body,
  color: C.text,
  display: 'flex',
  flexDirection: 'column',
};
const header = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '20px 32px', borderBottom: `1px solid ${C.ruleSoft}`,
};
const brandLink = { display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: C.text };
const brandText = {};
const brandWord = { fontFamily: FONT.display, fontWeight: 700, fontSize: 18, letterSpacing: '.06em', color: C.plumDeep };
const brandTag  = { fontSize: 10, color: C.muted, letterSpacing: '.16em', textTransform: 'uppercase' };

const main = {
  maxWidth: 920, width: '100%', margin: '0 auto', padding: '48px 32px 64px', flex: 1,
};
const h1 = {
  fontFamily: FONT.display, fontWeight: 700, fontSize: 32, color: C.plumDeep,
  letterSpacing: '.02em', marginBottom: 10,
};
const lead = { fontSize: 15, lineHeight: 1.55, color: C.muted, marginBottom: 32 };
const section = { marginBottom: 22 };
// Two-column grid for short input pairs (e.g. salon name + phone). Stacks
// on narrow viewports where the grid would feel cramped.
const formGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '0 24px',
  marginBottom: 0,
};
const sectionTitle = {
  fontSize: 11, fontWeight: 700, color: C.plumDeep, letterSpacing: '.16em',
  textTransform: 'uppercase', marginBottom: 10,
};
const hintStyle = { marginTop: 6, fontSize: 11, color: C.mutedSoft };

const input = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 14px', fontSize: 14, border: `1px solid ${C.rule}`,
  borderRadius: radius.sm, fontFamily: 'inherit', outline: 'none', background: '#fff',
};
const slugRow = {
  display: 'flex', alignItems: 'stretch', border: `1px solid ${C.rule}`,
  borderRadius: radius.sm, overflow: 'hidden', background: '#fff',
};
const slugProtocol = { padding: '11px 12px', fontSize: 13, color: C.muted, background: C.bgSoft, borderRight: `1px solid ${C.rule}` };
const slugSuffix   = { padding: '11px 12px', fontSize: 13, color: C.muted, background: C.bgSoft, borderLeft: `1px solid ${C.rule}` };
const slugInput    = { flex: 1, border: 'none', padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none' };

const statusOk      = { marginTop: 6, fontSize: 12, color: C.success, fontWeight: 600 };
const statusBad     = { marginTop: 6, fontSize: 12, color: C.danger, fontWeight: 600 };
const statusNeutral = { marginTop: 6, fontSize: 12, color: C.muted };

const planGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 };

const billingWrap = {
  display: 'inline-flex',
  gap: 0,
  padding: 4,
  background: C.bgSoft,
  border: `1px solid ${C.rule}`,
  borderRadius: 999,
  marginBottom: 16,
};
const billingPill = {
  padding: '7px 16px',
  fontSize: 12,
  fontWeight: 600,
  background: 'transparent',
  color: C.muted,
  border: 'none',
  borderRadius: 999,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const billingPillActive = {
  ...billingPill,
  background: '#fff',
  color: C.plumDeep,
  boxShadow: '0 1px 4px rgba(15,25,35,.08)',
};


const tableWrap = { marginTop: 18, border: `1px solid ${C.rule}`, borderRadius: radius.md, overflow: 'hidden' };
const table     = { width: '100%', borderCollapse: 'collapse', fontSize: 12 };
const th        = { padding: '10px 8px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: C.muted, letterSpacing: '.12em', textTransform: 'uppercase', background: '#fafafa', borderBottom: `1px solid ${C.rule}` };
const thSelected = { ...th, background: '#f5efff', color: C.plumDeep, borderBottom: `2px solid ${C.plum}` };
const thLabel    = { ...th, textAlign: 'left', paddingLeft: 14 };
const td         = { padding: '8px 8px', textAlign: 'center', verticalAlign: 'middle', color: C.text };
const tdSelected = { ...td, background: 'rgba(91,59,140,.06)', borderLeft: `1px solid ${C.plumSoft}`, borderRight: `1px solid ${C.plumSoft}` };
const tdLabel    = { padding: '8px 14px', textAlign: 'left', fontSize: 12, color: C.muted, fontWeight: 500 };
const trEven     = { background: '#fff' };
const trOdd      = { background: '#fbfaff' };
const trSection  = { background: '#f3effa' };
const tdSection  = { padding: '8px 14px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: C.plumDeep, letterSpacing: '.14em', textTransform: 'uppercase' };
const cellCheck  = { color: C.success, fontWeight: 700, fontSize: 13 };
const cellDash   = { color: C.mutedSoft, fontSize: 13 };
const cellText   = { color: C.text, fontSize: 11 };
const cellIncluded = { color: C.success, fontWeight: 700, fontSize: 11 };
const securityNote = { padding: '10px 14px', fontSize: 11, color: C.muted, background: '#fafafa', borderTop: `1px solid ${C.rule}`, lineHeight: 1.55 };


const signedInRow = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '12px 16px', background: C.bgSoft, borderRadius: radius.sm,
  border: `1px solid ${C.ruleSoft}`,
};

const btnBase = {
  padding: '11px 20px', fontSize: 14, fontWeight: 700, borderRadius: 999,
  border: 'none', fontFamily: 'inherit', cursor: 'pointer',
};
const btnPrimary    = { ...btnBase, background: C.plum,  color: '#fff', boxShadow: shadow.brand };
const btnPrimaryLg  = { ...btnBase, background: C.plum,  color: '#fff', padding: '14px 28px', fontSize: 15, textDecoration: 'none', display: 'inline-block', boxShadow: shadow.brand };
const btnGhost      = { ...btnBase, background: '#fff', color: C.plum, border: `1px solid ${C.rule}` };
const btnGhostSmall = { padding: '7px 12px', fontSize: 12, fontWeight: 600, borderRadius: 999, border: `1px solid ${C.rule}`, background: '#fff', color: C.muted, cursor: 'pointer', fontFamily: 'inherit' };

const errBox = {
  marginTop: 18, padding: '12px 16px', background: '#fef2f2',
  border: '1px solid #fca5a5', borderRadius: radius.sm, color: '#7f1d1d', fontSize: 13,
};
const muted = { fontSize: 13, color: C.muted };
const link  = { color: C.plum, textDecoration: 'underline' };
const fineprint = { fontSize: 11, color: C.mutedSoft, lineHeight: 1.55, marginTop: 18 };

const progressList = {
  marginTop: 32, padding: '20px 28px', background: C.bgSoft,
  border: `1px solid ${C.ruleSoft}`, borderRadius: radius.md,
  textAlign: 'left', width: '100%', maxWidth: 360,
};
const progressRow = { display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0', fontSize: 13 };
