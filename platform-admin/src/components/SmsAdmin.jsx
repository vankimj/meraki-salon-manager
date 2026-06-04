import { useEffect, useState } from 'react';
import { markSharedTfn, listInboundOrphans, forwardInboundOrphan, deleteInboundOrphan } from '../lib/sms.js';
import { fetchTenants } from '../lib/tenants.js';
import { C, FONT, radius, shadow } from '../theme.js';

export default function SmsAdmin() {
  return (
    <>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px', color: C.ink, letterSpacing: '-.005em' }}>
          Platform SMS
        </h1>
        <div style={{ fontSize: 13, color: C.muted }}>
          Mark the shared toll-free number after TrustHub approval, and triage inbound replies that arrive on the shared TFN from clients we can't auto-route.
        </div>
      </div>

      <SharedTfnPanel />
      <InboundOrphansPanel />
    </>
  );
}

// ── Shared TFN marker ─────────────────────────────────────

function SharedTfnPanel() {
  const [phone,    setPhone]    = useState('+18559574235');
  const [status,   setStatus]   = useState(null); // null | 'pending' | 'ok' | 'err'
  const [message,  setMessage]  = useState('');
  const [confirm,  setConfirm]  = useState(false);

  const valid = /^\+\d{10,15}$/.test(phone.trim());

  async function go() {
    setStatus('pending'); setMessage('');
    try {
      const res = await markSharedTfn(phone.trim());
      setStatus('ok');
      setMessage(`Marked ${res.phone} as the shared platform TFN. New inbound replies from unmapped clients now route through clientSalonIndex.`);
      setConfirm(false);
    } catch (e) {
      setStatus('err');
      setMessage(e?.message || 'Mark failed.');
    }
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>Shared TFN marker</div>
        <code style={{ fontSize: 11, color: C.muted, fontFamily: FONT.mono }}>smsTfnRegistry/{'{e164}'}.tenantId = '__shared__'</code>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Idempotent. Call this once when the Plume Nexus TFN clears TrustHub. After this, <code style={{ fontFamily: FONT.mono, fontSize: 11 }}>twilioInboundSms</code> sees the sentinel and falls through to <code style={{ fontFamily: FONT.mono, fontSize: 11 }}>clientSalonIndex</code> for tenant routing.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          value={phone}
          onChange={e => { setPhone(e.target.value); setStatus(null); setConfirm(false); }}
          placeholder="+18559574235"
          spellCheck={false}
          style={{
            flex: 1, padding: '10px 12px', fontSize: 13, fontFamily: FONT.mono,
            border: `1px solid ${C.rule}`, borderRadius: 8, outline: 'none', background: C.bgCard,
          }} />
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            disabled={!valid || status === 'pending'}
            style={btnPrimary(valid && status !== 'pending')}>
            Mark as shared
          </button>
        ) : (
          <>
            <button onClick={() => setConfirm(false)} style={btnGhost}>Cancel</button>
            <button onClick={go} disabled={status === 'pending'} style={btnDanger(status !== 'pending')}>
              {status === 'pending' ? 'Marking…' : 'Confirm mark'}
            </button>
          </>
        )}
      </div>
      {!valid && phone.length > 0 && (
        <div style={{ fontSize: 11, color: C.danger, marginTop: 8 }}>Must be E.164 (e.g. +18559574235).</div>
      )}
      {confirm && (
        <div style={{ fontSize: 12, color: C.warning, marginTop: 10, padding: '8px 10px', background: C.warningSoft, borderRadius: 6 }}>
          ⚠ This changes routing for every inbound message on {phone}. Confirm only if TrustHub has approved and this is the shared platform number.
        </div>
      )}
      {message && (
        <div style={{
          fontSize: 12,
          color:  status === 'ok' ? C.success : C.danger,
          background: status === 'ok' ? C.successSoft : C.dangerSoft,
          padding: '8px 10px', borderRadius: 6, marginTop: 10,
        }}>{message}</div>
      )}
    </div>
  );
}

// ── Inbound orphan triage ─────────────────────────────────

