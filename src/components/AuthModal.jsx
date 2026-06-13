import { useState } from 'react';
import { useApp } from '../context/AppContext';

export default function AuthModal({ onClose, onSuccess }) {
  const { signIn, appleSignIn, sendMagicLink } = useApp();
  const [status,    setStatus]    = useState('');
  const [email,     setEmail]     = useState('');
  const [sending,   setSending]   = useState(false);
  const [linkSent,  setLinkSent]  = useState(false);

  async function handleGoogleSignIn() {
    setStatus('');
    const result = await signIn();
    if (result.ok) { onSuccess?.(); onClose(); }
    else if (result.reason) setStatus(result.reason);
  }

  async function handleAppleSignIn() {
    setStatus('');
    const result = await appleSignIn();
    if (result.ok) { onSuccess?.(); onClose(); }
    else if (result.reason) setStatus(result.reason);
  }

  async function handleSendLink() {
    if (!email.trim()) return;
    setSending(true);
    setStatus('');
    try {
      await sendMagicLink(email.trim());
      setLinkSent(true);
    } catch (e) {
      setStatus(e.message || 'Failed to send sign-in link.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'var(--pn-overlay)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', color: 'var(--pn-text)', borderRadius: 16, padding: 24, width: '90%', maxWidth: 360, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Icon + title */}
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: 'linear-gradient(135deg,#2D7A5F,#4A7DB5)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
            <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Sign in</h3>
          <p style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4 }}>Access is granted by an administrator.</p>
        </div>

        {/* Google */}
        <button onClick={handleGoogleSignIn}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, width: '100%', padding: 12, border: '1px solid #d0d0d0', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer', background: '#fff', color: '#3c4043', fontFamily: 'inherit', marginBottom: 16 }}>
          <svg width={18} height={18} viewBox="0 0 18 18">
            <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
            <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
            <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
            <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
          </svg>
          Sign in with Google
        </button>

        {/* Apple */}
        <button onClick={handleAppleSignIn}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: 12, border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer', background: '#000', color: '#fff', fontFamily: 'inherit', marginBottom: 16 }}>
          <svg width={16} height={16} viewBox="0 0 384 512" fill="#fff"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          Sign in with Apple
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--pn-border)' }} />
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', fontWeight: 500 }}>or</span>
          <div style={{ flex: 1, height: 1, background: 'var(--pn-border)' }} />
        </div>

        {/* Email magic link */}
        {linkSent ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>📬</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)', marginBottom: 4 }}>Check your inbox</div>
            <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>
              We sent a sign-in link to <strong>{email}</strong>. Click the link to sign in — no password needed.
            </div>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 4 }}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendLink()}
                placeholder="you@example.com"
                style={{ width: '100%', fontFamily: 'inherit', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', background: 'var(--pn-bg)', color: 'var(--pn-text)', boxSizing: 'border-box' }}
              />
            </div>
            <button onClick={handleSendLink} disabled={sending || !email.trim()}
              style={{ width: '100%', padding: '11px', borderRadius: 10, border: 'none', background: sending || !email.trim() ? '#d0d0d0' : '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: sending || !email.trim() ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {sending ? 'Sending…' : 'Send sign-in link'}
            </button>
          </>
        )}

        {status && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 10, textAlign: 'center' }}>{status}</div>}

        <button onClick={onClose}
          style={{ width: '100%', marginTop: 12, color: 'var(--pn-text-faint)', border: 'none', background: 'none', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
