// Card-on-file UI inside the client modal. Lists saved Stripe PaymentMethods
// and lets admins add or remove cards. Card capture goes through Stripe
// Elements → tokenization in the browser → savePaymentMethod Cloud Function.
// We never see the raw PAN.

import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';
import { callFn } from '../../lib/firebase';
import { TENANT_ID } from '../../lib/tenant';
import { useApp } from '../../context/AppContext';
import { fetchClientAppointments, saveClient } from '../../lib/firestore';
import { evaluateCancellationPolicy } from '../../lib/cancellationPolicy';

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
      background: 'var(--pn-surface)', borderRadius: 10, border: '1px solid var(--pn-border)',
      padding: '12px 14px', marginBottom: 8,
    }}>
      <div style={{
        width: 40, height: 28, borderRadius: 6, background: 'var(--pn-surface-alt)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 9, fontWeight: 700, color: 'var(--pn-text-muted)', letterSpacing: 0.5,
        textTransform: 'uppercase', flexShrink: 0,
      }}>
        {BRAND_ICONS[pm.brand] || 'card'}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>
            {brandLabel(pm.brand)} •••• {pm.last4}
          </span>
          {isDefault && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              padding: '2px 6px', borderRadius: 4, background: 'var(--pn-success-bg)', color: 'var(--pn-success)',
              textTransform: 'uppercase',
            }}>Default</span>
          )}
          {pm.country && pm.country !== 'US' && (
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
              padding: '2px 6px', borderRadius: 4, background: 'var(--pn-warning-bg)', color: 'var(--pn-warning)',
              textTransform: 'uppercase',
            }} title="International card — Stripe charges +1.5% surcharge">Intl +1.5%</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 2 }}>
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
      background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 10,
      padding: '16px 14px', marginBottom: 12,
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 10 }}>
        Add a new card
      </div>
      <div style={{
        background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8,
        padding: '12px 14px', marginBottom: 10,
      }}>
        <CardElement options={{
          style: {
            base: { fontSize: '14px', color: 'var(--pn-text)', fontFamily: 'inherit', '::placeholder': { color: '#9ca3af' } },
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
            border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)',
            cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>Cancel</button>
        <button type="submit" disabled={submitting || !stripe}
          style={{
            fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 6,
            border: 'none', background: submitting ? 'var(--pn-border-strong)' : '#2D7A5F', color: '#fff',
            cursor: submitting ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}>
          {submitting ? 'Saving…' : 'Save card'}
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginTop: 10, textAlign: 'center' }}>
        Cards are stored by Stripe. We only ever see the brand + last 4 digits.
      </div>
    </form>
  );
}

