import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

function fmtDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function fmtDateShort(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

export default function ManageAppointmentScreen() {
  const params = new URLSearchParams(window.location.search);
  const apptId = params.get('manage');
  const tid    = params.get('tid');
  const token  = params.get('t');
  const exp    = params.get('exp');

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [view, setView]       = useState('summary'); // summary | reschedule | cancel | done
  const [doneState, setDoneState] = useState(null);  // { type, ... }

  useEffect(() => {
    if (!apptId || !tid || !token || !exp) {
      setError('Invalid link.');
      setLoading(false);
      return;
    }
    const fn = httpsCallable(functions, 'manageAppointment');
    fn({ tid, apptId, token, exp, action: 'get' })
      .then(res => setData(res?.data || null))
      .catch(e => setError(e?.message || 'Could not load appointment'))
      .finally(() => setLoading(false));
  }, [apptId, tid, token, exp]);

  if (loading) return <Frame><Loading /></Frame>;
  if (error)   return <Frame><ErrorBlock msg={error} /></Frame>;
  if (!data)   return <Frame><ErrorBlock msg="No appointment found." /></Frame>;

  const { appt, policy, salon } = data;

  if (view === 'done') {
    return <Frame><DoneView state={doneState} salon={salon} /></Frame>;
  }
  if (view === 'cancel') {
    return (
      <Frame>
        <CancelView
          appt={appt}
          salon={salon}
          policy={policy}
          onConfirm={async () => {
            try {
              await httpsCallable(functions, 'manageAppointment')({ tid, apptId, token, exp, action: 'cancel' });
              setDoneState({ type: 'cancelled', appt });
              setView('done');
            } catch (e) {
              setError(e?.message || 'Could not cancel');
              setView('summary');
            }
          }}
          onBack={() => setView('summary')}
        />
      </Frame>
    );
  }
  if (view === 'reschedule') {
    return (
      <Frame>
        <RescheduleView
          appt={appt}
          salon={salon}
          policy={policy}
          tid={tid}
          apptId={apptId}
          token={token}
          exp={exp}
          onConfirmed={(newDate, newStartTime) => {
            setDoneState({ type: 'rescheduled', appt: { ...appt, date: newDate, startTime: newStartTime } });
            setView('done');
          }}
          onBack={() => setView('summary')}
        />
      </Frame>
    );
  }

  return (
    <Frame>
      <SummaryView appt={appt} policy={policy} salon={salon} onReschedule={() => setView('reschedule')} onCancel={() => setView('cancel')} />
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div style={{
      minHeight: '100dvh',
      background: 'linear-gradient(135deg,#f3eafc 0%, #eaf3fc 100%)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '32px 16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 480,
        background: '#fff',
        borderRadius: 16,
        boxShadow: '0 12px 40px rgba(106,79,160,.12)',
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  );
}

function SummaryView({ appt, policy, salon, onReschedule, onCancel }) {
  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Service';
  return (
    <>
      <div style={{ background: 'linear-gradient(135deg,#6a4fa0 0%, #7a4ad9 100%)', padding: '28px 24px', color: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .8, marginBottom: 8 }}>
          Your appointment
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{salon.name}</div>
        <div style={{ fontSize: 14, opacity: .85 }}>Hi {appt.clientName} 👋</div>
      </div>

      <div style={{ padding: '24px' }}>
        {appt.status === 'cancelled' ? (
          <Banner color="#fef2f2" border="#fca5a5" textColor="#991b1b">
            This appointment was cancelled. Call {salon.phone || 'the salon'} to rebook.
          </Banner>
        ) : appt.status === 'done' ? (
          <Banner color="#f3f4f6" border="#d1d5db" textColor="#4b5563">
            This appointment has been completed.
          </Banner>
        ) : null}

        <div style={{ marginBottom: 18 }}>
          <DetailRow icon="📅" label="Date" value={fmtDate(appt.date)} />
          <DetailRow icon="🕐" label="Time" value={`${fmtTime(appt.startTime)} (${appt.duration || 60} min)`} />
          <DetailRow icon="💅" label="With" value={appt.techName} />
          <DetailRow icon="✂️" label="Service" value={services} />
        </div>

        {policy.canModify ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button onClick={onReschedule}
              style={{ ...primaryBtn, background: '#6a4fa0' }}>
              📅 Reschedule
            </button>
            <button onClick={onCancel}
              style={{ ...secondaryBtn, color: '#ef4444', borderColor: '#fca5a5' }}>
              ✕ Cancel appointment
            </button>
          </div>
        ) : appt.status !== 'cancelled' && appt.status !== 'done' && (
          <Banner color="#fffbeb" border="#fcd34d" textColor="#92400e">
            Changes must be made at least {policy.cancellationLeadHours} hour{policy.cancellationLeadHours === 1 ? '' : 's'} in advance.
            {salon.phone && <> For last-minute changes, call <a href={`tel:${salon.phone}`} style={{ color: '#92400e', fontWeight: 700 }}>{salon.phone}</a>.</>}
          </Banner>
        )}

        <div style={{ marginTop: 22, padding: '14px 0 0', borderTop: '1px solid #f0f0f0', textAlign: 'center', fontSize: 12, color: '#888' }}>
          Need help? Call {salon.phone || 'the salon'}
        </div>
      </div>
    </>
  );
}

function CancelView({ appt, salon, policy, onConfirm, onBack }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <div style={{ background: 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)', padding: '24px', color: '#fff' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .8, marginBottom: 6 }}>
          Cancel appointment
        </div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Are you sure?</div>
      </div>
      <div style={{ padding: '24px' }}>
        <div style={{ marginBottom: 18 }}>
          <DetailRow icon="📅" label="Date" value={fmtDate(appt.date)} />
          <DetailRow icon="🕐" label="Time" value={`${fmtTime(appt.startTime)} (${appt.duration || 60} min)`} />
          <DetailRow icon="💅" label="With" value={appt.techName} />
        </div>
        <Banner color="#fffbeb" border="#fcd34d" textColor="#92400e">
          Cancellations confirmed at least {policy.cancellationLeadHours} hour{policy.cancellationLeadHours === 1 ? '' : 's'} in advance won't incur a fee.
        </Banner>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
          <button onClick={async () => { setConfirming(true); await onConfirm(); }} disabled={confirming}
            style={{ ...primaryBtn, background: confirming ? '#cbb6e0' : '#ef4444' }}>
            {confirming ? 'Cancelling…' : 'Yes, cancel my appointment'}
          </button>
          <button onClick={onBack} disabled={confirming}
            style={{ ...secondaryBtn }}>
            ← Keep appointment
          </button>
        </div>
      </div>
    </>
  );
}

function RescheduleView({ appt, salon, policy, tid, apptId, token, exp, onConfirmed, onBack }) {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [availability, setAvail] = useState([]); // [{ date, dow, slots:[{startTime}] }]
  const [pick, setPick]         = useState(null); // { date, startTime }
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    httpsCallable(functions, 'manageAppointment')({ tid, apptId, token, exp, action: 'availableSlots' })
      .then(res => setAvail(res?.data?.availability || []))
      .catch(e => setError(e?.message || 'Could not load times'))
      .finally(() => setLoading(false));
  }, [tid, apptId, token, exp]);

  async function confirm() {
    if (!pick) return;
    setSubmitting(true);
    setError('');
    try {
      await httpsCallable(functions, 'manageAppointment')({ tid, apptId, token, exp, action: 'reschedule', payload: { date: pick.date, startTime: pick.startTime } });
      onConfirmed(pick.date, pick.startTime);
    } catch (e) {
      setError(e?.message || 'Could not reschedule');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ background: 'linear-gradient(135deg, #6a4fa0 0%, #7a4ad9 100%)', padding: '24px', color: '#fff' }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .8, marginBottom: 6 }}>
          Reschedule
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, opacity: .9 }}>
          Currently: {fmtDate(appt.date)} at {fmtTime(appt.startTime)}
        </div>
      </div>

      <div style={{ padding: '20px 24px' }}>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 14 }}>
          Pick a new time with <strong>{appt.techName}</strong>:
        </div>

        {loading && <Loading />}
        {!loading && error && <Banner color="#fee2e2" border="#fca5a5" textColor="#991b1b">{error}</Banner>}
        {!loading && !error && availability.length === 0 && (
          <Banner color="#fffbeb" border="#fcd34d" textColor="#92400e">
            No openings in the next 30 days. Call {salon.phone || 'the salon'} to find a time.
          </Banner>
        )}

        {!loading && availability.length > 0 && (
          <div style={{ maxHeight: '50vh', overflowY: 'auto', paddingRight: 4, marginBottom: 14 }}>
            {availability.map(d => (
              <div key={d.date} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#6a4fa0', marginBottom: 6 }}>
                  {fmtDateShort(d.date)}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: 6 }}>
                  {d.slots.map(s => {
                    const isPick = pick?.date === d.date && pick?.startTime === s.startTime;
                    return (
                      <button key={s.startTime}
                        onClick={() => setPick({ date: d.date, startTime: s.startTime })}
                        style={{
                          padding: '9px 4px',
                          borderRadius: 8,
                          border: isPick ? '2px solid #6a4fa0' : '1px solid #e8e8e8',
                          background: isPick ? '#f3eafc' : '#fff',
                          color: isPick ? '#6a4fa0' : '#333',
                          fontWeight: isPick ? 700 : 500,
                          fontSize: 13,
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                        }}>
                        {fmtTime(s.startTime)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button onClick={confirm} disabled={!pick || submitting}
            style={{ ...primaryBtn, background: !pick || submitting ? '#cbb6e0' : '#6a4fa0' }}>
            {submitting ? 'Confirming…' : pick ? `Confirm ${fmtDateShort(pick.date)} at ${fmtTime(pick.startTime)}` : 'Pick a time'}
          </button>
          <button onClick={onBack} disabled={submitting} style={secondaryBtn}>
            ← Back
          </button>
        </div>
      </div>
    </>
  );
}

function DoneView({ state, salon }) {
  const isCancel = state.type === 'cancelled';
  const icsHref = isCancel ? null : buildIcsDataUrl(state.appt, salon);
  return (
    <>
      <div style={{
        background: isCancel ? 'linear-gradient(135deg,#ef4444 0%, #b91c1c 100%)' : 'linear-gradient(135deg,#22c55e 0%, #15803d 100%)',
        padding: '32px 24px', color: '#fff', textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{isCancel ? '✕' : '✓'}</div>
        <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
          {isCancel ? 'Appointment cancelled' : 'Appointment rescheduled'}
        </div>
        <div style={{ fontSize: 14, opacity: .9 }}>
          {isCancel
            ? 'Sorry to miss you. We\'d love to see you next time.'
            : `New time: ${fmtDate(state.appt.date)} at ${fmtTime(state.appt.startTime)}`
          }
        </div>
      </div>
      <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: '#666', lineHeight: 1.6 }}>
        {!isCancel && (
          <>
            {icsHref && (
              <a href={icsHref} download={`${salon.name || 'Appointment'}.ics`}
                style={{ display: 'inline-block', padding: '10px 18px', borderRadius: 10, background: '#6a4fa0', color: '#fff', textDecoration: 'none', fontWeight: 600, fontSize: 13, marginBottom: 14 }}>
                📅 Add to Calendar
              </a>
            )}
            <div style={{ marginBottom: 8 }}>You'll get a reminder {state.appt.startTime ? '24 hours before' : 'before your visit'}.</div>
          </>
        )}
        Questions? Call <a href={`tel:${salon.phone || ''}`} style={{ color: '#6a4fa0', fontWeight: 600, textDecoration: 'none' }}>
          {salon.phone || salon.name}
        </a>.
      </div>
    </>
  );
}

// Build a data: URL containing an .ics file the browser can hand to the
// device's default calendar app. Works on iOS (Calendar.app), Android
// (Google Cal), Outlook, etc. without any backend round-trip.
function buildIcsDataUrl(appt, salon) {
  if (!appt?.date || !appt?.startTime) return null;
  const startDt = new Date(`${appt.date}T${appt.startTime}:00`);
  if (Number.isNaN(startDt.getTime())) return null;
  const endDt   = new Date(startDt.getTime() + (Number(appt.duration) || 60) * 60000);
  const iso     = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const uid     = `${appt.id || Math.random().toString(36).slice(2)}@plumenexus`;
  const title   = `${salon.name || 'Appointment'}: ${(appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Visit'}`;
  const desc    = `With ${appt.techName || 'your tech'}${salon.phone ? `\\nPhone: ${salon.phone}` : ''}`;
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Plume Nexus//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${iso(new Date())}`,
    `DTSTART:${iso(startDt)}`,
    `DTEND:${iso(endDt)}`,
    `SUMMARY:${title.replace(/[\r\n]/g, ' ')}`,
    `DESCRIPTION:${desc}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

function DetailRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f5f3fa' }}>
      <div style={{ width: 28, fontSize: 18, textAlign: 'center' }}>{icon}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
        <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );
}

function Banner({ color, border, textColor, children }) {
  return (
    <div style={{ background: color, border: `1px solid ${border}`, color: textColor, padding: '12px 14px', borderRadius: 10, fontSize: 13, lineHeight: 1.5, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function Loading() {
  return <div style={{ textAlign: 'center', padding: '40px 20px', color: '#aaa', fontSize: 14 }}>Loading…</div>;
}

function ErrorBlock({ msg }) {
  return (
    <div style={{ padding: 24 }}>
      <Banner color="#fee2e2" border="#fca5a5" textColor="#991b1b">{msg}</Banner>
      <div style={{ textAlign: 'center', fontSize: 13, color: '#666', marginTop: 12 }}>
        Try opening the link from your booking email or call the salon directly.
      </div>
    </div>
  );
}

const primaryBtn = {
  padding: '12px 18px',
  borderRadius: 12,
  border: 'none',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
const secondaryBtn = {
  padding: '11px 18px',
  borderRadius: 12,
  border: '1px solid #d8d8d8',
  background: '#fff',
  color: '#666',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};
