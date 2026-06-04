import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { fetchRecentlyDeleted, restoreDocFromBQ, clearTombstone } from '../lib/firestore';

// Reusable trash/restore panel. Scoped by `collections` (a list of
// SOFT_DELETED_COLLECTIONS keys); omit it for the global Admin trash.
//
// Two render modes:
//   - embedded (no onClose): renders inline — used by the Admin Trash tab.
//   - modal (onClose set): renders its own fixed overlay + centered card —
//     used by the per-module / calendar 🗑 Trash buttons, so a module only
//     needs `{show && <TrashPanel collections={[...]} onClose={...} />}`.
//
// Lifted from the old Admin.jsx TrashTab so the restore logic (BQ lossless
// vs in-place clearTombstone) and per-collection preview stay in one place.

function previewLabel(item) {
  const c = item.collection;
  if (c === 'clients' || c === 'employees') return item.name || '(no name)';
  if (c === 'appointments') return `${item.date || '?'} ${item.startTime || ''} · ${item.clientName || '?'} w/ ${item.techName || '?'}`;
  if (c === 'receipts') return `${item.date || '?'} · ${item.clientName || '?'} · $${(item.payment?.total || 0).toFixed(2)}`;
  if (c === 'services' || c === 'products') return item.name || '(no name)';
  if (c === 'giftCards') return `${item.code || '?'} · $${(item.originalAmount || item.balance || 0).toFixed(0)}`;
  if (c === 'promoCodes') return `${item.code || '?'}`;
  if (c === 'memberships') return `${item.clientName || '?'} · ${item.planId || ''}`;
  if (c === 'membershipPlans') return item.name || '(no name)';
  if (c === 'timeOff') return `${item.techName || '?'} · ${item.startDate || ''}–${item.endDate || item.startDate || ''}`;
  if (c === 'bonuses') return `${item.techName || '?'} · $${item.amount || 0}`;
  if (c === 'reviews') return `${item.techName || '?'} · ${item.period || ''}`;
  if (c === 'meetings') return `${item.subject || '?'} · ${item.startTimestamp ? new Date(item.startTimestamp).toLocaleDateString() : ''}`;
  if (c === 'campaigns') return `${item.subject || item.name || '?'}`;
  return '(no preview)';
}

export default function TrashPanel({ collections = null, title = '🗑 Recently deleted', onClose = null }) {
  const { showToast } = useApp();
  const [items, setItems] = useState(null);
  const [busy,  setBusy]  = useState(false);

  async function load() {
    setItems(null);
    try {
      setItems(await fetchRecentlyDeleted(collections ? { collections } : {}));
    } catch (e) {
      console.error('[trash] load failed:', e);
      setItems([]);
      showToast('Failed to load trash: ' + (e?.message || 'unknown'), 4000);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function handleRestore(item) {
    if (!window.confirm(`Restore this ${item.collection.replace(/s$/, '')}?`)) return;
    setBusy(true);
    try {
      if (item.restorable) {
        const res = await restoreDocFromBQ(item.collection, item.id);
        if (!res?.restored) throw new Error('Restore did not complete — see Cloud Function logs');
      } else {
        await clearTombstone(item.collection, item.id);
      }
      showToast(`Restored from ${item.collection}`);
      await load();
    } catch (e) {
      console.error('[trash] restore failed:', e);
      showToast('Restore failed: ' + (e?.message || 'unknown'), 4000);
    } finally { setBusy(false); }
  }

  const body = (
    <div style={{ background: 'var(--pn-surface)', borderRadius: onClose ? 12 : 0, overflow: 'hidden', border: onClose ? '1px solid var(--pn-border)' : 'none', maxHeight: onClose ? '80vh' : 'none', display: 'flex', flexDirection: 'column', width: onClose ? 'min(560px, 92vw)' : '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--pn-border)' }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>
          {title}{items ? ` (${items.length})` : ''}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={load} style={btn('#3D95CE')}>Refresh</button>
          {onClose && <button onClick={onClose} style={btn('#888')}>Close</button>}
        </div>
      </div>

      <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.55, background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
        Tombstones from the last 30 days. After 30 days the <code>purgeOldTombstones</code> cron permanently deletes them — BigQuery keeps a copy for the 4 mirrored collections (clients, appointments, receipts, employees); other collections are gone forever past 30 days.
      </div>

      <div style={{ overflowY: 'auto', flex: 1 }}>
        {items === null ? (
          <div style={empty}>Loading trash…</div>
        ) : items.length === 0 ? (
          <div style={empty}>Nothing in the trash</div>
        ) : (
          items.map(item => (
            <div key={`${item.collection}-${item.id}`}
              style={{ padding: '10px 16px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#7f1d1d', background: '#fef2f2', padding: '2px 7px', borderRadius: 10, textTransform: 'uppercase', flexShrink: 0, minWidth: 86, textAlign: 'center' }}>
                {item.collection}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--pn-text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {previewLabel(item)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>
                  Deleted {item._deletedAt ? new Date(item._deletedAt).toLocaleString() : 'unknown time'}
                  {item._deletedBy ? ` by ${item._deletedBy}` : ''}
                  {!item.restorable && <span style={{ marginLeft: 6, color: '#92400e' }}>· no BQ history</span>}
                </div>
              </div>
              <button onClick={() => handleRestore(item)} disabled={busy}
                style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: '1px solid #16a34a', background: busy ? '#f0fdf4' : 'var(--pn-surface)', color: '#16a34a', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600, flexShrink: 0 }}>
                {busy ? '…' : '↩ Restore'}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );

  if (!onClose) return body;

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 400, padding: 16 }}>
      <div onClick={e => e.stopPropagation()}>{body}</div>
    </div>
  );
}

const empty = { padding: '40px 16px', textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 };
function btn(color) {
  return { fontSize: 12, padding: '6px 12px', borderRadius: 8, border: `1px solid ${color}`, background: 'var(--pn-surface)', color, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 };
}
