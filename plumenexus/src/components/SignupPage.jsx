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
// Anti-abuse layer one (v1): Google account (verified email) + IP rate
// limit on the Cloud Function (3/hr) + reserved-slug list at the
// orchestrator's transaction layer. Phone OTP via Firebase Auth's phone
// provider + reCAPTCHA + per-phone duplicate check are Sprint 3b adds.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  auth, signInWithGoogle, signOutUser, watchAuth,
  checkSlugAvailability, callProvisionTenant, watchProvisioningJob,
} from '../lib/firebase';
import { C, FONT, shadow, radius } from '../theme';
import Footer from './Footer.jsx';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;

const PLANS = [
  { id: 'solo',     name: 'Solo',     tagline: 'Free forever during Founders\' Year',  blurb: 'Single tech, single location. Booking + clients + receipts.' },
  { id: 'studio',   name: 'Studio',   tagline: '$39/mo · 30-day free trial',             blurb: 'Multi-tech, multi-employee scheduling, marketing, AI Reports.' },
  { id: 'salonPro', name: 'Salon Pro', tagline: '$89/mo · 30-day free trial',             blurb: 'Everything in Studio + payroll, multi-location, custom domain.' },
];

function fmtPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
    PLANS.some(p => p.id === plan)
  ), [user, salonName, slug, slugCheck, plan]);

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

        <Section title="2 · Salon name">
          <input
            value={salonName}
            onChange={e => setSalonName(e.target.value.slice(0, 80))}
            placeholder="e.g. Glow Beauty Bar"
            style={input}
          />
        </Section>

        <Section title="3 · Your salon URL" hint="Lowercase letters / numbers / hyphens. 3–30 chars.">
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

        <Section title="4 · Phone (optional)" hint="For account recovery + critical service alerts. Not shown to clients.">
          <input
            value={phone}
            onChange={e => setPhone(fmtPhone(e.target.value))}
            placeholder="(555) 123-4567"
            style={input}
            type="tel"
            inputMode="tel"
          />
        </Section>

        <Section title="5 · Plan">
          <div style={planGrid}>
            {PLANS.map(p => (
              <PlanCard key={p.id} plan={p} selected={plan === p.id} onClick={() => setPlan(p.id)} />
            ))}
          </div>
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

      <Footer />
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

function PlanCard({ plan, selected, onClick, disabled }) {
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
      <div style={{ fontSize: 12, color: C.gold, fontWeight: 600, marginBottom: 8 }}>{plan.tagline}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>{plan.blurb}</div>
    </button>
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
  maxWidth: 560, width: '100%', margin: '0 auto', padding: '48px 32px 64px', flex: 1,
};
const h1 = {
  fontFamily: FONT.display, fontWeight: 700, fontSize: 32, color: C.plumDeep,
  letterSpacing: '.02em', marginBottom: 10,
};
const lead = { fontSize: 15, lineHeight: 1.55, color: C.muted, marginBottom: 32 };
const section = { marginBottom: 22 };
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
