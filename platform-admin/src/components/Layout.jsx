import { signOutNow } from '../lib/firebase.js';
import { C, FONT, shadow } from '../theme.js';
import SessionTimeout from './SessionTimeout.jsx';

export default function Layout({ user, currentPath, children }) {
  return (
    <div style={{ minHeight: '100vh', background: C.bg, fontFamily: FONT.body }}>
      {/* Top nav */}
      <header style={{
        background: C.ink,
        color: '#fff',
        padding: '0 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 56,
        boxShadow: shadow.sm,
      }}>
        <a href="/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: '#fff' }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: `linear-gradient(135deg, #5b3b8c, #3d95ce)`,
            color: '#fff', fontSize: 12, fontWeight: 800, letterSpacing: -.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>PA</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: -.005 }}>Plume Nexus</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.6)', marginTop: -2 }}>Platform Admin</div>
          </div>
        </a>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <NavLink href="/"           label="Tenants"  active={currentPath === '/'} />
          <NavLink href="/tickets"    label="Support"  active={currentPath === '/tickets'} />
          <NavLink href="/audit"      label="Audit log" active={currentPath === '/audit'} />
          {/* Future tabs — disabled placeholders */}
          <NavLink href="#"          label="Onboarding" disabled />
          <NavLink href="#"          label="Financials" disabled />
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.7)' }}>{user.email}</div>
          <button onClick={signOutNow} style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600,
            background: 'rgba(255,255,255,.08)', color: '#fff',
            border: '1px solid rgba(255,255,255,.12)', borderRadius: 6,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>Sign out</button>
        </div>
      </header>

      {/* Main content */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 48px' }}>
        {children}
      </main>

      <SessionTimeout />
    </div>
  );
}

function NavLink({ href, label, active, disabled }) {
  return (
    <a href={disabled ? undefined : href}
      onClick={disabled ? (e) => e.preventDefault() : undefined}
      style={{
      padding: '6px 12px', fontSize: 13, fontWeight: 500,
      color: disabled ? 'rgba(255,255,255,.3)' : (active ? '#fff' : 'rgba(255,255,255,.7)'),
      background: active ? 'rgba(255,255,255,.1)' : 'transparent',
      borderRadius: 6,
      textDecoration: 'none',
      cursor: disabled ? 'not-allowed' : 'pointer',
      transition: 'background .12s',
    }}>{label}{disabled && <span style={{ fontSize: 9, marginLeft: 4, color: 'rgba(255,255,255,.3)' }}>· soon</span>}</a>
  );
}
