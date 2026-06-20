import { useState, useEffect } from 'react';
import { fetchProducts, saveProduct, createProduct, deleteProduct } from '../../lib/firestore';
import { useApp } from '../../context/AppContext';
import { logActivity, logError } from '../../lib/logger';
import TrashButton from '../../components/TrashButton';

const CATEGORIES = ['Nail Care', 'Skincare', 'Tools', 'Accessories', 'Other'];

function fmt$(n) { return '$' + Number(n || 0).toFixed(2); }

export default function ProductsAdmin() {
  const { showToast, isAdmin } = useApp();
  const [products, setProducts] = useState(null);
  const [filter,   setFilter]   = useState('active');
  const [modal,    setModal]    = useState(null); // null | 'new' | product

  useEffect(() => { load(); }, []); // eslint-disable-line

  async function load() {
    try { setProducts(await fetchProducts()); }
    catch { setProducts([]); }
  }

  async function handleSave(data, id) {
    try {
      if (id) {
        await saveProduct(id, data);
        logActivity('product_updated', data.name);
        showToast('Product updated');
      } else {
        await createProduct(data);
        logActivity('product_created', data.name);
        showToast('Product added');
      }
      setModal(null);
      load();
    } catch (e) { logError('product_save', e); showToast('Failed: ' + e.message, 3000); }
  }

  async function handleDelete(p) {
    if (!window.confirm(`Delete "${p.name}"?`)) return;
    try {
      await deleteProduct(p.id);
      logActivity('product_deleted', p.name);
      showToast('Product deleted');
      load();
    } catch (e) { logError('product_delete', e); showToast('Failed: ' + e.message, 3000); }
  }

  async function adjustStock(p, delta) {
    const newStock = Math.max(0, (p.stock || 0) + delta);
    try {
      await saveProduct(p.id, { ...p, stock: newStock });
      setProducts(ps => ps.map(x => x.id === p.id ? { ...x, stock: newStock } : x));
    } catch (e) { logError('product_stock', e); showToast('Failed: ' + e.message, 3000); }
  }

  if (!products) return <div style={{ textAlign: 'center', padding: 80, color: 'var(--pn-text-faint)', fontSize: 14 }}>Loading…</div>;

  const active   = products.filter(p => p.active !== false);
  const inactive = products.filter(p => p.active === false);
  const lowStock = products.filter(p => p.active !== false && (p.stock || 0) < 5);
  const shown    = filter === 'active' ? active : filter === 'low' ? lowStock : products;
  const totalValue = active.reduce((s, p) => s + (p.price || 0) * (p.stock || 0), 0);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 32 }}>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard label="Active products" value={active.length}       accent="#2D7A5F" />
        <StatCard label="Retail value"    value={fmt$(totalValue)}    accent="#3D95CE" />
        <StatCard label="Low stock (< 5)" value={lowStock.length}     accent={lowStock.length ? '#f59e0b' : undefined} />
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <PillBtn active={filter === 'active'} onClick={() => setFilter('active')}>Active ({active.length})</PillBtn>
          <PillBtn active={filter === 'low'}    onClick={() => setFilter('low')}>Low Stock ({lowStock.length})</PillBtn>
          <PillBtn active={filter === 'all'}    onClick={() => setFilter('all')}>All ({products.length})</PillBtn>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TrashButton collections={['products']} scope="Products" />
          {isAdmin && (
            <button onClick={() => setModal('new')}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
              + Add Product
            </button>
          )}
        </div>
      </div>

      {shown.length === 0
        ? <Empty>No products in this view.</Empty>
        : <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
            {shown.map((p, i) => (
              <ProductRow key={p.id} product={p} last={i === shown.length - 1} isAdmin={isAdmin}
                onEdit={() => setModal(p)}
                onDelete={() => handleDelete(p)}
                onAdjust={delta => adjustStock(p, delta)}
              />
            ))}
          </div>
      }

      {modal && (
        <ProductModal
          product={modal === 'new' ? null : modal}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

function ProductThumb({ url, active }) {
  const [err, setErr] = useState(false);
  return (
    <div style={{ width: 38, height: 38, borderRadius: 8, overflow: 'hidden', background: active !== false ? '#e8f4ee' : 'var(--pn-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 18 }}>
      {url && !err
        ? <img src={url} alt="" style={{ width: 38, height: 38, objectFit: 'cover' }} onError={() => setErr(true)} />
        : '🛍'}
    </div>
  );
}

function ProductRow({ product: p, last, isAdmin, onEdit, onDelete, onAdjust }) {
  const low = (p.stock || 0) < 5;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: last ? 'none' : '1px solid var(--pn-border)' }}>
      <ProductThumb url={p.image} active={p.active} />

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: p.active !== false ? 'var(--pn-text)' : 'var(--pn-text-faint)' }}>{p.name}</span>
          {p.brand && <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{p.brand}</span>}
          {p.category && <span style={{ fontSize: 10, background: 'var(--pn-info-bg)', color: '#6366f1', borderRadius: 8, padding: '2px 7px', fontWeight: 600 }}>{p.category}</span>}
          {p.active === false && <span style={{ fontSize: 10, background: 'var(--pn-surface-alt)', color: 'var(--pn-text-faint)', borderRadius: 8, padding: '2px 7px', fontWeight: 600 }}>Inactive</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>
          {p.sku && <span style={{ marginRight: 10, fontFamily: 'monospace' }}>#{p.sku}</span>}
          {fmt$(p.price)} retail
          {isAdmin && p.cost ? <span style={{ color: 'var(--pn-text-faint)' }}> · {fmt$(p.cost)} cost</span> : null}
        </div>
      </div>

      {/* Stock */}
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isAdmin && (
            <button onClick={() => onAdjust(-1)} disabled={!p.stock}
              style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', cursor: p.stock ? 'pointer' : 'default', fontSize: 16, color: p.stock ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
          )}
          <div style={{ minWidth: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: low ? '#f59e0b' : 'var(--pn-text)' }}>{p.stock || 0}</div>
            <div style={{ fontSize: 9, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.04em' }}>in stock</div>
          </div>
          {isAdmin && (
            <button onClick={() => onAdjust(1)}
              style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
          )}
        </div>
      </div>

      {/* Actions */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button onClick={onEdit}
            style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', color: 'var(--pn-text-muted)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
            Edit
          </button>
          <button onClick={onDelete}
            style={{ width: 30, height: 30, borderRadius: 8, border: '1px solid #fee2e2', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}

function ProductModal({ product, onSave, onClose }) {
  const editing = !!product;
  const [name,     setName]     = useState(product?.name     || '');
  const [brand,    setBrand]    = useState(product?.brand    || '');
  const [category, setCategory] = useState(product?.category || '');
  const [sku,      setSku]      = useState(product?.sku      || '');
  const [price,    setPrice]    = useState(product?.price    != null ? String(product.price) : '');
  const [cost,     setCost]     = useState(product?.cost     != null ? String(product.cost)  : '');
  const [stock,    setStock]    = useState(product?.stock    != null ? String(product.stock) : '0');
  const [desc,     setDesc]     = useState(product?.description || '');
  const [image,    setImage]    = useState(product?.image     || '');
  const [active,   setActive]   = useState(product?.active   !== false);
  const [affiliateUrl,  setAffiliateUrl]  = useState(product?.affiliateUrl  || '');
  const [isRecommended, setIsRecommended] = useState(!!product?.isRecommended);
  const [saving,   setSaving]   = useState(false);
  const [imgErr,   setImgErr]   = useState(false);

  async function handleSave() {
    if (!name.trim() || !price) return;
    setSaving(true);
    const data = {
      name:        name.trim(),
      brand:       brand.trim()    || null,
      category:    category        || null,
      sku:         sku.trim()      || null,
      price:       Number(price)   || 0,
      cost:        cost ? Number(cost) : null,
      stock:       Math.max(0, Number(stock) || 0),
      description: desc.trim()    || null,
      image:       image.trim()   || null,
      active,
      // Affiliate storefront: external referral URL + "recommended" flag. The
      // trainer keeps the third-party kickback; we only host the link + count
      // clicks. clickCount is server-incremented, so never overwrite it here.
      affiliateUrl:  affiliateUrl.trim() || null,
      isRecommended: !!isRecommended,
    };
    await onSave(data, product?.id);
    setSaving(false);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 420, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--pn-border)', flexShrink: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{editing ? 'Edit Product' : 'New Product'}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', fontSize: 16, color: 'var(--pn-text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          <F label="Product name (required)">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. OPI Gel Color" autoFocus style={inp} />
          </F>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1 }}><F label="Brand"><input value={brand} onChange={e => setBrand(e.target.value)} placeholder="OPI" style={inp} /></F></div>
            <div style={{ flex: 1 }}>
              <F label="Category">
                <select value={category} onChange={e => setCategory(e.target.value)} style={inp}>
                  <option value="">—</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </F>
            </div>
          </div>
          <F label="SKU / Item code (optional)">
            <input value={sku} onChange={e => setSku(e.target.value)} placeholder="OPI-GC-001" style={{ ...inp, fontFamily: 'monospace' }} />
          </F>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <F label="Retail price ($)">
                <input type="number" min={0} step="0.01" value={price} onChange={e => setPrice(e.target.value)} placeholder="24.99" style={inp} />
              </F>
            </div>
            <div style={{ flex: 1 }}>
              <F label="Cost ($) — admin only">
                <input type="number" min={0} step="0.01" value={cost} onChange={e => setCost(e.target.value)} placeholder="12.00" style={inp} />
              </F>
            </div>
          </div>
          <F label="Stock quantity">
            <input type="number" min={0} value={stock} onChange={e => setStock(e.target.value)} placeholder="0" style={inp} />
          </F>
          <F label="Description (optional)">
            <textarea value={desc} onChange={e => setDesc(e.target.value)} rows={2} placeholder="Short description…" style={{ ...inp, resize: 'vertical' }} />
          </F>
          <F label="Product image URL (optional)">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={image} onChange={e => { setImage(e.target.value); setImgErr(false); }} placeholder="https://…" style={{ ...inp, flex: 1 }} />
              {image && !imgErr && (
                <img src={image} alt="" style={{ width: 38, height: 38, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--pn-border)', flexShrink: 0 }} onError={() => setImgErr(true)} />
              )}
            </div>
          </F>
          <F label="Affiliate link (optional)">
            <input value={affiliateUrl} onChange={e => setAffiliateUrl(e.target.value)} placeholder="https://amzn.to/… (your affiliate URL)" style={inp} />
          </F>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 10 }}>
            <input type="checkbox" checked={isRecommended} onChange={e => setIsRecommended(e.target.checked)} />
            Show on my public “Recommended Gear” page
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
            Active (available for sale)
          </label>
          <button onClick={handleSave} disabled={saving || !name.trim() || !price}
            style={{ width: '100%', padding: 12, borderRadius: 10, border: 'none', background: saving || !name.trim() || !price ? 'var(--pn-surface-muted)' : '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving || !name.trim() || !price ? 'default' : 'pointer', fontFamily: 'inherit' }}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Add Product'}
          </button>
        </div>
      </div>
    </div>
  );
}

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
    <button onClick={onClick} style={{ padding: '5px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? 'var(--pn-text)' : 'var(--pn-surface)', color: active ? 'var(--pn-bg)' : 'var(--pn-text-muted)', border: `1px solid ${active ? 'var(--pn-text)' : 'var(--pn-border-strong)'}`, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--pn-text-faint)', fontSize: 13 }}>{children}</div>;
}

function F({ label, children }) {
  return <div style={{ marginBottom: 14 }}><label style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', display: 'block', marginBottom: 5 }}>{label}</label>{children}</div>;
}

const inp = { width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '9px 12px', fontSize: 13, background: 'var(--pn-bg)', outline: 'none' };
