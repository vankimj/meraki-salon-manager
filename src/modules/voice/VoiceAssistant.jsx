import { useState, useEffect, useRef, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { createAppointment, saveAppointment, fetchClient } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import { TENANT_ID } from '../../lib/tenant';
import { resolveBookedDurations } from '../../utils/serviceHelpers';

// Web Speech API wrapper. Returns null if unsupported (Firefox, etc.).
function getSpeechRecognition() {
  const Cls = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Cls) return null;
  const r = new Cls();
  r.continuous = false;
  r.interimResults = true;
  r.lang = 'en-US';
  return r;
}

const POSITIVE = /^(yes|yeah|yep|sure|confirm|do it|go ahead|ok|okay|book it|that's right|that is right)\b/i;
const NEGATIVE = /^(no|nope|cancel|stop|don't|wait|nevermind|never mind)\b/i;

// Floating mic button + slide-up panel with editable confirmation card,
// disambiguation, typed fallback, and voice-confirm. Hides itself if Web
// Speech API is unsupported (mic UI), but typed input still works in any
// browser.
export default function VoiceAssistant({ clients = [], services = [], techs = [], employees = [] }) {
  const { isAdmin, isScheduler, isTech, gUser, showToast } = useApp();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterim] = useState('');
  const [typedInput, setTypedInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [proposal, setProposal] = useState(null); // { actionType, summary, payload, naturalReply }
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState('');
  const recogRef = useRef(null);
  const speechSupported = useRef(!!getSpeechRecognition());

  const canActOnAppts = isAdmin || isScheduler;
  if (!canActOnAppts && !isTech) return null;

  function reset() {
    setTranscript('');
    setInterim('');
    setTypedInput('');
    setProposal(null);
    setError('');
    setThinking(false);
  }

  function startListening(onFinalText) {
    setError('');
    const r = getSpeechRecognition();
    if (!r) return;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      setInterim(interim);
      setTranscript(finalText);
    };
    r.onend = () => {
      setListening(false);
      const t = (finalText || '').trim();
      if (t && onFinalText) onFinalText(t);
    };
    r.onerror = (e) => {
      setListening(false);
      const msg = e.error === 'not-allowed'
        ? 'Microphone permission denied — enable mic in your browser settings.'
        : e.error === 'no-speech'
          ? 'I didn\'t hear anything.'
          : `Mic error: ${e.error}`;
      setError(msg);
    };
    recogRef.current = r;
    try { r.start(); setListening(true); }
    catch (e) { setError(e?.message || 'Could not start microphone'); }
  }

  function stopListening() {
    try { recogRef.current?.stop(); } catch {}
    setListening(false);
  }

  // ── Initial command flow ────────────────────────────
  function startCommandListen() {
    reset();
    startListening((text) => submitTranscript(text));
  }

  async function submitTranscript(text) {
    setThinking(true);
    setError('');
    setTranscript(text);
    try {
      const role = isAdmin ? 'admin' : isScheduler ? 'scheduler' : 'tech';
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const fn = httpsCallable(functions, 'voiceCommand');
      const res = await fn({ tenantId: TENANT_ID, transcript: text, role });
      const out = res?.data || {};
      // Tech-role gating on the client too (defense in depth)
      if (!canActOnAppts && (out.actionType === 'book' || out.actionType === 'reschedule' || out.actionType === 'cancel')) {
        setProposal({
          actionType: 'unsupported',
          summary: 'Only schedulers and admins can book, reschedule, or cancel appointments by voice.',
          payload: { reason: 'permission' },
          naturalReply: 'You don\'t have permission for that action.',
        });
      } else {
        setProposal(out);
        // Auto-start voice-confirm listen for mutation actions (3s grace)
        if (speechSupported.current && ['book', 'reschedule', 'cancel', 'checkIn'].includes(out.actionType)) {
          setTimeout(() => startConfirmListen(out), 600);
        }
      }
    } catch (e) {
      setError(e?.message || 'Voice command failed');
    } finally {
      setThinking(false);
    }
  }

  // ── Voice confirm flow ──────────────────────────────
  function startConfirmListen(currentProposal) {
    if (executing || !currentProposal) return;
    startListening((spoken) => {
      const t = spoken.trim();
      if (POSITIVE.test(t)) executeProposal(currentProposal);
      else if (NEGATIVE.test(t)) reset();
      // Otherwise just leave the proposal up; user can tap Confirm/Cancel.
    });
  }

  // ── Execute via existing client-side helpers ───────
  async function executeProposal(p) {
    const propToUse = p || proposal;
    if (!propToUse) return;
    setExecuting(true);
    setError('');
    try {
      const { actionType, payload, summary } = propToUse;
      if (actionType === 'book') {
        // Banned-client guard — voice flow has no override; banned clients
        // get hard-blocked. Admin must use the schedule modal (with explicit
        // override + audit log) if they really want to book a banned client.
        if (payload.clientId) {
          try {
            const c = await fetchClient(payload.clientId);
            if (c?.banned) {
              setError(`${c.name} is banned. Voice booking is blocked. Use the calendar with explicit override if you really need to book them.`);
              setExecuting(false);
              return;
            }
          } catch (e) {
            console.warn('[voice] could not check ban status:', e?.message);
          }
        }
        // Re-resolve each service's duration for the chosen tech — the voice
        // model only knows base durations, so a slower tech's longer block is
        // applied here at execute time.
        const bookTechRec = (employees || []).find(e => e.name === payload.techName) || null;
        const resolvedServices = resolveBookedDurations(payload.services, services, bookTechRec);
        const dur = resolvedServices.reduce((s, sv) => s + (Number(sv.duration) || 0), 0) || (Number(payload.duration) || 60);
        const apptData = {
          clientId:        payload.clientId || '',
          clientName:      payload.clientName || '',
          techName:        payload.techName,
          date:            payload.date,
          startTime:       payload.startTime,
          duration:        dur,
          services:        resolvedServices,
          status:          'scheduled',
          source:          'voice_command',
          notes:           payload.notes || '',
          createdAt:       new Date().toISOString(),
          updatedAt:       new Date().toISOString(),
          techRequestType: payload.techRequestType || 'scheduler',
          createdBy:       gUser?.email || null,
        };
        await createAppointment(apptData);
        logActivity('appt_created', `${apptData.clientName || 'Walk-in'} with ${apptData.techName} on ${apptData.date} at ${apptData.startTime} (voice)`);
        showToast(`Booked: ${summary}`);
      } else if (actionType === 'reschedule') {
        const updates = {
          ...(payload.newTechName && { techName: payload.newTechName }),
          ...(payload.newDate     && { date: payload.newDate }),
          ...(payload.newStartTime && { startTime: payload.newStartTime }),
          updatedAt: new Date().toISOString(),
        };
        await saveAppointment(payload.apptId, updates);
        logActivity('appt_updated', `Rescheduled via voice: ${summary}`);
        showToast(`Rescheduled.`);
      } else if (actionType === 'cancel') {
        await saveAppointment(payload.apptId, { status: 'cancelled', updatedAt: new Date().toISOString(), cancelledBy: gUser?.email || null });
        logActivity('appt_cancelled', `Cancelled via voice: ${summary}`);
        showToast(`Cancelled.`);
      } else if (actionType === 'checkIn') {
        await saveAppointment(payload.apptId, { checkedInAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        logActivity('appt_updated', `Checked in via voice: ${summary}`);
        showToast(`Checked in.`);
      }
      setOpen(false);
      reset();
    } catch (e) {
      setError(e?.message || 'Could not execute');
    } finally {
      setExecuting(false);
    }
  }

  // Update a single field in the proposal payload (editable confirmation)
  function updatePayload(patch) {
    setProposal(p => p ? { ...p, payload: { ...p.payload, ...patch } } : p);
  }

  // ── UI ───────────────────────────────────────────────
  return (
    <>
      {/* Floating FAB */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) reset(); }}
        title="Voice command"
        style={{
          position: 'fixed',
          right: 20,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: '50%',
          border: 'none',
          background: open ? '#6a4fa0' : 'linear-gradient(135deg, #6d4cb8, #4a8dc1)',
          color: '#fff',
          fontSize: 24,
          cursor: 'pointer',
          boxShadow: '0 6px 18px rgba(106,79,160,.35)',
          zIndex: 90,
          transition: 'transform .12s, background .12s',
        }}
      >🎙️</button>

      {open && (
        <div style={{
          position: 'fixed',
          right: 20,
          bottom: 92,
          width: 420,
          maxWidth: 'calc(100vw - 40px)',
          maxHeight: 'calc(100vh - 120px)',
          background: 'var(--pn-surface)',
          border: '1px solid var(--pn-border)',
          borderRadius: 16,
          boxShadow: '0 16px 40px rgba(106,79,160,.18)',
          zIndex: 95,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <div style={{ background: 'linear-gradient(135deg, #6a4fa0, #4a8dc1)', color: '#fff', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>🎙️ Voice command</div>
            <button onClick={() => { setOpen(false); reset(); }} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 18, cursor: 'pointer' }}>×</button>
          </div>

          <div style={{ padding: 14, flex: 1, overflowY: 'auto' }}>
            {!proposal && !thinking && (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                {speechSupported.current && (
                  <>
                    <button
                      onClick={listening ? stopListening : startCommandListen}
                      disabled={thinking}
                      style={{
                        width: 84, height: 84, borderRadius: '50%',
                        border: 'none',
                        background: listening ? '#ef4444' : '#6a4fa0',
                        color: '#fff',
                        fontSize: 36,
                        cursor: 'pointer',
                        boxShadow: listening ? '0 0 0 8px rgba(239,68,68,.18)' : '0 4px 12px rgba(106,79,160,.3)',
                        transition: 'all .15s',
                      }}
                    >{listening ? '⏹' : '🎙️'}</button>
                    <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 10 }}>
                      {listening ? 'Listening… tap to stop' : 'Tap to speak'}
                    </div>
                  </>
                )}

                {(transcript || interimText) && (
                  <div style={{ marginTop: 14, padding: 10, background: 'var(--pn-surface-alt)', borderRadius: 10, fontSize: 13, color: 'var(--pn-text)', textAlign: 'left' }}>
                    {transcript}
                    {interimText && <span style={{ color: 'var(--pn-text-faint)' }}>{interimText}</span>}
                  </div>
                )}

                {/* Typed fallback — works even when speech API is unavailable */}
                <form onSubmit={e => { e.preventDefault(); const t = typedInput.trim(); if (t) submitTranscript(t); }}
                  style={{ marginTop: speechSupported.current ? 14 : 4, display: 'flex', gap: 6 }}>
                  <input
                    value={typedInput}
                    onChange={e => setTypedInput(e.target.value)}
                    placeholder={speechSupported.current ? 'or type a command…' : 'Type a command…'}
                    style={{ flex: 1, fontFamily: 'inherit', fontSize: 13, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', outline: 'none' }}
                  />
                  <button type="submit" disabled={!typedInput.trim()}
                    style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: typedInput.trim() ? '#6a4fa0' : '#cbb6e0', color: '#fff', fontSize: 13, cursor: typedInput.trim() ? 'pointer' : 'default', fontFamily: 'inherit' }}>
                    Send
                  </button>
                </form>
              </div>
            )}

            {thinking && (
              <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--pn-text-muted)' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🤔</div>
                <div style={{ fontSize: 13 }}>Thinking…</div>
                {transcript && (
                  <div style={{ marginTop: 12, padding: 8, background: 'var(--pn-surface-alt)', borderRadius: 8, fontSize: 12, color: 'var(--pn-text-muted)' }}>
                    "{transcript}"
                  </div>
                )}
              </div>
            )}

            {proposal && (
              <ProposalView
                proposal={proposal}
                executing={executing}
                listening={listening}
                clients={clients}
                services={services}
                techs={techs}
                onUpdate={updatePayload}
                onConfirm={() => executeProposal()}
                onCancel={() => { stopListening(); reset(); }}
                onListenAgain={() => startConfirmListen(proposal)}
              />
            )}

            {error && (
              <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--pn-danger-bg)', border: '1px solid #fca5a5', borderRadius: 8, fontSize: 12, color: 'var(--pn-danger)' }}>
                {error}
              </div>
            )}
          </div>

          {!proposal && !thinking && !listening && (
            <div style={{ borderTop: '1px solid var(--pn-border)', padding: '10px 14px', background: 'var(--pn-bg)' }}>
              <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Try saying</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[
                  'Book Sarah Johnson with Tess tomorrow at 2pm for a gel manicure',
                  'What does Tess have today?',
                  'Cancel Mary\'s appointment tomorrow',
                  'Sarah just walked in',
                ].map((s, i) => (
                  <div key={i} style={{ fontSize: 11, color: 'var(--pn-text-muted)', fontStyle: 'italic' }}>"{s}"</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ProposalView({ proposal, executing, listening, clients, services, techs, onUpdate, onConfirm, onCancel, onListenAgain }) {
  const { actionType, summary, payload, naturalReply } = proposal;

  if (actionType === 'view') {
    const items = payload?.items || [];
    // Defensively render either strings (preferred) or appointment-shaped
    // objects ({startTimeFormatted, clientName, services}) the model
    // sometimes returns despite the prompt. Falls back to JSON for
    // anything else.
    const renderItem = (it) => {
      if (typeof it === 'string') return it;
      if (it && typeof it === 'object') {
        const time = it.startTimeFormatted || it.startTime || '';
        const client = it.clientName || '';
        const tech = it.techName || '';
        const services = Array.isArray(it.services)
          ? it.services.map(s => typeof s === 'string' ? s : (s.name || '')).filter(Boolean).join(', ')
          : (it.services || '');
        const status = it.status && it.status !== 'scheduled' ? ` (${it.status})` : '';
        const parts = [time, client, tech, services].filter(Boolean);
        if (parts.length) return parts.join(' · ') + status;
      }
      return JSON.stringify(it);
    };
    return (
      <div>
        <div style={{ fontSize: 14, color: 'var(--pn-text)', marginBottom: 10, fontWeight: 600 }}>{naturalReply || summary}</div>
        {items.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.map((it, i) => (
              <div key={i} style={{ padding: '8px 10px', background: 'var(--pn-surface-alt)', borderRadius: 8, fontSize: 12, color: 'var(--pn-text)' }}>
                {renderItem(it)}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>{payload?.description || summary || 'No details available.'}</div>
        )}
        <button onClick={onCancel} style={{ marginTop: 12, width: '100%', padding: '9px 14px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Done</button>
      </div>
    );
  }

  if (actionType === 'unsupported') {
    return (
      <div>
        <div style={{ fontSize: 14, color: 'var(--pn-text)', marginBottom: 6, fontWeight: 600 }}>{naturalReply || 'Could not process.'}</div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 12 }}>{summary}</div>
        <button onClick={onCancel} style={{ width: '100%', padding: '9px 14px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Try again</button>
      </div>
    );
  }

  // Mutation actions — editable confirmation card
  return (
    <MutationCard
      proposal={proposal}
      executing={executing}
      listening={listening}
      clients={clients}
      services={services}
      techs={techs}
      onUpdate={onUpdate}
      onConfirm={onConfirm}
      onCancel={onCancel}
      onListenAgain={onListenAgain}
    />
  );
}

function MutationCard({ proposal, executing, listening, clients, services, techs, onUpdate, onConfirm, onCancel, onListenAgain }) {
  const { actionType, summary, payload, naturalReply } = proposal;
  const [editing, setEditing] = useState(false);
  const [clientSearch, setClientSearch] = useState('');

  const accent =
    actionType === 'cancel'    ? { bg: 'var(--pn-danger-bg)', border: '#fca5a5', accent: 'var(--pn-danger)', label: 'Cancel appointment' }
    : actionType === 'reschedule' ? { bg: 'var(--pn-warning-bg)', border: '#fcd34d', accent: 'var(--pn-warning)', label: 'Reschedule' }
    : actionType === 'checkIn'   ? { bg: 'var(--pn-success-bg)', border: '#bbf7d0', accent: 'var(--pn-success)', label: 'Check in' }
    :                              { bg: 'var(--pn-info-bg)', border: '#c7dff7', accent: 'var(--pn-info)', label: 'Book appointment' };

  // Filtered client matches for disambiguation. If the model picked a clientId
  // but the spoken-name has multiple matches in our DB, surface them.
  const ambiguousClientMatches = useMemo(() => {
    if (actionType !== 'book') return [];
    const q = (clientSearch || payload.clientName || '').toLowerCase().trim();
    if (!q) return [];
    return (clients || [])
      .filter(c => (c.name || '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [clients, clientSearch, payload.clientName, actionType]);

  const showDisambig = actionType === 'book' && (
    !payload.clientId || (ambiguousClientMatches.length > 1 && (payload.clientName || '').toLowerCase() === clientSearch.toLowerCase())
  );

  return (
    <div>
      {naturalReply && <div style={{ fontSize: 13, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{naturalReply}</div>}

      <div style={{ background: accent.bg, border: `1px solid ${accent.border}`, borderRadius: 10, padding: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: accent.accent, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {accent.label}
          </div>
          {(actionType === 'book' || actionType === 'reschedule') && (
            <button onClick={() => setEditing(e => !e)}
              style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit' }}>
              {editing ? 'Done' : '✎ Edit'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 14, color: 'var(--pn-text)', lineHeight: 1.4, fontWeight: 600, marginBottom: editing ? 10 : 0 }}>{summary}</div>

        {/* Editable view */}
        {editing && actionType === 'book' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <FieldRow label="Client">
              <input
                value={clientSearch || payload.clientName || ''}
                onChange={e => { setClientSearch(e.target.value); onUpdate({ clientName: e.target.value, clientId: '' }); }}
                placeholder="Search clients…"
                style={inputStyle}
              />
            </FieldRow>
            {showDisambig && ambiguousClientMatches.length > 1 && (
              <div style={{ marginLeft: 70, padding: 6, background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 6 }}>
                <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginBottom: 4 }}>Pick one</div>
                {ambiguousClientMatches.map(c => (
                  <button key={c.id} onClick={() => { onUpdate({ clientId: c.id, clientName: c.name }); setClientSearch(c.name); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 8px', borderRadius: 4, border: 'none', background: payload.clientId === c.id ? 'var(--pn-success-bg)' : 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--pn-text)' }}>
                    {c.name}{c.phone ? ` · ${c.phone}` : ''}
                  </button>
                ))}
              </div>
            )}
            <FieldRow label="Tech">
              <select value={payload.techName || ''} onChange={e => onUpdate({ techName: e.target.value })} style={inputStyle}>
                <option value="">Pick tech…</option>
                {(techs || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="Date">
              <input type="date" value={payload.date || ''} onChange={e => onUpdate({ date: e.target.value })} style={inputStyle} />
            </FieldRow>
            <FieldRow label="Time">
              <input type="time" value={payload.startTime || ''} onChange={e => onUpdate({ startTime: e.target.value })} style={inputStyle} />
            </FieldRow>
            <FieldRow label="Service">
              <select
                value={(payload.services?.[0]?.name) || ''}
                onChange={e => {
                  const svc = (services || []).find(s => s.name === e.target.value);
                  if (svc) onUpdate({ services: [{ name: svc.name, duration: svc.duration || 60, price: svc.basePrice ?? '' }] });
                }}
                style={inputStyle}>
                <option value="">Pick service…</option>
                {(services || []).map(s => <option key={s.id} value={s.name}>{s.name}{s.basePrice ? ` · $${s.basePrice}` : ''}</option>)}
              </select>
            </FieldRow>
          </div>
        )}

        {editing && actionType === 'reschedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <FieldRow label="New tech">
              <select value={payload.newTechName || ''} onChange={e => onUpdate({ newTechName: e.target.value })} style={inputStyle}>
                <option value="">(no change)</option>
                {(techs || []).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </FieldRow>
            <FieldRow label="New date">
              <input type="date" value={payload.newDate || ''} onChange={e => onUpdate({ newDate: e.target.value })} style={inputStyle} />
            </FieldRow>
            <FieldRow label="New time">
              <input type="time" value={payload.newStartTime || ''} onChange={e => onUpdate({ newStartTime: e.target.value })} style={inputStyle} />
            </FieldRow>
          </div>
        )}

        {/* Read-only details when not editing */}
        {!editing && actionType === 'book' && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--pn-text-muted)', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {payload.clientName && <div>👤 {payload.clientName}{!payload.clientId && <span style={{ color: 'var(--pn-danger)', marginLeft: 6 }}>(no exact match)</span>}</div>}
            {payload.techName  && <div>💅 {payload.techName}</div>}
            {payload.date      && <div>📅 {payload.date}{payload.startTime ? ` at ${payload.startTime}` : ''}</div>}
            {Array.isArray(payload.services) && payload.services.length > 0 && (
              <div>✂️ {payload.services.map(s => s.name).join(', ')}</div>
            )}
          </div>
        )}
      </div>

      {listening && (
        <div style={{ fontSize: 11, color: '#6a4fa0', marginBottom: 8, textAlign: 'center', fontStyle: 'italic' }}>
          🎙️ Listening — say "yes" to confirm, "no" to cancel
        </div>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onConfirm} disabled={executing || (actionType === 'book' && !payload.clientId && !payload.clientName)}
          style={{ flex: 2, padding: '10px 14px', borderRadius: 10, border: 'none', background: executing ? '#cbb6e0' : '#6a4fa0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: executing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
          {executing ? 'Working…' : 'Confirm'}
        </button>
        <button onClick={onCancel} disabled={executing}
          style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
          Cancel
        </button>
      </div>

      {!listening && !executing && onListenAgain && (
        <button onClick={onListenAgain}
          style={{ marginTop: 8, width: '100%', padding: '7px 10px', borderRadius: 8, border: 'none', background: 'transparent', color: '#6a4fa0', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
          🎙️ Listen for "yes" / "no"
        </button>
      )}
    </div>
  );
}

const inputStyle = {
  width: '100%',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '5px 8px',
  border: '1px solid var(--pn-border-strong)',
  borderRadius: 6,
  background: 'var(--pn-surface)',
  outline: 'none',
};

function FieldRow({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', width: 62, flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}
