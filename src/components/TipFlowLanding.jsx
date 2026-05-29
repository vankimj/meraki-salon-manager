import { useState } from 'react';

const NAV_LINKS = ['Features', 'Pricing', 'Sign in'];

const FEATURES = [
  {
    icon: '📅',
    title: 'Smart Scheduling',
    desc: 'Day-view calendar with per-tech columns, walk-in slots, birthday banners, and overlay persistence. Your whole team at a glance.',
  },
  {
    icon: '💳',
    title: 'POS & Checkout',
    desc: 'Multi-tech revenue splits, promo codes, gift cards, store credit, tips, digital receipts, and instant Google review requests.',
  },
  {
    icon: '💅',
    title: 'TipFlow Kiosk',
    desc: 'Front-desk iPad display that lets clients tip via Venmo QR. Customizable slides with each tech\'s photo and social links.',
  },
  {
    icon: '📣',
    title: 'Marketing Campaigns',
    desc: 'Email and SMS campaigns with smart audience segments — lapsed clients, birthdays, top spenders. Built-in templates included.',
  },
  {
    icon: '💼',
    title: 'HR & Payroll',
    desc: 'Commission tracking, payroll runs, bonuses, 1099 generation, performance reviews, and direct Gusto integration.',
  },
  {
    icon: '🌐',
    title: 'Online Booking',
    desc: 'Public booking page, client check-in QR codes, and a white-labeled salon website with an AI chatbot — all included.',
  },
];

const PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 'Free',
    sub: '14-day Pro trial, no credit card',
    color: '#2D7A5F',
    features: [
      'Scheduling & appointments',
      'POS & checkout',
      'TipFlow kiosk',
      'Email receipts',
      'Client profiles',
      'Online booking page',
    ],
    cta: 'Start free trial',
  },
  {
    id: 'studio',
    name: 'Studio',
    price: '$29',
    sub: 'per month, cancel any time',
    color: '#3D9E8A',
    features: [
      'Everything in Starter',
      'Reports & analytics',
      'Earnings dashboard',
      'Gift cards & promos',
      'Retail inventory',
      'Attendance tracking',
    ],
    cta: 'Start free trial',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$49',
    sub: 'per month, cancel any time',
    color: '#3D95CE',
    recommended: true,
    features: [
      'Everything in Studio',
      'SMS + Email campaigns',
      'HR & payroll (Gusto)',
      'Membership subscriptions',
      'AI chatbot on your website',
      'Google review tracking',
      'Priority support',
    ],
    cta: 'Start free trial',
  },
];

const SOCIAL_PROOF = [
  'Nail studios', 'Hair salons', 'Lash bars', 'Wax studios', 'Massage spas',
];

