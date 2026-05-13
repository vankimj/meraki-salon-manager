import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import {
  provisionTenantSMS,
  releaseTenantSMS,
  subscribeTenantSms,
  fetchWebfrontConfig,
} from '../../lib/firestore';
import { logActivity, logError } from '../../lib/logger';

// Local US-style phone formatter for the contact phone field.
function fmtPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const TFN_AREA_CODES = ['833', '844', '855', '866', '877', '888'];

const STATUS_COPY = {
  draft:           { color: '#6b7280', label: 'Not started', desc: 'Fill out the wizard to provision SMS.' },
  pending_twilio:  { color: '#f59e0b', label: 'Pending Twilio review', desc: 'Twilio is reviewing your submission (1–3 days).' },
  pending_carrier: { color: '#3b82f6', label: 'In carrier review',     desc: 'Carriers (T-Mobile / AT&T / Verizon) are reviewing (2–7 business days).' },
  approved:        { color: '#10b981', label: 'Approved & live',       desc: 'Your TFN is verified. SMS sends are now active.' },
  rejected:        { color: '#ef4444', label: 'Needs changes',         desc: 'Carriers flagged something — edit your submission and resubmit.' },
  released:        { color: '#9ca3af', label: 'Released',              desc: 'TFN has been released. Start over to provision a new one.' },
  error:           { color: '#ef4444', label: 'Provisioning error',    desc: 'Twilio returned an error — see message below.' },
};