function InboundOrphansPanel() {
  const [orphans, setOrphans] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const [o, t] = await Promise.all([listInboundOrphans(100), fetchTenants()]);
      setOrphans(o);
      setTenants(Array.isArray(t) ? t : (t?.tenants || []));
    } catch (e) {
      setError(e?.message || 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  function removeFromList(orphanId) {
    setOrphans(prev => (prev || []).filter(o => o.id !== orphanId));
  }

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>
          Inbound orphans
          {orphans ? <span style={{ marginLeft: 8, fontSize: 12, color: C.muted, fontWeight: 500 }}>({orphans.length})</span> : null}
        </div>
        <button onClick={load} style={btnGhost}>↻ Refresh</button>
      </div>
      <div style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.5 }}>
        Messages received on the shared platform TFN from phones we have no prior <code style={{ fontFamily: FONT.mono, fontSize: 11 }}>clientSalonIndex</code> mapping for. Forward to the salon the customer meant, or delete (spam, wrong number). Forwarding pre-seeds the routing index so the next reply routes automatically.
      </div>

      {error && (
        <div style={{ fontSize: 12, color: C.danger, background: C.dangerSoft, padding: '8px 10px', borderRadius: 6 }}>
          {error}
        </div>
      )}
      {loading && <div style={{ fontSize: 12, color: C.muted, padding: '14px 0' }}>Loading…</div>}
      {!loading && orphans && orphans.length === 0 && (
        <div style={{
          textAlign: 'center', padding: '32px 16px', color: C.muted,
          background: C.bgCode, borderRadius: 8, border: `1px dashed ${C.rule}`, fontSize: 13,
        }}>
          📭 Nothing in the queue. Either we're catching every inbound, or no one's texted the shared TFN.
        </div>
      )}
      {!loading && orphans && orphans.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orphans.map(o => (
            <OrphanRow key={o.id} orphan={o} tenants={tenants} onResolved={() => removeFromList(o.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrphanRow({ orphan, tenants, onResolved }) {
  const [target,    setTarget]    = useState('');
  const [busy,      setBusy]      = useState(null); // null | 'forward' | 'delete'
  const [err,       setErr]       = useState('');
  const [confirmDel,setConfirmDel] = useState(false);

  async function doForward() {
    if (!target) return;
    setBusy('forward'); setErr('');
    try {
      await forwardInboundOrphan(orphan.id, target);
      onResolved();
    } catch (e) {
      setErr(e?.message || 'Forward failed.');
    } finally {
      setBusy(null);
    }
  }

  async function doDelete() {
    setBusy('delete'); setErr('');
    try {
      await deleteInboundOrphan(orphan.id);
      onResolved();
    } catch (e) {
      setErr(e?.message || 'Delete failed.');
    } finally {
      setBusy(null);
    }
  }

  const ago = orphan.at ? timeAgo(orphan.at) : '';

  return (
    <div style={{
      border: `1px solid ${C.rule}`, borderRadius: 10, padding: '12px 14px', background: C.bgCard,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <code style={{ fontSize: 13, fontFamily: FONT.mono, color: C.ink, fontWeight: 600 }}>{orphan.from || '(no from)'}</code>
          <span style={{ fontSize: 11, color: C.muted }}>→ {orphan.to || '(no to)'}</span>
        </div>
        <span style={{ fontSize: 11, color: C.mutedSoft }}>{ago}</span>
      </div>
      <div style={{
        fontSize: 13, color: C.text, background: C.bgCode, padding: '8px 10px',
        borderRadius: 6, marginBottom: 10, whiteSpace: 'pre-wrap', lineHeight: 1.45,
      }}>
        {orphan.body || <span style={{ color: C.mutedSoft }}>(empty body)</span>}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={target}
          onChange={e => setTarget(e.target.value)}
          disabled={busy !== null}
          style={{
            flex: 1, minWidth: 200, padding: '8px 10px', fontSize: 12,
            border: `1px solid ${C.rule}`, borderRadius: 6, background: C.bgCard, fontFamily: 'inherit',
          }}>
          <option value="">Forward to tenant…</option>
          {tenants.map(t => (
            <option key={t.id || t.tenantId} value={t.id || t.tenantId}>
              {(t.salonName || t.name || t.id || t.tenantId)} ({t.id || t.tenantId})
            </option>
          ))}
        </select>
        <button onClick={doForward} disabled={!target || busy !== null} style={btnPrimary(target && busy === null)}>
          {busy === 'forward' ? 'Forwarding…' : 'Forward'}
        </button>
        {!confirmDel ? (
          <button onClick={() => setConfirmDel(true)} disabled={busy !== null} style={btnGhost}>Delete</button>
        ) : (
          <>
            <button onClick={() => setConfirmDel(false)} disabled={busy !== null} style={btnGhost}>Cancel</button>
            <button onClick={doDelete} disabled={busy !== null} style={btnDanger(busy === null)}>
              {busy === 'delete' ? 'Deleting…' : 'Confirm delete'}
            </button>
          </>
        )}
      </div>
      {err && (
        <div style={{ fontSize: 11, color: C.danger, marginTop: 8 }}>{err}</div>
      )}
    </div>
  );
}

// ── styles ────────────────────────────────────────────────

const cardStyle = {
  background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.lg,
  padding: '18px 22px', marginBottom: 14, boxShadow: shadow.sm, fontFamily: FONT.body,
};

function btnPrimary(enabled) {
  return {
    padding: '8px 16px', fontSize: 13, fontWeight: 600,
    background: enabled ? C.plumDeep : C.rule,
    color: enabled ? '#fff' : C.mutedSoft,
    border: 'none', borderRadius: 8, fontFamily: 'inherit',
    cursor: enabled ? 'pointer' : 'default',
  };
}
function btnDanger(enabled) {
  return {
    padding: '8px 16px', fontSize: 13, fontWeight: 600,
    background: enabled ? C.danger : C.rule,
    color: enabled ? '#fff' : C.mutedSoft,
    border: 'none', borderRadius: 8, fontFamily: 'inherit',
    cursor: enabled ? 'pointer' : 'default',
  };
}
const btnGhost = {
  padding: '8px 14px', fontSize: 13, fontWeight: 500,
  background: C.bgCard, color: C.text,
  border: `1px solid ${C.rule}`, borderRadius: 8, fontFamily: 'inherit', cursor: 'pointer',
};

function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
