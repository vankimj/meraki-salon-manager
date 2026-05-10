import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

export default function Splash() {
  const { settings } = useApp();
  const [fading, setFading] = useState(false);
  const [gone,   setGone]   = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2600);
    const t2 = setTimeout(() => setGone(true),   3300);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (gone) return null;

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 100,
      background: '#0f1923',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      gap: 0,
      opacity: fading ? 0 : 1,
      transition: 'opacity .7s ease',
      pointerEvents: fading ? 'none' : 'auto',
    }}>

      {/* Ambient gradient glow behind logo */}
      <div style={{
        position: 'absolute',
        width: 520, height: 520,
        borderRadius: '50%',
        background: 'radial-gradient(ellipse, rgba(45,122,95,.28) 0%, rgba(61,149,206,.14) 50%, transparent 72%)',
        pointerEvents: 'none',
      }} />

      {/* ── Logo plate ── */}
      <div style={{
        position: 'relative',
        width: 380, height: 280,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>

        {/* Corner flourish SVG — full plate size */}
        <svg viewBox="0 0 380 280" fill="none" xmlns="http://www.w3.org/2000/svg"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>

          {/* ── Top-left corner ornament ── */}
          <g opacity="0.5" stroke="white" strokeLinecap="round" fill="none">
            <path d="M 30 30 Q 20 20 30 10 Q 40 20 30 30 Z" strokeWidth="0.8" opacity="0.6"/>
            <path d="M 30 30 Q 15 35 8 28" strokeWidth="1"/>
            <path d="M 30 30 Q 35 15 28 8" strokeWidth="1"/>
            <circle cx="9" cy="10" r="1.5" fill="white" opacity="0.5"/>
            <path d="M 9 10 Q 4 6 6 2" strokeWidth="0.7"/>
          </g>

          {/* ── Top-right corner ornament ── */}
          <g opacity="0.5" stroke="white" strokeLinecap="round" fill="none">
            <path d="M 350 30 Q 360 20 350 10 Q 340 20 350 30 Z" strokeWidth="0.8" opacity="0.6"/>
            <path d="M 350 30 Q 365 35 372 28" strokeWidth="1"/>
            <path d="M 350 30 Q 345 15 352 8" strokeWidth="1"/>
            <circle cx="371" cy="10" r="1.5" fill="white" opacity="0.5"/>
            <path d="M 371 10 Q 376 6 374 2" strokeWidth="0.7"/>
          </g>

          {/* ── Bottom-left corner ornament ── */}
          <g opacity="0.5" stroke="white" strokeLinecap="round" fill="none">
            <path d="M 30 250 Q 15 245 8 252" strokeWidth="1"/>
            <path d="M 30 250 Q 35 265 28 272" strokeWidth="1"/>
            <circle cx="9" cy="270" r="1.5" fill="white" opacity="0.5"/>
            <path d="M 9 270 Q 4 274 6 278" strokeWidth="0.7"/>
          </g>

          {/* ── Bottom-right corner ornament ── */}
          <g opacity="0.5" stroke="white" strokeLinecap="round" fill="none">
            <path d="M 350 250 Q 365 245 372 252" strokeWidth="1"/>
            <path d="M 350 250 Q 345 265 352 272" strokeWidth="1"/>
            <circle cx="371" cy="270" r="1.5" fill="white" opacity="0.5"/>
            <path d="M 371 270 Q 376 274 374 278" strokeWidth="0.7"/>
          </g>

          {/* ── Left wing flourish ── */}
          <g opacity="0.55" stroke="white" fill="none" strokeLinecap="round">
            {/* Main sweeping arm */}
            <path d="M 80 148 Q 55 140 36 148 Q 22 154 18 148 Q 22 142 36 148" strokeWidth="1.3"/>
            {/* Upper feather */}
            <path d="M 60 148 Q 52 136 44 138" strokeWidth="1"/>
            {/* Lower feather */}
            <path d="M 60 148 Q 52 160 44 158" strokeWidth="1"/>
            {/* Tip curls */}
            <path d="M 18 148 Q 10 144 12 138" strokeWidth="0.8" opacity="0.7"/>
            <path d="M 18 148 Q 10 152 12 158" strokeWidth="0.8" opacity="0.7"/>
          </g>

          {/* ── Right wing flourish (mirrored) ── */}
          <g opacity="0.55" stroke="white" fill="none" strokeLinecap="round">
            <path d="M 300 148 Q 325 140 344 148 Q 358 154 362 148 Q 358 142 344 148" strokeWidth="1.3"/>
            <path d="M 320 148 Q 328 136 336 138" strokeWidth="1"/>
            <path d="M 320 148 Q 328 160 336 158" strokeWidth="1"/>
            <path d="M 362 148 Q 370 144 368 138" strokeWidth="0.8" opacity="0.7"/>
            <path d="M 362 148 Q 370 152 368 158" strokeWidth="0.8" opacity="0.7"/>
          </g>

          {/* ── Decorative rule under script ── */}
          {/* Left half */}
          <path d="M 190 185 Q 155 178 120 182 Q 100 184 88 180" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5"/>
          {/* Right half */}
          <path d="M 190 185 Q 225 178 260 182 Q 280 184 292 180" stroke="white" strokeWidth="1.2" fill="none" strokeLinecap="round" opacity="0.5"/>
          {/* Center diamond */}
          <rect x="186" y="181" width="8" height="8" rx="1" fill="white" opacity="0.45" transform="rotate(45 190 185)"/>

          {/* ── Small sparkles ── */}
          <g fill="white">
            <circle cx="75"  cy="100" r="1.5" opacity="0.4"/>
            <circle cx="305" cy="100" r="1.5" opacity="0.4"/>
            <circle cx="65"  cy="185" r="1"   opacity="0.3"/>
            <circle cx="315" cy="185" r="1"   opacity="0.3"/>
          </g>
          {/* 4-point star accents */}
          <g stroke="white" strokeLinecap="round" opacity="0.4">
            <line x1="68" y1="68" x2="68" y2="76" strokeWidth="1.2"/>
            <line x1="64" y1="72" x2="72" y2="72" strokeWidth="1.2"/>
            <line x1="312" y1="68" x2="312" y2="76" strokeWidth="1.2"/>
            <line x1="308" y1="72" x2="316" y2="72" strokeWidth="1.2"/>
          </g>

        </svg>

        {/* ── Text stack (on top of SVG) ── */}
        <div style={{ position: 'relative', textAlign: 'center', userSelect: 'none' }}>

          {/* Brand tagline above name — only render if explicitly configured (default omits it) */}
          {settings?.brandTaglineTop && (
            <div style={{
              fontFamily: '"Great Vibes", cursive',
              fontSize: 30,
              color: 'rgba(255,255,255,0.75)',
              lineHeight: 1,
              marginBottom: -4,
              letterSpacing: '0.02em',
            }}>
              {settings.brandTaglineTop}
            </div>
          )}

          {/* Brand name */}
          <div style={{
            fontFamily: '"Great Vibes", cursive',
            fontSize: 88,
            color: '#ffffff',
            lineHeight: 0.95,
            textShadow: '0 2px 24px rgba(45,122,95,.5), 0 0 48px rgba(61,149,206,.3)',
            letterSpacing: '0.01em',
          }}>
            {settings?.brandName || settings?.salonName || 'Plume Nexus'}
          </div>

          {settings?.brandTagline && (
            <>
              <div style={{ height: 14 }} />
              {/* Brand tagline below name — only renders when the tenant has set one. */}
              <div style={{
                fontFamily: '"Cinzel", serif',
                fontSize: 13,
                fontWeight: 600,
                color: 'rgba(255,255,255,0.82)',
                letterSpacing: '0.32em',
                textTransform: 'uppercase',
              }}>
                {settings.brandTagline}
              </div>
            </>
          )}

        </div>
      </div>

      {/* ── Bottom subtitle ── */}
      <div style={{
        marginTop: 28,
        fontFamily: '"Cinzel", serif',
        fontSize: 10,
        fontWeight: 400,
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: '0.22em',
        textTransform: 'uppercase',
        userSelect: 'none',
      }}>
        Salon Manager
      </div>

    </div>
  );
}