// Renders the cancellation-policy verdict for this client + admin override
// controls. Color follows the verdict: red when card required, green when
// satisfied, gray when policy disabled.
function PolicyBanner({ verdict, busy, onOverride }) {
  const { required, reason, overrideApplied, cancellationCount, thresholdCount, windowDays, hasCard } = verdict;

  // Pick palette
  let bg, border, fg, headlineColor;
  if (required) {
    bg = 'var(--pn-danger-bg)'; border = '#fecaca'; fg = 'var(--pn-danger)'; headlineColor = 'var(--pn-danger)';
  } else if (overrideApplied === 'exempt') {
    bg = 'var(--pn-success-bg)'; border = '#bbf7d0'; fg = 'var(--pn-success)'; headlineColor = 'var(--pn-success)';
  } else if (cancellationCount >= thresholdCount && hasCard) {
    bg = 'var(--pn-success-bg)'; border = '#bbf7d0'; fg = 'var(--pn-success)'; headlineColor = 'var(--pn-success)';
  } else if (cancellationCount > 0) {
    bg = 'var(--pn-warning-bg)'; border = '#fed7aa'; fg = 'var(--pn-warning)'; headlineColor = 'var(--pn-warning)';
  } else {
    bg = 'var(--pn-bg)'; border = 'var(--pn-border)'; fg = 'var(--pn-text-muted)'; headlineColor = 'var(--pn-text)';
  }

  let headline;
  if (overrideApplied === 'force') {
    headline = required ? '⚠ Card required (admin override)' : '✓ Card required policy met (override + card on file)';
  } else if (overrideApplied === 'exempt') {
    headline = '✓ Exempt from card-required policy';
  } else if (required) {
    headline = '⚠ Card on file required before next booking';
  } else if (cancellationCount >= thresholdCount && hasCard) {
    headline = '✓ Threshold met, but card on file — booking allowed';
  } else if (cancellationCount > 0) {
    headline = `${cancellationCount} cancellation${cancellationCount === 1 ? '' : 's'} in the last ${windowDays} days`;
  } else {
    headline = 'No recent cancellations';
  }

  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, color: fg,
      borderRadius: 10, padding: '12px 14px', marginBottom: 14, fontSize: 12,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: headlineColor, marginBottom: 4 }}>
        {headline}
      </div>
      <div style={{ lineHeight: 1.5 }}>
        {cancellationCount} / {thresholdCount} cancellation{thresholdCount === 1 ? '' : 's'} threshold in last {windowDays} days.
        {' '}
        {hasCard ? 'Card on file ✓' : 'No card on file.'}
      </div>
      {verdict.message && (
        <div style={{ fontSize: 11, marginTop: 4, opacity: 0.85 }}>{verdict.message}</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {overrideApplied !== 'exempt' && (
          <button onClick={() => onOverride(false, prompt('Reason for exempting this client (optional):') || '')}
            disabled={busy}
            style={{
              fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 6,
              border: '1px solid #bbf7d0', background: 'var(--pn-surface)', color: '#15803d',
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}>
            Exempt this client
          </button>
        )}
        {overrideApplied !== 'force' && (
          <button onClick={() => onOverride(true, prompt('Reason for marking card-required (optional):') || '')}
            disabled={busy}
            style={{
              fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 6,
              border: '1px solid #fecaca', background: 'var(--pn-surface)', color: '#991b1b',
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}>
            Force card required
          </button>
        )}
        {overrideApplied && (
          <button onClick={() => onOverride(null, null)}
            disabled={busy}
            style={{
              fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 6,
              border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)',
              cursor: busy ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}>
            Clear override
          </button>
        )}
      </div>
    </div>
  );
}

export default function SavedCardsTab({ client, onChange, onReload }) {
  const { settings, showToast, isAdmin } = useApp();
  const [adding,     setAdding]     = useState(false);
  const [busyId,     setBusyId]     = useState('');
  const [appts,      setAppts]      = useState(null);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const paymentMethods = client.paymentMethods || [];
  const defaultId      = client.defaultPaymentMethodId;

  // Load appointment history to evaluate the cancellation policy.
  useEffect(() => {
    if (!client?.id) return;
    let cancelled = false;
    fetchClientAppointments(client.id)
      .then(rows => { if (!cancelled) setAppts(rows); })
      .catch(() => { if (!cancelled) setAppts([]); });
    return () => { cancelled = true; };
  }, [client?.id]);

  const policyVerdict = appts === null
    ? null
    : evaluateCancellationPolicy(appts, settings, client);

  async function handleOverride(value, reason) {
    if (!client.id) return;
    setOverrideBusy(true);
    try {
      const patch = {
        cardRequiredOverride: value,
        cardRequiredOverrideReason: reason || null,
      };
      await saveClient(client.id, patch);
      onChange?.(patch);
      showToast(value === false ? 'Client exempted from card-required policy'
                 : value === true ? 'Client marked card-required'
                 : 'Override cleared');
    } catch (e) {
      showToast(`Failed: ${e.message}`, 3000);
    } finally {
      setOverrideBusy(false);
    }
  }

  // Card-on-file is admin-only — taking money is a privileged action.
  if (!isAdmin) {
    return (
      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', padding: '24px 0', textAlign: 'center' }}>
        Saved cards are visible to admins only.
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div style={{ fontSize: 13, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fed7aa', borderRadius: 8, padding: '12px 14px' }}>
        Stripe publishable key not configured. Set <code>VITE_STRIPE_PUBLISHABLE_KEY</code> in the root <code>.env</code> file.
      </div>
    );
  }

  if (!client.id) {
    return (
      <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', padding: '24px 0', textAlign: 'center' }}>
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
        {policyVerdict && (policyVerdict.policyEnabled || policyVerdict.overrideApplied) && (
          <PolicyBanner verdict={policyVerdict} busy={overrideBusy} onOverride={handleOverride} />
        )}

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
          Saved cards
        </div>

        {paymentMethods.length === 0 && !adding && (
          <div style={{
            fontSize: 13, color: 'var(--pn-text-muted)', textAlign: 'center',
            background: 'var(--pn-bg)', borderRadius: 10, border: '1px dashed var(--pn-border-strong)',
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
              background: 'var(--pn-surface)', border: '1px dashed #93c5fd', borderRadius: 10,
              padding: '12px', cursor: 'pointer', fontFamily: 'inherit',
            }}>
            + Add a card on file
          </button>
        )}

        <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 14, lineHeight: 1.6 }}>
          Cards are stored by Stripe (PCI Level 1 vault). We see brand + last 4 only — never the full
          card number. To charge a stored card the salon must complete Stripe Connect onboarding first.
        </div>
      </div>
    </Elements>
  );
}
