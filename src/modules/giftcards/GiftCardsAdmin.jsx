import { useState, useEffect } from 'react';
import {
  fetchGiftCards, createGiftCard, updateGiftCard,
  fetchPromoCodes, createPromoCode, savePromoCode, deletePromoCode,
  subscribeToGiftCard, retryGiftCardEmail,
} from '../../lib/firestore';
import { useApp } from '../../context/AppContext';
import { logActivity } from '../../lib/logger';
import TrashButton from '../../components/TrashButton';

// ── helpers ─────────────────────────────────────────────
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) s += '-';
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return 'MNS-' + s;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmt$(n) { return '$' + Number(n).toFixed(2); }

function promoReason(p) {
  if (p.active) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (p.endDate && today > p.endDate)
    return { label: 'Expired', color: 'var(--pn-warning)', bg: 'var(--pn-warning-bg)', border: '#fde68a' };
  if (p.maxUses && (p.usedCount || 0) >= p.maxUses)
    return { label: 'Maxed out', color: '#7c3aed', bg: '#ede9fe', border: '#ddd6fe' };
  if (p.singleUse && p.usedAt)
    return { label: 'Used', color: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' };
  return null;
}

// ── main ─────────────────────────────────────────────────
export default function GiftCardsAdmin() {
  const { showToast, isAdmin } = useApp();
  const [tab,        setTab]        = useState('gift');
  const [giftCards,  setGiftCards]  = useState(null);
  const [promos,     setPromos]     = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [showGCModal,setShowGCModal]= useState(false);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [detailGC,   setDetailGC]   = useState(null);

  useEffect(() => { loadAll(); }, []); // eslint-disable-line

  async function loadAll() {
    setLoading(true);
    try {
      const [gc, pr] = await Promise.all([fetchGiftCards(), fetchPromoCodes()]);
      setGiftCards(gc);

      // Sweep: auto-deactivate promos whose end date has passed or max uses reached
      const today = new Date().toISOString().slice(0, 10);
      const stale = pr.filter(p => p.active && (
        (p.endDate && today > p.endDate) ||
        (p.maxUses && (p.usedCount || 0) >= p.maxUses)
      ));
      if (stale.length) {
        await Promise.all(stale.map(p => savePromoCode(p.id, { ...p, active: false })));
        setPromos(pr.map(p => stale.some(s => s.id === p.id) ? { ...p, active: false } : p));
      } else {
        setPromos(pr);
      }
    } catch (e) {
      console.error('[GiftCards] load failed:', e);
      setGiftCards([]); setPromos([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGC(data) {
    try {
      await createGiftCard(data);
      logActivity('gift_card_created', data.code);
      showToast('Gift card created');
      setShowGCModal(false);
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleVoidGC(gc) {
    if (!window.confirm(`Void gift card ${gc.code}? Remaining balance of ${fmt$(gc.balance)} will be forfeited.`)) return;
    try {
      await updateGiftCard(gc.id, { balance: 0, voided: true, voidedAt: new Date().toISOString() });
      logActivity('gift_card_voided', gc.code);
      showToast('Gift card voided');
      setDetailGC(null);
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleCreatePromo(data) {
    try {
      await createPromoCode(data);
      logActivity('promo_created', data.code);
      showToast('Promo code created');
      setShowPromoModal(false);
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleTogglePromo(p) {
    try {
      await savePromoCode(p.id, { ...p, active: !p.active });
      logActivity('promo_toggled', `${p.code} → ${!p.active}`);
      showToast(p.active ? 'Promo deactivated' : 'Promo activated');
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleDeletePromo(p) {
    if (!window.confirm(`Delete promo code "${p.code}"?`)) return;
    try {
      await deletePromoCode(p.id);
      logActivity('promo_deleted', p.code);
      showToast('Promo deleted');
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  async function handleEditPromo(p, patch) {
    try {
      await savePromoCode(p.id, { ...p, ...patch });
      logActivity('promo_edited', p.code);
      showToast('Promo updated');
      loadAll();
    } catch (e) { showToast('Failed: ' + e.message, 3000); }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--pn-text-faint)', fontSize: 14 }}>Loading…</div>;

  const activeGC      = (giftCards || []).filter(g => !g.voided && g.balance > 0);
  const depletedGC    = (giftCards || []).filter(g => !g.voided && g.balance <= 0);
  const voidedGC      = (giftCards || []).filter(g => g.voided);
  const totalOutstanding = activeGC.reduce((s, g) => s + (g.balance || 0), 0);

  const activePromos = (promos || []).filter(p => p.active);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 32 }}>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--pn-border)' }}>
        {[
          { id: 'gift',  label: `Gift Cards`, badge: activeGC.length },
          { id: 'promo', label: `Promo Codes`, badge: activePromos.length },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)',
            borderBottom: tab === t.id ? '2px solid #2D7A5F' : '2px solid transparent',
            marginBottom: -1, display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{ fontSize: 10, fontWeight: 700, background: '#2D7A5F', color: '#fff', borderRadius: 10, padding: '1px 6px' }}>{t.badge}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'gift' ? (
        <GiftCardsTab
          giftCards={giftCards}
          activeGC={activeGC} depletedGC={depletedGC} voidedGC={voidedGC}
          totalOutstanding={totalOutstanding}
          isAdmin={isAdmin}
          onNew={() => setShowGCModal(true)}
          onDetail={setDetailGC}
        />
      ) : (
        <PromosTab
          promos={promos}
          isAdmin={isAdmin}
          onNew={() => setShowPromoModal(true)}
          onToggle={handleTogglePromo}
          onDelete={handleDeletePromo}
          onEdit={handleEditPromo}
        />
      )}

      {showGCModal && (
        <GiftCardModal onSave={handleCreateGC} onClose={() => setShowGCModal(false)} />
      )}
      {showPromoModal && (
        <PromoModal onSave={handleCreatePromo} onClose={() => setShowPromoModal(false)} />
      )}
      {detailGC && (
        <GiftCardDetail gc={detailGC} isAdmin={isAdmin} onVoid={handleVoidGC} onClose={() => setDetailGC(null)} />
      )}
    </div>
  );
}

// ── Gift Cards tab ───────────────────────────────────────
function GiftCardsTab({ giftCards, activeGC, depletedGC, voidedGC, totalOutstanding, isAdmin, onNew, onDetail }) {
  const [filter, setFilter] = useState('active');
  const [search, setSearch] = useState('');

  const q = search.trim().toLowerCase();
  const bucket = filter === 'active'   ? activeGC
               : filter === 'depleted' ? depletedGC
               : voidedGC;
  // While searching, look across ALL cards (any status) so a buyer or
  // recipient can be found regardless of remaining balance.
  const shown = q ? (giftCards || []).filter(g => matchesGiftCard(g, q)) : bucket;

  return (
    <>
      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Active cards"       value={activeGC.length}            accent="#2D7A5F" />
        <StatCard label="Outstanding balance" value={fmt$(totalOutstanding)}    accent="#3D95CE" />
        <StatCard label="Total issued"        value={(giftCards || []).length}  />
      </div>

      {/* Search — by buyer, recipient, code, phone or email */}
      <div style={{ position: 'relative', marginBottom: 14 }}>
        <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--pn-text-faint)', pointerEvents: 'none' }}>🔍</span>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by buyer, recipient, code, phone or email…"
          style={{ ...inputStyle, paddingLeft: 34, paddingRight: search ? 34 : 12 }}
        />
        {search && (
          <button onClick={() => setSearch('')}
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 22, height: 22, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        )}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          {[
            { id: 'active',   label: `Active (${activeGC.length})` },
            { id: 'depleted', label: `Depleted (${depletedGC.length})` },
            { id: 'voided',   label: `Voided (${voidedGC.length})` },
          ].map(f => (
            <PillBtn key={f.id} active={!q && filter === f.id} onClick={() => { setSearch(''); setFilter(f.id); }}>{f.label}</PillBtn>
          ))}
        </div>
        <TrashButton collections={['giftCards', 'promoCodes']} scope="Gift Cards" />
        {isAdmin && (
          <button onClick={onNew} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + Issue Gift Card
          </button>
        )}
      </div>

      {q && (
        <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 10 }}>
          {shown.length} {shown.length === 1 ? 'card' : 'cards'} matching “{search.trim()}” · all statuses
        </div>
      )}

      {shown.length === 0 ? (
        <Empty>{q ? `No gift cards match “${search.trim()}”.` : `No ${filter} gift cards.`}</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(gc => <GiftCardRow key={gc.id} gc={gc} onClick={() => onDetail(gc)} />)}
        </div>
      )}
    </>
  );
}

// Match a gift card against a free-text query — buyer, recipient, code,
// note, email, or (digits-only) either phone number.
function matchesGiftCard(g, q) {
  const hay = [g.code, g.purchaserName, g.purchaserPhone, g.recipientName, g.recipientEmail, g.recipientPhone, g.issuedTo, g.note]
    .map(v => String(v || '').toLowerCase());
  if (hay.some(h => h.includes(q))) return true;
  const digits = (q.match(/\d/g) || []).join('');
  if (digits.length >= 4) {
    const pPhone = (String(g.purchaserPhone || '').match(/\d/g) || []).join('');
    const rPhone = (String(g.recipientPhone || '').match(/\d/g) || []).join('');
    if ((pPhone && pPhone.includes(digits)) || (rPhone && rPhone.includes(digits))) return true;
  }
  return false;
}

function GiftCardRow({ gc, onClick }) {
  const pct = gc.initialBalance ? (gc.balance / gc.initialBalance) * 100 : 0;
  const status = gc.voided ? 'voided' : gc.balance <= 0 ? 'depleted' : 'active';
  const statusColor = { active: '#2D7A5F', depleted: '#aaa', voided: '#ef4444' }[status];

  return (
    <div onClick={onClick} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px', cursor: 'pointer', transition: 'box-shadow .15s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,.08)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {/* Card icon */}
        <div style={{ width: 40, height: 28, borderRadius: 6, background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>🎁</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', fontFamily: 'monospace', letterSpacing: '.03em' }}>{gc.code}</span>
            <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: status === 'active' ? 'var(--pn-success-bg)' : status === 'voided' ? 'var(--pn-danger-bg)' : 'var(--pn-surface-alt)', color: status === 'active' ? '#2D7A5F' : status === 'voided' ? 'var(--pn-danger)' : '#aaa', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {status}
            </span>
            <EmailStatusBadge gc={gc} />
          </div>
          {gc.purchaserName && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>From: {gc.purchaserName}{gc.purchaserPhone ? ` · ${gc.purchaserPhone}` : ''}</div>}
          {gc.recipientName && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>To: {gc.recipientName}{gc.recipientEmail ? ` · ${gc.recipientEmail}` : ''}</div>}
          {!gc.recipientName && gc.issuedTo && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>Issued to: {gc.issuedTo}</div>}
          {gc.note     && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>{gc.note}</div>}
          {status === 'active' && gc.initialBalance && (
            <div style={{ marginTop: 5, height: 4, background: 'var(--pn-surface-alt)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pct}%`, background: pct > 50 ? '#2D7A5F' : pct > 20 ? '#f59e0b' : '#ef4444', borderRadius: 2, transition: 'width .4s' }} />
            </div>
          )}
        </div>

        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: status === 'active' ? '#2D7A5F' : '#aaa' }}>
            {fmt$(gc.balance)}
          </div>
          {gc.initialBalance && gc.initialBalance !== gc.balance && (
            <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>of {fmt$(gc.initialBalance)}</div>
          )}
          <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 2 }}>{fmtDate(gc.createdAt)}</div>
        </div>
      </div>
    </div>
  );
}

// ── Promo Codes tab ──────────────────────────────────────
function PromosTab({ promos, isAdmin, onNew, onToggle, onDelete, onEdit }) {
  const active   = (promos || []).filter(p => p.active);
  const inactive = (promos || []).filter(p => !p.active);
  const [filter, setFilter] = useState('active');
  const shown = filter === 'active' ? active : inactive;

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Active codes" value={active.length}   accent="#2D7A5F" />
        <StatCard label="Used / inactive" value={inactive.length} />
        <StatCard label="Total created" value={(promos || []).length} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <PillBtn active={filter === 'active'}   onClick={() => setFilter('active')}>Active ({active.length})</PillBtn>
          <PillBtn active={filter === 'inactive'} onClick={() => setFilter('inactive')}>Inactive ({inactive.length})</PillBtn>
        </div>
        {isAdmin && (
          <button onClick={onNew} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            + New Promo Code
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <Empty>No {filter} promo codes.</Empty>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {shown.map(p => (
            <PromoRow key={p.id} promo={p} isAdmin={isAdmin} onToggle={() => onToggle(p)} onDelete={() => onDelete(p)} onEdit={onEdit} />
          ))}
        </div>
      )}
    </>
  );
}

function PromoRow({ promo, isAdmin, onToggle, onDelete, onEdit }) {
  const [editing, setEditing] = useState(false);
  const reason = promoReason(promo);
  return (
    <>
      <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 28, borderRadius: 6, background: promo.active ? 'linear-gradient(135deg,#f59e0b,#f97316)' : '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 14 }}>
          🏷
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', fontFamily: 'monospace', letterSpacing: '.05em' }}>{promo.code}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#f59e0b' }}>
              {promo.type === 'percent' ? `${promo.value}% off` : `$${promo.value} off`}
            </span>
            {reason && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: reason.bg, color: reason.color, border: `1px solid ${reason.border}`, fontWeight: 600 }}>
                {reason.label}
              </span>
            )}
            {promo.singleUse && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#f0f4ff', color: '#6366f1', fontWeight: 600 }}>Single-use</span>
            )}
            {promo.maxUses && (
              <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'var(--pn-warning-bg)', color: 'var(--pn-warning)', fontWeight: 600 }}>
                {promo.usedCount || 0}/{promo.maxUses} uses
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>
            Created {fmtDate(promo.createdAt)}
            {(promo.startDate || promo.endDate) && (
              <span style={{ marginLeft: 10 }}>
                {promo.startDate ? fmtDate(promo.startDate) : '∞'} – {promo.endDate ? fmtDate(promo.endDate) : '∞'}
              </span>
            )}
            {promo.usedAt && <span style={{ marginLeft: 10, color: '#ef4444' }}>Used {fmtDate(promo.usedAt)}</span>}
          </div>
        </div>

        {isAdmin && (
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button onClick={() => setEditing(true)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              Edit
            </button>
            <button onClick={onToggle} style={{ padding: '5px 12px', borderRadius: 8, border: `1px solid ${promo.active ? 'var(--pn-border)' : '#2D7A5F'}`, background: promo.active ? 'var(--pn-bg)' : '#e8f4ee', color: promo.active ? 'var(--pn-text-muted)' : '#2D7A5F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              {promo.active ? 'Deactivate' : 'Activate'}
            </button>
            <button onClick={onDelete} style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #fee2e2', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              ×
            </button>
          </div>
        )}
      </div>
      {editing && (
        <PromoEditModal
          promo={promo}
          onSave={async patch => { await onEdit(promo, patch); setEditing(false); }}
          onClose={() => setEditing(false)}
        />
      )}
    </>
  );
}

// ── Promo Code edit modal ─────────────────────────────────
function PromoEditModal({ promo, onSave, onClose }) {
  const [startDate, setStartDate] = useState(promo.startDate || '');
  const [endDate,   setEndDate]   = useState(promo.endDate   || '');
  const [maxUses,   setMaxUses]   = useState(promo.maxUses != null ? String(promo.maxUses) : '');
  const [saving,    setSaving]    = useState(false);

  async function handleSave() {
    setSaving(true);
    await onSave({
      startDate: startDate || null,
      endDate:   endDate   || null,
      maxUses:   maxUses   ? Number(maxUses) : null,
    });
    setSaving(false);
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title={`Edit "${promo.code}"`} onClose={onClose}>
        {/* Read-only summary */}
        <div style={{ background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 12 }}>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{ color: 'var(--pn-text-faint)' }}>Code</span>
            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--pn-text)', letterSpacing: '.05em' }}>{promo.code}</span>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
            <span style={{ color: 'var(--pn-text-faint)' }}>Discount</span>
            <span style={{ fontWeight: 600, color: '#f59e0b' }}>
              {promo.type === 'percent' ? `${promo.value}% off` : `$${promo.value} off`}
            </span>
          </div>
          {promo.usedCount > 0 && (
            <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
              <span style={{ color: 'var(--pn-text-faint)' }}>Redemptions</span>
              <span style={{ color: 'var(--pn-text)' }}>{promo.usedCount}{promo.maxUses ? ` / ${promo.maxUses}` : ''}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>Valid from</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>Expires</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <Field label="Max redemptions (blank = unlimited)">
          <input type="number" min={promo.usedCount || 1} value={maxUses} onChange={e => setMaxUses(e.target.value)}
            placeholder="e.g. 50" style={inputStyle} />
          {promo.usedCount > 0 && maxUses && Number(maxUses) < promo.usedCount && (
            <div style={{ fontSize: 11, color: '#b45309', marginTop: 4 }}>
              ⚠ Can't be less than current redemption count ({promo.usedCount})
            </div>
          )}
        </Field>

        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
            Cancel
          </button>
          <div style={{ flex: 2 }}>
            <SaveBtn
              onClick={handleSave}
              saving={saving}
              disabled={!!maxUses && Number(maxUses) < (promo.usedCount || 0)}
            >
              Save changes
            </SaveBtn>
          </div>
        </div>
      </ModalBox>
    </Overlay>
  );
}

// ── Gift Card create modal ────────────────────────────────
function GiftCardModal({ onSave, onClose }) {
  const [amount,         setAmount]         = useState('');
  const [code,           setCode]           = useState(genCode());
  const [purchaserName,  setPurchaserName]  = useState('');
  const [purchaserPhone, setPurchaserPhone] = useState('');
  const [recipientName,  setRecipientName]  = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [note,           setNote]           = useState('');
  const [saving,         setSaving]         = useState(false);

  // Email is required because the Cloud Function emails the recipient the
  // code on creation. Without an email the recipient never gets it.
  const validEmail = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(recipientEmail.trim());
  const canSave = !!amount && Number(amount) > 0 && !!code.trim() && validEmail;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    await onSave({
      code:           code.trim().toUpperCase(),
      initialBalance: Number(amount),
      balance:        Number(amount),
      // Naming aligned with the checkout flow + Cloud Function
      // sendGiftCardEmail (recipientName / recipientEmail). issuedTo is
      // kept populated for backward-compat with existing UI references.
      recipientName:  recipientName.trim() || null,
      recipientEmail: recipientEmail.trim(),
      recipientPhone: recipientPhone.trim() || null,
      issuedTo:       recipientName.trim() || null,
      // Who bought the card — used for record-keeping + lookup (search by
      // buyer or recipient in the Gift Cards list and at checkout).
      purchaserName:  purchaserName.trim() || null,
      purchaserPhone: purchaserPhone.trim() || null,
      note:           note.trim() || null,
      voided:         false,
    });
    setSaving(false);
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title="Issue Gift Card" onClose={onClose}>
        <Field label="Amount ($)">
          <input type="number" min={1} value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="50.00" autoFocus
            style={inputStyle} />
        </Field>

        <Field label="Code">
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
              style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '.06em', flex: 1 }} />
            <button onClick={() => setCode(genCode())}
              style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontSize: 11, color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
              Generate
            </button>
          </div>
        </Field>

        <Field label="Purchased by (optional)">
          <input value={purchaserName} onChange={e => setPurchaserName(e.target.value)}
            placeholder="Buyer's name…"
            style={inputStyle} />
        </Field>

        <Field label="Purchaser phone (optional)">
          <input value={purchaserPhone} onChange={e => setPurchaserPhone(e.target.value)}
            placeholder="(555) 123-4567" inputMode="tel"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>Lets you find this card later by who bought it.</div>
        </Field>

        <Field label="Recipient name (optional)">
          <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
            placeholder="Client name…"
            style={inputStyle} />
        </Field>

        <Field label="Recipient email *">
          <input value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
            placeholder="recipient@example.com" inputMode="email"
            style={{ ...inputStyle, borderColor: recipientEmail && !validEmail ? '#ef4444' : 'var(--pn-border-strong)' }} />
          <div style={{ fontSize: 11, color: recipientEmail && !validEmail ? '#ef4444' : 'var(--pn-text-muted)', marginTop: 4 }}>
            {recipientEmail && !validEmail
              ? "Enter a valid email — we'll send the code here."
              : "We'll email the code + balance to this address."}
          </div>
        </Field>

        <Field label="Recipient phone (optional)">
          <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)}
            placeholder="(555) 123-4567" inputMode="tel"
            style={inputStyle} />
          <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4 }}>Lets staff look this card up by phone at checkout.</div>
        </Field>

        <Field label="Note (optional)">
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="Birthday gift, purchase, etc."
            style={inputStyle} />
        </Field>

        <div style={{ marginTop: 8, padding: '12px 16px', background: 'var(--pn-success-bg)', borderRadius: 10, border: '1px solid #bbf7d0' }}>
          <div style={{ fontSize: 12, color: 'var(--pn-success)', fontWeight: 600 }}>Gift card summary</div>
          <div style={{ fontSize: 13, color: 'var(--pn-text)', marginTop: 4 }}>
            {code || '—'} · {amount ? fmt$(amount) : '$—'}
            {recipientName && <span style={{ color: 'var(--pn-text-muted)' }}> · for {recipientName}</span>}
          </div>
          {purchaserName && (
            <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>Bought by {purchaserName}</div>
          )}
          {validEmail && (
            <div style={{ fontSize: 11, color: 'var(--pn-success)', marginTop: 3 }}>📧 Code will be emailed to {recipientEmail}</div>
          )}
        </div>

        <SaveBtn onClick={handleSave} saving={saving} disabled={!canSave}>
          Issue Gift Card
        </SaveBtn>
      </ModalBox>
    </Overlay>
  );
}

