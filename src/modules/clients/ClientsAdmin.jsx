import { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import Button from '../../components/Button';
import { fetchClients, createClient, saveClient, deleteClient, fetchServices, fetchClientAppointments, createReviewRequest, saveReviewReceived, fetchClientInsurance, saveClientInsurance } from '../../lib/firestore';
import RestoreFromBQModal from '../../components/RestoreFromBQModal';
import TrashButton from '../../components/TrashButton';
import { resizeImg, formatTime } from '../../utils/helpers';
import { logActivity, logError } from '../../lib/logger';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';

import { useApp } from '../../context/AppContext';
import NotesEditor from '../../components/NotesEditor';
import EmptyState from '../../components/EmptyState';
import CoachMark from '../../components/CoachMark';
import SavedCardsTab from './SavedCardsTab';

// ── helpers ────────────────────────────────────────────
function blankClient() {
  return {
    name: '', phone: '', email: '', address: '', birthday: '', allergies: '', notes: '',
    picture: '',
    instagram: '', facebook: '', tiktok: '', venmo: '',
    instagramTags: [],
    googleReviews: [],
    visits: [],
    banned: false,
    testSubject: false,
    commPreferences: defaultCommPreferences(),
  };
}

// Two categories × three channels. Voice is recorded but not yet acted on
// (Phase 4 of the Communications Hub roadmap). Default opts everyone into
// SMS + Email for both transactional and marketing — preserves existing
// behavior so the field is purely additive for legacy clients.
export function defaultCommPreferences() {
  return {
    appointmentSms:   true,
    appointmentEmail: true,
    appointmentVoice: false,
    marketingSms:     true,
    marketingEmail:   true,
    marketingVoice:   false,
  };
}

function blankTag()    { return { url: '', note: '' }; }
function blankReview() { return { url: '', rating: 5, date: new Date().toISOString().slice(0, 10), text: '' }; }

function blankVisit() {
  return {
    id: Date.now().toString(),
    date: new Date().toISOString().slice(0, 10),
    tech: '',
    notes: '',
    services: [{ name: '', price: '', notes: '' }],
  };
}

function matchesSearch(c, q) {
  const s = q.toLowerCase();
  return (
    c.name?.toLowerCase().includes(s) ||
    c.phone?.toLowerCase().includes(s) ||
    c.email?.toLowerCase().includes(s)
  );
}

const PAGE_SIZE = 50;

// ── main list ──────────────────────────────────────────
export default function ClientsAdmin({ initialClientId, onInitialClientOpened } = {}) {
  const { showToast } = useApp();
  const [clients,    setClients]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [page,       setPage]       = useState(0);
  const [modal,      setModal]      = useState(null);

  // Cross-module deep-link: parent module (App.jsx) sets initialClientId
  // when the user clicks a client name from the Schedule. Once we've loaded
  // the clients list, find the target and pop the profile open in view mode,
  // then signal the parent to clear the id so reopening this module fresh
  // doesn't keep popping the same modal.
  useEffect(() => {
    if (!initialClientId || loading) return;
    const c = clients.find(x => x.id === initialClientId);
    if (c) setModal({ client: c, mode: 'view' });
    onInitialClientOpened?.();
  }, [initialClientId, loading, clients]); // eslint-disable-line
  // undo/redo — items live here instead of Firestore until evicted
  const [undoStack,  setUndoStack]  = useState([]); // pending deletes (max 2)
  const [redoStack,  setRedoStack]  = useState([]);
  const undoRef = useRef([]);

  function syncUndo(next) { undoRef.current = next; setUndoStack(next); }

  function commitDelete(client) {
    deleteClient(client.id).catch(() => {});
    logActivity('client_deleted', client.name);
  }

  useEffect(() => {
    return () => { undoRef.current.forEach(commitDelete); };
  }, []); // eslint-disable-line

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try { setClients(await fetchClients()); }
    catch (e) { console.error('[Clients] load failed:', e); }
    finally { setLoading(false); }
  }

  async function handleSave(rawClient) {
    // Keep legacy `notes` string in sync with the structured notesLog so
    // any consumer still reading client.notes (email, AI chatbot, reports)
    // sees the latest content. Newest-first joined; if no log entries,
    // preserve any existing legacy string as-is.
    const log = Array.isArray(rawClient.notesLog) ? rawClient.notesLog : [];
    const derivedNotes = log.length
      ? log.map(e => e?.text || '').filter(Boolean).join('\n\n')
      : (rawClient.notes || '');
    const client = { ...rawClient, notes: derivedNotes };
    try {
      if (client.id) {
        const { id, createdAt, ...data } = client;
        await saveClient(id, data);
        logActivity('client_updated', `${client.name}${client.phone ? ' · ' + client.phone : ''}${client.email ? ' · ' + client.email : ''}`);
      } else {
        await createClient(client);
        logActivity('client_added', `${client.name}${client.phone ? ' · ' + client.phone : ''}${client.email ? ' · ' + client.email : ''}`);
      }
      await load();
      setModal(null);
    } catch (e) { console.error('[Clients] save failed:', e); }
  }

  function handleDelete(client) {
    if (!confirm(`Delete client "${client.name}"?`)) return;
    setClients(cs => cs.filter(c => c.id !== client.id));
    setRedoStack([]);
    const next = [client, ...undoRef.current];
    if (next.length > 2) { commitDelete(next[next.length - 1]); }
    syncUndo(next.slice(0, 2));
    showToast(`Deleted "${client.name}" — use Undo above to revert`);
  }

  function handleUndo() {
    const [item, ...rest] = undoRef.current;
    if (!item) return;
    setClients(cs => [...cs, item].sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    setRedoStack(r => [item, ...r]);
    syncUndo(rest);
  }

  function handleRedo() {
    setRedoStack(prev => {
      const [item, ...rest] = prev;
      if (!item) return prev;
      setClients(cs => cs.filter(c => c.id !== item.id));
      const next = [item, ...undoRef.current];
      if (next.length > 2) { commitDelete(next[next.length - 1]); }
      syncUndo(next.slice(0, 2));
      return rest;
    });
  }

  function handleSearch(val) {
    setSearch(val);
    setPage(0);
  }

  // Stable per-row handlers so React.memo(ClientRow) can skip re-rendering rows
  // whose client/referralCount didn't change (search keystrokes only re-filter,
  // they don't mutate the surviving rows). Each takes the row's own client.
  const handleViewClient   = useCallback((c) => setModal({ client: { ...c }, mode: 'view' }), []);
  const handleEditClient   = useCallback((c) => setModal({ client: { ...c }, mode: 'edit' }), []);
  const handleDeleteClient = useCallback((c) => handleDelete(c), []); // eslint-disable-line react-hooks/exhaustive-deps

  function exportCSV() {
    const refCounts = {};
    clients.forEach(c => { if (c.referredBy?.id) refCounts[c.referredBy.id] = (refCounts[c.referredBy.id] || 0) + 1; });
    const cols = ['Name','Phone','Email','Address','Birthday','Instagram','Facebook','TikTok','Venmo','Notes','Referred By','Referrals Given','Credit Balance','Visits'];
    const esc  = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [cols.join(','), ...clients.map(c => [
      c.name, c.phone, c.email, c.address, c.birthday,
      c.instagram, c.facebook, c.tiktok, c.venmo, c.notes,
      c.referredBy?.name || '',
      refCounts[c.id] || 0,
      c.credit ? Number(c.credit).toFixed(2) : '',
      (c.visits?.length || 0),
    ].map(esc).join(','))];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `meraki-clients-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    logActivity('export_csv', `${clients.length} clients`);
  }

  const refCounts = useMemo(() => {
    const counts = {};
    clients.forEach(c => { if (c.referredBy?.id) counts[c.referredBy.id] = (counts[c.referredBy.id] || 0) + 1; });
    return counts;
  }, [clients]);

  const visible = useMemo(
    () => (search ? clients.filter(c => matchesSearch(c, search)) : clients),
    [clients, search],
  );
  const totalPages = Math.ceil(visible.length / PAGE_SIZE);
  const pageSlice  = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const rangeStart = visible.length ? page * PAGE_SIZE + 1 : 0;
  const rangeEnd   = Math.min((page + 1) * PAGE_SIZE, visible.length);

  if (loading) return <Empty>Loading clients…</Empty>;

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <input
          value={search} onChange={e => handleSearch(e.target.value)}
          placeholder="Search by name, phone, or email…"
          style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 12px', fontSize: 13, outline: 'none', background: 'var(--pn-bg)' }}
        />
        {undoStack.length > 0 && <Btn onClick={handleUndo}>↩ Undo</Btn>}
        {redoStack.length > 0 && <Btn onClick={handleRedo}>↪ Redo</Btn>}
        <span style={{ fontSize: 12, color: 'var(--pn-text-faint)', whiteSpace: 'nowrap' }}>{clients.length} clients</span>
        <Btn onClick={exportCSV}>⬇ CSV</Btn>
        <TrashButton collections={['clients']} scope="Clients" />
        <Btn color="#3D95CE" onClick={() => setModal({ client: blankClient(), mode: 'edit' })}>+ Add Client</Btn>
      </div>

      {/* List */}
      {visible.length === 0
        ? (search ? (
            <Empty>No clients match "{search}". Try a different name or phone number.</Empty>
          ) : (
            <EmptyState
              icon="👋"
              title="No clients yet"
              description="Add your first client manually, or import everyone from GlossGenius / a CSV in one go. Once they're in, every booking auto-links and visit history starts to build."
              actions={[
                { label: '+ Add a client',     onClick: () => setModal({ client: blankClient(), mode: 'edit' }) },
                { label: 'Import from CSV',    onClick: () => showToast('Open Admin → Settings → Data Imports to import.', 4000) },
              ]}
            />
          ))
        : (
          <>
            <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
              {pageSlice.map((c, i) => (
                <ClientRow
                  key={c.id}
                  client={c}
                  referralCount={refCounts[c.id] || 0}
                  last={i === pageSlice.length - 1}
                  onView={handleViewClient}
                  onEdit={handleEditClient}
                  onDelete={handleDeleteClient}
                />
              ))}
            </div>

            {/* Pagination controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, padding: '0 2px' }}>
                <button
                  onClick={() => setPage(p => p - 1)} disabled={page === 0}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: page === 0 ? 'var(--pn-text-faint)' : 'var(--pn-text)', cursor: page === 0 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  ← Prev
                </button>
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
                  {rangeStart}–{rangeEnd} of {visible.length} clients
                </span>
                <button
                  onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
                  style={{ fontSize: 12, padding: '5px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: page >= totalPages - 1 ? 'var(--pn-text-faint)' : 'var(--pn-text)', cursor: page >= totalPages - 1 ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  Next →
                </button>
              </div>
            )}
            {totalPages <= 1 && visible.length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 8 }}>
                {visible.length} client{visible.length !== 1 ? 's' : ''}
              </div>
            )}
          </>
        )
      }

      {modal && (
        <ClientModal
          client={modal.client}
          allClients={clients}
          initialMode={modal.mode}
          onChange={patch => setModal(m => ({ ...m, client: { ...m.client, ...patch } }))}
          onSave={() => handleSave(modal.client)}
          onClose={() => setModal(null)}
          onReload={load}
        />
      )}

      <CoachMark
        id="clients_intro"
        icon="👥"
        title="This is your client list"
        body="Search by name or phone in the box up top. Click anyone's row to open their profile — visit history, notes, social handles. Use the export button on the right to download a CSV."
      />
    </div>
  );
}

const ClientRow = memo(function ClientRow({ client, referralCount, last, onView, onEdit, onDelete }) {
  const lastVisit = client.visits?.slice(-1)[0];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: last ? 'none' : '1px solid var(--pn-border)' }}>
      <div onClick={() => onView(client)} style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <Avatar picture={client.picture} name={client.name} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{client.name || '—'}</span>
            {referralCount > 0 && (
              <span style={{ fontSize: 10, background: 'var(--pn-success-bg)', color: 'var(--pn-success)', borderRadius: 10, padding: '1px 7px', fontWeight: 600, flexShrink: 0 }}>
                ↗ {referralCount} referred
              </span>
            )}
            {Number(client.credit) > 0 && (
              <span style={{ fontSize: 10, background: 'var(--pn-success-bg)', color: '#2D7A5F', borderRadius: 10, padding: '1px 7px', fontWeight: 700, flexShrink: 0 }}>
                💳 ${Number(client.credit).toFixed(2)} credit
              </span>
            )}
            {Number(client.loyaltyPoints) > 0 && (
              <span style={{ fontSize: 10, background: 'var(--pn-info-bg)', color: '#3D95CE', borderRadius: 10, padding: '1px 7px', fontWeight: 700, flexShrink: 0 }}>
                ⭐ {Number(client.loyaltyPoints)} pts
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>
            {[client.phone, client.email].filter(Boolean).join(' · ') || 'No contact info'}
          </div>
          {lastVisit && (
            <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 1 }}>Last visit: {formatDate(lastVisit.date)}</div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Btn onClick={() => onEdit(client)}>Edit</Btn>
        <Btn color="#ef4444" onClick={() => onDelete(client)}>Del</Btn>
      </div>
    </div>
  );
});

// ── modal ──────────────────────────────────────────────
// Add / remove store credit on a client's account (admin or tech). Backed by the
// adjustClientCredit callable (atomic, audit-logged, alerts all admins). Replaces
// the old "issue store credit" field that used to live on checkout.
function CreditAdjuster({ client, onReload, onChange, showToast }) {
  const [balance, setBalance] = useState(Number(client.credit) || 0);
  const [open, setOpen] = useState(false);
  const [amt, setAmt] = useState('');
  const [dir, setDir] = useState('add');   // add | remove
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [idem, setIdem] = useState('');

  useEffect(() => { setBalance(Number(client.credit) || 0); }, [client.id]); // eslint-disable-line

  function openForm() {
    setIdem(`cadj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    setAmt(''); setReason(''); setDir('add'); setOpen(true);
  }
  async function apply() {
    const a = Number(amt) || 0;
    if (a <= 0) { showToast('Enter an amount'); return; }
    if (!reason.trim()) { showToast('Add a reason'); return; }
    setBusy(true);
    try {
      const cents = Math.round(a * 100) * (dir === 'remove' ? -1 : 1);
      const res = await callFn('adjustClientCredit')({ tenantId: TENANT_ID, clientId: client.id, deltaCents: cents, reason: reason.trim(), idempotencyKey: idem });
      if (!res.data?.ok) throw new Error(res.data?.error || 'Failed');
      setBalance(Number(res.data.credit) || 0);
      onChange?.({ credit: Number(res.data.credit) || 0 });   // refresh the open profile's displayed balance (the save already persisted)
      setOpen(false);
      showToast(`Store credit updated — balance $${(Number(res.data.credit) || 0).toFixed(2)}`);
      onReload?.();
    } catch (e) { showToast('Couldn\'t adjust credit: ' + (e?.message || 'error')); }
    finally { setBusy(false); }
  }

  const tab = (on) => ({ flex: 1, padding: '7px 8px', borderRadius: 7, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12.5, background: on ? '#2D7A5F' : 'var(--pn-surface-muted)', color: on ? '#fff' : 'var(--pn-text-muted)' });

  return (
    <div style={{ marginBottom: 14, borderRadius: 8, background: 'var(--pn-success-bg)', border: '1px solid #2D7A5F', padding: '10px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#2D7A5F' }}>💳 Store credit balance</span>
        <span style={{ fontSize: 16, fontWeight: 800, color: '#2D7A5F' }}>${balance.toFixed(2)}</span>
      </div>
      {!open ? (
        <button onClick={openForm} style={{ marginTop: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: '1px solid #2D7A5F', background: 'transparent', color: '#2D7A5F', cursor: 'pointer', fontFamily: 'inherit' }}>Adjust store credit</button>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button onClick={() => setDir('add')} style={tab(dir === 'add')}>Add</button>
            <button onClick={() => setDir('remove')} style={tab(dir === 'remove')}>Remove</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ color: 'var(--pn-text-faint)' }}>$</span>
            <input type="number" min={0} value={amt} onChange={e => setAmt(e.target.value)} placeholder="0.00"
              style={{ flex: 1, fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)', color: 'var(--pn-text)' }} />
          </div>
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required)" maxLength={200}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)', color: 'var(--pn-text)', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={apply} disabled={busy || !(Number(amt) > 0) || !reason.trim()} style={{ flex: 1, padding: '8px', fontWeight: 800, fontSize: 13, borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', cursor: busy ? 'default' : 'pointer', opacity: (busy || !(Number(amt) > 0) || !reason.trim()) ? 0.5 : 1, fontFamily: 'inherit' }}>{busy ? 'Saving…' : dir === 'remove' ? 'Remove credit' : 'Add credit'}</button>
            <button onClick={() => setOpen(false)} style={{ padding: '8px 14px', fontWeight: 700, fontSize: 13, borderRadius: 8, border: '1px solid var(--pn-border)', background: 'transparent', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--pn-text-faint)', marginTop: 8, lineHeight: 1.4 }}>Adjustments are audit-logged and alert all admins.</div>
        </div>
      )}
    </div>
  );
}

