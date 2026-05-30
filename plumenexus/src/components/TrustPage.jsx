import { C, FONT, grad, shadow, radius } from '../theme.js';
import Logo from './Logo.jsx';
import Footer from './Footer.jsx';

// /trust — the "under the hood" page. Honest, technical, but readable.
// Vendor names live here transparently; the rest of the site stays clean.
export default function TrustPage() {
  return (
    <>
      <header style={{
        position: 'sticky', top: 0, zIndex: 60,
        background: 'rgba(255,255,255,.95)',
        backdropFilter: 'saturate(180%) blur(12px)',
        WebkitBackdropFilter: 'saturate(180%) blur(12px)',
        borderBottom: `1px solid ${C.rule}`,
      }}>
        <div style={{
          maxWidth: 1240, margin: '0 auto', padding: '14px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <a href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
            <Logo size={30} />
            <span style={{ fontFamily: FONT.display, fontWeight: 700, letterSpacing: '.04em', fontSize: 16, color: C.ink }}>
              PLUME <span style={{ color: C.plum }}>NEXUS</span>
            </span>
          </a>
          <a href="/" style={{ fontSize: 13, color: C.muted, fontWeight: 500, textDecoration: 'none' }}>← Back to home</a>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section style={{
          padding: '80px 28px 56px',
          background: `radial-gradient(1100px 500px at 70% -20%, rgba(109,76,184,.1), transparent 60%),
                       radial-gradient(800px 400px at 0% 30%, rgba(61,149,206,.08), transparent 60%),
                       #fff`,
        }}>
          <div style={{ maxWidth: 880, margin: '0 auto', textAlign: 'center' }}>
            <div style={{
              display: 'inline-block', padding: '6px 14px', borderRadius: 999,
              background: 'rgba(91,59,140,.08)', border: '1px solid rgba(91,59,140,.18)',
              color: C.plumDeep, fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
              textTransform: 'uppercase', marginBottom: 22,
            }}>Trust & Architecture</div>
            <h1 style={{
              fontFamily: FONT.display, fontSize: 'clamp(32px, 4.5vw, 52px)',
              fontWeight: 600, letterSpacing: '-.005em', lineHeight: 1.1,
              margin: '0 0 18px', color: C.ink,
            }}>Built for the operators who ask the hard questions.</h1>
            <p style={{ fontSize: 17, lineHeight: 1.6, color: C.muted, margin: 0 }}>
              Sophisticated buyers want to know what's under the hood. Here's the honest
              answer — every layer, every integration, every commitment we make about your data.
            </p>
          </div>
        </section>

        {/* Architecture */}
        <Section eyebrow="Architecture" title="One platform, four layers.">
          <Grid cols={4}>
            <Layer icon="🌐" name="Frontend"
              tags={['React 19', 'PWA', 'iOS + Android (in dev)']}
              body="Modern web app, runs in any browser, installable to your home screen, offline-tolerant POS." />
            <Layer icon="⚡" name="Backend"
              tags={['Serverless', 'Auto-scaling', 'Multi-tenant']}
              body="Cloud functions on demand. Pay nothing when you're closed; scale instantly when you're slammed." />
            <Layer icon="🔒" name="Data layer"
              tags={['Encrypted at rest', 'TLS in transit', 'Per-tenant isolation']}
              body="Each salon's data is fully isolated by tenant ID. Cross-tenant access is structurally impossible." />
            <Layer icon="✨" name="AI layer"
              tags={['Server-side only', 'Read-only by default', 'Zero-retention']}
              body="AI calls happen on our backend, never in your browser. Reporting AI is read-only; action AI requires your confirmation before writing." />
          </Grid>
        </Section>

        {/* Security */}
        <Section eyebrow="Security" title="Defense in depth, on every layer." alt>
          <Grid cols={3}>
            <Card icon="🔐" title="Encryption everywhere"
              body="HTTPS/TLS 1.2+ in transit. AES-256 at rest. HSTS preload-eligible. No mixed-content. Your data is never exposed in the clear." />
            <Card icon="👤" title="Role-based access"
              body="Admin, scheduler, tech, read-only. View-as impersonation for support. Each role has the minimum permissions to do its job." />
            <Card icon="📜" title="Audit logs"
              body="Every privileged action — login, payment refund, role change, data export — is logged with who/what/when. Admin-readable." />
            <Card icon="🔢" title="PIN locks"
              body="Optional 4-digit PIN gates on HR + Reports modules. So a tech logged in to take payments can't accidentally open payroll." />
            <Card icon="📱" title="2FA for admins"
              body="Two-factor authentication on Salon Pro plans. Time-based one-time passwords (TOTP) via any standard authenticator app." />
            <Card icon="🚪" title="Session security"
              body="Configurable auto-logout on inactivity (default 5 min). Idle sessions invalidate; refresh tokens rotate." />
          </Grid>
        </Section>

        {/* Integrations */}
        <Section eyebrow="Integrations" title="The third parties we trust with your data.">
          <p style={{
            fontSize: 15, color: C.muted, lineHeight: 1.6,
            maxWidth: 720, margin: '-20px auto 36px',
            textAlign: 'center',
          }}>
            We deliberately don't build what someone else has already built better.
            Here's the list — every external service Plume Nexus uses, what it does,
            and what data it touches.{' '}
            <strong style={{ color: C.ink }}>You never see, sign into, or get bills from any of these.</strong>{' '}
            They run under the hood; the only platform you sign into is Plume Nexus.
          </p>
          <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Integration name="Stripe"      what="Payment processing"
              data="Card numbers (we never see them), receipts, payout history."
              note="Each tenant connects their own Stripe account. Funds settle directly to your bank." />
            <Integration name="Twilio"      what="SMS messaging"
              data="Phone numbers, message content for sent/received SMS."
              note="Dedicated phone number per tenant; separate marketing vs transactional numbers." />
            <Integration name="AWS SES"     what="Email delivery"
              data="Email addresses, message content for sent/received email, delivery status."
              note="Verified-domain sending with per-tenant reputation and suppression via SES Tenants." />
            <Integration name="Anthropic (Claude)"  what="AI features"
              data="Anonymized salon data passed in for the question being asked. Never trained on; never retained."
              note="Zero-retention agreement on our API traffic. Server-side calls only — no API key in your browser." />
            <Integration name="Gusto"       what="Payroll (optional)"
              data="Employee details, hours, pay rates — only for tenants who enable it."
              note="OAuth-based; you authorize each integration explicitly." />
            <Integration name="Google Cloud / Firebase" what="Hosting + database"
              data="Everything — application code, user data, session state, file uploads."
              note="SOC 2, ISO 27001, HIPAA-eligible infrastructure. Data stored in US-region by default." />
          </div>
        </Section>

        {/* Compliance */}
        <Section eyebrow="Compliance" title="The standards we hold ourselves to." alt>
          <Grid cols={2}>
            <Card icon="📧" title="CAN-SPAM compliant"
              body="One-click unsubscribe in every marketing email. Physical address in footer. Opt-out preferences honored across all sends. Permanent unsubscribe links (no expiry)." />
            <Card icon="📲" title="TCPA + STOP keyword"
              body="Marketing SMS uses a separate phone number from transactional. Reply STOP to instantly opt out of marketing — your appointment confirmations keep coming." />
            <Card icon="🌍" title="GDPR-ready"
              body="Data export anytime (CSV or JSON). Right-to-erasure honored within 30 days. Consent records logged. EU data residency available on request." />
            <Card icon="🩺" title="HIPAA-aware"
              body="PIN-locked sensitive modules, audited access logs, role-based permissions, allergy/health flags. Full BAA-eligible hosting available — talk to us if compliance is a hard requirement." />
          </Grid>
        </Section>

        {/* Data handling */}
        <Section eyebrow="Your data" title="Promises we put in writing.">
          <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['Data export is always free.',              'On every plan. On the Free Solo plan. For Founders\' Members. For paused accounts. For canceled accounts during the 90-day grace period. Forever. One click in Settings, full CSV + JSON of everything you own. If our service stops working for you, we will not hold your data hostage to slow you down.'],
              ['Even our founder cannot read your data.',  'Without your invitation, the Plume Nexus team cannot see a single one of your clients, appointments, receipts, or messages. The platform admin dashboard returns only metadata (your plan, billing, last login). If you ever want our help with something, you invite the founder as an admin via your own users settings — exactly the same way you\'d add any of your own staff. You can revoke access anytime. Most SaaS companies quietly keep god-mode access via "support impersonation." We don\'t.'],
              ['You own your data.',                       'Always. We process it on your behalf to operate the service. We never claim ownership.'],
              ['You can leave anytime.',                   'No exit fees. No "fill out this form." No 30-day waiting period. Cancel from Settings, export, done.'],
              ['We do not train AI on your data.',         'Our AI provider operates under a zero-retention agreement for API traffic. Your data is not used to improve any model.'],
              ['We do not sell or share your data.',       'Ever. Not to advertisers, not to "partners," not to data brokers. The only third parties that touch your data are the integrations listed above, and only to perform the service you signed up for.'],
              ['90-day deletion grace period.',            'If you cancel, we hold a backup copy for 90 days in case you change your mind. Then it\'s permanently deleted from primary and backup storage.'],
              ['No surprise outages.',                     'We aim for 99.9% uptime. Scheduled maintenance is announced 7+ days in advance via email and an in-app banner.'],
            ].map(([title, body]) => (
              <div key={title} style={{
                padding: 22, background: '#fff',
                border: `1px solid ${C.rule}`, borderRadius: radius.md,
                display: 'flex', gap: 16, alignItems: 'flex-start',
              }}>
                <span style={{ color: C.success, fontSize: 18, fontWeight: 700, flexShrink: 0 }}>✓</span>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 4 }}>{title}</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6, color: C.muted }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Final CTA */}
        <section style={{
          padding: '64px 28px 96px',
          background: `linear-gradient(180deg, #fff, ${C.bgSoft})`,
        }}>
          <div style={{
            maxWidth: 760, margin: '0 auto',
            padding: '36px 32px',
            background: '#0f1923',
            color: '#fff',
            borderRadius: radius.lg,
            textAlign: 'center',
          }}>
            <h3 style={{
              fontFamily: FONT.display, fontSize: 24, fontWeight: 600,
              margin: '0 0 12px', color: '#fff',
            }}>Have a security or compliance question we missed?</h3>
            <p style={{ fontSize: 15, color: 'rgba(255,255,255,.7)', margin: '0 0 22px' }}>
              The founder reviews every inbound security inquiry personally. Response within one business day.
            </p>
            <a href="/#contact" style={{
              display: 'inline-block', padding: '12px 26px', fontSize: 14, fontWeight: 600,
              color: '#0f1923', background: '#fff', borderRadius: 999,
              textDecoration: 'none',
            }}>Get in touch →</a>
          </div>
        </section>
      </main>

      <Footer />
    </>
  );
}

