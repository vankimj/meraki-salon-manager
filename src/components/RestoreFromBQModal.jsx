import { useEffect, useState } from 'react';
import { fetchDocSnapshotHistory, restoreDocFromBQ } from '../lib/firestore';

// Restore-from-BigQuery modal. Lists the last N CREATE/UPDATE snapshots
// of a specific document and lets an admin pick one to restore. Lossless
// recovery of the doc's state at any historical moment — works for the
// "I deleted the wrong record" case AND the "I edited the wrong field"
// case AND the "this got silently corrupted" case.
//
// Usage:
//   <RestoreFromBQModal
//     collection="clients" docId={client.id}
//     label={client.name}
//     onClose={() => setOpen(false)}
//     onRestored={() => { reload(); setOpen(false); }}
//   />
export default function RestoreFromBQModal({ collection, docId, label, onClose, onRestored }) {
  const [snapshots, setSnapshots] = useState(null);
  const [loadErr, setLoadErr]     = useState(null);
  const [chosen, setChosen]       = useState(null);
  const [working, setWorking]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchDocSnapshotHistory(collection, docId, 20)
      .then(res => { if (!cancelled) setSnapshots(res.snapshots || []); })
      .catch(e => { if (!cancelled) setLoadErr(e?.message || String(e)); });
    return () => { cancelled = true; };
  }, [collection, docId]);

  async function doRestore() {
    if (!chosen) return;
    setWorking(true);
    try {
      const res = await restoreDocFromBQ(collection, docId, chosen.timestamp);
      if (res.restored) {
        onRestored?.();
      } else {
        setLoadErr('Restore did not complete — see Cloud Function logs');
      }
    } catch (e) {
      setLoadErr(e?.message || String(e));
    } finally {
      setWorking(false);
    }
  }

  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }); }
    catch { return iso; }
  }

  function previewLine(p) {
    if (!p) return '(no preview)';
    if (collection === 'clients') {
      return `${p.name || '(no name)'}${p.email ? ' · ' + p.email : ''}${p._deleted ? ' · 🗑 deleted' : ''}`;
    }
    if (collection === 'appointments') {
      return `${p.date || '?'} ${p.startTime || ''} · ${p.clientName || '?'} w/ ${p.techName || '?'} · ${p.status || ''}${p._deleted ? ' · 🗑' : ''}`;
    }
    if (collection === 'receipts') {
      return `${p.date || '?'} · ${p.clientName || '?'} · $${(p.total || 0).toFixed(2)} (${p.techName || '?'})${p._deleted ? ' · 🗑' : ''}`;
    }
    if (collection === 'employees') {
      return `${p.name || '?'}${p.email ? ' · ' + p.email : ''}${p.active === false ? ' · inactive' : ''}${p._deleted ? ' · 🗑' : ''}`;
    }
    return JSON.stringify(p);
  }

  return (
    <div onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: 'var(--pn-surface)', borderRadius: 14, width: '100%', maxWidth: 560, maxHeight: '85vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 32px rgba(0,0,0,.2)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)' }}>Restore previous version</div>
            <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>{collection}/{docId}{label ? ` — ${label}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--pn-text-muted)', padding: 0 }}>×</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {snapshots === null && !loadErr && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>Loading snapshot history from BigQuery…</div>
          )}
          {loadErr && (
            <div style={{ padding: 20, color: '#b91c1c', fontSize: 13, background: '#fef2f2', margin: 16, borderRadius: 8 }}>
              {loadErr}
            </div>
          )}
          {snapshots && snapshots.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>
              No snapshots in BigQuery for this doc yet. Either it was never written, or the BQ mirror was installed after this doc was created and last edited.
            </div>
          )}
          {snapshots && snapshots.length > 0 && snapshots.map(s => (
            <label key={s.timestamp}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 20px', cursor: 'pointer', borderBottom: '1px solid var(--pn-border)', background: chosen?.timestamp === s.timestamp ? '#f0faf6' : 'transparent' }}>
              <input
                type="radio"
                name="snapshot"
                checked={chosen?.timestamp === s.timestamp}
                onChange={() => setChosen(s)}
                style={{ marginTop: 4 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--pn-text)' }}>{fmtTime(s.timestamp)}</div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>{s.operation}</div>
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewLine(s.preview)}</div>
              </div>
            </label>
          ))}
        </div>

        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8, justifyContent: 'flex-end', background: 'var(--pn-bg)' }}>
          <button onClick={onClose} disabled={working}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
            Cancel
          </button>
          <button onClick={doRestore} disabled={!chosen || working}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: chosen && !working ? '#2D7A5F' : '#cbd5e1', color: '#fff', cursor: chosen && !working ? 'pointer' : 'default', fontSize: 13, fontFamily: 'inherit', fontWeight: 600 }}>
            {working ? 'Restoring…' : 'Restore this version'}
          </button>
        </div>
      </div>
    </div>
  );
}
