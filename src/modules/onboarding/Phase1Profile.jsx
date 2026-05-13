import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchWebfrontConfig } from '../../lib/firestore';
import { DEFAULT_LOCATION_ID } from '../../lib/locations';

// Phase 1 — Salon profile. Confirms legal entity (tenant-wide) + at
// least one location. Multi-location collection happens here when the
// owner toggles "Multiple locations" (adds a repeat-form for each).
//
// Tenant-wide fields (asked once):
//   legalName, ein, ownerEmail, ownerPhone, subdomain
//
// Per-location fields (asked once for single, N times for multi):
//   id (slug from name), name, address, city, state, zip, phone,
//   taxRate, isPrimary, active
//
// Sprint 1 collects this and saves to onboarding.phaseData.profile;
// a sibling Cloud Function then writes settings + data/locations
// atomically. For Sprint 1, the wizard just stores the form in
// the onboarding doc as `phaseData.profile` and we let the existing
// Admin → Branding Save button serve as the canonical write path.
// Sprint 2 will dual-write directly.

function blankLocation(name = 'Main') {
  return {
    id:       (name || 'main').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || DEFAULT_LOCATION_ID,
    name,
    address:  '',
    city:     '',
    state:    'OH',
    zip:      '',
    phone:    '',
    taxRate:  7.5,
    isPrimary:true,
    active:   true,
  };
}

