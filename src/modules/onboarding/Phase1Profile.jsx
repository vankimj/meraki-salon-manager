import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchWebfrontConfig } from '../../lib/firestore';
import { DEFAULT_LOCATION_ID, saveLocations } from '../../lib/locations';
import AddressAutocomplete from '../../components/AddressAutocomplete';
import { logActivity, logError } from '../../lib/logger';

// Phase 1 — Salon profile.
//
// Collects tenant-wide identity (legal name, EIN, owner contact,
// subdomain) + 1..N locations (name, address, phone, taxRate). Saves
// in two places:
//   - tenant `settings` doc (via updateSettings) — brandLegalName,
//     ein, ownerEmail, brandPhone, subdomain, brandAddress/City/State/Zip
//     (from the primary location, for back-compat with existing modules)
//   - tenant `data/locations` doc (via saveLocations) — the canonical
//     multi-location list. Single-location tenants just have one entry.
//
// Address fields use the AddressAutocomplete component (Google Places
// API New, proxied through the placesAutocomplete + placeDetails Cloud
// Functions). Selecting a prediction fills street / city / state / zip
// in one motion.
//
// Per-field validation surfaces errors after blur. "Save & continue"
// force-shows all errors on click and only advances when valid.

// US state codes for the state dropdown (cleaner than free-text input
// since carriers reject invalid 2-letter codes).
const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE   = /^\d{5}(-\d{4})?$/;
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,28}[a-z0-9])?$/;

