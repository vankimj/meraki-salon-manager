// Friendly empty-state card. Use anywhere a list could be blank for a
// fresh tenant. Three slots: an emoji `icon`, a `title` (one short
// sentence), and a `description` (a sentence or two of plain English).
// Pass any number of `actions` (label + onClick) — the first is the
// primary CTA and gets the brand gradient; the rest are secondary.
//
// Goal: replace "No clients yet." plain-text empty lists with something
// that explains what the module is for and what to do next.
export default function EmptyState({ icon = '✨', title, description, actions = [], compact = false }) {
  return (
    <div style={{
      textAlign: 'center',
      padding: compact ? '24px 20px' : '40px 24px',
      background: 'var(--pn-surface)',
      border: '1px solid var(--pn-border)',
      borderRadius: 14,
      maxWidth: 460,
      margin: '0 auto',
    }}>
      <div style={{ fontSize: compact ? 30 : 40, marginBottom: compact ? 8 : 12, opacity: 0.9 }}>{icon}</div>
      {title && (
        <div style={{ fontSize: compact ? 14 : 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 6, lineHeight: 1.35 }}>{title}</div>
      )}
      {description && (
        <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: actions.length ? 16 : 0 }}>
          {description}
        </div>
      )}
      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          {actions.map((a, i) => (
            <button key={i} onClick={a.onClick}
              style={i === 0 ? {
                padding: '10px 18px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: 'inherit',
              } : {
                padding: '10px 18px', borderRadius: 10,
                border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)',
                color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
