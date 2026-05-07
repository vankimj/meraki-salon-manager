// Auto-rebook prompt rendered inside the receipt screen at checkout.
// Suggests a next-visit date based on per-service `defaultRebookWeeks`,
// shows a small slot picker, and books a single appointment for the same
// tech + same services if the client confirms.

import { useState, useEffect, useMemo } from 'react';
import {
  fetchServices, fetchEmployees, fetchAppointments,
  fetchAppointmentsByRange, createAppointment,
} from '../../lib/firestore';
import {
  cartTotalDuration, isTechFreeAt, getSlots, techCanDo,
} from '../../lib/booking';
import {
  suggestRebookDate, rebookCartFromVisit, hasFutureAppointment, addWeeks,
} from '../../lib/rebook';
import { logActivity } from '../../lib/logger';

function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}
function minsToStr(m) {
  const h = Math.floor(m / 60), min = m % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}
function todayStr() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function RebookPrompt({
  clientId, clientName, clientPhone, clientEmail,
  techName, visitDate, visitServices,
}) {
  const [allServices,  setAllServices]  = useState(null);
  const [allTechs,     setAllTechs]     = useState(null);
  const [futureAppts,  setFutureAppts]  = useState(null);
  const [pickedDate,   setPickedDate]   = useState(null);
  const [pickedSlot,   setPickedSlot]   = useState(null);
  const [dayAppts,     setDayAppts]     = useState(null);
  const [expanded,     setExpanded]     = useState(false);
  const [booking,      setBooking]      = useState(false);
  const [bookedAt,     setBookedAt]     = useState(null);
  const [skipped,      setSkipped]      = useState(false);

  // Load services, techs, and any existing future appts for this client.
  useEffect(() => {
    if (!clientId) return;
    let cancel = false;
    (async () => {
      const [svcs, emps, fut] = await Promise.all([
        fetchServices().catch(() => []),
        fetchEmployees().catch(() => []),
        fetchAppointmentsByRange(visitDate, addWeeks(visitDate, 26)).catch(() => []),
      ]);
      if (cancel) return;
      setAllServices(svcs);
      setAllTechs(emps);
      setFutureAppts(fut);
    })();
    return () => { cancel = true; };
  }, [clientId, visitDate]);

  // Build cart of rebook-eligible services + suggest a date.
  const { cart, tech, suggestedDate, totalDur } = useMemo(() => {
    if (!allServices || !allTechs) return {};
    const byId = {};
    allServices.forEach(s => { byId[s.id] = s; });
    const c = rebookCartFromVisit(visitServices || [], byId);
    const t = allTechs.find(e => e.name === techName) || null;
    const docs = c.map(it => it.service);
    const suggested = suggestRebookDate(visitDate, docs);
    return {
      cart: c,
      tech: t,
      suggestedDate: suggested,
      totalDur: cartTotalDuration(c),
    };
  }, [allServices, allTechs, visitServices, techName, visitDate]);

  // Once we have the suggested date, default the date picker to it.
  useEffect(() => {
    if (suggestedDate && !pickedDate) setPickedDate(suggestedDate);
  }, [suggestedDate, pickedDate]);

  // Fetch the day's appointments when a date is chosen.
  useEffect(() => {
    if (!pickedDate) return;
    let cancel = false;
    setDayAppts(null);
    fetchAppointments(pickedDate).then(rows => {
      if (!cancel) setDayAppts(rows);
    }).catch(() => { if (!cancel) setDayAppts([]); });
    return () => { cancel = true; };
  }, [pickedDate]);

  // Decide whether to render at all.
  const shouldRender = useMemo(() => {
    if (!clientId)                       return false;          // walk-in
    if (allServices === null)            return true;            // still loading — render container so layout doesn't jump
    if (!cart || cart.length === 0)      return false;          // no rebook-eligible services
    if (!suggestedDate)                  return false;          // no rebook interval set
    if (hasFutureAppointment(futureAppts || [], clientId, visitDate)) return false;
    return true;
  }, [clientId, allServices, cart, suggestedDate, futureAppts, visitDate]);

  if (!shouldRender || skipped) return null;

  // Loading state — keep the slot reserved while data fetches.
  if (allServices === null || futureAppts === null) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 12, color: '#888' }}>Checking availability…</div>
      </div>
    );
  }

  // Already booked confirmation
  if (bookedAt) {
    return (
      <div style={{ ...cardStyle, borderColor: '#2D7A5F', background: '#EDFAF3' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#166534' }}>
          ✓ Rebooked
        </div>
        <div style={{ fontSize: 12, color: '#1a6040', marginTop: 4 }}>
          {fmtDate(bookedAt.date)} at {minsToStr(bookedAt.slot)} with {tech?.name || techName}
        </div>
      </div>
    );
  }

  const eligible = (allTechs || []).filter(t => cart.every(c => techCanDo(t, c.service.id)));
  // If the original tech can't do all services anymore (rare), fall back
  // to "any eligible" — we still want to offer the rebook.
  const useAnyTech = !tech || !eligible.includes(tech);

  function isSlotFree(m) {
    if (!dayAppts) return false;
    if (useAnyTech) return eligible.some(t => isTechFreeAt(t, m, totalDur, dayAppts));
    return isTechFreeAt(tech, m, totalDur, dayAppts);
  }

  const slots = getSlots(totalDur);
  const anyAvail = dayAppts && slots.some(isSlotFree);

  async function bookIt() {
    if (!pickedDate || pickedSlot == null) return;
    setBooking(true);
    try {
      // Resolve tech (use original if free, else first eligible+free).
      let assigned = tech;
      if (useAnyTech || !isTechFreeAt(tech, pickedSlot, totalDur, dayAppts)) {
        assigned = eligible.find(t => isTechFreeAt(t, pickedSlot, totalDur, dayAppts)) || null;
      }
      if (!assigned) {
        setBooking(false);
        alert('That slot just filled up — please pick another.');
        return;
      }

      const services = cart.map(c => {
        const resolvedPrice    = c.option?.price    ?? c.service.basePrice;
        const resolvedDuration = c.option?.duration ?? c.service.duration;
        return {
          id:        c.service.id,
          name:      c.option?.name ? `${c.service.name} — ${c.option.name}` : c.service.name,
          price:     Number(resolvedPrice) || 0,
          duration:  Number(resolvedDuration) || 60,
          optionId:  c.option?.id || null,
          optionName: c.option?.name || null,
        };
      });
      const totalDuration = services.reduce((s, sv) => s + sv.duration, 0);
      const h = Math.floor(pickedSlot / 60), m = pickedSlot % 60;

      await createAppointment({
        date:        pickedDate,
        startTime:   `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`,
        duration:    totalDuration,
        techId:      assigned?.id || null,
        techName:    assigned?.name || techName || 'TBD',
        techRequestType: 'specific',
        clientId,
        clientName,
        clientPhone: clientPhone || '',
        clientEmail: clientEmail || null,
        services,
        status:      'scheduled',
        source:      'rebook_prompt',
        createdAt:   new Date().toISOString(),
        updatedAt:   new Date().toISOString(),
      });
      logActivity('rebook_booked', `${clientName} for ${pickedDate} ${minsToStr(pickedSlot)}`);
      setBookedAt({ date: pickedDate, slot: pickedSlot });
    } catch (e) {
      console.error('[Rebook] failed:', e);
      alert('Could not book. Please try again or use the booking page.');
    } finally {
      setBooking(false);
    }
  }

  // ── Collapsed state — single line + Yes/Skip ──
  if (!expanded) {
    return (
      <div style={cardStyle}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>
          Book your next visit?
        </div>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.5, marginBottom: 10 }}>
          Suggested: <strong>{fmtDate(suggestedDate)}</strong> with {tech?.name || techName}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setExpanded(true)}
            style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '8px 12px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>
            Yes — pick a time
          </button>
          <button onClick={() => setSkipped(true)}
            style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid #d8d8d8', background: '#fff', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
            Skip
          </button>
        </div>
      </div>
    );
  }

  // ── Expanded state — date + slot picker ──
  return (
    <div style={{ ...cardStyle, borderColor: '#2D7A5F' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
          Book next visit · {totalDur} min · {tech?.name || techName}
        </div>
        <button onClick={() => setExpanded(false)} style={{ background: 'none', border: 'none', fontSize: 11, color: '#888', cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}>
          ✕ collapse
        </button>
      </div>

      <div style={{ marginBottom: 8 }}>
        <input type="date" value={pickedDate || ''}
          min={addWeeks(visitDate, 1)}
          max={addWeeks(visitDate, 26)}
          onChange={e => { setPickedDate(e.target.value); setPickedSlot(null); }}
          style={{ width: '100%', padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, background: '#fafafa', boxSizing: 'border-box' }} />
      </div>

      {dayAppts == null ? (
        <div style={{ fontSize: 11, color: '#aaa', textAlign: 'center', padding: '12px 0' }}>Loading…</div>
      ) : !anyAvail ? (
        <div style={{ fontSize: 11, color: '#888', textAlign: 'center', padding: '14px 8px', background: '#fafafa', borderRadius: 6 }}>
          No openings on this day — try another date.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(70px, 1fr))', gap: 4, marginBottom: 8 }}>
          {slots.map(m => {
            const free = isSlotFree(m);
            const sel = pickedSlot === m;
            return (
              <button key={m} onClick={() => free && setPickedSlot(m)} disabled={!free}
                style={{
                  padding: '8px 4px', fontSize: 11, fontWeight: 600, borderRadius: 6, fontFamily: 'inherit',
                  border: `1.5px solid ${sel ? '#2D7A5F' : free ? '#c3e6d8' : '#ececec'}`,
                  background: sel ? '#2D7A5F' : free ? '#f0f9f5' : '#fafafa',
                  color: sel ? '#fff' : free ? '#1a6040' : '#ccc',
                  cursor: free ? 'pointer' : 'default',
                }}>
                {minsToStr(m)}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => setSkipped(true)}
          style={{ fontSize: 12, padding: '8px 14px', borderRadius: 8, border: '1px solid #d8d8d8', background: '#fff', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
          Skip
        </button>
        <button onClick={bookIt} disabled={!pickedDate || pickedSlot == null || booking}
          style={{ flex: 1, fontSize: 12, fontWeight: 700, padding: '8px 12px', borderRadius: 8, border: 'none', background: (pickedDate && pickedSlot != null && !booking) ? '#2D7A5F' : '#d0d0d0', color: '#fff', cursor: (pickedDate && pickedSlot != null && !booking) ? 'pointer' : 'default', fontFamily: 'inherit' }}>
          {booking ? 'Booking…' : 'Confirm booking'}
        </button>
      </div>
    </div>
  );
}

const cardStyle = {
  background: '#f0f9f5',
  border: '1.5px solid #c3e6d8',
  borderRadius: 12,
  padding: '12px 14px',
  marginBottom: 14,
};
