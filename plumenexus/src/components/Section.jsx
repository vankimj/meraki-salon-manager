import { C, FONT } from '../theme.js';

// Reusable section wrapper with consistent padding + header treatment.
export default function Section({ id, eyebrow, title, subtitle, children, dark, alt }) {
  const bg = dark
    ? `linear-gradient(180deg, ${C.ink}, ${C.inkSoft})`
    : alt ? C.bgSoft : '#fff';
  const titleColor = dark ? '#fff' : C.ink;
  const subtitleColor = dark ? 'rgba(255,255,255,.65)' : C.muted;

  return (
    <section id={id} style={{
      padding: '96px 28px',
      background: bg,
      color: dark ? '#fff' : C.text,
    }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        {(eyebrow || title) && (
          <div style={{ textAlign: 'center', maxWidth: 720, margin: '0 auto 56px' }}>
            {eyebrow && (
              <div style={{
                display: 'inline-block', padding: '5px 13px', borderRadius: 999,
                background: dark ? 'rgba(255,255,255,.08)' : 'rgba(106,79,160,.08)',
                color: dark ? 'rgba(255,255,255,.85)' : C.plum,
                border: dark ? '1px solid rgba(255,255,255,.14)' : '1px solid rgba(106,79,160,.18)',
                fontSize: 11, fontWeight: 600, letterSpacing: '.08em',
                textTransform: 'uppercase', marginBottom: 18,
              }}>
                {eyebrow}
              </div>
            )}
            {title && (
              <h2 style={{
                fontFamily: FONT.display,
                fontSize: 'clamp(28px, 3.6vw, 44px)',
                lineHeight: 1.15, letterSpacing: '-.005em',
                margin: '0 0 16px', color: titleColor, fontWeight: 600,
              }}>
                {title}
              </h2>
            )}
            {subtitle && (
              <p style={{
                fontSize: 'clamp(15px, 1.3vw, 18px)', lineHeight: 1.6,
                color: subtitleColor, margin: 0,
              }}>
                {subtitle}
              </p>
            )}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
