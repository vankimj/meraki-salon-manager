import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const createTenantFn = httpsCallable(functions, 'createTenantOnboarding');

const PLANS = [
  {
    id: 'solo',
    label: 'Solo',
    price: '$19 / month',
    features: ['Scheduling & online booking', 'POS, gift cards & promos', 'AI-powered reports', 'Clients & services'],
    color: '#2D7A5F',
  },
  {
    id: 'studio',
    label: 'Studio',
    price: '$49 / month',
    features: ['Everything in Solo', 'SMS + 2-way comms', 'Attendance & meetings', 'Retail inventory'],
    color: '#3D9E8A',
  },
  {
    id: 'salonPro',
    label: 'Salon Pro',
    price: '$149 / month',
    features: ['Everything in Studio', 'Marketing + loyalty', 'HR & payroll (Gusto)', 'Memberships', 'Unlimited staff'],
    color: '#3D95CE',
    recommended: true,
  },
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);
}

export default function OnboardingScreen() {
  const [step,       setStep]      = useState(1); // 1 = info, 2 = plan, 3 = done
  const [salonName,  setSalonName] = useState('');
  const [ownerName,  setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail]= useState('');
  const [plan,       setPlan]      = useState('salonPro');
  const [loading,    setLoading]   = useState(false);
  const [error,      setError]     = useState('');
  const [result,     setResult]    = useState(null); // { tenantId, url, salonName }

  const slug = slugify(salonName);

  async function handleSubmit() {
    setError('');
    setLoading(true);
    try {
      const { data } = await createTenantFn({ salonName, ownerName, ownerEmail, plan });
      setResult(data);
      setStep(3);
    } catch (e) {
      setError(e.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  const step1Valid = salonName.trim().length >= 2 && ownerEmail.includes('@');

  return (
    <div style={{ minHeight: '100dvh', background: '#0f1923', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', boxSizing: 'border-box' }}>
      {/* Logo */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 42, fontWeight: 300, color: '#fff', letterSpacing: 3, fontFamily: 'Georgia, serif' }}>TipFlow</div>
        <div style={{ fontSize: 11, color: '#3D9E8A', letterSpacing: 6, marginTop: 4 }}>SALON MANAGEMENT</div>
      </div>

      <div style={{ width: '100%', maxWidth: 480, background: 'var(--pn-surface)', borderRadius: 20, overflow: 'hidden', boxShadow: '0 8px 48px rgba(0,0,0,.35)' }}>
        {/* Progress bar */}
        {step < 3 && (
          <div style={{ height: 3, background: 'var(--pn-surface-alt)' }}>
            <div style={{ height: '100%', background: '#2D7A5F', width: step === 1 ? '33%' : '66%', transition: 'width .3s' }} />
          </div>
        )}

        <div style={{ padding: '32px 28px' }}>
          {/* ── Step 1: Salon info ── */}
          {step === 1 && (
            <>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>Set up your salon</div>
              <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 28 }}>Takes 60 seconds. No credit card required.</div>

              <Field label="Salon name" required>
                <input
                  value={salonName} onChange={e => setSalonName(e.target.value)}
                  placeholder="e.g. Luxe Nails Studio"
                  autoFocus
                  style={inputStyle}
                />
                {slug && (
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 5 }}>
                    Your URL: <span style={{ color: '#2D7A5F', fontWeight: 600 }}>{slug}.tipflow.app</span>
                  </div>
                )}
              </Field>

              <Field label="Your name">
                <input
                  value={ownerName} onChange={e => setOwnerName(e.target.value)}
                  placeholder="e.g. Sarah Johnson"
                  style={inputStyle}
                />
              </Field>

              <Field label="Email address" required>
                <input
                  type="email"
                  value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)}
                  placeholder="you@yoursalon.com"
                  style={inputStyle}
                />
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 5 }}>You'll sign in with this email via Google.</div>
              </Field>

              <button
                onClick={() => setStep(2)}
                disabled={!step1Valid}
                style={{ ...btnStyle, background: step1Valid ? '#2D7A5F' : '#ccc', cursor: step1Valid ? 'pointer' : 'default', marginTop: 8 }}
              >
                Continue →
              </button>
            </>
          )}

          {/* ── Step 2: Plan ── */}
          {step === 2 && (
            <>
              <button onClick={() => setStep(1)} style={backBtnStyle}>← Back</button>
              <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>Choose your plan</div>
              <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 24 }}>Every signup includes a 30-day Salon Pro trial — no credit card required. Switch plans any time.</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {PLANS.map(p => (
                  <div
                    key={p.id}
                    onClick={() => setPlan(p.id)}
                    style={{
                      border: `2px solid ${plan === p.id ? p.color : 'var(--pn-border)'}`,
                      borderRadius: 12,
                      padding: '16px 18px',
                      cursor: 'pointer',
                      position: 'relative',
                      background: plan === p.id ? `${p.color}08` : 'var(--pn-surface)',
                      transition: 'border-color .15s, background .15s',
                    }}
                  >
                    {p.recommended && (
                      <div style={{ position: 'absolute', top: -10, right: 14, background: p.color, color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 10px', borderRadius: 20, letterSpacing: 1 }}>RECOMMENDED</div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)' }}>{p.label}</span>
                      </div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: p.color }}>{p.price}</div>
                    </div>
                    <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.8 }}>
                      {p.features.map(f => <li key={f}>{f}</li>)}
                    </ul>
                    <div style={{ position: 'absolute', top: 16, right: 18 }}>
                      <div style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${plan === p.id ? p.color : 'var(--pn-border)'}`, background: plan === p.id ? p.color : 'var(--pn-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {plan === p.id && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#fff' }} />}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {error && <div style={{ background: 'var(--pn-danger-bg)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--pn-danger)', marginBottom: 16 }}>{error}</div>}

              <button
                onClick={handleSubmit}
                disabled={loading}
                style={{ ...btnStyle, background: loading ? '#aaa' : '#2D7A5F', cursor: loading ? 'default' : 'pointer' }}
              >
                {loading ? 'Creating your salon…' : 'Create my salon →'}
              </button>

              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 12 }}>
                By continuing you agree to our Terms of Service and Privacy Policy.
              </div>
            </>
          )}

          {/* ── Step 3: Confirmation ── */}
          {step === 3 && result && (
            <>
              <div style={{ textAlign: 'center', marginBottom: 24 }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>🎉</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6 }}>{result.salonName} is live!</div>
                <div style={{ fontSize: 13, color: 'var(--pn-text-muted)' }}>Check your email for setup instructions.</div>
              </div>

              <div style={{ background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 12, padding: '16px 20px', marginBottom: 24, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--pn-success)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Your TipFlow URL</div>
                <a href={result.url} style={{ fontSize: 18, color: '#2D7A5F', fontWeight: 700 }}>{result.url}</a>
              </div>

              <div style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)', marginBottom: 10 }}>Getting started</div>
                {[
                  ['1', 'Visit your URL and sign in with Google using ' + ownerEmail],
                  ['2', 'Add your employees under the Employees module'],
                  ['3', 'Set up your service menu'],
                  ['4', 'Configure your public booking page (Admin → Settings)'],
                  ['5', 'Customise your public website (Admin → Webfront)'],
                ].map(([n, text]) => (
                  <div key={n} style={{ display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' }}>
                    <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#2D7A5F', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{n}</div>
                    <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>{text}</div>
                  </div>
                ))}
              </div>

              <a
                href={result.url}
                style={{ ...btnStyle, display: 'block', textAlign: 'center', textDecoration: 'none', background: '#2D7A5F' }}
              >
                Open {result.salonName} →
              </a>
            </>
          )}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 20 }}>
        Already have an account?{' '}
        <a href="/" style={{ color: '#3D9E8A' }}>Sign in</a>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6 }}>
        {label}{required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  border: '1px solid var(--pn-border)', borderRadius: 10,
  padding: '10px 12px', fontSize: 14,
  fontFamily: 'inherit', outline: 'none',
  transition: 'border-color .15s',
};

const btnStyle = {
  width: '100%', padding: '13px',
  border: 'none', borderRadius: 10,
  fontSize: 15, fontWeight: 700,
  color: '#fff', fontFamily: 'inherit',
};

const backBtnStyle = {
  background: 'none', border: 'none',
  color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer',
  fontFamily: 'inherit', padding: '0 0 16px',
  display: 'block',
};
