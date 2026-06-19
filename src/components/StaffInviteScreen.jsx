import { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { auth, callFn } from '../lib/firebase';

// Public claim page for an SMS staff invite: `/invite?token=XYZ`.
// Flow: peek (show "{salon} invited you as {role}") → sign in with Google or
// Apple → claimStaffInvite links the account to the tenant with the invited
// role. No app required — they can use the web dashboard or the app next.
//
// Once the iOS app is on the public App Store (it's TestFlight-only today),
// set APP_LINK to the listing / TestFlight URL and the "Open the app" button
// lights up. Until then we route to the web dashboard, which works now.
const APP_LINK = '';   // e.g. 'https://apps.apple.com/app/idXXXXXXXXX' or a TestFlight invite URL

function appleProvider() {
  const p = new OAuthProvider('apple.com');
  p.addScope('email'); p.addScope('name');
  return p;
}

const card = { background: '#fff', borderRadius: 18, padding: '32px 28px', width: '90%', maxWidth: 420, boxShadow: '0 18px 50px rgba(0,0,0,.12)', textAlign: 'center', boxSizing: 'border-box' };
const btnBase = { width: '100%', boxSizing: 'border-box', padding: '13px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', marginTop: 10 };

export default function StaffInviteScreen() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [peek, setPeek]   = useState(null);   // { status, salonName, roleLabel } | { error }
  const [user, setUser]   = useState(undefined);  // undefined=loading, null=signed out, obj=signed in
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed]   = useState(null);  // { salonName, role, subdomain }
  const [err, setErr]     = useState('');

  useEffect(() => {
    if (!token) { setPeek({ error: 'missing' }); return; }
    callFn('peekStaffInvite')({ token })
      .then(r => setPeek(r.data?.ok ? r.data : { error: r.data?.error || 'invalid' }))
      .catch(() => setPeek({ error: 'invalid' }));
  }, [token]);

  useEffect(() => onAuthStateChanged(auth, u => setUser(u || null)), []);

  // Auto-claim the moment we have both a signed-in user and a valid pending
  // invite. The claim is idempotent server-side (single-use token), so a
  // re-render can't double-grant.
  useEffect(() => {
    if (!token || !user || claiming || claimed) return;
    if (!peek || peek.error || peek.status !== 'pending') return;
    setClaiming(true); setErr('');
    callFn('claimStaffInvite')({ token })
      .then(r => { if (r.data?.ok) setClaimed(r.data); else setErr('Could not accept the invite. Ask for a new link.'); })
      .catch(e => setErr(e?.message || 'Could not accept the invite. Ask for a new link.'))
      .finally(() => setClaiming(false));
  }, [token, user, peek, claiming, claimed]);

  async function signIn(which) {
    setErr('');
    try { await signInWithPopup(auth, which === 'apple' ? appleProvider() : new GoogleAuthProvider()); }
    catch (e) { if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') setErr('Sign-in was cancelled or failed. Please try again.'); }
  }

  const wrap = (children) => (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(160deg,#0f1923,#1b2a36)', padding: 16 }}>
      <div style={card}>
        <div style={{ fontSize: 30, marginBottom: 8 }}>💅</div>
        {children}
      </div>
    </div>
  );

  if (!peek || user === undefined) {
    return wrap(<div style={{ color: '#667', fontSize: 14, padding: '20px 0' }}>Loading your invite…</div>);
  }

  if (peek.error || peek.status === 'used' || peek.status === 'expired') {
    const msg = peek.status === 'used'
      ? 'This invite has already been used. If that wasn’t you, ask your manager for a new one.'
      : peek.status === 'expired'
        ? 'This invite link has expired. Ask your manager to send a fresh one.'
        : 'This invite link isn’t valid. Please ask your manager to resend it.';
    return wrap(<>
      <h1 style={{ fontSize: 19, color: '#1a1a1a', margin: '0 0 8px' }}>Invite unavailable</h1>
      <p style={{ fontSize: 14, color: '#556', lineHeight: 1.5, margin: 0 }}>{msg}</p>
    </>);
  }

  if (claimed) {
    const dashUrl = `${window.location.origin}/manage`;
    return wrap(<>
      <h1 style={{ fontSize: 21, color: '#1a1a1a', margin: '0 0 6px' }}>You’re in! 🎉</h1>
      <p style={{ fontSize: 14, color: '#556', lineHeight: 1.5, margin: '0 0 18px' }}>
        Your account is now linked to <strong>{claimed.salonName}</strong>. Sign in with the same {user?.providerData?.[0]?.providerId === 'apple.com' ? 'Apple' : 'Google'} account any time.
      </p>
      {APP_LINK
        ? <a href={APP_LINK} style={{ ...btnBase, background: '#2D7A5F', color: '#fff', display: 'block', textDecoration: 'none' }}>Open the Plume Nexus app</a>
        : null}
      <a href={dashUrl} style={{ ...btnBase, background: APP_LINK ? '#eef0f3' : '#2D7A5F', color: APP_LINK ? '#1a1a1a' : '#fff', display: 'block', textDecoration: 'none' }}>
        Go to your dashboard
      </a>
    </>);
  }

  if (user && (claiming || !err)) {
    return wrap(<div style={{ color: '#667', fontSize: 14, padding: '20px 0' }}>Setting up your account…</div>);
  }

  // Pending + signed out → sign-in prompt.
  return wrap(<>
    <h1 style={{ fontSize: 20, color: '#1a1a1a', margin: '0 0 6px' }}>{peek.salonName}</h1>
    <p style={{ fontSize: 14, color: '#556', lineHeight: 1.5, margin: '0 0 20px' }}>
      You’ve been invited to join the team as <strong>{peek.roleLabel}</strong> on Plume Nexus. Sign in to set up your account.
    </p>
    <button onClick={() => signIn('google')} style={{ ...btnBase, background: '#fff', color: '#1a1a1a', border: '1.5px solid #d0d5dd', marginTop: 0 }}>Continue with Google</button>
    <button onClick={() => signIn('apple')} style={{ ...btnBase, background: '#000', color: '#fff' }}>Continue with Apple</button>
    {err ? <p style={{ fontSize: 12.5, color: '#c0392b', marginTop: 14, marginBottom: 0 }}>{err}</p> : null}
    <p style={{ fontSize: 11, color: '#8a93a0', marginTop: 18, marginBottom: 0, lineHeight: 1.4 }}>
      We only use your sign-in to link you to {peek.salonName}. The invite expires after first use.
    </p>
  </>);
}
