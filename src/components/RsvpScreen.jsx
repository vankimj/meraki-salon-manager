import { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { fetchWebfrontConfig } from '../lib/firestore';

// Public RSVP page hit via the /?rsvp=<meetingId>&token=<t>[&r=accept|maybe|decline] link
// in meeting invitation emails. Token is the credential — no login required.
export default function RsvpScreen() {
  const params = new URLSearchParams(window.location.search);
  const meetingId = params.get('rsvp');
  const token     = params.get('token');
  const presetR   = params.get('r');
  const validPreset = ['accept', 'maybe', 'decline'].includes(presetR) ? presetR : null;

  const [state,    setState]    = useState('loading');  // loading | ready | recording | done | error
  const [meeting,  setMeeting]  = useState(null);
  const [me,       setMe]       = useState(null);
  const [response, setResponse] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [salonName, setSalonName] = useState('Plume Nexus');

  useEffect(() => {
    fetchWebfrontConfig().then(wf => { if (wf?.salonName) setSalonName(wf.salonName); }).catch(() => {});
  }, []);

  // Load the meeting + participant details by token
  useEffect(() => {
    if (!meetingId || !token) {
      setState('error'); setErrorMsg('Missing meeting or token in the link.'); return;
    }
    httpsCallable(functions, 'fetchMeetingForRsvp')({ meetingId, token })
      .then(res => {
        setMeeting(res.data.meeting);
        setMe(res.data.participant);
        setResponse(res.data.participant.response || null);
        setState('ready');
        // If the email link pre-selected a response, record it automatically.
        if (validPreset && res.data.participant.response !== validPreset) {
          submit(validPreset);
        }
      })
      .catch(e => {
        setState('error');
        const code = e?.code || e?.message || '';
        setErrorMsg(code.includes('not-found') ? 'This meeting no longer exists.'
          : code.includes('permission-denied') ? 'This RSVP link is invalid or has expired.'
          : 'Could not load the meeting. Please try again.');
      });
  }, []); // eslint-disable-line

  function submit(r) {
    setState('recording');
    httpsCallable(functions, 'recordMeetingResponse')({ meetingId, token, response: r })
      .then(() => {
        setResponse(r);
        setState('done');
      })
      .catch(e => {
        setState('error');
        setErrorMsg(e?.message || 'Could not record your response.');
      });
  }

  const RESPONSE_STYLES = {
    accept:  { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', label: '✓ Accepted',  verb: 'see you there' },
    maybe:   { color: '#f59e0b', bg: '#fffbeb', border: '#fde68a', label: '? Maybe',     verb: 'we hope you can make it' },
    decline: { color: '#ef4444', bg: '#fef2f2', border: '#fecaca', label: '✗ Declined',  verb: "we'll catch you next time" },
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f5f6f8', overflowY: 'auto', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'linear-gradient(135deg,#2D7A5F 0%,#3D95CE 100%)', padding: '24px 20px', textAlign: 'center', color: '#fff' }}>
        <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', opacity: .85 }}>{salonName}</div>
        <div style={{ fontSize: 11, opacity: .7, marginTop: 3 }}>Meeting RSVP</div>
      </div>

      <div style={{ flex: 1, padding: '24px 16px 48px', maxWidth: 520, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

        {state === 'loading' && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, textAlign: 'center', color: '#888' }}>Loading…</div>
        )}

        {state === 'error' && (
          <div style={{ background: '#fff', borderRadius: 14, padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>😔</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', marginBottom: 6 }}>We couldn't load this RSVP</div>
            <div style={{ fontSize: 13, color: '#888', lineHeight: 1.5 }}>{errorMsg}</div>
          </div>
        )}

        {(state === 'ready' || state === 'recording' || state === 'done') && meeting && (
          <>
            <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', marginBottom: 16, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
              <div style={{ padding: '18px 20px 12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#aaa', letterSpacing: '.08em', textTransform: 'uppercase' }}>You're invited</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#1a1a1a', marginTop: 4, lineHeight: 1.25 }}>{meeting.title || `${salonName} team meeting`}</div>
                {me?.name && <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>Hi {me.name.split(' ')[0]} 👋</div>}
              </div>
              <div style={{ borderTop: '1px solid #f0f0f0', padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13, color: '#444' }}>
                <Row icon="📅" label={fmtDateLong(meeting.date)} />
                <Row icon="🕐" label={`${fmtT(meeting.startTime)}${meeting.duration ? ` · ${meeting.duration} min` : ''}`} />
                {meeting.location    && <Row icon="📍" label={meeting.location} />}
                {meeting.description && <Row icon="📝" label={<span style={{ whiteSpace: 'pre-line', lineHeight: 1.55 }}>{meeting.description}</span>} />}
              </div>
            </div>

            {state !== 'done' && (
              <div style={{ background: '#fff', borderRadius: 14, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,.06)' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', marginBottom: 10 }}>
                  {response ? 'Update your response:' : 'Will you attend?'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {['accept', 'maybe', 'decline'].map(r => {
                    const sty = RESPONSE_STYLES[r];
                    const isSel = response === r;
                    return (
                      <button key={r} onClick={() => submit(r)} disabled={state === 'recording'}
                        style={{
                          padding: '12px 8px', borderRadius: 10, fontFamily: 'inherit', fontWeight: 700, fontSize: 13,
                          border: `1.5px solid ${isSel ? sty.color : sty.border}`,
                          background: isSel ? sty.color : sty.bg,
                          color: isSel ? '#fff' : sty.color,
                          cursor: state === 'recording' ? 'wait' : 'pointer',
                          transition: 'background .15s, border-color .15s',
                        }}>
                        {sty.label}
                      </button>
                    );
                  })}
                </div>
                {response && state === 'ready' && (
                  <div style={{ fontSize: 11, color: '#888', marginTop: 10, textAlign: 'center' }}>
                    Currently recorded as <strong style={{ color: RESPONSE_STYLES[response].color }}>{RESPONSE_STYLES[response].label}</strong>
                  </div>
                )}
              </div>
            )}

            {state === 'done' && response && (
              <div style={{ background: RESPONSE_STYLES[response].bg, border: `1px solid ${RESPONSE_STYLES[response].border}`, borderRadius: 14, padding: 22, textAlign: 'center' }}>
                <div style={{ fontSize: 28, color: RESPONSE_STYLES[response].color, marginBottom: 6, fontWeight: 800 }}>
                  {RESPONSE_STYLES[response].label}
                </div>
                <div style={{ fontSize: 13, color: '#444', lineHeight: 1.6 }}>
                  Thanks{me?.name ? `, ${me.name.split(' ')[0]}` : ''} — {RESPONSE_STYLES[response].verb}.<br/>
                  You can come back to this link anytime to update your response.
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <span style={{ fontSize: 14, width: 18, flexShrink: 0, textAlign: 'center' }}>{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function fmtT(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function fmtDateLong(d) {
  if (!d) return '';
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
