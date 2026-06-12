import { TURN_HELP } from '../data/turnHelp';

// On-page explainer for the walk-in turn rotation. Opened from a "How turns
// work?" link on the turn roster (schedule) and the walk-in kiosk.
export default function TurnHelpModal({ onClose }) {
  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface, #fff)', color: 'var(--pn-text, #1a1a1a)', borderRadius: 16, maxWidth: 640, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', borderBottom: '1px solid var(--pn-border, #eee)', position: 'sticky', top: 0, background: 'var(--pn-surface, #fff)' }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>🔄 {TURN_HELP.title}</div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--pn-text-muted, #888)', lineHeight: 1, fontFamily: 'inherit' }}>×</button>
        </div>

        <div style={{ padding: '20px 22px' }}>
          <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--pn-text, #333)', marginTop: 0 }}>{TURN_HELP.intro}</p>

          {TURN_HELP.sections.map((s, i) => (
            <div key={i} style={{ marginTop: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-primary, #2D7A5F)', marginBottom: 6 }}>{s.h}</div>
              {(s.p || []).map((para, j) => (
                <p key={j} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--pn-text-muted, #555)', margin: '0 0 6px' }}>{para}</p>
              ))}
              {s.bullets && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {s.bullets.map((b, j) => (
                    <li key={j} style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--pn-text-muted, #555)', marginBottom: 4 }}>{b}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--tm-primary, #2D7A5F)', margin: '24px 0 10px' }}>Examples</div>
          {TURN_HELP.examples.map((ex, i) => (
            <div key={i} style={{ background: 'var(--pn-bg, #f7f8f9)', border: '1px solid var(--pn-border, #eee)', borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 8 }}>{i + 1}. {ex.title}</div>
              {ex.lines.map((ln, j) => (
                <div key={j} style={{ display: 'flex', gap: 8, marginBottom: 5 }}>
                  <span style={{ color: 'var(--tm-primary, #2D7A5F)', fontWeight: 700, flexShrink: 0 }}>›</span>
                  <span style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--pn-text-muted, #555)' }}>{ln}</span>
                </div>
              ))}
            </div>
          ))}

          <div style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--pn-text-faint, #888)', marginTop: 14, lineHeight: 1.55 }}>{TURN_HELP.footer}</div>
        </div>
      </div>
    </div>
  );
}
