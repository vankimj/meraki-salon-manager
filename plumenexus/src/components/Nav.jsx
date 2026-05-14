import { useEffect, useState } from 'react';
import { C, FONT, grad } from '../theme.js';
import Logo from './Logo.jsx';

const LINKS = [
  { label: 'Features',  href: '#features' },
  { label: 'AI',        href: '#ai' },
  { label: 'Compare',   href: '#compare' },
  { label: 'Pricing',   href: '#pricing' },
  { label: 'FAQ',       href: '#faq' },
  { label: 'Contact',   href: '#contact' },
];

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen]         = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 60,
      background: scrolled ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.6)',
      backdropFilter: 'saturate(180%) blur(12px)',
      WebkitBackdropFilter: 'saturate(180%) blur(12px)',
      borderBottom: scrolled ? `1px solid ${C.rule}` : '1px solid transparent',
      transition: 'background .2s, border-color .2s',
    }}>
      <div style={{
        maxWidth: 1240, margin: '0 auto', padding: '14px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <a href="#top" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={32} />
          <span style={{ fontFamily: FONT.display, fontWeight: 700, letterSpacing: '.04em', fontSize: 17, color: C.ink }}>
            PLUME <span style={{ color: C.plum }}>NEXUS</span>
          </span>
        </a>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="pn-desktop">
          {LINKS.map(l => (
            <a key={l.href} href={l.href} style={{
              padding: '8px 14px', fontSize: 14, fontWeight: 500,
              color: C.text, textDecoration: 'none', borderRadius: 8,
              transition: 'background .15s',
            }}
              onMouseEnter={e => e.currentTarget.style.background = C.ruleSoft}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >{l.label}</a>
          ))}
          <a href="/signup" style={{
            marginLeft: 10, padding: '9px 16px', fontSize: 14, fontWeight: 600,
            color: C.plum, background: '#fff', border: `1px solid ${C.plum}`, borderRadius: 999,
            textDecoration: 'none',
          }}>Start free</a>
          <a href="#demo" style={{
            marginLeft: 6, padding: '9px 18px', fontSize: 14, fontWeight: 600,
            color: '#fff', background: grad.primary, borderRadius: 999,
            textDecoration: 'none', boxShadow: '0 4px 14px rgba(91,59,140,.35)',
          }}>Book a demo</a>
        </div>

        <button onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="pn-mobile-menu"
          className="pn-mobile-btn"
          style={{
            display: 'none', background: 'transparent', border: 'none',
            fontSize: 22, cursor: 'pointer', color: C.ink, padding: 6,
          }}
        >{open ? '✕' : '☰'}</button>
      </div>

      {open && (
        <div id="pn-mobile-menu" className="pn-mobile-menu" style={{
          borderTop: `1px solid ${C.rule}`, background: '#fff',
          padding: '8px 0',
        }}>
          {LINKS.map(l => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)} style={{
              display: 'block', padding: '12px 28px', fontSize: 15,
              color: C.text, textDecoration: 'none', borderBottom: `1px solid ${C.ruleSoft}`,
            }}>{l.label}</a>
          ))}
          <div style={{ padding: '14px 28px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <a href="/signup" onClick={() => setOpen(false)} style={{
              display: 'block', textAlign: 'center', padding: '11px 18px', fontSize: 15,
              fontWeight: 600, color: C.plum, background: '#fff',
              border: `1px solid ${C.plum}`, borderRadius: 999, textDecoration: 'none',
            }}>Start free</a>
            <a href="#demo" onClick={() => setOpen(false)} style={{
              display: 'block', textAlign: 'center', padding: '11px 18px', fontSize: 15,
              fontWeight: 600, color: '#fff', background: grad.primary, borderRadius: 999,
              textDecoration: 'none',
            }}>Book a demo</a>
          </div>
        </div>
      )}

      <style>{`
        @media (max-width: 880px) {
          .pn-desktop { display: none !important; }
          .pn-mobile-btn { display: block !important; }
        }
        @media (min-width: 881px) {
          .pn-mobile-menu { display: none !important; }
        }
      `}</style>
    </nav>
  );
}
