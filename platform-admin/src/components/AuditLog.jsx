import { useEffect, useState } from 'react';
import { db, collection, query, orderBy, limit, getDocs } from '../lib/firebase.js';
import { C, FONT, radius } from '../theme.js';

// Reads the platformAuditLog/ collection — every sensitive admin
// action (tenant delete, role grant, etc.) is appended here by Cloud
// Functions. Append-only forensic trail.
//
// Rules: bootstrap admin can read (jvankim@gmail.com). Write is
// server-only (admin SDK in Cloud Functions). So the page is safe to
// hit by any platform admin signed in here.
//
// 100-entry rolling window for now; pagination can come if the log
// grows large.

export default function AuditLog() {
  const [rows,    setRows]    = useState(null);
  const [error,   setError]   = useState('');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, 'platformAuditLog'), orderBy('at', 'desc'), limit(100))
        );
        setRows(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      } catch (e) {
        setError(e?.message || 'Could not load audit log.');
        setRows([]);
      }
    })();
  }, []);

  return (
    <>
      <a href="/" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: C.muted, textDecoration: 'none', marginBottom: 12 }}>
        ← Tenants
      </a>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 6px', color: C.ink }}>Audit log</h1>
      <p style={{ fontSize: 13, color: C.muted, marginBottom: 24, lineHeight: 1.55 }}>
        Append-only forensic trail of platform-admin actions. Latest 100 entries. Read-only.
      </p>

      {rows === null && <Empty>Loading…</Empty>}
      {error && rows?.length === 0 && <Empty error>{error}</Empty>}
      {rows && rows.length === 0 && !error && <Empty>No audit entries yet.</Empty>}
      {rows && rows.length > 0 && (
        <div style={{
          background: '#fff', border: `1px solid ${C.rule}`, borderRadius: radius.md,
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: FONT.body }}>
            <thead>
              <tr style={{ background: C.bgCode }}>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => <AuditRow key={r.id} r={r} />)}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function AuditRow({ r }) {
  const target = r.payload?.slug || r.payload?.tenantId || r.payload?.name || '—';
  const meta   = r.payload && Object.keys(r.payload).length
    ? JSON.stringify(r.payload)
    : '';
  return (
    <tr style={{ borderTop: `1px solid ${C.rule}` }}>
      <Td>
        <div>{relTime(r.at)}</div>
        <div style={{ fontSize: 10, color: C.mutedSoft }}>{(r.at || '').slice(0, 19)}Z</div>
      </Td>
      <Td>{r.actor || '—'}</Td>
      <Td>
        <ActionBadge action={r.action} />
      </Td>
      <Td>
        <code style={{ background: C.bgCode, padding: '1px 5px', borderRadius: 3, fontSize: 11 }}>{target}</code>
        {meta && <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4, maxWidth: 360, overflowWrap: 'anywhere' }}>{meta}</div>}
      </Td>
      <Td><span style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11, color: C.muted }}>{r.ip || '—'}</span></Td>
    </tr>
  );
}

function ActionBadge({ action }) {
  const isDestructive = /\.delete\.hard$/.test(action);
  const isMutative    = /\.delete\.soft$|\.update$|\.grant$|\.revoke$/.test(action);
  const color = isDestructive ? C.danger : isMutative ? C.warning : C.muted;
  const bg    = isDestructive ? C.dangerSoft : isMutative ? C.warningSoft : C.bgCode;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      background: bg, color, fontSize: 11, fontWeight: 700,
      fontFamily: 'ui-monospace, Menlo, monospace',
    }}>{action}</span>
  );
}

function Th({ children }) {
  return <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, color: C.muted, fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase' }}>{children}</th>;
}
function Td({ children }) {
  return <td style={{ padding: '10px 14px', verticalAlign: 'top', color: C.text }}>{children}</td>;
}
function Empty({ children, error }) {
  return <div style={{ padding: 48, textAlign: 'center', color: error ? C.danger : C.muted, fontSize: 13 }}>{children}</div>;
}

function relTime(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso).getTime()) / 1000;
  if (sec < 60)      return `${Math.round(sec)}s ago`;
  if (sec < 3600)    return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400)   return `${Math.round(sec / 3600)}h ago`;
  return `${Math.round(sec / 86400)}d ago`;
}
