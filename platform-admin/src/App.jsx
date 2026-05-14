import { useEffect, useState } from 'react';
import { watchAuth } from './lib/firebase.js';
import { isPlatformAdmin } from './lib/auth.js';
import SignIn from './components/SignIn.jsx';
import Layout from './components/Layout.jsx';
import TenantList from './components/TenantList.jsx';
import TenantDetail from './components/TenantDetail.jsx';
import AuditLog from './components/AuditLog.jsx';
import { C, FONT } from './theme.js';

const norm = (p) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);

export default function App() {
  const [user,    setUser]    = useState(undefined); // undefined = loading, null = signed-out, object = signed-in
  const [allowed, setAllowed] = useState(undefined); // undefined = checking, true/false after check
  const [path,    setPath]    = useState(norm(window.location.pathname));

  useEffect(() => {
    const onPop = () => setPath(norm(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    return watchAuth(async u => {
      setUser(u);
      if (!u) { setAllowed(false); return; }
      setAllowed(undefined);
      const ok = await isPlatformAdmin(u);
      setAllowed(ok);
    });
  }, []);

  // ─ Loading / unauthenticated states ─
  if (user === undefined || (user && allowed === undefined)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT.body, color: C.muted, fontSize: 13 }}>
        Checking access…
      </div>
    );
  }
  if (!user)            return <SignIn />;
  if (allowed === false) return <SignIn deniedEmail={user.email} />;

  // ─ Routing ─
  // Tenant detail at /t/:id; audit log at /audit
  const detailMatch = /^\/t\/([a-zA-Z0-9-]+)$/.exec(path);

  return (
    <Layout user={user} currentPath={path}>
      {detailMatch ? (
        <TenantDetail tenantId={detailMatch[1]} />
      ) : path === '/' ? (
        <TenantList />
      ) : path === '/audit' ? (
        <AuditLog />
      ) : (
        <NotFound />
      )}
    </Layout>
  );
}

function NotFound() {
  return (
    <div style={{ padding: 48, textAlign: 'center' }}>
      <div style={{ fontSize: 64, fontWeight: 800, color: C.plumDeep, lineHeight: 1, marginBottom: 14 }}>404</div>
      <div style={{ fontSize: 16, color: C.muted, marginBottom: 18 }}>Page not found.</div>
      <a href="/" style={{ color: C.plum, fontWeight: 600, fontSize: 14, textDecoration: 'none' }}>← Back to tenants</a>
    </div>
  );
}