function Section({ eyebrow, title, children, alt }) {
  return (
    <section style={{
      padding: '72px 28px',
      background: alt ? C.bgSoft : '#fff',
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-block', padding: '4px 11px', borderRadius: 999,
            background: 'rgba(91,59,140,.08)', color: C.plum,
            fontSize: 11, fontWeight: 600, letterSpacing: '.08em',
            textTransform: 'uppercase', marginBottom: 12,
          }}>{eyebrow}</div>
          <h2 style={{
            fontFamily: FONT.display, fontSize: 'clamp(24px, 3vw, 34px)',
            fontWeight: 600, letterSpacing: '-.005em',
            margin: 0, color: C.ink,
          }}>{title}</h2>
        </div>
        {children}
      </div>
    </section>
  );
}

function Grid({ cols, children }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(auto-fit, minmax(${cols >= 4 ? 220 : cols === 3 ? 280 : 320}px, 1fr))`,
      gap: 16,
    }}>{children}</div>
  );
}

function Layer({ icon, name, tags, body }) {
  return (
    <div style={{
      padding: 22,
      background: '#fff',
      border: `1px solid ${C.rule}`,
      borderRadius: radius.md,
      transition: 'transform .18s, box-shadow .18s',
    }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = shadow.md; }}
      onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 11,
        background: `${C.plum}14`, color: C.plumDeep,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 20, marginBottom: 14,
      }}>{icon}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{name}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 12 }}>{body}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tags.map(t => (
          <span key={t} style={{
            fontSize: 10, padding: '2px 7px', borderRadius: 4,
            background: C.ruleSoft, color: C.muted, fontWeight: 600,
          }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function Card({ icon, title, body }) {
  return (
    <div style={{
      padding: 22,
      background: '#fff',
      border: `1px solid ${C.rule}`,
      borderRadius: radius.md,
    }}>
      <div style={{ fontSize: 24, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.6 }}>{body}</div>
    </div>
  );
}

function Integration({ name, what, data, note }) {
  return (
    <div style={{
      padding: '18px 22px',
      background: '#fff',
      border: `1px solid ${C.rule}`,
      borderRadius: radius.md,
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gap: 18,
      alignItems: 'flex-start',
    }} className="pn-integration-row">
      <div className="pn-integration-name">
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{name}</div>
        <div style={{ fontSize: 12, color: C.plum, fontWeight: 600, marginTop: 2 }}>{what}</div>
      </div>
      <div style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>
        <div style={{ marginBottom: 4 }}>
          <span style={{ color: C.mutedSoft, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>Data:</span>{' '}
          {data}
        </div>
        <div style={{ color: C.muted, fontSize: 12, fontStyle: 'italic' }}>{note}</div>
      </div>
      <style>{`
        @media (max-width: 640px) {
          .pn-integration-row  { grid-template-columns: 1fr !important; gap: 8px !important; }
        }
      `}</style>
    </div>
  );
}
