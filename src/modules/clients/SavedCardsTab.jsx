// Card-on-file UI inside the client modal. Lists saved Stripe PaymentMethods
// and lets admins add or remove cards. Card capture goes through Stripe
// Elements → tokenization in the browser → savePaymentMethod Cloud Function.
// We never see the raw PAN.

import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';
import { useApp } from '../../context/AppContext';

const stripePromise = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
  ? loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY)
  : null;

const BRAND_ICONS = {
  visa:       'visa',
  mastercard: 'mc',
  amex:       'amex',
  discover:   'disc',
  diners:     'diners',
  jcb:        'jcb',
  unionpay:   'unionpay',
  unknown:    'card',
};

function brandLabel(brand) {
  if (!brand) return 'Card';
  const map = { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' };
  return map[brand] || brand.charAt(0).toUpperCase() + brand.slice(1);
}

function CardRow({ pm, isDefault, onMakeDefault, onDelete, busy }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: '#fff', borderRadius: 10, border: '1px solid #e8e8e8',
      padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{
        width: 40, height: 28, borderRadius: 6, background: '#f0f4f8',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: 0.5,
        textTransform: 'uppercase', flexShrink: 0,
      }}>
        {BRAND_ICONS[pm.brand] || 'card'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
            {brandLabel(pm.brand)} •••• {pm.last4}
          </span>
          {isDefault && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              padding: '2px 6px', borderRadius: 4, background: '#ecfdf5', color: '#15803d',
              textTransform: 'uppercase',
            }}>Default</span>
          )}
          {pm.country && pm.country !== 'US' && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              padding: '2px 6px', borderRadius: 4, background: '#fff7ed', color: '#9a3412',
              textTransform: 'uppercase',
            }} title="International card — Stripe charges +1.5% surcharge">Intl +1.5%</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
          Expires {String(pm.expMonth).padStart(2, '0')}/{String(pm.expYear).slice(-2)}
          {pm.funding && pm.funding !== 'unknown' ? ` · ${pm.funding}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {!isDefault && (
          <button onClick={onMakeDefault} disabled={busy}
            style={{
              fontSize: 11, color: '#3D95CE', background: 'none',
              border: 'none', cursor: busy ? 'wait' : 'pointer', padding: '4px 8px',
              fontFamily: 'inherit',
            }}>
            Make default
          </button>
        )}
        <button onClick={onDelete} disabled={busy}
          style={{
            fontSize: 11, color: '#ef4444', background: 'none',
            border: 'none', cursor: busy ? 'wait' : 'pointer', padding: '4px 8px',
            fontFamily: 'inherit',
          }}>
          Remove
        </button>
      </div>
    </div>
  );
}

function AddCardForm({ clientId, onAdded, onCancel }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e) {
    e?.preventDefault?.();
    if (!stripe || !elements) return;
    setSubmitting(true); setError('');
    try {
      const { data } = await callFn('createSetupIntent')({ clientId, tenantId: TENANT_ID });
      const clientSecret = data?.clientSecret;
      if (!clientSecret) throw new Error('No client secret returned');

      const { setupIntent, error: stripeErr } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: elements.getElement(CardElement) },
      });
      if (stripeErr) throw new Error(stripeErr.message || 'Card declined');
      if (!setupIntent?.payment_method) throw new Error('No payment method returned');

      const { data: saved } = await callFn('savePaymentMethod')({
        clientId,
        paymentMethodId: setupIntent.payment_method,
        tenantId: TENANT_ID,
      });
      onAdded(saved?.paymentMethod);
    } catch (err) {
      setError(err.message || 'Failed to save card');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{
      background: '#f8fafc', border: '1px solid #e8e8e8', borderRadius: 10,
      padding: '16px 14px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#444', marginBottom: 10 }}>
        Add a new card
      </div>
      <div style={{
        background: '#fff', border: '1px solid #d1d5db', borderRadius: 8,
        padding: '12px 14px', marginBottom: 10,
      }}>
        <CardElement options={{
          style: {
            base: { fontSize: '14px', color: '#1a1a1a', fontFamily: 'inherit', '::placeholder': { color: '#9ca3af' } },
            invalid: { color: '#dc2626' },
          },
        }} />
      </div>
      {error && (
        <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10 }}>{error}</div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onCancel} disabled={submitting}
          style={{
            fontSize: 12, padding: '8px 14px', borderRadius: 6,
            border: '1px solid #d1d5db', background: '#fff', color: '#555',
            cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
        <button type="submit" disabled={submitting || !stripe}
          style={{
            fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 6,
            border: 'none', background: submitting ? '#ccc' : '#2D7A5F', color: '#fff',
            cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>
          {submitting ? 'Saving…' : 'Save card'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: '#888', marginTop: 10, textAlign: 'center' }}>
        Cards are stored by Stripe. We only ever see the brand + last 4 digits.
      </div>
    </form>
  );
}

export default function SavedCardsTab({ client, onChange, onReload }) {
  const { showToast, isAdmin } = useApp();
  const [adding,     setAdding]     = useState(false);
  const [busyId,     setBusyId]     = useState('');

  const paymentMethods = client.paymentMethods || [];
  const defaultId      = client.defaultPaymentMethodId;

  // Card-on-file is admin-only — taking money is a privileged action.
  if (!isAdmin) {
    return (
      <div style={{ fontSize: 13, color: '#888', padding: '24px 0', textAlign: 'center' }}>
        Saved cards are visible to admins only.
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div style={{ fontSize: 13, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '12px 14px' }}>
        Stripe publishable key not configured. Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the root <code>.env</code> file.
      </div>
    );
  }

  if (!client.id) {
    return (
      <div style={{ fontSize: 13, color: '#888', padding: '24px 0', textAlign: 'center' }}>
        Save this client first before adding a card on file.
      </div>
    );
  }

  async function handleMakeDefault(pmId) {
    setBusyId(pmId);
    try {
      await callFn('savePaymentMethod')({
        clientId: client.id,
        paymentMethodId: pmId,
        makeDefault: true,
        tenantId: TENANT_ID,
      });
      // Reflect locally — onChange propagates to parent for re-fetch
      onChange?.({ defaultPaymentMethodId: pmId });
      await onReload?.();
      showToast('Default card updated');
    } catch (e) {
      showToast(`Failed: ${e.message}`, 3000);
    } finally {
      setBusyId('');
    }
  }

  async function handleDelete(pmId) {
    if (!confirm(`Remove this card from ${client.name || 'this client'}?`)) return;
    setBusyId(pmId);
    try {
      await callFn('deletePaymentMethod')({
        clientId: client.id,
        paymentMethodId: pmId,
        tenantId: TENANT_ID,
      });
      const next = paymentMethods.filter(p => p.id !== pmId);
      onChange?.({
        paymentMethods: next,
        defaultPaymentMethodId: defaultId === pmId ? (next[0]?.id || null) : defaultId,
      });
      await onReload?.();
      showToast('Card removed');
    } catch (e) {
      showToast(`Failed: ${e.message}`, 3000);
    } finally {
      setBusyId('');
    }
  }

  function handleAdded(newPm) {
    if (!newPm) return;
    const existing = paymentMethods.filter(p => p.id !== newPm.id);
    const next = [...existing, newPm];
    onChange?.({
      paymentMethods: next,
      defaultPaymentMethodId: defaultId || newPm.id,
    });
    setAdding(false);
    onReload?.();
    showToast('Card saved');
  }

  return (
    <Elements stripe={stripePromise}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Saved cards
        </div>

        {paymentMethods.length === 0 && !adding && (
          <div style={{
            fontSize: 13, color: '#888', textAlign: 'center',
            background: '#f8fafc', borderRadius: 10, border: '1px dashed #d1d5db',
            padding: '24px 16px', marginBottom: 12,
          }}>
            No cards on file. Add one to charge no-show fees, deposits, or repeat checkouts.
          </div>
        )}

        {paymentMethods.map(pm => (
          <CardRow key={pm.id}
            pm={pm}
            isDefault={pm.id === defaultId}
            busy={busyId === pm.id}
            onMakeDefault={() => handleMakeDefault(pm.id)}
            onDelete={() => handleDelete(pm.id)}
          />
        ))}

        {adding ? (
          <AddCardForm
            clientId={client.id}
            onAdded={handleAdded}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button onClick={() => setAdding(true)}
            style={{
              width: '100%', fontSize: 13, fontWeight: 600, color: '#3D95CE',
              background: '#fff', border: '1px dashed #93c5fd', borderRadius: 10,
              padding: '12px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            + Add a card on file
          </button>
        )}

        <div style={{ fontSize: 10, color: '#aaa', marginTop: 14, lineHeight: 1.6 }}>
          Cards are stored by Stripe (PCI Level 1 vault). We see brand + last 4 only — never the full
          card number. To charge a stored card the salon must complete Stripe Connect onboarding first.
        </div>
      </div>
    </Elements>
  );
}
