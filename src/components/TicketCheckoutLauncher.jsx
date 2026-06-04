import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { fetchEmployees } from '../lib/firestore';
import CheckoutModal from '../modules/checkout/CheckoutModal';

// Renders the CheckoutModal driven by the ticket. Lives at AppShell level so
// it can launch from any module (Schedule, Clients, Reports, etc.) — wherever
// the user is when they click "Continue to checkout" in the ticket panel.
export default function TicketCheckoutLauncher() {
  const { ticket, ticketCheckoutOpen, setTicketCheckoutOpen, clearTicket } = useApp();
  const [techs, setTechs] = useState(null);
  const [walkInClient, setWalkInClient] = useState(null);
  const [askName, setAskName] = useState(false);
  const [tmpName, setTmpName] = useState('');
  const [tmpPhone, setTmpPhone] = useState('');
  const [tmpEmail, setTmpEmail] = useState('');

  useEffect(() => {
    if (ticketCheckoutOpen && techs === null) {
      fetchEmployees().then(emps => {
        const names = emps.filter(e => e.active !== false).map(e => e.name);
        setTechs(names);
      }).catch(() => setTechs([]));
    }
  }, [ticketCheckoutOpen, techs]);

  // When ticket has only products (no appts), we need a walk-in client name
  // before the checkout modal can render — capture it in a tiny pre-step.
  useEffect(() => {
    if (!ticketCheckoutOpen) {
      setWalkInClient(null);
      setAskName(false);
      setTmpName(''); setTmpPhone(''); setTmpEmail('');
      return;
    }
    if (ticket.appts.length === 0 && ticket.products.length > 0 && !walkInClient) {
      setAskName(true);
    }
  }, [ticketCheckoutOpen, ticket.appts.length, ticket.products.length, walkInClient]);

  if (!ticketCheckoutOpen) return null;

  function close() { setTicketCheckoutOpen(false); }
  function complete() {
    clearTicket();
    setTicketCheckoutOpen(false);
  }

  // Walk-in name capture step
  if (askName) {
    const valid = tmpName.trim().length > 0;
    function submit() {
      if (!valid) return;
      setWalkInClient({ name: tmpName.trim(), phone: tmpPhone.trim(), email: tmpEmail.trim() });
      setAskName(false);
    }
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 350 }}
           onClick={e => { if (e.target === e.currentTarget) close(); }}>
        <div style={{ background: 'var(--pn-surface)', borderRadius: 16, padding: '20px 22px', width: '92%', maxWidth: 380, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>🛍 Retail sale</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 14 }}>Just a customer name so we can attach the receipt. Phone and email are optional.</div>
          <input value={tmpName} onChange={e => setTmpName(e.target.value)} placeholder="Customer name *" autoFocus
            onKeyDown={e => e.key === 'Enter' && valid && submit()}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', marginBottom: 8, background: 'var(--pn-bg)' }} />
          <input value={tmpPhone} onChange={e => setTmpPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', marginBottom: 8, background: 'var(--pn-bg)' }} />
          <input value={tmpEmail} onChange={e => setTmpEmail(e.target.value)} placeholder="Email (optional, for receipt)" inputMode="email"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', fontSize: 13, fontFamily: 'inherit', marginBottom: 14, background: 'var(--pn-bg)' }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={close} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={submit} disabled={!valid}
              style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: valid ? '#7c3aed' : '#d0d0d0', color: '#fff', fontSize: 13, fontWeight: 700, cursor: valid ? 'pointer' : 'default', fontFamily: 'inherit' }}>
              Continue to checkout →
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (techs === null) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, color: '#fff', fontSize: 13 }}>
        Loading checkout…
      </div>
    );
  }

  // Empty ticket guard (shouldn't normally happen — guard anyway)
  if (ticket.appts.length === 0 && ticket.products.length === 0) {
    setTicketCheckoutOpen(false);
    return null;
  }

  return (
    <CheckoutModal
      appts={ticket.appts}
      walkInClient={ticket.appts.length === 0 ? walkInClient : null}
      initialProducts={ticket.products}
      techs={techs}
      onComplete={complete}
      onClose={close}
    />
  );
}
