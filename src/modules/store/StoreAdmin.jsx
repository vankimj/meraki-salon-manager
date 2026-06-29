import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  subscribeStoreProducts, createStoreProduct, saveStoreProduct, deleteStoreProduct,
  subscribeStoreOrders, fetchClients,
} from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import { resizeImg } from '../../utils/helpers';
import TrashButton from '../../components/TrashButton';

const TABS = [
  { id: 'products', label: 'Products' },
  { id: 'orders',   label: 'Orders'   },
];

const FULFILLMENT = [
  { id: 'shipped', label: 'Shipped' },
  { id: 'pickup',  label: 'Pickup'  },
  { id: 'digital', label: 'Digital' },
];

const money = (cents) => `$${((Number(cents) || 0) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function StoreAdmin() {
  const { isAdmin, showToast, settings } = useApp();
  const [tab,      setTab]      = useState('products');
  const [products, setProducts] = useState([]);
  const [orders,   setOrders]   = useState([]);
  const [edit,     setEdit]     = useState(null);   // product obj or 'new'
  const [sell,     setSell]     = useState(null);   // product to ring up

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-muted)' }}>Admin only.</div>;
  }

  useEffect(() => subscribeStoreProducts(setProducts), []);
  useEffect(() => subscribeStoreOrders(setOrders), []);

  const connectReady = settings?.stripeConnect?.chargesEnabled === true;
  const feePct = Math.min(100, Math.max(0, Number(settings?.platformFeePercent) || 0));

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 32 }}>
      {!connectReady && <ConnectGate />}

      {/* Tabs */}
      <div className="scroll-x" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--pn-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)', borderBottom: tab === t.id ? '2px solid #6a4fa0' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}{t.id === 'orders' && orders.length > 0 && <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>({orders.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'products' && (
        <ProductsTab
          products={products}
          connectReady={connectReady}
          onNew={() => setEdit('new')}
          onEdit={setEdit}
          onSell={setSell}
          onDelete={async (p) => {
            if (!confirm(`Delete "${p.name}"? Existing orders are unaffected.`)) return;
            await deleteStoreProduct(p.id);
            logActivity('store_product_deleted', p.name);
            showToast('Product deleted');
          }}
        />
      )}

      {tab === 'orders' && <OrdersTab orders={orders} feePct={feePct} />}

      {edit && (
        <ProductEditor
          product={edit === 'new' ? null : edit}
          onSave={async (data) => {
            try {
              if (edit === 'new') {
                await createStoreProduct(data);
                logActivity('store_product_created', `${data.name} — $${data.price}`);
                showToast('Product added');
              } else {
                await saveStoreProduct(edit.id, data);
                logActivity('store_product_updated', data.name);
                showToast('Product updated');
              }
              setEdit(null);
            } catch (e) {
              showToast(`Save failed: ${e.message}`, 4000);
            }
          }}
          onClose={() => setEdit(null)}
        />
      )}

      {sell && <SellModal product={sell} onClose={() => setSell(null)} />}
    </div>
  );
}

function ConnectGate() {
  return (
    <div style={{ background: 'var(--pn-warning-bg)', border: '1px solid var(--pn-warning)', borderRadius: 12, padding: '14px 18px', marginBottom: 18, fontSize: 13, color: 'var(--pn-text)' }}>
      <strong>Payments aren’t connected yet.</strong> You can build your catalog now, but customers can’t check out until Stripe is live.
      {' '}Finish setup in{' '}
      <button onClick={() => window.dispatchEvent(new CustomEvent('open-admin', { detail: { tab: 'settings', scrollTo: 'payments' } }))}
        style={{ background: 'none', border: 'none', padding: 0, color: '#6a4fa0', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textDecoration: 'underline' }}>
        Admin → Payments</button>. Payouts go straight to your own Stripe account.
    </div>
  );
}

function ProductsTab({ products, connectReady, onNew, onEdit, onSell, onDelete }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: 'var(--pn-text-muted)' }}>Sell supplements, gear, or coaching add-ons — one-time or recurring. Money lands in your Stripe account.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TrashButton collections={['storeProducts']} scope="Store" />
          <button onClick={onNew} style={primaryBtn}>+ New product</button>
        </div>
      </div>

      {products.length === 0 ? (
        <Empty>No products yet. Add your first — e.g. "Whey Protein — $49" or "Monthly supplement box — $30/mo".</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          {products.map(p => {
            const recurring = p.billingType === 'recurring';
            const soldOut = p.inventory != null && Number(p.inventory) <= 0;
            return (
              <div key={p.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, overflow: 'hidden', position: 'relative', opacity: p.active === false ? .5 : 1, display: 'flex', flexDirection: 'column' }}>
                {p.active === false && <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', background: 'var(--pn-surface-alt)', padding: '2px 8px', borderRadius: 4, zIndex: 1 }}>INACTIVE</div>}
                {p.image
                  ? <img src={p.image} alt={p.name} style={{ width: '100%', height: 130, objectFit: 'cover', background: 'var(--pn-surface-alt)' }} />
                  : <div style={{ width: '100%', height: 130, background: 'var(--pn-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--pn-text-faint)', fontSize: 28 }}>🛍️</div>}
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>{p.name}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#6a4fa0', lineHeight: 1.2, marginBottom: 6 }}>
                    ${p.price}{recurring && <span style={{ fontSize: 12, color: 'var(--pn-text-muted)', fontWeight: 500 }}>/{p.interval === 'year' ? 'yr' : 'mo'}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                    <Badge>{recurring ? 'Recurring' : 'One-time'}</Badge>
                    <Badge>{(FULFILLMENT.find(f => f.id === p.fulfillment) || FULFILLMENT[0]).label}</Badge>
                    {p.inventory != null && <Badge tone={soldOut ? 'danger' : 'default'}>{soldOut ? 'Sold out' : `${p.inventory} in stock`}</Badge>}
                  </div>
                  {p.description && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 10 }}>{p.description}</div>}
                  <div style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
                    <button onClick={() => onEdit(p)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }}>Edit</button>
                    <button onClick={() => onSell(p)} disabled={!connectReady || p.active === false || soldOut}
                      title={connectReady ? 'Generate a checkout link for a client' : 'Connect Stripe first'}
                      style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#6a4fa0', borderColor: '#d8d0e8', background: '#f3eafc', opacity: (!connectReady || p.active === false || soldOut) ? .5 : 1 }}>Sell</button>
                    <button onClick={() => onDelete(p)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#ef4444', borderColor: '#fca5a5', marginLeft: 'auto' }}>×</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function OrdersTab({ orders, feePct }) {
  const { showToast } = useApp();
  const [filter, setFilter] = useState('all');
  const [busy, setBusy] = useState(null); // { id, action }

  const paidLike = (s) => s === 'paid' || s === 'active' || s === 'past_due';
  const rollup = useMemo(() => {
    const settled = orders.filter(o => paidLike(o.status));
    const gross = settled.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const fee   = settled.reduce((s, o) => s + (Number(o.applicationFee) || 0), 0);
    const activeSubs = orders.filter(o => o.recurring && o.status === 'active').length;
    return { gross, fee, net: gross - fee, activeSubs };
  }, [orders]);

  const filtered = filter === 'all' ? orders
    : filter === 'subscriptions' ? orders.filter(o => o.recurring)
    : orders.filter(o => o.status === filter);

  async function cancelSub(o) {
    if (!window.confirm(`Cancel this subscription for ${o.clientName || o.clientEmail || 'this customer'}?\n\nStops the recurring charge immediately.`)) return;
    setBusy({ id: o.id, action: 'cancel' });
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      await httpsCallable(functions, 'cancelStoreSubscription')({ orderId: o.id });
      showToast('Subscription cancelled');
    } catch (e) {
      showToast(`Cancel failed: ${e.message || 'unknown'}`, 4500);
    } finally { setBusy(null); }
  }

  async function openPortal(o) {
    setBusy({ id: o.id, action: 'portal' });
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const res = await httpsCallable(functions, 'createStorePortal')({ orderId: o.id });
      const url = res?.data?.url;
      if (!url) throw new Error('No portal URL');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      showToast(`Portal failed: ${e.message || 'unknown'}`, 4500);
    } finally { setBusy(null); }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="Gross sales" value={money(rollup.gross)} accent="#22c55e" sub="paid + active" />
        <Stat label="Platform fee" value={money(rollup.fee)} accent="#f59e0b" sub={`${feePct}% of sales`} />
        <Stat label="Your take-home" value={money(rollup.net)} accent="#6a4fa0" sub="after platform fee" />
        <Stat label="Active subscriptions" value={rollup.activeSubs} accent="#3D95CE" />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        {['all', 'paid', 'active', 'subscriptions', 'past_due', 'cancelled'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, borderRadius: 8, border: filter === f ? '1px solid #6a4fa0' : '1px solid var(--pn-border-strong)', background: filter === f ? '#f3eafc' : 'var(--pn-surface)', color: filter === f ? '#6a4fa0' : 'var(--pn-text-muted)', cursor: 'pointer', fontWeight: filter === f ? 600 : 400, textTransform: 'capitalize' }}>
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <Empty>No {filter === 'all' ? '' : filter.replace('_', ' ')} orders yet.</Empty>
      ) : (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden', overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>
                <th style={th}>Product</th>
                <th style={th}>Customer</th>
                <th style={th}>Amount</th>
                <th style={th}>Type</th>
                <th style={th}>Status</th>
                <th style={th}>Date</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => {
                const busyAction = busy?.id === o.id ? busy.action : null;
                return (
                  <tr key={o.id} style={{ borderBottom: '1px solid var(--pn-border)' }}>
                    <td style={td}><span style={{ fontWeight: 600 }}>{o.name || '—'}</span></td>
                    <td style={td}>{o.clientName || o.clientEmail || '—'}</td>
                    <td style={td}>{money(o.amount)}{o.recurring && <span style={{ color: 'var(--pn-text-muted)' }}>/{o.interval === 'year' ? 'yr' : 'mo'}</span>}</td>
                    <td style={td}>{o.recurring ? 'Recurring' : 'One-time'}</td>
                    <td style={td}><StatusBadge status={o.status} /></td>
                    <td style={td}>{o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {o.recurring && o.stripeSubscriptionId && o.status !== 'cancelled' && (
                        <>
                          <button onClick={() => openPortal(o)} disabled={busyAction === 'portal'} title="Open Stripe billing portal"
                            style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginRight: 4 }}>{busyAction === 'portal' ? '…' : '💳 Portal'}</button>
                          <button onClick={() => cancelSub(o)} disabled={busyAction === 'cancel'} title="Cancel this subscription"
                            style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, color: '#ef4444', borderColor: '#fca5a5' }}>{busyAction === 'cancel' ? '…' : 'Cancel'}</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductEditor({ product, onSave, onClose }) {
  const isNew = !product;
  const [name, setName]               = useState(product?.name || '');
  const [description, setDescription] = useState(product?.description || '');
  const [image, setImage]             = useState(product?.image || '');
  const [price, setPrice]             = useState(product?.price ?? 25);
  const [billingType, setBillingType] = useState(product?.billingType || 'one_time');
  const [interval, setInterval]       = useState(product?.interval || 'month');
  const [fulfillment, setFulfillment] = useState(product?.fulfillment || 'shipped');
  const [trackInventory, setTrackInventory] = useState(product?.inventory != null);
  const [inventory, setInventory]     = useState(product?.inventory ?? 0);
  const [active, setActive]           = useState(product?.active !== false);
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState('');

  async function pickImage(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImg(file, 800, 800, 0.82);
      setImage(dataUrl);
    } catch {
      setErr('Could not process that image');
    }
  }

  async function submit() {
    setErr('');
    if (!name.trim()) { setErr('Name required'); return; }
    if (!(Number(price) > 0)) { setErr('Price must be greater than 0'); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        image: image || null,
        price: Number(price),
        currency: 'usd',
        billingType,
        interval: billingType === 'recurring' ? interval : null,
        fulfillment,
        inventory: trackInventory ? Math.max(0, Math.round(Number(inventory) || 0)) : null,
        active,
        ownerTrainerId: product?.ownerTrainerId || null,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? 'New product' : 'Edit product'} onClose={onClose}>
      <Field label="Product name">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Whey Protein (2lb)" style={inp} />
      </Field>
      <Field label="Description (optional)">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One-line description" style={inp} />
      </Field>
      <Field label="Photo (optional)">
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {image
            ? <img src={image} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)' }} />
            : <div style={{ width: 56, height: 56, borderRadius: 8, background: 'var(--pn-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🛍️</div>}
          <label style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            {image ? 'Replace' : 'Upload'}
            <input type="file" accept="image/*" onChange={pickImage} style={{ display: 'none' }} />
          </label>
          {image && <button onClick={() => setImage('')} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#ef4444' }}>Remove</button>}
        </div>
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Price (USD)" style={{ flex: 1 }}>
          <input type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={inp} />
        </Field>
        <Field label="Billing" style={{ flex: 1 }}>
          <select value={billingType} onChange={e => setBillingType(e.target.value)} style={inp}>
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring</option>
          </select>
        </Field>
        {billingType === 'recurring' && (
          <Field label="Every" style={{ flex: 1 }}>
            <select value={interval} onChange={e => setInterval(e.target.value)} style={inp}>
              <option value="month">Month</option>
              <option value="year">Year</option>
            </select>
          </Field>
        )}
      </div>
      <Field label="Fulfillment">
        <select value={fulfillment} onChange={e => setFulfillment(e.target.value)} style={inp}>
          {FULFILLMENT.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={trackInventory} onChange={e => setTrackInventory(e.target.checked)} />
        <span>Track inventory</span>
      </label>
      {trackInventory && (
        <Field label="Units in stock">
          <input type="number" min={0} step={1} value={inventory} onChange={e => setInventory(e.target.value)} style={inp} />
        </Field>
      )}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '6px 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        <span>Active <span style={{ color: 'var(--pn-text-muted)', fontSize: 11 }}>(uncheck to hide from the shop)</span></span>
      </label>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <ModalFooter onCancel={onClose} onSave={submit} saving={saving} />
    </Modal>
  );
}

// Ring up a known client: generate a Stripe Checkout link via the admin CF
// and open it / copy it for the client to pay.
function SellModal({ product, onClose }) {
  const { showToast } = useApp();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => { fetchClients().then(setClients).catch(() => {}); }, []);

  async function generate() {
    setErr('');
    if (!clientId) { setErr('Pick a client'); return; }
    setBusy(true);
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const res = await httpsCallable(functions, 'createStoreCheckout')({ productId: product.id, clientId });
      const url = res?.data?.url;
      if (!url) throw new Error('No checkout URL returned');
      setLink(url);
      logActivity('store_checkout_created', `${product.name} → ${clients.find(c => c.id === clientId)?.name || clientId}`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(e.message || 'Could not create checkout');
    } finally { setBusy(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(link); showToast('Link copied'); }
    catch { window.prompt('Copy this checkout link:', link); }
  }

  return (
    <Modal title={`Sell — ${product.name}`} onClose={onClose}>
      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 12 }}>
        ${product.price}{product.billingType === 'recurring' ? `/${product.interval === 'year' ? 'yr' : 'mo'}` : ''} · routed to your Stripe account.
      </div>
      <Field label="Client">
        <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
          <option value="">Pick a client…</option>
          {[...clients].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => (
            <option key={c.id} value={c.id}>{c.name}{c.email ? ` · ${c.email}` : ''}</option>
          ))}
        </select>
      </Field>
      {link && (
        <div style={{ background: 'var(--pn-surface-alt)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: 10, fontSize: 12, marginBottom: 10, wordBreak: 'break-all' }}>
          {link}
          <div style={{ marginTop: 8 }}><button onClick={copy} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11 }}>Copy link</button></div>
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button onClick={generate} disabled={busy} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>
          {busy ? 'Creating…' : (link ? 'Re-open checkout' : 'Create checkout link')}
        </button>
        <button onClick={onClose} disabled={busy} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Done</button>
      </div>
    </Modal>
  );
}

// ── Reusable bits ────────────────────────────────────
function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: 14, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function StatusBadge({ status }) {
  const map = {
    paid:      ['var(--pn-success)', 'var(--pn-success-bg)'],
    active:    ['var(--pn-success)', 'var(--pn-success-bg)'],
    past_due:  ['var(--pn-warning)', 'var(--pn-warning-bg)'],
    pending:   ['var(--pn-text-muted)', 'var(--pn-surface-alt)'],
    cancelled: ['var(--pn-text-muted)', 'var(--pn-surface-alt)'],
    refunded:  ['var(--pn-text-muted)', 'var(--pn-surface-alt)'],
  };
  const [color, bg] = map[status] || map.pending;
  return <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: bg, color, textTransform: 'uppercase', letterSpacing: '.04em' }}>{(status || '—').replace('_', ' ')}</span>;
}
function Badge({ children, tone = 'default' }) {
  const danger = tone === 'danger';
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, background: danger ? 'var(--pn-danger-bg, #fee2e2)' : 'var(--pn-surface-alt)', color: danger ? '#b91c1c' : 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</span>;
}
function Empty({ children }) {
  return <div style={{ background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>{children}</div>;
}
function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
function ModalFooter({ onCancel, onSave, saving }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>{saving ? 'Saving…' : 'Save'}</button>
      <button onClick={onCancel} disabled={saving} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
    </div>
  );
}
function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '8px 10px',
  borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', boxSizing: 'border-box',
};
const primaryBtn = {
  padding: '8px 16px', borderRadius: 10, border: 'none', background: '#6a4fa0',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const secondaryBtn = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)',
  color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--pn-text)' };