export default function SmsSetup() {
  const { isAdmin, settings, showToast } = useApp();
  const [sms, setSms]       = useState(null);
  const [webCfg, setWebCfg] = useState(null);
  const [step, setStep]     = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState('');
  const [releaseBusy, setReleaseBusy] = useState(false);

  const [form, setForm] = useState({
    businessName:         '',
    ein:                  '',
    address:              '',
    city:                 '',
    state:                'OH',
    zip:                  '',
    contactFirstName:     '',
    contactLastName:      '',
    contactEmail:         '',
    contactPhone:         '',
    website:              '',
    privacyPolicyUrl:     '',
    useCase:              'MIXED',
    useCaseDescription:   '',
    sampleMessages:       ['', '', ''],
    optInDescription:     'Clients check a consent checkbox during online booking. The checkbox is unchecked by default and the consent text appears next to it. Opt-in is stored on the client record with a timestamp. Reply STOP to opt out, HELP for help.',
    optInProofUrl:        '',
    estimatedDailyVolume: 100,
  });
  const [areaCode, setAreaCode] = useState('833');

  // Live subscription on data/sms — drives status card auto-update.
  useEffect(() => subscribeTenantSms(setSms), []);

  // Pre-fill form from settings + webfront on mount.
  useEffect(() => {
    fetchWebfrontConfig().then(wf => setWebCfg(wf || {})).catch(() => setWebCfg({}));
  }, []);

  useEffect(() => {
    if (sms?.formData) {
      setForm(prev => ({ ...prev, ...sms.formData }));
      return;
    }
    // Default-fill from settings + webfront when the user has never submitted before.
    const s = settings || {};
    const w = webCfg   || {};
    setForm(prev => ({
      ...prev,
      businessName:     prev.businessName     || s.brandLegalName || s.salonName || w.salonName || '',
      ein:              prev.ein              || s.ein || '',
      address:          prev.address          || s.brandAddress || w.address || '',
      city:             prev.city             || s.brandCity    || '',
      state:            prev.state            || s.brandState   || 'OH',
      zip:              prev.zip              || s.brandZip     || '',
      contactEmail:     prev.contactEmail     || s.brandEmail   || s.ownerEmail || '',
      contactPhone:     prev.contactPhone     || s.brandPhone   || w.phone || '',
      website:          prev.website          || `https://${(s.subdomain || 'meraki')}.plumenexus.com`,
      privacyPolicyUrl: prev.privacyPolicyUrl || `${window.location.origin}/?privacy=1`,
      optInProofUrl:    prev.optInProofUrl    || `${window.location.origin}/?book=1`,
      useCaseDescription: prev.useCaseDescription || `${s.salonName || w.salonName || 'Our salon'} sends appointment reminders, booking confirmations, and opt-in promotional offers to existing clients. Estimated 50–150 segments/day with marketing blasts ~2× per month at 300–500 recipients.`,
      sampleMessages: prev.sampleMessages?.[0] ? prev.sampleMessages : [
        `Hi {firstName}! Friendly reminder of your appointment at ${s.salonName || 'our salon'} tomorrow at 2:00 PM. Reply STOP to opt out.`,
        `Hi {firstName}, your appointment is confirmed for Saturday at 11:00 AM. Reply STOP to opt out.`,
        `Hi {firstName} — booking is open for next month at ${s.salonName || 'our salon'}: {bookingLink}. Reply STOP to opt out.`,
      ],
    }));
  }, [settings, webCfg, sms]);

  if (!isAdmin) {
    return <div style={{ padding: 24, color: '#888', fontSize: 14 }}>SMS setup is admin-only.</div>;
  }

  const status = sms?.status || 'draft';
  const stat = STATUS_COPY[status] || STATUS_COPY.draft;
  const showWizard = status === 'draft' || status === 'rejected' || status === 'released';

  function patch(k, v) { setForm(p => ({ ...p, [k]: v })); }
  function patchSample(i, v) {
    setForm(p => {
      const next = [...p.sampleMessages]; next[i] = v;
      return { ...p, sampleMessages: next };
    });
  }

  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      const res = await provisionTenantSMS(form, areaCode);
      logActivity('sms_provision_submitted', `Status: ${res.status}, TFN: ${res.tfnNumber || '—'}`);
      showToast('Submitted to Twilio · check status below', 4000);
    } catch (e) {
      const msg = e?.message || String(e);
      setError(msg);
      logError('sms_provision', e, { form: { ...form, sampleMessages: form.sampleMessages.length } });
    } finally {
      setSubmitting(false);
    }
  }

  async function doRelease() {
    if (!confirm('Release this TFN back to Twilio? You can re-provision later, but you\'ll get a different number.')) return;
    setReleaseBusy(true);
    try {
      await releaseTenantSMS();
      logActivity('sms_released', 'TFN released back to Twilio');
      showToast('SMS released. You can re-provision any time.', 4000);
    } catch (e) {
      showToast(`Release failed: ${e?.message || e}`, 6000);
    } finally {
      setReleaseBusy(false);
    }
  }

  return (
    <div style={{ padding: '20px 24px', maxWidth: 760 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a', margin: 0 }}>📱 SMS Setup</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: stat.color }} />
          <span style={{ color: stat.color, fontWeight: 600 }}>{stat.label}</span>
        </div>
      </div>

      {/* Status card — always visible */}
      <div style={{ padding: 14, borderRadius: 10, background: '#f8f9fa', border: '1px solid #e8e8e8', marginBottom: 18, fontSize: 13 }}>
        <div style={{ color: '#555' }}>{stat.desc}</div>
        {sms?.tfnNumber && (
          <div style={{ marginTop: 6, fontSize: 12, color: '#666' }}>
            <strong>Your TFN:</strong> {sms.tfnNumber}
            {sms.approvedAt && <span style={{ marginLeft: 12, color: '#10b981' }}>· Approved {new Date(sms.approvedAt).toLocaleDateString()}</span>}
          </div>
        )}
        {status === 'rejected' && sms?.rejectionReason && (
          <div style={{ marginTop: 8, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>
            <strong>Carrier feedback:</strong> {sms.rejectionReason}
          </div>
        )}
        {status === 'error' && sms?.lastError && (
          <div style={{ marginTop: 8, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>
            {sms.lastError}
          </div>
        )}
        {sms?.tfnNumber && status !== 'released' && (
          <div style={{ marginTop: 10 }}>
            <button onClick={doRelease} disabled={releaseBusy}
              style={{ fontSize: 11, fontWeight: 600, padding: '6px 10px', borderRadius: 6, border: '1px solid #d0d0d0', background: '#fff', color: '#7f1d1d', cursor: releaseBusy ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {releaseBusy ? 'Releasing…' : '✕ Release this TFN'}
            </button>
          </div>
        )}
      </div>

      {!showWizard && (
        <div style={{ padding: 14, color: '#555', fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10 }}>
          SMS is in flight. We'll email you when the status changes. Nothing further is needed from you right now.
        </div>
      )}

      {showWizard && (
        <>
          {/* Step indicator */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {[1, 2, 3].map(n => (
              <div key={n} style={{
                flex: 1, height: 4, borderRadius: 2,
                background: step >= n ? '#5b3b8c' : '#e5e5e5',
                transition: 'background .2s',
              }} />
            ))}
          </div>

          {step === 1 && (
            <Step title="1 of 3 · Business profile">
              <Row label="Legal business name *">
                <input value={form.businessName} onChange={e => patch('businessName', e.target.value)} style={inp} placeholder="Meraki Nail Studio LLC" />
              </Row>
              <Row label="EIN (optional for sole proprietor)">
                <input value={form.ein} onChange={e => patch('ein', e.target.value)} style={inp} placeholder="XX-XXXXXXX" />
              </Row>
              <Row label="Street address *">
                <input value={form.address} onChange={e => patch('address', e.target.value)} style={inp} placeholder="5029 Olentangy River Rd" />
              </Row>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px', gap: 8 }}>
                <input value={form.city}  onChange={e => patch('city', e.target.value)}  style={inp} placeholder="City *" />
                <input value={form.state} onChange={e => patch('state', e.target.value)} style={inp} placeholder="State *" maxLength={2} />
                <input value={form.zip}   onChange={e => patch('zip', e.target.value)}   style={inp} placeholder="ZIP *" />
              </div>
              <Row label="Contact name">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <input value={form.contactFirstName} onChange={e => patch('contactFirstName', e.target.value)} style={inp} placeholder="First name" />
                  <input value={form.contactLastName}  onChange={e => patch('contactLastName', e.target.value)}  style={inp} placeholder="Last name" />
                </div>
              </Row>
              <Row label="Contact email *">
                <input value={form.contactEmail} onChange={e => patch('contactEmail', e.target.value)} style={inp} placeholder="owner@example.com" />
              </Row>
              <Row label="Contact phone *">
                <input value={form.contactPhone} onChange={e => patch('contactPhone', fmtPhone(e.target.value))} style={inp} placeholder="(614) 555-0100" />
              </Row>
              <Row label="Business website">
                <input value={form.website} onChange={e => patch('website', e.target.value)} style={inp} placeholder="https://…" />
              </Row>
              <Row label="Privacy policy URL *">
                <input value={form.privacyPolicyUrl} onChange={e => patch('privacyPolicyUrl', e.target.value)} style={inp} placeholder="https://…/?privacy=1" />
              </Row>
              <NavRow>
                <span />
                <button onClick={() => setStep(2)} style={btnPrimary}>Next: Use case →</button>
              </NavRow>
            </Step>
          )}

          {step === 2 && (
            <Step title="2 of 3 · Use case + sample messages">
              <Row label="Use case category *">
                <select value={form.useCase} onChange={e => patch('useCase', e.target.value)} style={inp}>
                  <option value="MIXED">Mixed — reminders + marketing</option>
                  <option value="CUSTOMER_CARE">Customer Care (transactional reminders)</option>
                  <option value="MARKETING">Marketing only</option>
                </select>
              </Row>
              <Row label="Use case description * (carriers read this)">
                <textarea value={form.useCaseDescription} onChange={e => patch('useCaseDescription', e.target.value)} rows={4} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </Row>
              <Row label="Opt-in description *">
                <textarea value={form.optInDescription} onChange={e => patch('optInDescription', e.target.value)} rows={3} style={{ ...inp, resize: 'vertical', fontFamily: 'inherit' }} />
              </Row>
              <Row label="Opt-in screenshot / URL *">
                <input value={form.optInProofUrl} onChange={e => patch('optInProofUrl', e.target.value)} style={inp} placeholder="https://…/?book=1" />
              </Row>
              <Row label="Sample messages * (3 recommended)">
                {form.sampleMessages.map((m, i) => (
                  <textarea key={i} value={m} onChange={e => patchSample(i, e.target.value)} rows={2}
                    placeholder={`Sample message ${i + 1}…`}
                    style={{ ...inp, marginBottom: 6, resize: 'vertical', fontFamily: 'inherit' }} />
                ))}
              </Row>
              <Row label="Estimated daily volume">
                <input type="number" min={1} max={2000} value={form.estimatedDailyVolume}
                  onChange={e => patch('estimatedDailyVolume', Number(e.target.value) || 0)}
                  style={{ ...inp, width: 120 }} />
                <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>segments/day (TFN cap ~2,000/day)</span>
              </Row>
              <NavRow>
                <button onClick={() => setStep(1)} style={btnSecondary}>← Back</button>
                <button onClick={() => setStep(3)} style={btnPrimary}>Next: Pick number →</button>
              </NavRow>
            </Step>
          )}

          {step === 3 && (
            <Step title="3 of 3 · Pick area code + submit">
              <Row label="Toll-free area code">
                <select value={areaCode} onChange={e => setAreaCode(e.target.value)} style={inp}>
                  {TFN_AREA_CODES.map(a => <option key={a} value={a}>+1 ({a}) xxx-xxxx</option>)}
                </select>
                <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
                  We'll buy the first available number in this area code ($2/mo).
                </div>
              </Row>

              <div style={{ padding: 14, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, marginTop: 14, fontSize: 13, color: '#92400e' }}>
                <strong>What happens when you submit:</strong>
                <ol style={{ margin: '8px 0 0 18px', padding: 0, lineHeight: 1.6 }}>
                  <li>We buy a Toll-Free number — <strong>$2/mo billing starts immediately</strong>.</li>
                  <li>Your business info gets submitted to Twilio Toll-Free Verification on your behalf.</li>
                  <li>Twilio reviews (1–3 days), then carriers review (2–7 business days).</li>
                  <li>We'll email you when the status changes — no need to check Twilio Console.</li>
                </ol>
              </div>

              {error && (
                <div style={{ marginTop: 14, padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12 }}>
                  {error}
                </div>
              )}

              <NavRow>
                <button onClick={() => setStep(2)} style={btnSecondary} disabled={submitting}>← Back</button>
                <button onClick={submit} disabled={submitting} style={{ ...btnPrimary, opacity: submitting ? 0.6 : 1 }}>
                  {submitting ? 'Submitting…' : '✓ Buy number & submit verification'}
                </button>
              </NavRow>
            </Step>
          )}
        </>
      )}
    </div>
  );
}

function Step({ title, children }) {
  return (
    <div style={{ padding: 18, background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#5b3b8c', marginBottom: 14, letterSpacing: '.04em', textTransform: 'uppercase' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
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

function NavRow({ children }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, gap: 8 }}>{children}</div>
  );
}

const inp = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 11px',
  fontSize: 13,
  border: '1px solid #d8d8d8',
  borderRadius: 8,
  fontFamily: 'inherit',
  outline: 'none',
  background: '#fff',
};

const btnPrimary = {
  padding: '9px 16px',
  fontSize: 13,
  fontWeight: 700,
  borderRadius: 8,
  border: 'none',
  background: '#5b3b8c',
  color: '#fff',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnSecondary = {
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 8,
  border: '1px solid #d0d0d0',
  background: '#fff',
  color: '#555',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