// ── Promo Code create modal ───────────────────────────────
function PromoModal({ onSave, onClose }) {
  const [code,      setCode]      = useState('');
  const [type,      setType]      = useState('percent');
  const [value,     setValue]     = useState('');
  const [singleUse, setSingleUse] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate,   setEndDate]   = useState('');
  const [maxUses,   setMaxUses]   = useState('');
  const [saving,    setSaving]    = useState(false);

  async function handleSave() {
    const v = Number(value);
    if (!code.trim() || !v || v <= 0) return;
    setSaving(true);
    await onSave({
      code:      code.trim().toUpperCase(),
      type,
      value:     v,
      singleUse,
      startDate: startDate || null,
      endDate:   endDate   || null,
      maxUses:   maxUses ? Number(maxUses) : null,
      usedCount: 0,
      active:    true,
      usedAt:    null,
    });
    setSaving(false);
  }

  return (
    <Overlay onClose={onClose}>
      <ModalBox title="New Promo Code" onClose={onClose}>
        <Field label="Code">
          <input value={code} onChange={e => setCode(e.target.value.toUpperCase())}
            placeholder="SUMMER20"
            style={{ ...inputStyle, fontFamily: 'monospace', letterSpacing: '.06em' }}
            autoFocus />
        </Field>

        <Field label="Discount type">
          <div style={{ display: 'flex', gap: 8 }}>
            {[{ id: 'percent', label: '% off' }, { id: 'fixed', label: '$ off' }].map(t => (
              <button key={t.id} onClick={() => setType(t.id)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: `1.5px solid ${type === t.id ? '#3D95CE' : 'var(--pn-border)'}`, background: type === t.id ? '#EBF4FB' : 'var(--pn-bg)', color: type === t.id ? '#1a5f8a' : 'var(--pn-text-muted)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                {t.label}
              </button>
            ))}
          </div>
        </Field>

        <Field label={type === 'percent' ? 'Percentage (0–100)' : 'Dollar amount off'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {type === 'fixed' && <span style={{ fontSize: 13, color: 'var(--pn-text-faint)' }}>$</span>}
            <input type="number" min={0} max={type === 'percent' ? 100 : undefined} value={value} onChange={e => setValue(e.target.value)}
              placeholder={type === 'percent' ? '20' : '10.00'}
              style={{ ...inputStyle, flex: 1 }} />
            {type === 'percent' && <span style={{ fontSize: 13, color: 'var(--pn-text-faint)' }}>%</span>}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>Valid from (optional)</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>Expires (optional)</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} />
          </div>
        </div>

        <Field label="Max redemptions (optional — blank = unlimited)">
          <input type="number" min={1} value={maxUses} onChange={e => setMaxUses(e.target.value)}
            placeholder="e.g. 50" style={inputStyle} />
        </Field>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 16 }}>
          <input type="checkbox" checked={singleUse} onChange={e => setSingleUse(e.target.checked)} />
          Single-use (deactivates after first redemption)
        </label>

        {code && value && (
          <div style={{ marginBottom: 8, padding: '12px 16px', background: 'var(--pn-warning-bg)', borderRadius: 10, border: '1px solid #fed7aa' }}>
            <div style={{ fontSize: 12, color: 'var(--pn-warning)', fontWeight: 600 }}>Preview</div>
            <div style={{ fontSize: 13, color: 'var(--pn-text)', marginTop: 4 }}>
              Code <strong>{code}</strong> gives {type === 'percent' ? `${value}%` : fmt$(value)} off
              {singleUse && ' · single-use'}
              {maxUses && ` · max ${maxUses} uses`}
              {(startDate || endDate) && ` · ${startDate ? fmtDate(startDate) : '∞'} – ${endDate ? fmtDate(endDate) : '∞'}`}
            </div>
          </div>
        )}

        <SaveBtn onClick={handleSave} saving={saving} disabled={!code.trim() || !value || Number(value) <= 0}>
          Create Promo Code
        </SaveBtn>
      </ModalBox>
    </Overlay>
  );
}