export default function Phase1Profile({ onboarding, onAdvance, saving }) {
  const { settings } = useApp();
  const [webCfg, setWebCfg] = useState(null);

  const stored = onboarding?.phases?.profile?.phaseData || {};

  const [legalName,   setLegalName]   = useState(stored.legalName   || settings?.brandLegalName || settings?.salonName || '');
  const [ein,         setEin]         = useState(stored.ein         || settings?.ein || '');
  const [ownerEmail,  setOwnerEmail]  = useState(stored.ownerEmail  || settings?.ownerEmail || '');
  const [ownerPhone,  setOwnerPhone]  = useState(stored.ownerPhone  || settings?.brandPhone || '');
  const [subdomain,   setSubdomain]   = useState(stored.subdomain   || settings?.subdomain || '');
  const [multi,       setMulti]       = useState(Boolean(stored.multi));
  const [locations,   setLocations]   = useState(
    Array.isArray(stored.locations) && stored.locations.length
      ? stored.locations
      : [blankLocation(settings?.salonName || 'Main')]
  );

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
        phone:   loc.phone   || wf.phone      || settings?.brandPhone   || '',
      } : loc));
    }).catch(() => setWebCfg({}));
  }, []); // eslint-disable-line

  function patchLocation(idx, patch) {
    setLocations(prev => prev.map((l, i) => i === idx ? { ...l, ...patch } : l));
  }

  function addLocation() {
    setLocations(prev => [...prev, { ...blankLocation(`Location ${prev.length + 1}`), isPrimary: false }]);
  }

  function removeLocation(idx) {
    setLocations(prev => prev.filter((_, i) => i !== idx));
  }

  function suggestSubdomain() {
    const base = (legalName || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (base) setSubdomain(base);
  }

  function save({ skip } = {}) {
    if (skip) { onAdvance({ skip: true }); return; }
    const cleaned = locations.map((l, i) => ({
      ...l,
      id:        l.id || `loc-${i + 1}`,
      isPrimary: i === 0,
      active:    l.active !== false,
    }));
    onAdvance({
      phaseData: {
        legalName: legalName.trim(),
        ein:       ein.trim(),
        ownerEmail:ownerEmail.trim(),
        ownerPhone:ownerPhone.trim(),
        subdomain: subdomain.trim().toLowerCase(),
        multi,
        locations: multi ? cleaned : [cleaned[0]],
      },
    });
  }

  return (
    <div>
      <Section title="Legal business identity">
        <Row label="Legal business name *">
          <input value={legalName} onChange={e => setLegalName(e.target.value)} placeholder="Meraki Nail Studio LLC" style={inp} />
        </Row>
        <Row label="EIN (optional if sole proprietor)">
          <input value={ein} onChange={e => setEin(e.target.value)} placeholder="XX-XXXXXXX" style={inp} />
        </Row>
        <Row label="Owner email *">
          <input value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="owner@example.com" style={inp} />
        </Row>
        <Row label="Owner phone">
          <input value={ownerPhone} onChange={e => setOwnerPhone(e.target.value)} placeholder="(614) 555-0100" style={inp} />
        </Row>
        <Row label="Public booking URL">
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <input value={subdomain} onChange={e => setSubdomain(e.target.value.toLowerCase())} placeholder="merakinails" style={{ ...inp, flex: 1 }} />
            <span style={{ alignSelf: 'center', fontSize: 12, color: '#666' }}>.plumenexus.com</span>
            <button type="button" onClick={suggestSubdomain}
              style={{ padding: '0 10px', fontSize: 11, fontWeight: 600, background: '#fff', border: '1px solid #d0d0d0', borderRadius: 8, color: '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
              Suggest
            </button>
          </div>
        </Row>
      </Section>

      <Section title="Location(s)">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          <RadioCard selected={!multi}  onClick={() => setMulti(false)} title="Single location" desc="Most salons — one storefront" />
          <RadioCard selected={multi}   onClick={() => setMulti(true)}  title="Multiple locations" desc="Chain or multi-storefront — add each one" />
        </div>

        {locations.map((loc, i) => (
          <div key={i} style={{ padding: 14, border: '1px solid #e8e8e8', borderRadius: 10, marginBottom: 10, background: '#fafafa' }}>
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
            <Row label={multi ? 'Location name' : 'Salon name'}>
              <input value={loc.name} onChange={e => patchLocation(i, { name: e.target.value })} placeholder={multi ? 'e.g. Columbus' : 'e.g. Meraki Nail Studio'} style={inp} />
            </Row>
            <Row label="Street address">
              <input value={loc.address} onChange={e => patchLocation(i, { address: e.target.value })} style={inp} />
            </Row>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 80px 100px', gap: 8 }}>
              <input value={loc.city}  onChange={e => patchLocation(i, { city:  e.target.value })} placeholder="City"  style={inp} />
              <input value={loc.state} onChange={e => patchLocation(i, { state: e.target.value })} placeholder="State" maxLength={2} style={inp} />
              <input value={loc.zip}   onChange={e => patchLocation(i, { zip:   e.target.value })} placeholder="ZIP"   style={inp} />
            </div>
            <Row label="Location phone">
              <input value={loc.phone} onChange={e => patchLocation(i, { phone: e.target.value })} placeholder="(614) 555-0100" style={inp} />
            </Row>
            <Row label="Sales tax rate (%)">
              <input type="number" step="0.01" min="0" max="20" value={loc.taxRate}
                onChange={e => patchLocation(i, { taxRate: Number(e.target.value) || 0 })}
                style={{ ...inp, width: 100 }} />
              <span style={{ marginLeft: 8, fontSize: 11, color: '#888' }}>
                Each location can have its own rate (e.g. different city tax)
              </span>
            </Row>
          </div>
        ))}

        {multi && (
          <button type="button" onClick={addLocation}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, background: '#fff', border: '1px dashed #5b3b8c', borderRadius: 8, color: '#5b3b8c', cursor: 'pointer', fontFamily: 'inherit' }}>
            + Add another location
          </button>
        )}
      </Section>

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => save({ skip: true })} disabled={saving}
          style={btnSecondary}>
          Skip for now
        </button>
        <button onClick={() => save()} disabled={saving}
          style={btnPrimary}>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

function RadioCard({ selected, onClick, title, desc }) {
  return (
    <button onClick={onClick} type="button"
      style={{
        flex: 1, textAlign: 'left', padding: '12px 14px',
        border: `1.5px solid ${selected ? '#5b3b8c' : '#e5e5e5'}`,
        borderRadius: 10, background: selected ? '#f5efff' : '#fff', cursor: 'pointer',
        fontFamily: 'inherit', transition: 'border-color .15s, background .15s',
      }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: 11, color: '#666', lineHeight: 1.4 }}>{desc}</div>
    </button>
  );
}

const inp = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', fontSize: 13, border: '1px solid #d8d8d8', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: '#fff' };
const btnPrimary   = { padding: '9px 18px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: '#555', cursor: 'pointer', fontFamily: 'inherit' };
