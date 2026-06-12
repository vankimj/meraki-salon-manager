// Pure logic for the front-desk kiosk: which idle view to render, and how to
// turn a kioskWalkinOptions() availability payload into a render descriptor.
// No react-native imports → unit-testable in plain node (see kioskWalkin.test.js).
// Ported from the web QueueKiosk (src/components/QueueKiosk.jsx) so the native
// kiosk and the web /?queue stay behaviourally identical.

export const KIOSK_MODES = { WALKIN: 'walkin', TIPFLOW: 'tipflow', CHECKOUT: 'checkout' };

// A live checkout session ALWAYS takes over the kiosk, whatever the idle mode.
export function isCheckoutActive(session) {
  return !!(session && (session.status === 'pending' || session.status === 'paying' || session.status === 'confirmed'));
}

// What the kiosk should render right now:
//   'checkout' → KioskCheckout (a session is live)
//   'walkin'   → the native walk-in sign-in
//   'tipflow'  → the TipFlow idle (also used for the 'checkout' default, which
//                idles on TipFlow then takes over when a session arrives)
// Default mode is 'walkin' so a fresh kiosk greets walk-ins (the owner can
// switch it to tipflow/checkout in Admin → Kiosk).
export function resolveKioskView(settings, session) {
  if (isCheckoutActive(session)) return 'checkout';
  const mode = settings?.kioskDefaultMode || KIOSK_MODES.WALKIN;
  return mode === KIOSK_MODES.WALKIN ? 'walkin' : 'tipflow';
}

export function digitsOnly(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);   // strip US country code on paste
  return d.slice(0, 10);
}

// "(614) 515-1231" as the user types.
export function fmtPhoneInput(digits) {
  const d = digitsOnly(digits);
  if (d.length < 4) return d;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

// Stored on the waitlist entry / passed to the CF (matches web fmtPhoneStored).
export function fmtPhoneStored(digits) {
  const d = digitsOnly(digits);
  return d.length === 10 ? `+1 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d;
}

export function waitLabel(min) {
  if (min == null) return '';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

// Turn the availability payload + the customer's tech choice into a render
// descriptor. Mirrors QueueKiosk.renderAvailability exactly. `techSel` is 'Any'
// for no-preference, else a tech name. Each descriptor names the joinQueue args
// for its primary / suggested / keep actions so the native view stays a thin
// renderer.
export function availabilityView(avail, techSel) {
  if (!avail) return { kind: 'loading' };
  if (avail.salonClosed) return { kind: 'closed' };

  // No preference → soonest clocked-in tech who can do the service.
  if (techSel === 'Any') {
    const e = avail.noPrefEarliest;
    if (!e) return { kind: 'noTech', requestedTechName: '' };
    return {
      kind: 'noPref',
      primary: { techName: e.techName, waitMinutes: e.waitMinutes, note: 'next available' },
      join:    { techName: 'Any', requestedTechName: '', waitMin: e.waitMinutes },
    };
  }

  const r = (avail.options || []).find(o => o.techName === techSel);
  if (!r) {
    // Requested tech not available today at all → offer the first option.
    const alt = (avail.options || [])[0] || null;
    return {
      kind: 'techUnavailable',
      techSel,
      alt: alt ? { techName: alt.techName, waitMinutes: alt.waitMinutes } : null,
      joinAlt:  alt ? { techName: alt.techName, requestedTechName: alt.techName, waitMin: alt.waitMinutes } : null,
      joinWait: { techName: techSel, requestedTechName: techSel, waitMin: null },
    };
  }

  if (r.waitMinutes <= 60) {
    return {
      kind: 'soon',
      primary: { techName: techSel, waitMinutes: r.waitMinutes, note: 'your requested tech' },
      join:    { techName: techSel, requestedTechName: techSel, waitMin: r.waitMinutes },
    };
  }

  // Requested tech > 1 hr → suggest an immediately-available alternative.
  const immediate = (avail.options || []).find(o => o.techName !== techSel && o.waitMinutes <= 10);
  const sooner    = (avail.options || []).find(o => o.techName !== techSel);
  const suggest   = immediate || sooner;
  return {
    kind: 'wait',
    techSel,
    primaryWaitMinutes: r.waitMinutes,
    suggest: suggest ? { techName: suggest.techName, waitMinutes: suggest.waitMinutes, immediate: !!immediate } : null,
    joinSuggest: suggest ? { techName: suggest.techName, requestedTechName: suggest.techName, waitMin: suggest.waitMinutes } : null,
    joinKeep:    { techName: techSel, requestedTechName: techSel, waitMin: r.waitMinutes },
  };
}