export default function TipFlowLanding() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [email,    setEmail]    = useState('');

  function scrollTo(id) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  }

  function startTrial(e) {
    e.preventDefault();
    const dest = email.trim()
      ? `/?signup&email=${encodeURIComponent(email.trim())}`
      : '/?signup';
    window.location.href = dest;
  }

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', color: '#1a1a1a', background: '#fff', minHeight: '100dvh', overflowX: 'hidden' }}>

      {/* ── Nav ── */}
      <nav style={{ position: 'sticky', top: 0, zIndex: 100, background: 'rgba(15,25,35,.96)', backdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 24px', display: 'flex', alignItems: 'center', height: 60 }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>💅</div>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#fff', letterSpacing: '-.3px' }}>TipFlow</span>
          </div>

          {/* Desktop links */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 28 }} className="nav-desktop">
            <button onClick={() => scrollTo('features')} style={navLinkStyle}>Features</button>
            <button onClick={() => scrollTo('pricing')}  style={navLinkStyle}>Pricing</button>
            <a href="/" style={{ ...navLinkStyle, textDecoration: 'none' }}>Sign in</a>
            <a href="/?signup" style={{ padding: '8px 18px', borderRadius: 8, background: '#2D7A5F', color: '#fff', fontSize: 13, fontWeight: 700, textDecoration: 'none', letterSpacing: '-.1px' }}>
              Start free trial
            </a>
          </div>

          {/* Mobile hamburger */}
          <button onClick={() => setMenuOpen(v => !v)}
            style={{ display: 'none', background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', padding: 4 }}
            className="nav-mobile">
            {menuOpen ? '✕' : '☰'}
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div style={{ background: '#0f1923', borderTop: '1px solid rgba(255,255,255,.08)', padding: '16px 24px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <button onClick={() => scrollTo('features')} style={{ ...navLinkStyle, textAlign: 'left' }}>Features</button>
            <button onClick={() => scrollTo('pricing')}  style={{ ...navLinkStyle, textAlign: 'left' }}>Pricing</button>
            <a href="/" style={{ ...navLinkStyle, textDecoration: 'none' }}>Sign in</a>
            <a href="/?signup" style={{ padding: '11px 0', borderRadius: 8, background: '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 700, textDecoration: 'none', textAlign: 'center' }}>
              Start free trial
            </a>
          </div>
        )}
      </nav>

      {/* ── Hero ── */}
      <section style={{ background: 'linear-gradient(180deg,#0f1923 0%,#0f1923 60%,#f8f9fa 100%)', padding: '96px 24px 120px', textAlign: 'center' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(45,122,95,.15)', border: '1px solid rgba(45,122,95,.35)', borderRadius: 20, padding: '5px 14px', marginBottom: 28 }}>
            <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#2D7A5F' }} />
            <span style={{ fontSize: 12, color: '#3D9E8A', fontWeight: 600, letterSpacing: '.04em' }}>Now in open beta</span>
          </div>

          <h1 style={{ fontSize: 'clamp(36px,6vw,64px)', fontWeight: 800, color: '#fff', lineHeight: 1.1, letterSpacing: '-.02em', margin: '0 0 20px' }}>
            Run your salon<br />
            <span style={{ background: 'linear-gradient(90deg,#2D7A5F,#3D95CE)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              smarter.
            </span>
          </h1>

          <p style={{ fontSize: 'clamp(16px,2vw,20px)', color: 'rgba(255,255,255,.65)', lineHeight: 1.7, margin: '0 0 40px', maxWidth: 540, marginLeft: 'auto', marginRight: 'auto' }}>
            Scheduling, POS, payroll, marketing, and TipFlow kiosk — everything your nail studio or salon needs, in one place.
          </p>

          {/* Email CTA */}
          <form onSubmit={startTrial} style={{ display: 'flex', gap: 10, maxWidth: 440, margin: '0 auto 20px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com"
              style={{ flex: 1, minWidth: 200, padding: '13px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,.15)', background: 'rgba(255,255,255,.08)', color: '#fff', fontSize: 14, fontFamily: 'inherit', outline: 'none' }}
            />
            <button type="submit"
              style={{ padding: '13px 24px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              Start free trial →
            </button>
          </form>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', margin: 0 }}>Free for 30 days · No credit card required</p>

          {/* Social proof tags */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center', marginTop: 48 }}>
            {SOCIAL_PROOF.map(s => (
              <span key={s} style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '4px 12px' }}>{s}</span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" style={{ background: '#f8f9fa', padding: '80px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={sectionLabelStyle}>Everything you need</div>
            <h2 style={h2Style}>One platform, zero duct tape</h2>
            <p style={subStyle}>Stop juggling five different tools. TipFlow handles your whole operation from one screen.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 20 }}>
            {FEATURES.map(f => (
              <div key={f.title} style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 16, padding: '24px 24px 20px' }}>
                <div style={{ fontSize: 32, marginBottom: 14 }}>{f.icon}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>{f.title}</div>
                <div style={{ fontSize: 14, color: '#666', lineHeight: 1.7 }}>{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Feature highlight strip ── */}
      <section style={{ background: '#0f1923', padding: '72px 24px' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 32, textAlign: 'center' }}>
          {[
            { stat: '500+',  label: 'Client profiles supported'     },
            { stat: '10',    label: 'Techs on one schedule'          },
            { stat: '0',     label: 'Spreadsheets needed'            },
            { stat: '< 60s', label: 'Checkout time with TipFlow POS' },
          ].map(({ stat, label }) => (
            <div key={label}>
              <div style={{ fontSize: 'clamp(32px,4vw,48px)', fontWeight: 800, color: '#fff', letterSpacing: '-.02em', lineHeight: 1 }}>{stat}</div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,.5)', marginTop: 8, lineHeight: 1.5 }}>{label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <section style={{ background: '#fff', padding: '80px 24px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', textAlign: 'center' }}>
          <div style={sectionLabelStyle}>Getting started</div>
          <h2 style={h2Style}>Up and running in 60 seconds</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0, marginTop: 48, textAlign: 'left' }}>
            {[
              { n: '1', title: 'Create your salon',      desc: 'Enter your salon name and email. We provision your dedicated workspace instantly.' },
              { n: '2', title: 'Add your team',          desc: 'Invite staff via email or magic link. Set roles — admin, tech, scheduler, or read-only.' },
              { n: '3', title: 'Import your services',   desc: 'Add your service menu with prices and durations. Takes about 5 minutes.' },
              { n: '4', title: 'Go live',                desc: 'Share your booking URL, set up the TipFlow kiosk on your front-desk iPad, and you\'re done.' },
            ].map(({ n, title, desc }, i, arr) => (
              <div key={n} style={{ display: 'flex', gap: 20, position: 'relative' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{n}</div>
                  {i < arr.length - 1 && <div style={{ width: 2, flex: 1, background: '#e8e8e8', margin: '8px 0', minHeight: 32 }} />}
                </div>
                <div style={{ paddingBottom: i < arr.length - 1 ? 32 : 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 14, color: '#666', lineHeight: 1.7 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" style={{ background: '#f8f9fa', padding: '80px 24px' }}>
        <div style={{ maxWidth: 800, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={sectionLabelStyle}>Pricing</div>
            <h2 style={h2Style}>Simple, transparent pricing</h2>
            <p style={subStyle}>Start free. Upgrade when you're ready.</p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20, alignItems: 'start' }}>
            {PLANS.map(plan => (
              <div key={plan.id} style={{ position: 'relative', background: '#fff', border: `2px solid ${plan.recommended ? plan.color : '#e8e8e8'}`, borderRadius: 20, padding: '28px 28px 24px', boxShadow: plan.recommended ? '0 8px 40px rgba(61,149,206,.15)' : 'none' }}>
                {plan.recommended && (
                  <div style={{ position: 'absolute', top: -13, left: '50%', transform: 'translateX(-50%)', background: plan.color, color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 14px', borderRadius: 20, letterSpacing: '.06em', whiteSpace: 'nowrap' }}>
                    MOST POPULAR
                  </div>
                )}
                <div style={{ fontSize: 16, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{plan.name}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                  <span style={{ fontSize: 40, fontWeight: 800, color: plan.color, letterSpacing: '-.02em' }}>{plan.price}</span>
                  {plan.price !== 'Free' && <span style={{ fontSize: 14, color: '#aaa' }}>/mo</span>}
                </div>
                <div style={{ fontSize: 12, color: '#aaa', marginBottom: 24 }}>{plan.sub}</div>
                <ul style={{ margin: '0 0 28px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: '#333' }}>
                      <span style={{ color: plan.color, fontSize: 15, flexShrink: 0, marginTop: 1 }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <a href="/?signup"
                  style={{ display: 'block', textAlign: 'center', padding: '13px 0', borderRadius: 10, border: 'none', background: plan.recommended ? `linear-gradient(135deg,#2D7A5F,${plan.color})` : '#f0f0f0', color: plan.recommended ? '#fff' : '#555', fontSize: 14, fontWeight: 700, textDecoration: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {plan.cta} →
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section style={{ background: 'linear-gradient(135deg,#0f1923,#1a2d3d)', padding: '80px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(28px,4vw,40px)', fontWeight: 800, color: '#fff', letterSpacing: '-.02em', margin: '0 0 16px' }}>
            Ready to upgrade your salon?
          </h2>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,.6)', margin: '0 0 36px', lineHeight: 1.6 }}>
            Join salons already using TipFlow. Free for 30 days, no credit card required.
          </p>
          <a href="/?signup"
            style={{ display: 'inline-block', padding: '15px 40px', borderRadius: 12, background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', fontSize: 16, fontWeight: 700, textDecoration: 'none', letterSpacing: '-.1px' }}>
            Start free trial →
          </a>
          <div style={{ marginTop: 16, fontSize: 13, color: 'rgba(255,255,255,.3)' }}>
            Already have an account?{' '}
            <a href="/" style={{ color: 'rgba(255,255,255,.55)', textDecoration: 'underline' }}>Sign in</a>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer style={{ background: '#0a1118', padding: '32px 24px', borderTop: '1px solid rgba(255,255,255,.05)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}>💅</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.6)' }}>TipFlow</span>
          </div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.25)' }}>
            © {new Date().getFullYear()} TipFlow. Built with ❤️ for salons.
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <a href="/?signup" style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', textDecoration: 'none' }}>Sign up</a>
            <a href="/"        style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', textDecoration: 'none' }}>Sign in</a>
          </div>
        </div>
      </footer>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 640px) {
          .nav-desktop { display: none !important; }
          .nav-mobile  { display: block !important; }
        }
      `}</style>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────
const navLinkStyle = {
  background: 'none', border: 'none',
  color: 'rgba(255,255,255,.65)', fontSize: 14, cursor: 'pointer',
  fontFamily: 'inherit', padding: 0,
};

const sectionLabelStyle = {
  fontSize: 12, fontWeight: 700, color: '#2D7A5F',
  textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12,
};

const h2Style = {
  fontSize: 'clamp(26px,4vw,40px)', fontWeight: 800,
  color: '#1a1a1a', letterSpacing: '-.02em',
  margin: '0 0 14px', lineHeight: 1.15,
};

const subStyle = {
  fontSize: 16, color: '#666', lineHeight: 1.7,
  margin: 0, maxWidth: 480, marginLeft: 'auto', marginRight: 'auto',
};
