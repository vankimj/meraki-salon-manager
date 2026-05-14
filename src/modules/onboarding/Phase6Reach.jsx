import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  fetchBookingConfig, saveBookingConfig,
  subscribeTenantSms,
} from '../../lib/firestore';
import { logActivity, logError } from '../../lib/logger';
import SmsSetup from '../admin/SmsSetup';

// Phase 6 (UI step 7 of 8) — Reach your clients.
//
// Two big rails:
//   1. Online booking — enabled toggle, optional booking-page note.
//      Writes to data/bookingConfig. Tenant's public booking URL is
//      auto-derived from their subdomain (set in Phase 1) and shown
//      so they can copy it for their Instagram bio / Google profile.
//   2. SMS — embeds the full SmsSetup wizard inline (3-step TFN
//      provisioning + status card). Same component that lives on
//      Admin → SMS tab; provisioning is idempotent so embedding here
//      vs. there yields the same state.
//
// Skipping is fine — every channel can be enabled post-launch from
// Admin. Phase 6 just lowers the friction of doing both during
// onboarding.
export default function Phase6Reach({ onboarding, onAdvance, saving }) {
  const { settings, showToast } = useApp();
  const [bookingCfg, setBookingCfg] = useState(null);
  const [savingBooking, setSavingBooking] = useState(false);
  const [sms, setSms]   = useState(null);
  const [err, setErr]   = useState('');

  useEffect(() => {
    fetchBookingConfig().then(setBookingCfg).catch(() => setBookingCfg({ enabled: false }));
  }, []);

  useEffect(() => subscribeTenantSms(setSms), []);

  async function saveBooking(patch) {
    if (!bookingCfg) return;
    setErr('');
    setSavingBooking(true);
    try {
      const next = { ...bookingCfg, ...patch };
      await saveBookingConfig(next);
      setBookingCfg(next);
      logActivity('onboarding_booking_saved', JSON.stringify(patch));
    } catch (e) {
      setErr(e?.message || String(e));
      logError('onboarding_booking_save', e);
    } finally {
      setSavingBooking(false);
    }
  }

  function complete({ skip } = {}) {
    if (skip) { onAdvance({ skip: true }); return; }
    onAdvance({
      phaseData: {
        bookingEnabled: Boolean(bookingCfg?.enabled),
        smsStatus:      sms?.status || 'draft',
      },
    });
  }

  // Build the public booking URL from tenant settings. For Meraki this
  // resolves to the salon's plumenexus subdomain or the meraki webapp
  // fallback so the tenant has something to copy/paste.
  const subdomain = settings?.subdomain
    || onboarding?.phases?.profile?.phaseData?.subdomain
    || 'meraki';
  const bookingUrl = subdomain === 'meraki'
    ? 'https://meraki-salon-manager.web.app/?book=1'
    : `https://${subdomain}.plumenexus.com/?book=1`;

  const smsStatusLabel = !sms || sms.status === 'released' || sms.status === 'draft'
    ? '⚪ Not set up yet'
    : sms.status === 'pending_twilio' ? '🟡 Pending Twilio review'
    : sms.status === 'pending_carrier' ? '🔵 In carrier review'
    : sms.status === 'approved' ? '🟢 Active'
    : sms.status === 'rejected' ? '🔴 Needs changes'
    : sms.status;

  return (
    <div>
      <div style={{ fontSize: 14, color: '#555', lineHeight: 1.55, marginBottom: 18 }}>
        Turn on the channels you want to reach clients through. Online booking is how new
        customers find you; SMS is how you remind everyone of their next appointment.
        Either can be enabled (or disabled) later from Admin.
      </div>

      <Section title="Online booking">
        {!bookingCfg ? (
          <div style={{ padding: 14, color: '#888', fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <ToggleRow
              checked={Boolean(bookingCfg.enabled)}
              onChange={v => saveBooking({ enabled: v })}
              disabled={savingBooking}
              label="Accept bookings online"
              desc="When on, clients can book at your public URL. Off = staff-managed only."
            />

            {bookingCfg.enabled && (
              <>
                <Row label="Your public booking URL">
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <code style={{ fontSize: 12, background: '#f3f4f6', padding: '5px 8px', borderRadius: 6, color: '#1a1a1a', wordBreak: 'break-all' }}>
                      {bookingUrl}
                    </code>
                    <button type="button" onClick={() => { navigator.clipboard?.writeText(bookingUrl); showToast('Copied to clipboard'); }}
                      style={btnSmall}>Copy</button>
                    <a href={bookingUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnSmall, textDecoration: 'none', display: 'inline-block' }}>Preview</a>
                  </div>
                  <Hint>Paste into your Instagram bio, Google Business profile, and website.</Hint>
                </Row>

                <Row label="Booking page note (optional)">
                  <textarea value={bookingCfg.note || ''}
                    onChange={e => setBookingCfg(c => ({ ...c, note: e.target.value }))}
                    onBlur={() => saveBooking({ note: bookingCfg.note || '' })}
                    rows={2}
                    placeholder="e.g. New clients welcome! Cancellations within 24 hours forfeit the deposit."
                    style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
                </Row>
              </>
            )}
          </>
        )}
      </Section>

      <Section title={`SMS · ${smsStatusLabel}`}>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.55, marginBottom: 10 }}>
          We provision a verified toll-free number on your behalf. Setup runs through Twilio
          (3-step wizard below). Once approved you can send reminders + marketing campaigns.
        </div>
        <div style={{ border: '1px solid #e8e8e8', borderRadius: 10, overflow: 'hidden' }}>
          <SmsSetup />
        </div>
      </Section>

      {err && (
        <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 18 }}>
        <button onClick={() => complete({ skip: true })} disabled={saving} style={btnSecondary}>Skip for now</button>
        <button onClick={() => complete()} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}

function Hint({ children }) {
  return <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>{children}</div>;
}

function ToggleRow({ checked, onChange, disabled, label, desc }) {
  return (
    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 10, border: '1px solid #e8e8e8', borderRadius: 8, cursor: disabled ? 'default' : 'pointer', background: '#fff', opacity: disabled ? 0.7 : 1 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled}
        style={{ marginTop: 2, accentColor: '#5b3b8c' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>{label}</div>
        {desc && <div style={{ fontSize: 11, color: '#666', marginTop: 2, lineHeight: 1.5 }}>{desc}</div>}
      </div>
    </label>
  );
}

const inp = { boxSizing: 'border-box', width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid #d8d8d8', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: '#fff' };
const btnPrimary   = { padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit' };
const btnSmall     = { padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit' };