// ── Gift card detail modal ────────────────────────────────
function GiftCardDetail({ gc, isAdmin, onVoid, onClose }) {
  const redeemed = (gc.initialBalance || 0) - (gc.balance || 0);
  const pct = gc.initialBalance ? ((gc.balance / gc.initialBalance) * 100).toFixed(0) : 0;
  const status = gc.voided ? 'voided' : gc.balance <= 0 ? 'depleted' : 'active';

  return (
    <Overlay onClose={onClose}>
      <ModalBox title="Gift Card Details" onClose={onClose}>
        {/* Code badge */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 64, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', fontSize: 24 }}>🎁</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', letterSpacing: '.08em', color: 'var(--pn-text)' }}>{gc.code}</div>
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: status === 'active' ? 'var(--pn-success-bg)' : status === 'voided' ? 'var(--pn-danger-bg)' : 'var(--pn-surface-alt)', color: status === 'active' ? '#2D7A5F' : status === 'voided' ? 'var(--pn-danger)' : 'var(--pn-text-faint)', textTransform: 'uppercase' }}>
              {status}
            </span>
          </div>
        </div>

        {/* Balance bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
            <span style={{ color: 'var(--pn-text-muted)' }}>Balance remaining</span>
            <span style={{ fontWeight: 700, color: '#2D7A5F', fontSize: 18 }}>{fmt$(gc.balance)}</span>
          </div>
          {gc.initialBalance && (
            <>
              <div style={{ height: 8, background: 'var(--pn-surface-alt)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: Number(pct) > 50 ? '#2D7A5F' : Number(pct) > 20 ? '#f59e0b' : '#ef4444', borderRadius: 4 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--pn-text-faint)' }}>
                <span>Redeemed: {fmt$(redeemed)}</span>
                <span>Original: {fmt$(gc.initialBalance)}</span>
              </div>
            </>
          )}
        </div>

        {/* Details */}
        <div style={{ background: 'var(--pn-bg)', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {gc.purchaserName  && <DetailRow label="Purchased by" value={gc.purchaserName} />}
          {gc.purchaserPhone && <DetailRow label="Buyer phone"  value={gc.purchaserPhone} />}
          {(gc.recipientName || gc.issuedTo) && <DetailRow label="Recipient" value={gc.recipientName || gc.issuedTo} />}
          {gc.recipientEmail && <DetailRow label="Recipient email" value={gc.recipientEmail} />}
          {gc.recipientPhone && <DetailRow label="Recipient phone" value={gc.recipientPhone} />}
          {gc.note     && <DetailRow label="Note"       value={gc.note} />}
          <DetailRow label="Created" value={fmtDate(gc.createdAt)} />
          {gc.voidedAt && <DetailRow label="Voided"     value={fmtDate(gc.voidedAt)} />}
        </div>

        {isAdmin && !gc.voided && gc.balance > 0 && (
          <button onClick={() => onVoid(gc)}
            style={{ width: '100%', padding: '10px', borderRadius: 10, border: '1px solid #fecaca', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Void Gift Card
          </button>
        )}
      </ModalBox>
    </Overlay>
  );
}

function DetailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--pn-text-faint)' }}>{label}</span>
      <span style={{ color: 'var(--pn-text)', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ── Shared primitives ────────────────────────────────────
function StatCard({ label, value, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent || 'var(--pn-text)' }}>{value}</div>
    </div>
  );
}

function PillBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '5px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? 'var(--pn-text)' : 'var(--pn-surface)', color: active ? '#fff' : 'var(--pn-text-muted)', border: `1px solid ${active ? 'var(--pn-text)' : 'var(--pn-border-strong)'}`, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

function Overlay({ children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

function ModalBox({ title, children, onClose }) {
  return (
    <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--pn-text)' }}>{title}</span>
        <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', fontSize: 16, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

function SaveBtn({ onClick, saving, disabled, children }) {
  return (
    <button onClick={onClick} disabled={saving || disabled}
      style={{ width: '100%', marginTop: 8, padding: '12px', borderRadius: 10, border: 'none', background: saving || disabled ? 'var(--pn-border-strong)' : '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving || disabled ? 'default' : 'pointer', fontFamily: 'inherit' }}>
      {saving ? 'Saving…' : children}
    </button>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box', fontFamily: 'inherit',
  border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '9px 12px',
  fontSize: 13, background: 'var(--pn-bg)', outline: 'none',
};

// Live-status badge for gift card recipient emails. Subscribes to the
// individual card doc so status flips (sending → sent / failed) in real
// time. Failed cards get a Retry button that re-runs the Cloud Function;
// hover shows the underlying error code/reason.
function EmailStatusBadge({ gc }) {
  const [live, setLive] = useState(gc);
  const [retrying, setRetrying] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!gc?.id) return;
    return subscribeToGiftCard(gc.id, doc => doc && setLive(doc));
  }, [gc?.id]);

  const status = live?.emailStatus;
  if (!status && !live?.recipientEmail) return null; // no email on file → nothing to show
  if (!status) return <Pill bg="var(--pn-warning-bg)" fg="var(--pn-warning)" border="#fde68a">📧 Email queued</Pill>;
  if (status === 'sending') return <Pill bg="var(--pn-info-bg)" fg="var(--pn-info)" border="#bfdbfe">📧 Emailing…</Pill>;
  if (status === 'sent')    return <Pill bg="var(--pn-success-bg)" fg="var(--pn-success)" border="#86efac" title={live.emailSentAt ? `Sent ${new Date(live.emailSentAt).toLocaleString()}` : ''}>📧 Email sent</Pill>;
  if (status === 'skipped') return <Pill bg="#f5f5f5" fg="#6b7280" border="#e5e7eb" title={live.emailErrorReason || 'No email on file'}>📧 No email</Pill>;
  if (status === 'failed') {
    return (
      <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }} onClick={e => e.stopPropagation()}>
        <Pill bg="var(--pn-danger-bg)" fg="var(--pn-danger)" border="#fca5a5" title={`${live.emailErrorCode || 'ERROR'}: ${live.emailErrorReason || 'Send failed'}`}>📧 Email failed</Pill>
        <button onClick={async (e) => {
          e.stopPropagation();
          setRetrying(true); setErr('');
          try { await retryGiftCardEmail(gc.id); }
          catch (ex) { setErr(ex?.message || 'Retry failed'); }
          finally { setRetrying(false); }
        }} disabled={retrying}
          style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, border: '1px solid #2D7A5F', background: '#f0faf6', color: '#2D7A5F', cursor: retrying ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {retrying ? '…' : '🔄 Retry'}
        </button>
        {err && <span title={err} style={{ fontSize: 10, color: '#ef4444' }}>!</span>}
      </span>
    );
  }
  return null;
}

function Pill({ bg, fg, border, title, children }) {
  return (
    <span title={title} style={{ fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 10, background: bg, color: fg, border: `1px solid ${border}` }}>{children}</span>
  );
}
