import { useEffect, useState } from 'react';
import { C, FONT, EASE, DUR } from '../theme.js';

// Slim sticky bar that fades in once the user has scrolled past the Hero.
// Hides itself near the very bottom of the page so it doesn't sit on top of
// the Footer, and stays out of the way of the chat widget.
export default function StickyCTA() {
  const [visible, setVisible]   = useState(false);
  const [dismissed, setDismiss] = useState(false);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const docH = document.documentElement.scrollHeight;
      const winH = window.innerHeight;
      const nearBottom = y + winH > docH - 600;
      // Show after ~1 viewport scroll, hide near bottom (footer/contact territory)
      setVisible(y > winH * 0.9 && !nearBottom);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="complementary"
      aria-label="Quick demo CTA"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 24,
        transform: visible ? 'translate(-50%, 0)' : 'translate(-50%, 120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform .35s cubic-bezier(.34, 1.4, .64, 1), opacity .25s',
        zIndex: 70,
        pointerEvents: visible ? 'auto' : 'none',
        maxWidth: 'calc(100vw - 100px)',
      }}
      className="pn-sticky-cta"
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '12px 16px 12px 22px',
        background: C.ink,
        color: C.bg,
        borderRadius: 999,
        boxShadow: '0 18px 48px rgba(26,20,16,.32), 0 4px 12px rgba(26,20,16,.18)',
        border: `1px solid ${C.goldDeep}66`,
      }}>
        <div style={{
          fontSize: 13, fontWeight: 400, lineHeight: 1.4,
          fontFamily: FONT.display,
          fontStyle: 'italic',
          letterSpacing: '0.01em',
        }} className="pn-sticky-copy">
          A 20-minute walkthrough,
          <span style={{ color: C.gold, marginLeft: 6 }}>with the founder.</span>
        </div>
        <a href="#demo" style={{
          padding: '8px 18px', fontSize: 12, fontWeight: 600,
          color: C.ink, background: C.bg, borderRadius: 999,
          textDecoration: 'none', whiteSpace: 'nowrap',
          letterSpacing: '0.04em',
          transition: `transform ${DUR.fast} ${EASE}`,
        }}
          onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-1px)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
        >Begin →</a>
        <button
          onClick={() => setDismiss(true)}
          aria-label="Dismiss demo prompt"
          style={{
            background: 'transparent', border: 'none',
            color: 'rgba(255,255,255,.5)',
            fontSize: 16, cursor: 'pointer', padding: '4px 6px',
            transition: 'color .12s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,.5)'}
        >×</button>
      </div>

      <style>{`
        @media (max-width: 540px) {
          .pn-sticky-copy { display: none; }
          .pn-sticky-cta  { left: 16px !important; transform: ${visible ? 'translateX(0)' : 'translateX(-130%)'} !important; }
        }
      `}</style>
    </div>
  );
}
