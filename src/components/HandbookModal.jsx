import { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';

export default function HandbookModal() {
  const { gUser, handbookDoc, signHandbook, showToast } = useApp();
  const [atBottom, setAtBottom] = useState(false);
  const [signing,  setSigning]  = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) setAtBottom(el.scrollHeight <= el.clientHeight + 20);
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollTop + el.clientHeight >= el.scrollHeight - 20);
  }

  async function handleSign() {
    setSigning(true);
    try {
      await signHandbook();
    } catch (e) {
      showToast('Sign failed: ' + e.message, 4000);
      setSigning(false);
    }
  }

  if (!handbookDoc) return null;

  const publishDate = handbookDoc.publishedAt || handbookDoc.updatedAt;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: '20px 16px', boxSizing: 'border-box' }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 20, width: '100%', maxWidth: 600, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,.4)' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 28 }}>📋</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)' }}>
                {handbookDoc.title || 'Employee Handbook'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                v{handbookDoc.version || '1.0'}
                {publishDate && ` · Published ${new Date(publishDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--pn-warning)', marginTop: 10, padding: '8px 12px', background: 'var(--pn-warning-bg)', borderRadius: 8, border: '1px solid #fcd34d' }}>
            Please read the full handbook and scroll to the bottom to sign.
          </div>
        </div>

        {/* Scrollable content */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', fontSize: 13, lineHeight: 1.8, color: 'var(--pn-text)', whiteSpace: 'pre-wrap' }}
        >
          {handbookDoc.content || 'No content published yet.'}
        </div>

        {/* Footer */}
        <div style={{ padding: '14px 20px 18px', borderTop: '1px solid var(--pn-border)', flexShrink: 0 }}>
          {!atBottom && (
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginBottom: 10 }}>
              ↓ Scroll to the bottom to sign
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10 }}>
            Signing as <strong>{gUser?.displayName || gUser?.email}</strong>
          </div>
          <button
            onClick={handleSign}
            disabled={!atBottom || signing}
            style={{
              width: '100%', padding: '13px', borderRadius: 12, border: 'none',
              background: !atBottom || signing ? 'var(--pn-surface-muted)' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: !atBottom || signing ? 'default' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {signing ? 'Signing…' : atBottom ? '✓ I Acknowledge & Sign' : 'Read handbook to sign'}
          </button>
        </div>
      </div>
    </div>
  );
}
