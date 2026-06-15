import { C, FONT } from '../theme.js';
import Logo from './Logo.jsx';

export default function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer style={{
      background: '#0f1923',
      color: 'rgba(255,255,255,.7)',
      padding: '64px 28px 32px',
    }}>
      <div style={{
        maxWidth: 1180, margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1.5fr 1fr 1fr 1fr',
        gap: 48,
      }} className="pn-footer-grid">

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Logo size={36} />
            <span style={{ fontFamily: FONT.display, fontWeight: 700, letterSpacing: '.04em', fontSize: 18, color: '#fff' }}>
              PLUME <span style={{ color: '#8b6fc4' }}>NEXUS</span>
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 320, color: 'rgba(255,255,255,.6)' }}>
            The salon platform built by salon owners. One operating system for scheduling, POS, marketing, and AI-powered reporting.
          </div>
        </div>

        <FooterCol title="Product" links={[
          ['Features', '#features'],
          ['AI', '#ai'],
          ['Pricing', '#pricing'],
          ['vs Competitors', '#compare'],
        ]} />

        <FooterCol title="Company" links={[
          ['Contact', '#contact'],
          ['FAQ', '#faq'],
          ['Trust & Architecture', '/trust'],
          ['Built by Plume Nexus LLC', null],
        ]} />

        <FooterCol title="Legal" links={[
          ['Terms of Service', '/terms'],
          ['Privacy Policy', '/privacy'],
          ['SMS Terms', '/sms-consent'],
        ]} />
      </div>

      <div style={{
        maxWidth: 1180, margin: '48px auto 0',
        paddingTop: 24, borderTop: '1px solid rgba(255,255,255,.08)',
        display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center',
        gap: 12, fontSize: 12, color: 'rgba(255,255,255,.4)',
      }}>
        <div>© {year} Plume Nexus LLC</div>
        <div>Columbus, Ohio · Built with care.</div>
      </div>

      <style>{`
        @media (max-width: 820px) {
          .pn-footer-grid { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 540px) {
          .pn-footer-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </footer>
  );
}

function FooterCol({ title, links }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
        textTransform: 'uppercase', color: '#fff',
        marginBottom: 14,
      }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {links.map(([label, href]) => (
          href ? (
            <a key={label} href={href} style={{
              fontSize: 14, color: 'rgba(255,255,255,.6)',
              textDecoration: 'none',
              transition: 'color .12s',
            }}
              onMouseEnter={e => e.currentTarget.style.color = '#fff'}
              onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.6)'}
            >{label}</a>
          ) : (
            <span key={label} style={{ fontSize: 14, color: 'rgba(255,255,255,.4)' }}>{label}</span>
          )
        ))}
      </div>
    </div>
  );
}