// US-style phone formatter (10 digits → "(NNN) NNN-NNNN").
function fmtPhone(input) {
  const digits = String(input || '').replace(/\D/g, '').slice(0, 10);
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

function blankLocation(name = 'Main') {
  return {
    id:        slugify(name) || DEFAULT_LOCATION_ID,
    name,
    address:   '',
    city:      '',
    state:     'OH',
    zip:       '',
    phone:     '',
    taxRate:   7.5,
    isPrimary: true,
    active:    true,
  };
}

function validateLocation(loc) {
  const e = {};
  if (!loc.name?.trim())               e.name    = 'Required';
  if (!loc.address?.trim())            e.address = 'Required';
  if (!loc.city?.trim())               e.city    = 'Required';
  if (!/^[A-Z]{2}$/.test(loc.state))   e.state   = 'Pick a state';
  if (!ZIP_RE.test(loc.zip || ''))     e.zip     = 'Invalid ZIP';
  // phone is optional per-location (the salon's main contact is asked at
  // the tenant level), so we only validate if it's been filled in
  if (loc.phone && loc.phone.replace(/\D/g, '').length !== 10) e.phone = '10-digit phone';
  if (Number.isNaN(Number(loc.taxRate))) e.taxRate = 'Numeric only';
  return e;
}

function validateAll({ legalName, ownerEmail, ownerPhone, subdomain, locations }) {
  const errors = { tenant: {}, locations: locations.map(validateLocation) };
  if (!legalName?.trim())              errors.tenant.legalName  = 'Required';
  if (!EMAIL_RE.test(ownerEmail || '')) errors.tenant.ownerEmail = 'Valid email required';
  // ownerPhone is optional but if entered must be 10 digits
  if (ownerPhone && ownerPhone.replace(/\D/g, '').length !== 10) errors.tenant.ownerPhone = '10-digit phone';
  if (subdomain && !SUBDOMAIN_RE.test(subdomain)) errors.tenant.subdomain = 'lowercase letters/numbers/hyphens, 2–30 chars';
  return errors;
}

function hasAnyError(errs) {
  if (Object.keys(errs.tenant).length) return true;
  return errs.locations.some(l => Object.keys(l).length);
}

export default function Phase1Profile({ onboarding, onAdvance, saving }) {
  const { settings, updateSettings, showToast } = useApp();
  const [webCfg, setWebCfg] = useState(null);

  // markOnboardingPhase spreads payload.phaseData flat into the phase
  // entry (alongside `status` + `updatedAt`), so saved values live at
  // phases.profile.{field}, not phases.profile.phaseData.{field}.
  const stored = onboarding?.phases?.profile || {};

  const [legalName,   setLegalName]   = useState(stored.legalName   || settings?.brandLegalName || settings?.salonName || '');
  const [ein,         setEin]         = useState(stored.ein         || settings?.ein || '');
  const [ownerEmail,  setOwnerEmail]  = useState(stored.ownerEmail  || settings?.ownerEmail || '');
  const [ownerPhone,  setOwnerPhone]  = useState(fmtPhone(stored.ownerPhone || settings?.brandPhone || ''));
  const [subdomain,   setSubdomain]   = useState(stored.subdomain   || settings?.subdomain || '');
  const [multi,       setMulti]       = useState(Boolean(stored.multi));
  const [locations,   setLocations]   = useState(
    Array.isArray(stored.locations) && stored.locations.length
      ? stored.locations
      : [blankLocation(settings?.salonName || 'Main')]
  );

  // Per-field "touched" tracking — errors only show after blur.
  const [touched, setTouched] = useState({ tenant: {}, locations: [{}] });
  const [submitErr, setSubmitErr] = useState('');

  // Pre-fill first location from webfront on mount (address, phone).
  useEffect(() => {
    if (stored.locations?.length) return; // user-edited; don't clobber
    fetchWebfrontConfig().then(wf => {
      setWebCfg(wf || {});
      if (!wf) return;
      setLocations(prev => prev.map((loc, i) => i === 0 ? {
        ...loc,
        address: loc.address || wf.address    || settings?.brandAddress || '',
        city:    loc.city    || wf.city       || settings?.brandCity    || '',
        state:   loc.state   || wf.state      || settings?.brandState   || 'OH',
        zip:     loc.zip     || wf.zip        || settings?.brandZip     || '',
        phone:   loc.phone   ? loc.phone : fmtPhone(wf.phone || settings?.brandPhone || ''),
      } : loc));
    }).catch(() => setWebCfg({}));
  }, []);

  function patchLocation(idx, patch) {
    setLocations(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function touchTenant(field) {
    setTouched(t => ({ ...t, tenant: { ...t.tenant, [field]: true } }));
  }
  function touchLocation(idx, field) {
    setTouched(t => {
      const next = [...(t.locations || [])];
      next[idx] = { ...(next[idx] || {}), [field]: true };
      return { ...t, locations: next };
    });
  }

  function applyPlace(idx, place) {
    patchLocation(idx, {
      address: place.street || '',
      city:    place.city   || '',
      state:   place.state  || '',
      zip:     place.zip    || '',
    });
  }

  function addLocation() {
    setLocations(prev => [...prev, { ...blankLocation(`Location ${prev.length + 1}`), isPrimary: false }]);
    setTouched(t => ({ ...t, locations: [...(t.locations || []), {}] }));
  }

  function removeLocation(idx) {
    setLocations(prev => prev.filter((_, i) => i !== idx));
    setTouched(t => ({ ...t, locations: (t.locations || []).filter((_, i) => i !== idx) }));
  }

  function suggestSubdomain() {
    const base = slugify(legalName);
    if (base) setSubdomain(base);
  }

  const errors = validateAll({ legalName, ownerEmail, ownerPhone, subdomain, locations });
  const valid  = !hasAnyError(errors);

  function tenantErr(field) { return touched.tenant?.[field] ? errors.tenant[field] : null; }
  function locErr(idx, field) { return touched.locations?.[idx]?.[field] ? errors.locations[idx]?.[field] : null; }

  async function save({ skip } = {}) {
    if (skip) { onAdvance({ skip: true }); return; }
    // Force-show all errors so the user sees what's blocking advance.
    setTouched(() => ({
      tenant: { legalName: true, ownerEmail: true, ownerPhone: true, subdomain: true },
      locations: locations.map(() => ({ name: true, address: true, city: true, state: true, zip: true, phone: true })),
    }));
    if (!valid) {
      setSubmitErr('Fix the highlighted fields before continuing.');
      return;
    }
    setSubmitErr('');
    const cleaned = locations.map((l, i) => ({
      ...l,
      id:        l.id || slugify(l.name) || `loc-${i + 1}`,
      taxRate:   Number(l.taxRate) || 0,
      isPrimary: i === 0,
      active:    l.active !== false,
    }));
    const finalLocations = multi ? cleaned : [cleaned[0]];
    const primary = finalLocations[0];

    try {
      // Tenant-wide identity → settings. Mirrors what Admin → Branding
      // writes today, so other modules pick up the changes immediately.
      await updateSettings({
        ...settings,
        brandLegalName: legalName.trim(),
        ein:            ein.trim() || null,
        ownerEmail:     ownerEmail.trim(),
        brandPhone:     ownerPhone.trim(),
        subdomain:      subdomain.trim().toLowerCase() || null,
        // Primary location → settings.brandAddress/City/State/Zip for
        // back-compat with modules that haven't been migrated to
        // data/locations yet (legal pages, webfront, etc.).
        brandAddress:   primary?.address || null,
        brandCity:      primary?.city    || null,
        brandState:     primary?.state   || null,
        brandZip:       primary?.zip     || null,
      });

      // Canonical multi-location list.
      await saveLocations({
        list:              finalLocations,
        defaultLocationId: primary?.id || DEFAULT_LOCATION_ID,
      });

      logActivity('onboarding_profile_saved', `${legalName} · ${finalLocations.length} location(s)`);
      showToast('Profile saved', 2500);

      onAdvance({
        phaseData: {
          legalName:  legalName.trim(),
          ein:        ein.trim(),
          ownerEmail: ownerEmail.trim(),
          ownerPhone: ownerPhone.trim(),
          subdomain:  subdomain.trim().toLowerCase(),
          multi,
          locations:  finalLocations,
        },
      });
    } catch (e) {
      setSubmitErr(e?.message || String(e));
      logError('onboarding_profile_save', e);
    }
  }

  return (
    <div>
      <Section title="Legal business identity">
        <Row label="Legal business name *" err={tenantErr('legalName')}>
          <input value={legalName} onChange={e => setLegalName(e.target.value)} onBlur={() => touchTenant('legalName')}
            placeholder="Meraki Nail Studio LLC" style={inpStyle(tenantErr('legalName'))} />
        </Row>
        <Row label="EIN (optional if sole proprietor)">
          <input value={ein} onChange={e => setEin(e.target.value)}
            placeholder="XX-XXXXXXX" style={inp} />
        </Row>
        <Row label="Owner email *" err={tenantErr('ownerEmail')}>
          <input value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} onBlur={() => touchTenant('ownerEmail')}
            placeholder="owner@example.com" style={inpStyle(tenantErr('ownerEmail'))} type="email" />
        </Row>
        <Row label="Owner phone" err={tenantErr('ownerPhone')}>
          <input value={ownerPhone} onChange={e => setOwnerPhone(fmtPhone(e.target.value))} onBlur={() => touchTenant('ownerPhone')}
            placeholder="(614) 555-0100" style={inpStyle(tenantErr('ownerPhone'))} type="tel" inputMode="tel" />
        </Row>
        <Row label="Public booking URL" err={tenantErr('subdomain')} hint="Lowercase letters / numbers / hyphens. Used at {subdomain}.plumenexus.com when multi-tenant routing launches.">
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <input value={subdomain} onChange={e => setSubdomain(e.target.value.toLowerCase())} onBlur={() => touchTenant('subdomain')}
              placeholder="merakinails" style={{ ...inpStyle(tenantErr('subdomain')), flex: 1 }} />
            <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--pn-text-muted)' }}>.plumenexus.com</span>
            <button type="button" onClick={suggestSubdomain}
              style={btnGhost}>Suggest</button>
          </div>
        </Row>
      </Section>

      <Section title="Location(s)">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <RadioCard selected={!multi}  onClick={() => setMulti(false)} title="Single location"   desc="Most salons — one storefront" />
          <RadioCard selected={multi}   onClick={() => setMulti(true)}  title="Multiple locations" desc="Chain or multi-storefront — add each one" />
        </div>

        {locations.map((loc, i) => (
          <div key={i} style={{ padding: 14, border: '1px solid var(--pn-border)', borderRadius: 10, marginBottom: 10, background: 'var(--pn-bg)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.08em', textTransform: 'uppercase' }}>
                {multi ? `Location ${i + 1}` : 'Your salon'}
              </div>
              {multi && i > 0 && (
                <button type="button" onClick={() => removeLocation(i)}
                  style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
            <Row label={multi ? 'Location name *' : 'Salon name *'} err={locErr(i, 'name')}>
              <input value={loc.name} onChange={e => patchLocation(i, { name: e.target.value })} onBlur={() => touchLocation(i, 'name')}
                placeholder={multi ? 'e.g. Columbus' : 'e.g. Meraki Nail Studio'} style={inpStyle(locErr(i, 'name'))} />
            </Row>
            <Row label="Street address *" err={locErr(i, 'address')} hint="Type to search — Google fills city / state / ZIP.">
              <AddressAutocomplete
                value={loc.address}
                onChange={v => patchLocation(i, { address: v })}
                onPlaceSelected={place => applyPlace(i, place)}
                onBlur={() => touchLocation(i, 'address')}
                style={inpStyle(locErr(i, 'address'))}
                placeholder="5029 Olentangy River Rd"
              />
            </Row>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px', gap: 8 }}>
              <div>
                <input value={loc.city}  onChange={e => patchLocation(i, { city:  e.target.value })} onBlur={() => touchLocation(i, 'city')}  placeholder="City *"  style={inpStyle(locErr(i, 'city'))} />
                {locErr(i, 'city')  && <Err msg={locErr(i, 'city')} />}
              </div>
              <div>
                <select value={loc.state} onChange={e => patchLocation(i, { state: e.target.value })} onBlur={() => touchLocation(i, 'state')} style={{ ...inpStyle(locErr(i, 'state')), padding: '7px 6px' }}>
                  {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {locErr(i, 'state') && <Err msg={locErr(i, 'state')} />}
              </div>
              <div>
                <input value={loc.zip}   onChange={e => patchLocation(i, { zip:   e.target.value })} onBlur={() => touchLocation(i, 'zip')}   placeholder="ZIP *"   style={inpStyle(locErr(i, 'zip'))} />
                {locErr(i, 'zip')   && <Err msg={locErr(i, 'zip')} />}
              </div>
            </div>
            <Row label="Location phone" err={locErr(i, 'phone')}>
              <input value={loc.phone} onChange={e => patchLocation(i, { phone: fmtPhone(e.target.value) })} onBlur={() => touchLocation(i, 'phone')}
                placeholder="(614) 555-0100" style={inpStyle(locErr(i, 'phone'))} type="tel" inputMode="tel" />
            </Row>
            <Row label="Sales tax rate (%)" hint="Each location can have its own rate (e.g. different city tax).">
              <input type="number" step="0.01" min="0" max="20" value={loc.taxRate}
                onChange={e => patchLocation(i, { taxRate: Number(e.target.value) || 0 })}
                style={{ ...inp, width: 100 }} />
            </Row>
          </div>
        ))}

        {multi && (
          <button type="button" onClick={addLocation}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: 'var(--pn-surface)', border: '1px dashed #5b3b8c', borderRadius: 8, color: '#5b3b8c', cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add another location
          </button>
        )}
      </Section>

      {submitErr && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12, marginBottom: 12 }}>{submitErr}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => save({ skip: true })} disabled={saving} style={btnSecondary}>
          Skip for now
        </button>
        <button onClick={() => save()} disabled={saving} style={{ ...btnPrimary, opacity: valid ? 1 : 0.5 }}>
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

function Row({ label, children, err, hint }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: err ? '#b91c1c' : 'var(--pn-text-muted)', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
      {err  && <Err msg={err} />}
      {!err && hint && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

function Err({ msg }) {
  return <div style={{ fontSize: 11, color: '#b91c1c', marginTop: 4 }}>{msg}</div>;
}

function RadioCard({ selected, onClick, title, desc }) {
  return (
    <button onClick={onClick} type="button"
      style={{
        flex: 1, textAlign: 'left', padding: '12px 14px',
        border: `1.5px solid ${selected ? '#5b3b8c' : 'var(--pn-border)'}`,
        borderRadius: 10, background: selected ? '#f5efff' : 'var(--pn-surface)', cursor: 'pointer',
        fontFamily: 'inherit', transition: 'border-color .15s, background .15s',
      }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}

function inpStyle(err) {
  return {
    width: '100%', boxSizing: 'border-box',
    padding: '8px 10px',
    fontSize: 13,
    border: `1px solid ${err ? '#fca5a5' : 'var(--pn-border-strong)'}`,
    borderRadius: 8,
    fontFamily: 'inherit',
    outline: 'none',
    background: err ? '#fef2f2' : 'var(--pn-surface)',
  };
}

const inp = inpStyle(null);
const btnPrimary   = { padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
const btnGhost     = { padding: '0 10px', fontSize: 11, fontWeight: 600, background: 'var(--pn-surface)', border: '1px solid var(--pn-border-strong)', borderRadius: 8, color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
