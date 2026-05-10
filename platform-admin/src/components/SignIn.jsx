import { useState } from 'react';
import { signIn, signOutNow } from '../lib/firebase.js';
import { C, FONT, shadow, radius } from '../theme.js';

export default function SignIn({ deniedEmail }) {
  const [error, setError]   = useState('');
  const [busy,  setBusy]    = useState(false);

  async function handleSignIn() {
    setBusy(true); setError('');
    try { await signIn(); }
    catch (e) { setError(e?.message || 'Sign-in failed.'); }
    finally   { setBusy(false); }
  }

  async function handleSignOut() {
    await signOutNow();
    window.location.reload();
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: C.bg, padding: 24,
    }}>
      <div style={{
        width: '100%', maxWidth: 400,
        background: C.bgCard,
        border: `1px solid ${C.rule}`,
        borderRadius: radius.lg,
        boxShadow: shadow.lg,
        padding: 32,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14,
            margin: '0 auto 14px',
            background: `linear-gradient(135deg, ${C.ink}, ${C.plumDeep})`,
            color: '#fff',
            fontSize: 22, fontWeight: 800, letterSpacing: -1,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>PA</div>
          <h1 style={{ fontFamily: FONT.body, fontSize: 20, fontWeight: 700, margin: '0 0 4px', color: C.ink }}>
            Plume Nexus · Platform Admin
          </h1>
          <p style={{ fontSize: 13, color: C.muted, margin: 0 }}>
            Internal only. Sign in with your authorized Google account.
          </p>
        </div>

        {deniedEmail && (
          <div style={{
            padding: '10px 14px', marginBottom: 18,
            background: C.dangerSoft, border: `1px solid ${C.danger}40`,
            borderRadius: radius.md, fontSize: 13, color: '#991b1b', lineHeight: 1.5,
          }}>
            <strong>Access denied</strong> for <code style={{ background: 'rgba(0,0,0,.06)', padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{deniedEmail}</code> — this email is not in the platform admin allowlist.{' '}
            <button onClick={handleSignOut} style={{
              background: 'none', border: 'none', color: C.danger, fontWeight: 600,
              cursor: 'pointer', textDecoration: 'underline', padding: 0, fontSize: 13, fontFamily: 'inherit',
            }}>Sign out</button>
          </div>
        )}

        {!deniedEmail && (
          <button onClick={handleSignIn} disabled={busy} style={{
            width: '100%', padding: '11px 18px',
            fontSize: 14, fontWeight: 600,
            background: busy ? C.rule : C.ink, color: '#fff',
            border: 'none', borderRadius: radius.md,
            cursor: busy ? 'default' : 'pointer',
            fontFamily: FONT.body,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'background .15s',
          }}>
            <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
              <path d="M16.51 8.18c0-.61-.05-1.2-.16-1.77H9v3.36h4.21c-.18.97-.74 1.79-1.57 2.34v1.95h2.54c1.49-1.37 2.33-3.39 2.33-5.88z" fill="#4285F4"/>
              <path d="M9 17c2.12 0 3.91-.7 5.21-1.91l-2.54-1.95c-.7.47-1.6.75-2.67.75-2.05 0-3.79-1.38-4.41-3.24H2v2.02C3.3 15.46 5.93 17 9 17z" fill="#34A853"/>
              <path d="M4.59 10.65c-.16-.47-.25-.97-.25-1.49s.09-1.02.25-1.49V5.65H2C1.45 6.74 1.13 7.96 1.13 9.16s.32 2.42.87 3.51l2.59-2.02z" fill="#FBBC05"/>
              <path d="M9 4.84c1.16 0 2.2.4 3.02 1.18l2.26-2.26C13.91 2.62 12.13 2 9 2 5.93 2 3.3 3.54 2 5.65l2.59 2.02C5.21 6.22 6.95 4.84 9 4.84z" fill="#EA4335"/>
            </svg>
            {busy ? 'Signing in…' : 'Sign in with Google'}
          </button>
        )}

        {error && (
          <div style={{ marginTop: 14, padding: '8px 12px', background: C.dangerSoft, borderRadius: 8, fontSize: 12, color: '#991b1b' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 22, fontSize: 11, color: C.mutedSoft, textAlign: 'center', lineHeight: 1.5 }}>
          Every action in this dashboard is logged to <code style={{ background: C.bgCode, padding: '1px 5px', borderRadius: 3, fontSize: 10 }}>platform/audit_log</code> with your email and timestamp.
        </div>
      </div>
    </div>
  );
}
