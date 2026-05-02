import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { fetchProducts } from '../lib/firestore';
import { resolveServicePricing } from '../utils/serviceHelpers';
import { IconShoppingCart } from './Icons';

// Top-bar ticket button + dropdown panel. State + persistence lives in AppContext.
export default function TicketPanel() {
  const { ticket, ticketCount, removeApptFromTicket, addProductToTicket, setTicketProductQty, setTicketCheckoutOpen, clearTicket, gUser } = useApp();
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [allProducts, setAllProducts] = useState(null);
  const [coords, setCoords] = useState(null); // { top, right } anchored from the button rect
  const wrapRef = useRef(null);
  const dropRef = useRef(null);

  // Recompute the dropdown's fixed-position anchor whenever it opens, the
  // viewport changes, or anything scrolls (so it stays anchored to the button).
  useEffect(() => {
    if (!open) return;
    function update() {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setCoords({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (wrapRef.current?.contains(e.target)) return;
      if (dropRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!gUser) return null;

  const apptsTotal = ticket.appts.reduce((s, a) => s + (a.services || []).reduce((ss, sv) => ss + (Number(sv.price) || 0), 0), 0);
  const productsTotal = ticket.products.reduce((s, p) => s + (Number(p.product.price) || 0) * p.qty, 0);
  const subtotal = apptsTotal + productsTotal;

  async function openPicker() {
    setShowPicker(true);
    if (!allProducts) {
      const list = await fetchProducts().catch(() => []);
      setAllProducts(list.filter(p => p.active !== false && (p.stock || 0) > 0));
    }
  }

  function continueToCheckout() {
    if (ticketCount === 0) return;
    setOpen(false);
    setTicketCheckoutOpen(true);
  }

  function handleClearTicket() {
    if (!window.confirm(`Clear ${ticketCount} item${ticketCount === 1 ? '' : 's'} from the ticket?`)) return;
    clearTicket();
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} title="Ticket"
        style={{ height: 40, width: 40, borderRadius: 20, border: '1px solid #e0e0e0', background: open ? '#f0f0f0' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <IconShoppingCart size={18} />
        {ticketCount > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', lineHeight: 1, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>
            {ticketCount > 9 ? '9+' : ticketCount}
          </span>
        )}
      </button>

      {open && coords && (
        <div ref={dropRef} style={{ position: 'fixed', top: coords.top, right: coords.right, width: 380, maxWidth: 'calc(100vw - 24px)', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.14)', zIndex: 9999, overflow: 'hidden', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>🧾 Ticket</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {ticketCount > 0 && (
                <span style={{ fontSize: 11, color: '#888' }}>{ticketCount} item{ticketCount === 1 ? '' : 's'}</span>
              )}
              {ticketCount > 0 && (
                <button onClick={handleClearTicket} title="Clear ticket"
                  style={{ fontSize: 11, fontWeight: 600, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                  Clear
                </button>
              )}
            </div>
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {ticket.appts.length === 0 && ticket.products.length === 0 ? (
              <div style={{ padding: '32px 16px', textAlign: 'center', color: '#aaa', fontSize: 12, lineHeight: 1.6 }}>
                No active ticket.<br />
                Add appointments from the schedule (or add products below) to start a checkout.
              </div>
            ) : (
              <>
                {/* Appointments */}
                {ticket.appts.length > 0 && (
                  <div style={{ padding: '10px 16px 4px' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Appointments</div>
                    {ticket.appts.map(a => {
                      const total = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
                      const svcLabel = (a.services || []).map(s => s.name).join(', ') || '—';
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.clientName || 'Walk-in'}</div>
                            <div style={{ fontSize: 11, color: '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.techName} · {svcLabel}</div>
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', flexShrink: 0 }}>${total.toFixed(2)}</div>
                          <button onClick={() => removeApptFromTicket(a.id)} title="Remove"
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#ccc', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Products */}
                {ticket.products.length > 0 && (
                  <div style={{ padding: '10px 16px 4px', borderTop: ticket.appts.length > 0 ? '1px solid #f0f0f0' : 'none' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>Products</div>
                    {ticket.products.map(p => (
                      <div key={p.product.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #f5f5f5' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.product.name}</div>
                          <div style={{ fontSize: 11, color: '#888' }}>${(p.product.price || 0).toFixed(2)} ea</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          <button onClick={() => setTicketProductQty(p.product.id, p.qty - 1)}
                            style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #e0e0e0', background: '#fff', cursor: 'pointer', fontSize: 14, color: '#555' }}>−</button>
                          <span style={{ fontSize: 13, fontWeight: 600, minWidth: 16, textAlign: 'center' }}>{p.qty}</span>
                          <button onClick={() => setTicketProductQty(p.product.id, p.qty + 1)} disabled={p.qty >= (p.product.stock || 0)}
                            style={{ width: 22, height: 22, borderRadius: 4, border: '1px solid #e0e0e0', background: '#fff', cursor: p.qty < (p.product.stock || 0) ? 'pointer' : 'default', fontSize: 14, color: p.qty < (p.product.stock || 0) ? '#555' : '#ccc' }}>+</button>
                        </div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', width: 56, textAlign: 'right', flexShrink: 0 }}>${((p.product.price || 0) * p.qty).toFixed(2)}</div>
                        <button onClick={() => setTicketProductQty(p.product.id, 0)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: '#ccc', padding: '0 2px', flexShrink: 0, lineHeight: 1 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Inline product picker */}
            {showPicker && (
              <div style={{ padding: '8px 12px 12px', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#666' }}>Add a product</span>
                  <button onClick={() => setShowPicker(false)}
                    style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 14 }}>×</button>
                </div>
                {!allProducts ? (
                  <div style={{ fontSize: 11, color: '#aaa', padding: 8 }}>Loading…</div>
                ) : allProducts.length === 0 ? (
                  <div style={{ fontSize: 11, color: '#aaa', padding: 8 }}>No products in stock. Add some in the Products module.</div>
                ) : (
                  <div style={{ maxHeight: 180, overflowY: 'auto', background: '#fff', border: '1px solid #ececec', borderRadius: 8 }}>
                    {allProducts.map((p, i) => (
                      <div key={p.id} onClick={() => { addProductToTicket(p); setShowPicker(false); }}
                        style={{ padding: '8px 12px', borderBottom: i < allProducts.length - 1 ? '1px solid #f5f5f5' : 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fafafa'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#1a1a1a' }}>{p.name}</div>
                          <div style={{ fontSize: 10, color: '#aaa' }}>{p.stock} in stock</div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--tm-primary, #2D7A5F)' }}>${(p.price || 0).toFixed(2)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ padding: '10px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {!showPicker && (
              <button onClick={openPicker}
                style={{ padding: '8px', borderRadius: 8, border: '1.5px dashed #d0d0d0', background: '#fafafa', color: '#666', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                + Add product
              </button>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#666' }}>Subtotal</span>
              <span style={{ fontSize: 18, fontWeight: 800, color: '#1a1a1a' }}>${subtotal.toFixed(2)}</span>
            </div>
            <button onClick={continueToCheckout} disabled={ticketCount === 0}
              style={{ padding: '11px', borderRadius: 10, border: 'none', background: ticketCount === 0 ? '#d0d0d0' : 'var(--tm-primary, #2D7A5F)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: ticketCount === 0 ? 'default' : 'pointer', fontFamily: 'inherit', boxShadow: ticketCount === 0 ? 'none' : '0 2px 6px rgba(0,0,0,.15)' }}>
              {ticketCount === 0 ? 'Ticket is empty' : 'Continue to checkout →'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