function ClientModal({ client, allClients = [], initialMode = 'edit', onChange, onSave, onClose, onReload }) {
  const { gUser, settings, showToast, isAdmin, isTech, hasCap } = useApp();
  const [mode,             setMode]             = useState(initialMode);
  const [tab,              setTab]              = useState('profile');
  const [saving,           setSaving]           = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const [recordingReview,  setRecordingReview]  = useState(false);
  const [reviewForm,       setReviewForm]       = useState({ rating: 5, date: new Date().toISOString().slice(0, 10), note: '', techName: '' });
  const [services,     setServices]     = useState([]);
  const [apptHistory,  setApptHistory]  = useState(null);
  const [expandedApptId, setExpandedApptId] = useState(null);
  const [clientLightbox,  setClientLightbox]  = useState(null);
  const [addingVisit,  setAddingVisit]  = useState(false);
  const [newVisit,     setNewVisit]     = useState(blankVisit());
  const [restoreOpen,  setRestoreOpen]  = useState(false);
  const fileRef = useRef(null);
  const cardFrontRef = useRef(null);
  const cardBackRef  = useRef(null);
  const isNew   = !client.id;
  const isView  = mode === 'view';
  // Insurance intake is ADMIN-ONLY (matches the Cards tab) AND gated on the
  // paid 'insurance' add-on. The data lives in an admin-only sub-doc — the
  // Firestore rules, not just this UI gate, withhold it from non-admin staff.
  const canInsurance = isAdmin && hasCap('insurance');
  const TABS    = ['profile', 'social', 'visits', ...(canInsurance ? ['insurance'] : []), 'cards'];

  // Loaded lazily from clients/{id}/private/insurance when the tab opens. Kept
  // in LOCAL state + a ref for the latest value, so an in-flight card upload
  // (the resize await) can't clobber a concurrent field edit, and persisted
  // straight to the sub-doc — never onto the staff-readable parent client doc.
  const [insData, setInsData] = useState(null);   // null = not loaded yet
  const insRef = useRef({});
  const ins = insData || {};
  // Local-only edit (persisted on Save, like the profile fields). insRef holds
  // the latest value so an in-flight card-resize await applies its patch on top
  // of any field typed in the meantime instead of a stale snapshot.
  const setIns = (patch) => {
    const next = { ...insRef.current, ...patch };
    insRef.current = next;
    setInsData(next);
  };
  const insLabel = { fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', margin: '0 0 4px', display: 'block' };
  const insInput = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, background: 'var(--pn-bg)', color: 'var(--pn-text)' };

  useEffect(() => {
    fetchServices().then(s => setServices(s.map(sv => sv.name))).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'visits' && client.id && apptHistory === null) {
      fetchClientAppointments(client.id)
        .then(setApptHistory)
        .catch(() => setApptHistory([]));
    }
  }, [tab, client.id]); // eslint-disable-line

  useEffect(() => {
    if (tab === 'insurance' && canInsurance && client.id && insData === null) {
      fetchClientInsurance(client.id)
        .then(d => { insRef.current = d || {}; setInsData(d || {}); })
        .catch(() => { insRef.current = {}; setInsData({}); });
    }
  }, [tab, canInsurance, client.id]); // eslint-disable-line

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { onChange({ picture: await resizeImg(file, 300, 300, 0.82) }); }
    catch (err) { logError('client_photo', err, { fileType: file.type, fileSize: file.size }); }
  }

  async function handleCardPhoto(side, e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setIns({ [side]: await resizeImg(file, 600, 380, 0.72) }); }
    catch (err) { logError('client_insurance_card', err, { side, fileType: file.type }); }
  }

  async function submit() {
    if (!client.name?.trim()) return;
    setSaving(true);
    try {
      await onSave();
      // Persist insurance to its admin-only sub-doc (only if the tab was
      // opened + loaded for this existing client). Never written for new
      // clients (no id) or when the add-on/admin gate is off.
      if (canInsurance && client.id && insData !== null) {
        await saveClientInsurance(client.id, insRef.current);
      }
    } finally { setSaving(false); }
  }

  async function handleRequestReview() {
    if (!client.email || !settings?.googleReviewUrl) return;
    setRequestingReview(true);
    try {
      await createReviewRequest({
        clientId:       client.id,
        clientName:     client.name,
        clientEmail:    client.email,
        googleReviewUrl: settings.googleReviewUrl,
      });
      const now = new Date().toISOString();
      await saveClient(client.id, { reviewRequestedAt: now });
      onChange({ reviewRequestedAt: now });
      logActivity('review_requested', `${client.name}${client.email ? ' · ' + client.email : ''}`);
      showToast('Review request sent!');
    } catch (e) {
      showToast('Failed to send: ' + e.message, 3000);
    } finally {
      setRequestingReview(false);
    }
  }

  async function handleRecordReview() {
    const entry = {
      rating:   reviewForm.rating,
      date:     reviewForm.date || new Date().toISOString().slice(0, 10),
      text:     reviewForm.note,
      techName: reviewForm.techName || null,
      url:      '',
    };
    const updated = [...(client.googleReviews || []), entry];
    onChange({ googleReviews: updated });
    try {
      await saveClient(client.id, { googleReviews: updated });
      await saveReviewReceived({
        clientId:   client.id,
        clientName: client.name,
        rating:     entry.rating,
        date:       entry.date,
        techName:   entry.techName,
      });
      logActivity('review_received', `${client.name} · ${'★'.repeat(entry.rating)}${entry.techName ? ' · ' + entry.techName : ''}`);
      showToast('Review recorded!');
    } catch (e) {
      showToast('Failed to save: ' + e.message, 3000);
    }
    setRecordingReview(false);
    setReviewForm({ rating: 5, date: new Date().toISOString().slice(0, 10), note: '', techName: '' });
  }

  function addVisit() {
    const visits = [...(client.visits || []), { ...newVisit, id: Date.now().toString() }];
    onChange({ visits });
    setNewVisit(blankVisit());
    setAddingVisit(false);
  }

  function removeVisit(id) {
    onChange({ visits: (client.visits || []).filter(v => v.id !== id) });
  }

  function patchNewVisitService(i, patch) {
    const svcs = newVisit.services.map((s, idx) => idx === i ? { ...s, ...patch } : s);
    setNewVisit(v => ({ ...v, services: svcs }));
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 460, maxHeight: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>
              {isNew ? 'New Client' : isView ? client.name || 'Client' : 'Edit Client'}
            </span>
            {isView && !isNew && (
              <span style={{ fontSize: 10, background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', borderRadius: 20, padding: '2px 8px', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>view</span>
            )}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, padding: '9px 0', fontSize: 12, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#3D95CE' : 'var(--pn-text-muted)', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize' }}>
              {t}{t === 'visits' && client.visits?.length ? ` (${client.visits.length})` : ''}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

          {/* ── Profile tab ── */}
          {tab === 'profile' && (
            <>
              {/* Photo + name row */}
              <div style={{ display: 'flex', gap: 14, marginBottom: 14, alignItems: 'flex-start' }}>
                <div style={{ flexShrink: 0 }}>
                  <div
                    onClick={isView ? undefined : () => fileRef.current?.click()}
                    style={{ width: 72, height: 72, borderRadius: '50%', overflow: 'hidden', background: 'var(--pn-surface-muted)', cursor: isView ? 'default' : 'pointer', border: '2px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {client.picture
                      ? <img src={client.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 28 }}>👤</span>
                    }
                  </div>
                  {!isView && (
                    <>
                      <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 3, cursor: 'pointer' }} onClick={() => fileRef.current?.click()}>photo</div>
                      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handlePhoto} />
                    </>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <Field label="Full name">
                    {isView
                      ? <ViewVal>{client.name || '—'}</ViewVal>
                      : <input value={client.name} onChange={e => onChange({ name: e.target.value })} placeholder="Jane Smith" style={inp} />
                    }
                  </Field>
                  <Field label="Birthday">
                    {isView
                      ? <ViewVal>{client.birthday ? formatDate(client.birthday) : '—'}</ViewVal>
                      : <input type="date" value={client.birthday || ''} onChange={e => onChange({ birthday: e.target.value })} style={inp} />
                    }
                  </Field>
                </div>
              </div>

              {(isAdmin || isTech)
                ? <CreditAdjuster client={client} onReload={onReload} onChange={onChange} showToast={showToast} />
                : Number(client.credit) > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', marginBottom: 14, borderRadius: 8, background: 'var(--pn-success-bg)', border: '1px solid #2D7A5F' }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#2D7A5F' }}>💳 Store credit balance</span>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#2D7A5F' }}>${Number(client.credit).toFixed(2)}</span>
                  </div>
                )}

              <Field label="Phone">
                {isView
                  ? <CopyVal value={client.phone} />
                  : (() => {
                      const phone = client.phone?.trim();
                      const dup = phone && allClients.find(c => c.id !== client.id && c.phone?.trim() === phone);
                      return (
                        <>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input value={client.phone || ''} onChange={e => onChange({ phone: e.target.value })} placeholder="(555) 000-0000" style={{ ...inp, flex: 1 }} />
                            {phone && <CopyBtn value={phone} />}
                          </div>
                          {dup && <DupWarn name={dup.name} />}
                        </>
                      );
                    })()
                }
              </Field>
              <Field label="Email">
                {isView
                  ? <CopyVal value={client.email} />
                  : (() => {
                      const email = client.email?.trim().toLowerCase();
                      const dup = email && allClients.find(c => c.id !== client.id && c.email?.trim().toLowerCase() === email);
                      return (
                        <>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <input type="email" value={client.email || ''} onChange={e => onChange({ email: e.target.value })} placeholder="jane@example.com" style={{ ...inp, flex: 1 }} />
                            {email && <CopyBtn value={client.email} />}
                          </div>
                          {dup && <DupWarn name={dup.name} />}
                        </>
                      );
                    })()
                }
              </Field>
              <Field label="Address">
                {isView
                  ? <CopyVal value={client.address} />
                  : <input value={client.address || ''} onChange={e => onChange({ address: e.target.value })} placeholder="123 Main St, City, State" style={inp} />
                }
              </Field>
              {/* Allergies — surfaces a red ⚠ banner on appt blocks
                  in the schedule grid so techs can re-confirm before
                  starting the service. Free-text comma-separated. */}
              <Field label={<span style={{ color: client.allergies ? '#991b1b' : undefined, fontWeight: client.allergies ? 700 : undefined }}>{client.allergies ? '⚠ Allergies' : 'Allergies'}</span>}>
                {isView
                  ? (client.allergies
                      ? <span style={{ color: 'var(--pn-danger)', fontWeight: 700, background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', padding: '4px 10px', borderRadius: 8, display: 'inline-block', fontSize: 13 }}>⚠ {client.allergies}</span>
                      : <ViewVal>—</ViewVal>)
                  : <input value={client.allergies || ''} onChange={e => onChange({ allergies: e.target.value })} placeholder="e.g. Latex, acetone, gel" style={{ ...inp, borderColor: client.allergies ? '#f59e0b' : undefined, background: client.allergies ? 'var(--pn-warning-bg)' : undefined }} />
                }
              </Field>
              <Field label="Notes">
                <NotesEditor
                  entries={client.notesLog}
                  legacy={client.notes}
                  onChange={notesLog => onChange({ notesLog })}
                  viewOnly={isView}
                  author={gUser?.email || gUser?.displayName || ''}
                  enableSoap={settings?.clinicalNotes === true}
                />
              </Field>
              <Field label="Banned">
                {isView
                  ? <ViewVal style={{ color: client.banned ? '#b91c1c' : undefined, fontWeight: client.banned ? 600 : undefined }}>{client.banned ? '🚫 Banned — do not accept bookings' : '—'}</ViewVal>
                  : <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--pn-text)' }}>
                      <input type="checkbox" checked={!!client.banned} onChange={e => onChange({ banned: e.target.checked })} />
                      Do not accept bookings from this client
                    </label>
                }
              </Field>
              <Field label="Test subject">
                {isView
                  ? <ViewVal style={{ color: client.testSubject ? '#1d4ed8' : undefined, fontWeight: client.testSubject ? 600 : undefined }}>{client.testSubject ? '🧪 Test subject (marketing)' : '—'}</ViewVal>
                  : <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--pn-text)' }}>
                      <input type="checkbox" checked={!!client.testSubject} onChange={e => onChange({ testSubject: e.target.checked })} />
                      Include in "Test subjects" marketing audience
                    </label>
                }
              </Field>
              <Field label="Communication preferences">
                {(() => {
                  const cp = client.commPreferences || defaultCommPreferences();
                  const setCp = (patch) => onChange({ commPreferences: { ...cp, ...patch } });
                  const Row = ({ label, smsKey, emailKey, voiceKey, hint }) => (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 4 }}>{label}</div>
                      {hint && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 6 }}>{hint}</div>}
                      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--pn-text)', flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: isView ? 'default' : 'pointer' }}>
                          <input type="checkbox" disabled={isView} checked={!!cp[smsKey]} onChange={e => setCp({ [smsKey]: e.target.checked })} /> SMS
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: isView ? 'default' : 'pointer' }}>
                          <input type="checkbox" disabled={isView} checked={!!cp[emailKey]} onChange={e => setCp({ [emailKey]: e.target.checked })} /> Email
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: isView ? 'default' : 'pointer', color: 'var(--pn-text-faint)' }}
                          title="Voice channel coming in a future release.">
                          <input type="checkbox" disabled={isView} checked={!!cp[voiceKey]} onChange={e => setCp({ [voiceKey]: e.target.checked })} /> Voice <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>(soon)</span>
                        </label>
                      </div>
                    </div>
                  );
                  return (
                    <div style={{ background: isView ? 'var(--pn-bg)' : 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '10px 12px' }}>
                      <Row label="Appointment messages" smsKey="appointmentSms" emailKey="appointmentEmail" voiceKey="appointmentVoice"
                        hint="Confirmations, reminders, reschedule notices, receipts." />
                      <Row label="Marketing messages" smsKey="marketingSms" emailKey="marketingEmail" voiceKey="marketingVoice"
                        hint="Campaigns, promotions, seasonal offers." />
                    </div>
                  );
                })()}
              </Field>
              <Field label="Marketing opt-out">
                {isView
                  ? (
                    <ViewVal style={{ color: client.marketingOptOut ? '#92400e' : undefined, fontWeight: client.marketingOptOut ? 600 : undefined }}>
                      {client.marketingOptOut ? (
                        <>
                          🔕 Opted out of marketing
                          {(client.marketingOptOutAt || client.marketingOptOutVia) && (
                            <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--pn-warning)', marginTop: 3 }}>
                              {client.marketingOptOutAt ? `Opted out: ${new Date(client.marketingOptOutAt).toLocaleString()}` : ''}
                              {client.marketingOptOutVia ? <> · via <code style={{ background: 'var(--pn-warning-bg)', padding: '0 4px', borderRadius: 3, fontSize: 10 }}>{client.marketingOptOutVia}</code></> : ''}
                            </div>
                          )}
                        </>
                      ) : (
                        <span>Subscribed (will receive marketing campaigns)</span>
                      )}
                    </ViewVal>
                  )
                  : (
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 14, color: 'var(--pn-text)' }}>
                      <input type="checkbox" checked={!!client.marketingOptOut}
                        onChange={e => {
                          const opted = e.target.checked;
                          onChange({
                            marketingOptOut: opted,
                            marketingOptOutAt: opted ? new Date().toISOString() : null,
                            marketingOptOutVia: opted ? 'manual_admin' : null,
                          });
                        }} />
                      <span>
                        Exclude from marketing campaigns
                        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>Email and SMS audiences automatically skip opted-out clients. Transactional messages (receipts, reminders) still send.</div>
                      </span>
                    </label>
                  )
                }
              </Field>
              <Field label="Referred by">
                {isView
                  ? (() => {
                      const count = allClients.filter(c => c.referredBy?.id === client.id).length;
                      return (
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <ViewVal>{client.referredBy?.name || '—'}</ViewVal>
                          {count > 0 && (
                            <span style={{ fontSize: 11, background: 'var(--pn-success-bg)', color: 'var(--pn-success)', borderRadius: 10, padding: '2px 9px', fontWeight: 600 }}>
                              Referred {count} {count === 1 ? 'client' : 'clients'}
                            </span>
                          )}
                        </div>
                      );
                    })()
                  : <select value={client.referredBy?.id || ''} onChange={e => {
                      const ref = allClients.find(c => c.id === e.target.value);
                      onChange({ referredBy: ref ? { id: ref.id, name: ref.name } : null });
                    }} style={inp}>
                      <option value="">— None —</option>
                      {allClients.filter(c => c.id !== client.id).sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                }
              </Field>
            </>
          )}

              {/* Review request — view mode only, admin only, existing clients with email */}
              {isView && client.id && client.email && isAdmin && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--pn-border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 6 }}>
                    GOOGLE REVIEW
                    {client.reviewRequestedAt && (
                      <span style={{ marginLeft: 8, fontWeight: 400 }}>
                        · last requested {(() => {
                          const days = Math.floor((Date.now() - new Date(client.reviewRequestedAt)) / 86400000);
                          return days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
                        })()}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleRequestReview}
                    disabled={requestingReview || !settings?.googleReviewUrl}
                    title={!settings?.googleReviewUrl ? 'Set Google Review URL in Admin → Settings first' : ''}
                    style={{ width: '100%', padding: '8px', borderRadius: 8, border: `1px solid ${settings?.googleReviewUrl ? '#f59e0b' : 'var(--pn-border)'}`, background: settings?.googleReviewUrl ? 'var(--pn-warning-bg)' : 'var(--pn-bg)', color: requestingReview ? 'var(--pn-text-faint)' : settings?.googleReviewUrl ? 'var(--pn-warning)' : 'var(--pn-text-faint)', fontSize: 12, fontWeight: 600, cursor: settings?.googleReviewUrl && !requestingReview ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                    {requestingReview ? 'Sending…' : '⭐ Request Google Review'}
                  </button>
                  {!settings?.googleReviewUrl && (
                    <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 4 }}>
                      Set Google Review URL in Admin → Settings to enable
                    </div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    {!recordingReview ? (
                      <button
                        onClick={() => setRecordingReview(true)}
                        style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px solid #bbf7d0', background: 'var(--pn-success-bg)', color: 'var(--pn-success)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                        📥 Record review received
                      </button>
                    ) : (
                      <div style={{ background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 8, padding: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-success)', marginBottom: 8 }}>Record Google Review</div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                          {[1,2,3,4,5].map(n => (
                            <button key={n} onClick={() => setReviewForm(f => ({ ...f, rating: n }))}
                              style={{ flex: 1, padding: '6px 0', border: `1px solid ${reviewForm.rating >= n ? '#f59e0b' : 'var(--pn-border)'}`, borderRadius: 6, background: reviewForm.rating >= n ? 'var(--pn-warning-bg)' : 'var(--pn-surface)', color: 'var(--pn-text)', fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                              ★
                            </button>
                          ))}
                        </div>
                        <input type="date" value={reviewForm.date} onChange={e => setReviewForm(f => ({ ...f, date: e.target.value }))}
                          style={{ width: '100%', fontFamily: 'inherit', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }} />
                        <input value={reviewForm.techName} onChange={e => setReviewForm(f => ({ ...f, techName: e.target.value }))}
                          placeholder="Tech name (optional)"
                          style={{ width: '100%', fontFamily: 'inherit', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, marginBottom: 6, boxSizing: 'border-box' }} />
                        <input value={reviewForm.note} onChange={e => setReviewForm(f => ({ ...f, note: e.target.value }))}
                          placeholder="Note (optional)"
                          style={{ width: '100%', fontFamily: 'inherit', border: '1px solid var(--pn-border)', borderRadius: 6, padding: '5px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }} />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => setRecordingReview(false)}
                            style={{ flex: 1, padding: '6px', border: '1px solid var(--pn-border-strong)', borderRadius: 6, background: 'var(--pn-surface)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
                            Cancel
                          </button>
                          <button onClick={handleRecordReview}
                            style={{ flex: 2, padding: '6px', border: 'none', borderRadius: 6, background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                            Save
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

          {/* ── Social tab ── */}
          {tab === 'social' && (
            <>
              {/* Handles */}
              {[
                { key: 'instagram', label: 'Instagram',  icon: '📸', placeholder: '@username' },
                { key: 'facebook',  label: 'Facebook',   icon: '👥', placeholder: 'username or profile URL' },
                { key: 'tiktok',    label: 'TikTok',     icon: '🎵', placeholder: '@username' },
                { key: 'venmo',     label: 'Venmo',      icon: '💸', placeholder: '@username' },
              ].map(({ key, label, icon, placeholder }) => (
                <Field key={key} label={`${icon} ${label}`}>
                  {isView
                    ? <CopyVal value={client[key]} />
                    : (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input value={client[key] || ''} onChange={e => onChange({ [key]: e.target.value })} placeholder={placeholder} style={{ ...inp, flex: 1 }} />
                        {client[key] && <CopyBtn value={client[key]} />}
                      </div>
                    )
                  }
                </Field>
              ))}

              <Divider />

              {/* Instagram tags */}
              <SectionHeader icon="🏷️" title="Instagram Posts Tagged In" />
              {(client.instagramTags || []).length === 0 && isView && (
                <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 8 }}>None recorded.</div>
              )}
              {(client.instagramTags || []).map((tag, i) => (
                <div key={i} style={{ background: 'var(--pn-bg)', borderRadius: 8, border: '1px solid var(--pn-border)', padding: 10, marginBottom: 8 }}>
                  {isView ? (
                    <>
                      {tag.url
                        ? <a href={tag.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#3D95CE', wordBreak: 'break-all', display: 'block', marginBottom: tag.note ? 4 : 0 }}>{tag.url}</a>
                        : <div style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>No URL</div>
                      }
                      {tag.note && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{tag.note}</div>}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          value={tag.url}
                          onChange={e => onChange({ instagramTags: client.instagramTags.map((t, idx) => idx === i ? { ...t, url: e.target.value } : t) })}
                          placeholder="https://instagram.com/p/…"
                          style={{ ...inp, flex: 1 }}
                        />
                        <button onClick={() => onChange({ instagramTags: client.instagramTags.filter((_, idx) => idx !== i) })}
                          style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>×</button>
                      </div>
                      <input
                        value={tag.note}
                        onChange={e => onChange({ instagramTags: client.instagramTags.map((t, idx) => idx === i ? { ...t, note: e.target.value } : t) })}
                        placeholder="Note (e.g. red coffin nails, gel-x)…"
                        style={inp}
                      />
                    </>
                  )}
                </div>
              ))}
              {!isView && (
                <AddRowBtn onClick={() => onChange({ instagramTags: [...(client.instagramTags || []), blankTag()] })} label="+ Add Instagram post" />
              )}

              <Divider />

              {/* Google reviews */}
              <SectionHeader icon="⭐" title="Google Reviews" />
              {(client.googleReviews || []).length === 0 && isView && (
                <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginBottom: 8 }}>None recorded.</div>
              )}
              {(client.googleReviews || []).map((rev, i) => (
                <div key={i} style={{ background: 'var(--pn-bg)', borderRadius: 8, border: '1px solid var(--pn-border)', padding: 10, marginBottom: 8 }}>
                  {isView ? (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: rev.text ? 6 : 0 }}>
                        <span style={{ fontSize: 13, color: '#f59e0b' }}>{'★'.repeat(rev.rating)}</span>
                        <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>{formatDate(rev.date)}</span>
                        {rev.url && <a href={rev.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: '#3D95CE', marginLeft: 'auto' }}>link</a>}
                      </div>
                      {rev.text && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5 }}>{rev.text}</div>}
                    </>
                  ) : (
                    <>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          value={rev.url}
                          onChange={e => onChange({ googleReviews: client.googleReviews.map((r, idx) => idx === i ? { ...r, url: e.target.value } : r) })}
                          placeholder="Google review URL (optional)…"
                          style={{ ...inp, flex: 1 }}
                        />
                        <button onClick={() => onChange({ googleReviews: client.googleReviews.filter((_, idx) => idx !== i) })}
                          style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 18, padding: '0 4px', flexShrink: 0 }}>×</button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                        <Field label="Date" style={{ flex: 1, marginBottom: 0 }}>
                          <input type="date" value={rev.date}
                            onChange={e => onChange({ googleReviews: client.googleReviews.map((r, idx) => idx === i ? { ...r, date: e.target.value } : r) })}
                            style={inp} />
                        </Field>
                        <Field label="Rating" style={{ width: 90, marginBottom: 0 }}>
                          <select value={rev.rating}
                            onChange={e => onChange({ googleReviews: client.googleReviews.map((r, idx) => idx === i ? { ...r, rating: Number(e.target.value) } : r) })}
                            style={inp}>
                            {[5,4,3,2,1].map(n => <option key={n} value={n}>{'★'.repeat(n)}</option>)}
                          </select>
                        </Field>
                      </div>
                      <textarea
                        value={rev.text}
                        onChange={e => onChange({ googleReviews: client.googleReviews.map((r, idx) => idx === i ? { ...r, text: e.target.value } : r) })}
                        rows={2} placeholder="Review text…"
                        style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
                      />
                    </>
                  )}
                </div>
              ))}
              {!isView && (
                <AddRowBtn onClick={() => onChange({ googleReviews: [...(client.googleReviews || []), blankReview()] })} label="+ Add Google review" />
              )}
            </>
          )}

          {/* ── Visits tab ── */}
          {tab === 'visits' && (
            <>
              {/* Appointment history from scheduling system */}
              {client.id && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                    Appointment history
                  </div>
                  {apptHistory === null ? (
                    <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '8px 0' }}>Loading…</div>
                  ) : apptHistory.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '8px 0' }}>No appointments on record.</div>
                  ) : (
                    apptHistory.map(a => {
                      const photoCount = (a.photosBefore?.length || 0) + (a.photosAfter?.length || 0);
                      const isExpanded = expandedApptId === a.id;
                      return (
                        <div key={a.id} style={{ background: 'var(--pn-surface)', borderRadius: 8, border: '1px solid var(--pn-border)', marginBottom: 6, overflow: 'hidden' }}>
                          <div onClick={() => setExpandedApptId(isExpanded ? null : a.id)}
                            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', cursor: photoCount > 0 ? 'pointer' : 'default' }}>
                            <div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{formatDate(a.date)}</span>
                                {photoCount > 0 && (
                                  <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 10, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', border: '1px solid #c7dff7' }}>
                                    📸 {photoCount}
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>
                                {a.techName} · {(a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—'}
                              </div>
                            </div>
                            <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text)' }}>
                                ${(a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0).toFixed(2)}
                              </div>
                              <div style={{ fontSize: 10, color: a.status === 'done' ? '#16a34a' : a.status === 'cancelled' ? '#ef4444' : 'var(--pn-text-muted)', marginTop: 1, textTransform: 'capitalize' }}>
                                {a.status}
                              </div>
                            </div>
                          </div>
                          {isExpanded && photoCount > 0 && (
                            <div style={{ borderTop: '1px solid var(--pn-border)', padding: '10px 12px', background: 'var(--pn-bg)' }}>
                              {(a.photosBefore || []).length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Before</div>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {(a.photosBefore || []).map((src, i) => (
                                      <img key={i} src={src} alt="" onClick={() => setClientLightbox({ src, label: 'Before' })}
                                        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--pn-border)', cursor: 'pointer' }} />
                                    ))}
                                  </div>
                                </div>
                              )}
                              {(a.photosAfter || []).length > 0 && (
                                <div>
                                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>After</div>
                                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                    {(a.photosAfter || []).map((src, i) => (
                                      <img key={i} src={src} alt="" onClick={() => setClientLightbox({ src, label: 'After' })}
                                        style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--pn-border)', cursor: 'pointer' }} />
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Manual visit notes */}
              {(client.visits || []).length > 0 && (
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
                  Manual notes
                </div>
              )}
              {(client.visits || []).length === 0 && !addingVisit && !client.id && (
                <Empty>No visits recorded yet.</Empty>
              )}
              {[...(client.visits || [])].reverse().map(v => (
                <VisitCard key={v.id} visit={v} onRemove={() => removeVisit(v.id)} readOnly={isView} />
              ))}

              {!isView && (
                addingVisit ? (
                  <div style={{ background: 'var(--pn-bg)', borderRadius: 10, border: '1px solid var(--pn-border)', padding: 14, marginTop: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 10 }}>New Visit</div>

                    <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                      <Field label="Date" style={{ flex: 1 }}>
                        <input type="date" value={newVisit.date} onChange={e => setNewVisit(v => ({ ...v, date: e.target.value }))} style={inp} />
                      </Field>
                      <Field label="Tech" style={{ flex: 1 }}>
                        <input value={newVisit.tech} onChange={e => setNewVisit(v => ({ ...v, tech: e.target.value }))} placeholder="Tech name" style={inp} />
                      </Field>
                    </div>

                    <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 6 }}>Services</div>
                    {newVisit.services.map((svc, i) => (
                      <div key={i} style={{ background: 'var(--pn-surface)', borderRadius: 8, border: '1px solid var(--pn-border)', padding: 10, marginBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                          <select value={svc.name} onChange={e => patchNewVisitService(i, { name: e.target.value })} style={{ ...inp, flex: 2 }}>
                            <option value="">Pick service…</option>
                            {services.map(s => <option key={s} value={s}>{s}</option>)}
                            <option value="__custom__">Other (type below)</option>
                          </select>
                          <input
                            type="number" min={0} value={svc.price} onChange={e => patchNewVisitService(i, { price: e.target.value })}
                            placeholder="$" style={{ ...inp, width: 60 }}
                          />
                          {newVisit.services.length > 1 && (
                            <button onClick={() => setNewVisit(v => ({ ...v, services: v.services.filter((_, idx) => idx !== i) }))}
                              style={{ border: 'none', background: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                          )}
                        </div>
                        {svc.name === '__custom__' && (
                          <input value={svc.customName || ''} onChange={e => patchNewVisitService(i, { customName: e.target.value })} placeholder="Service name" style={{ ...inp, marginBottom: 6 }} />
                        )}
                        <textarea value={svc.notes} onChange={e => patchNewVisitService(i, { notes: e.target.value })} rows={2}
                          placeholder="Notes for this service (color, shape, design…)" style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
                      </div>
                    ))}
                    <button onClick={() => setNewVisit(v => ({ ...v, services: [...v.services, { name: '', price: '', notes: '' }] }))}
                      style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 0', marginBottom: 8 }}>
                      + Add another service
                    </button>

                    <Field label="Visit notes">
                      <textarea value={newVisit.notes} onChange={e => setNewVisit(v => ({ ...v, notes: e.target.value }))} rows={2}
                        placeholder="Overall visit notes…" style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
                    </Field>

                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                      <button onClick={() => setAddingVisit(false)} style={{ flex: 1, ...btnBase }}>Cancel</button>
                      <button onClick={addVisit} style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE' }}>Save Visit</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => { setAddingVisit(true); setNewVisit(blankVisit()); }}
                    style={{ marginTop: 10, width: '100%', ...btnBase, color: '#3D95CE', borderStyle: 'dashed' }}>
                    + Record Visit
                  </button>
                )
              )}
            </>
          )}

          {/* ── Insurance tab (admin-only + 'insurance' add-on; admin-only sub-doc) ── */}
          {tab === 'insurance' && (
            isNew ? (
              <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', padding: '8px 2px', lineHeight: 1.5 }}>
                Save the client first, then reopen to add insurance details.
              </div>
            ) : insData === null ? (
              <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', padding: '8px 2px' }}>Loading…</div>
            ) : (
            <>
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', lineHeight: 1.5, marginBottom: 14 }}>
                Insurance details for superbills / out-of-network reimbursement. Intake only — Plume does not file claims. Stored admin-only.
              </div>

              <div style={{ marginBottom: 12 }}>
                <label style={insLabel}>Insurance carrier</label>
                <input style={insInput} value={ins.carrier || ''} disabled={isView} placeholder="e.g. Blue Cross Blue Shield"
                  onChange={e => setIns({ carrier: e.target.value })} />
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={insLabel}>Member / Subscriber ID</label>
                  <input style={insInput} value={ins.memberId || ''} disabled={isView}
                    onChange={e => setIns({ memberId: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={insLabel}>Group number</label>
                  <input style={insInput} value={ins.groupNumber || ''} disabled={isView}
                    onChange={e => setIns({ groupNumber: e.target.value })} />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={insLabel}>Plan type</label>
                  <select style={insInput} value={ins.planType || ''} disabled={isView}
                    onChange={e => setIns({ planType: e.target.value })}>
                    <option value="">—</option>
                    <option>PPO</option><option>HMO</option><option>EPO</option><option>POS</option><option>HDHP</option><option>Other</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={insLabel}>Relationship to holder</label>
                  <select style={insInput} value={ins.holderRelationship || 'self'} disabled={isView}
                    onChange={e => setIns({ holderRelationship: e.target.value })}>
                    <option value="self">Self</option><option value="spouse">Spouse</option><option value="child">Child</option><option value="other">Other</option>
                  </select>
                </div>
              </div>

              {ins.holderRelationship && ins.holderRelationship !== 'self' && (
                <div style={{ marginBottom: 12 }}>
                  <label style={insLabel}>Policy holder name</label>
                  <input style={insInput} value={ins.holderName || ''} disabled={isView}
                    onChange={e => setIns({ holderName: e.target.value })} />
                </div>
              )}

              <label style={insLabel}>Insurance card</label>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {['cardFront', 'cardBack'].map((side, i) => {
                  const ref = i === 0 ? cardFrontRef : cardBackRef;
                  return (
                    <div key={side} style={{ flex: 1 }}>
                      <div
                        onClick={isView ? undefined : () => ref.current?.click()}
                        style={{ aspectRatio: '1.6 / 1', borderRadius: 8, overflow: 'hidden', background: 'var(--pn-surface-muted)', border: '1px dashed var(--pn-border-strong)', cursor: isView ? 'default' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {ins[side]
                          ? <img src={ins[side]} alt={side} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{i === 0 ? 'Front' : 'Back'}</span>}
                      </div>
                      {!isView && (
                        <>
                          <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textAlign: 'center', marginTop: 3, cursor: 'pointer' }} onClick={() => ref.current?.click()}>
                            {ins[side] ? 'replace' : 'upload'} {i === 0 ? 'front' : 'back'}
                          </div>
                          <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={e => handleCardPhoto(side, e)} />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, cursor: isView ? 'default' : 'pointer' }}>
                <input type="checkbox" checked={!!ins.verified} disabled={isView}
                  onChange={e => setIns({ verified: e.target.checked, verifiedAt: e.target.checked ? new Date().toISOString() : '' })}
                  style={{ accentColor: '#2D7A5F' }} />
                <span style={{ fontSize: 13, color: 'var(--pn-text)' }}>Eligibility verified{ins.verified && ins.verifiedAt ? ` · ${ins.verifiedAt.slice(0, 10)}` : ''}</span>
              </label>

              <div>
                <label style={insLabel}>Notes (authorization #, referral, copay…)</label>
                <textarea style={{ ...insInput, minHeight: 60, resize: 'vertical' }} value={ins.notes || ''} disabled={isView}
                  onChange={e => setIns({ notes: e.target.value })} />
              </div>
            </>
            )
          )}

          {/* ── Cards tab ── */}
          {tab === 'cards' && (
            <SavedCardsTab
              client={client}
              onChange={onChange}
              onReload={onReload}
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8, flexShrink: 0 }}>
          {isView ? (
            <>
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Close</button>
              {!isNew && isAdmin && (
                <button onClick={() => setRestoreOpen(true)}
                  title="Restore an earlier version of this client from the BigQuery mirror"
                  style={{ ...btnBase, padding: '8px 12px', fontSize: 12, color: 'var(--pn-text-muted)' }}>
                  ⏳ History
                </button>
              )}
              {!isNew && (
                <button onClick={() => setMode('edit')} style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE' }}>
                  Edit
                </button>
              )}
            </>
          ) : (
            <>
              <button onClick={onClose} style={{ flex: 1, ...btnBase }}>Cancel</button>
              <button onClick={submit} disabled={saving || !client.name?.trim()}
                style={{ flex: 2, ...btnBase, background: '#3D95CE', color: '#fff', borderColor: '#3D95CE', opacity: (saving || !client.name?.trim()) ? .6 : 1 }}>
                {saving ? 'Saving…' : (isNew ? 'Add Client' : 'Save Changes')}
              </button>
            </>
          )}
        </div>
      </div>

      {restoreOpen && client.id && (
        <RestoreFromBQModal
          collection="clients"
          docId={client.id}
          label={client.name}
          onClose={() => setRestoreOpen(false)}
          onRestored={async () => {
            setRestoreOpen(false);
            await onReload?.();
            onClose();
            showToast('Client restored from BigQuery snapshot');
          }}
        />
      )}

      {clientLightbox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 300, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}
             onClick={() => setClientLightbox(null)}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.45)', textTransform: 'uppercase', letterSpacing: '.1em' }}>
            {clientLightbox.label}
          </div>
          <img src={clientLightbox.src} alt="" style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 10 }}
               onClick={e => e.stopPropagation()} />
          <button onClick={() => setClientLightbox(null)}
            style={{ position: 'absolute', top: 16, right: 16, width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,.15)', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function VisitCard({ visit, onRemove, readOnly }) {
  const [open, setOpen] = useState(false);
  const total = visit.services?.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
  return (
    <div style={{ background: 'var(--pn-surface)', borderRadius: 10, border: '1px solid var(--pn-border)', marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{formatDate(visit.date)}</div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>
            {visit.tech && `${visit.tech} · `}
            {visit.services?.map(s => s.name === '__custom__' ? s.customName : s.name).filter(Boolean).join(', ') || 'No services'}
            {total > 0 && ` · $${total}`}
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ borderTop: '1px solid var(--pn-border)', padding: '10px 12px' }}>
          {visit.services?.map((s, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--pn-text)' }}>
                {s.name === '__custom__' ? s.customName : s.name}
                {s.price ? <span style={{ color: 'var(--pn-text-muted)', fontWeight: 400 }}> · ${s.price}</span> : ''}
              </div>
              {s.notes && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>{s.notes}</div>}
            </div>
          ))}
          {visit.notes && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', borderTop: '1px solid var(--pn-border)', paddingTop: 8, marginTop: 4 }}>{visit.notes}</div>}
          {!readOnly && (
            <button onClick={onRemove} style={{ marginTop: 8, fontSize: 11, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Remove visit</button>
          )}
        </div>
      )}
    </div>
  );
}

function Avatar({ picture, name, size = 36 }) {
  const [err, setErr] = useState(false);
  if (picture && !err) {
    return <img src={picture} alt="" onError={() => setErr(true)} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  const initials = name?.trim().split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const colors = ['#4A7DB5', '#2D7A5F', '#B57A4A', '#7A4AB5', '#B54A7A'];
  const bg = colors[name?.charCodeAt(0) % colors.length] || '#888';
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, fontWeight: 600, color: '#fff' }}>
      {initials}
    </div>
  );
}

function formatDate(str) {
  if (!str) return '';
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 10, ...style }}>
      <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>{label}</label>
      {children}
    </div>
  );
}

function ViewVal({ children, style }) {
  return (
    <div style={{ fontSize: 13, color: 'var(--pn-text)', padding: '6px 0', minHeight: 28, lineHeight: 1.5, ...style }}>
      {children}
    </div>
  );
}

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }
  return (
    <button onClick={copy} title="Copy" style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: copied ? '#2D7A5F' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0, height: 28 }}>
      {copied ? '✓' : 'Copy'}
    </button>
  );
}

function DupWarn({ name }) {
  return (
    <div style={{ fontSize: 11, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 6, padding: '4px 9px', marginTop: 4 }}>
      ⚠ Already used by <strong>{name}</strong>
    </div>
  );
}

function CopyVal({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <ViewVal>—</ViewVal>;
  function copy() {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <ViewVal style={{ flex: 1, padding: '6px 0' }}>{value}</ViewVal>
      <button onClick={copy} title="Copy" style={{ fontSize: 11, padding: '2px 7px', borderRadius: 5, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: copied ? '#2D7A5F' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}

function Btn({ onClick, color, children }) {
  return <Button onClick={onClick} color={color}>{children}</Button>;
}

function Empty({ children }) {
  return <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

function Divider() {
  return <div style={{ borderTop: '1px solid var(--pn-border)', margin: '14px 0' }} />;
}

function SectionHeader({ icon, title }) {
  return <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{icon} {title}</div>;
}

function AddRowBtn({ onClick, label }) {
  return (
    <button onClick={onClick} style={{ fontSize: 12, color: '#3D95CE', background: 'none', border: '1px dashed #b3d4ef', borderRadius: 8, cursor: 'pointer', padding: '7px 12px', width: '100%', fontFamily: 'inherit' }}>
      {label}
    </button>
  );
}

const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 11px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };
const btnBase = { fontFamily: 'inherit', fontSize: 13, fontWeight: 500, cursor: 'pointer', background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '8px 14px', color: 'var(--pn-text)' };
