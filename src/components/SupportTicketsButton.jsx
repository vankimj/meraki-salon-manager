import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import {
  submitSupportTicket, submitOwnerReply,
  fetchRecentTickets, fetchTicket, subscribeToReplies,
  chatWithSalonAdmin,
} from '../lib/support';

// Bottom-right floating button → entry modal with two big choices:
//
//   1. "Submit a ticket"  — emails / SMSes Plume Nexus support, attaches
//                           diagnostics (recent activity log, browser
//                           errors, current route) so the engineer +
//                           triage AI have context.
//   2. "Ask AI"           — opens a chat with an AI that can answer
//                           how-to questions, navigate the salon owner
//                           to the right screen, and apply a tight
//                           allowlist of changes (hours, services,
//                           employees, marketing copy). No mutation
//                           confirms — the allowlist is the safety
//                           layer + every action is audit-logged on
//                           the server.
//
// Visibility: signed-in users only. Not rendered on TipFlow / kiosk
// modes because those don't mount ModuleShell.

const C = {
  ink: '#0f1923', text: '#1a1f2e', muted: '#5e6776', mutedSoft: '#8b94a3',
  rule: '#e3e6ed', ruleSoft: '#eef0f4', bg: '#f5f6f9', card: '#fff',
  plum: '#5b3b8c', plumDeep: '#3f2767',
  blue: '#3d95ce', blueDeep: '#1f6ea3',
  success: '#16a34a', successSoft: '#dcfce7',
  warning: '#f59e0b', warningSoft: '#fef3c7',
  danger: '#ef4444', dangerSoft: '#fee2e2',
};

export default function SupportTicketsButton() {
  const { gUser } = useApp();
  const [open, setOpen] = useState(false);
  if (!gUser) return null;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Support + AI assistant"
        aria-label="Open support / AI"
        style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9999,
          width: 48, height: 48, borderRadius: '50%',
          background: C.plum, color: '#fff', border: 'none',
          boxShadow: '0 6px 20px rgba(91,59,140,.35)',
          fontSize: 22, fontWeight: 700, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'inherit',
        }}
      >
        ?
      </button>
      {open && <Modal onClose={() => setOpen(false)} />}
    </>
  );
}

function Modal({ onClose }) {
  // 'pick' | 'ticket' | 'ai'
  const [mode, setMode] = useState('pick');
  // Ticket sub-state: 'new' (form) | 'mine' (history list) | string (ticketId open)
  const [ticketView, setTicketView] = useState('new');
  const [openTicketId, setOpenTicketId] = useState(null);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,25,35,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14,
        width: mode === 'pick' ? 480 : 620, maxWidth: '100%',
        maxHeight: '92vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.35)', overflow: 'hidden',
      }}>
        <Header mode={mode} onBack={() => { setMode('pick'); setOpenTicketId(null); }} onClose={onClose} />

        {mode === 'pick' && <Picker
          onPick={(m) => {
            setMode(m);
            if (m === 'ticket') setTicketView('new');
          }}
        />}

        {mode === 'ticket' && !openTicketId && (
          <>
            <div style={{ padding: '8px 20px', display: 'flex', gap: 4, borderBottom: `1px solid ${C.rule}` }}>
              <Tab active={ticketView === 'new'}  onClick={() => setTicketView('new')}>Submit</Tab>
              <Tab active={ticketView === 'mine'} onClick={() => setTicketView('mine')}>My tickets</Tab>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              {ticketView === 'new'  && <SubmitForm onSubmitted={() => setTicketView('mine')} />}
              {ticketView === 'mine' && <TicketsList onOpen={setOpenTicketId} />}
            </div>
          </>
        )}
        {mode === 'ticket' && openTicketId && (
          <TicketThread ticketId={openTicketId} onBack={() => setOpenTicketId(null)} />
        )}

        {mode === 'ai' && <AskAiChat onClose={onClose} />}
      </div>
    </div>
  );
}

function Header({ mode, onBack, onClose }) {
  const title = mode === 'pick'   ? 'How can we help?'
              : mode === 'ticket' ? 'Plume Nexus support'
              :                     'Plume Nexus AI';
  return (
    <div style={{ padding: '16px 20px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {mode !== 'pick' && (
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
            ← Back
          </button>
        )}
        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{title}</div>
      </div>
      <button onClick={onClose} aria-label="Close" style={{
        background: 'none', border: 'none', fontSize: 22, color: C.muted, cursor: 'pointer', lineHeight: 1,
      }}>×</button>
    </div>
  );
}

function Picker({ onPick }) {
  return (
    <div style={{ padding: 20 }}>
      <PickerCard
        accent={C.blue}
        title="Ask AI"
        sub="Get instant help. The AI can walk you through anything, jump you to the right screen, or make changes for you (hours, services, employees, marketing copy)."
        cta="Open chat →"
        onClick={() => onPick('ai')}
      />
      <div style={{ height: 12 }} />
      <PickerCard
        accent={C.plum}
        title="Submit a support ticket"
        sub="Talk to a human. Use this for billing, account issues, or anything the AI can't solve. We auto-attach recent activity and any browser errors so triage is fast."
        cta="File a ticket →"
        onClick={() => onPick('ticket')}
      />
    </div>
  );
}

function PickerCard({ accent, title, sub, cta, onClick }) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      padding: 18, borderRadius: 12,
      background: '#fff', border: `2px solid ${accent}`,
      cursor: 'pointer', fontFamily: 'inherit',
      boxShadow: '0 1px 4px rgba(15,25,35,.04)',
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, marginBottom: 10 }}>{sub}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '.06em' }}>{cta}</div>
    </button>
  );
}

function Tab({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px', fontSize: 13, fontWeight: 600,
      background: 'transparent',
      color: active ? C.plum : C.muted,
      border: 'none',
      borderBottom: `2px solid ${active ? C.plum : 'transparent'}`,
      marginBottom: -1,
      cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function SubmitForm({ onSubmitted }) {
  const [subject,  setSubject]  = useState('');
  const [body,     setBody]     = useState('');
  const [priority, setPriority] = useState('high');
  const [sending,  setSending]  = useState(false);
  const [err,      setErr]      = useState('');
  const [done,     setDone]     = useState(false);

  async function submit(e) {
    e?.preventDefault();
    if (subject.trim().length < 3) { setErr('Subject must be at least 3 characters.'); return; }
    if (body.trim().length    < 5) { setErr('Tell us a bit more so we can help.'); return; }
    setErr(''); setSending(true);
    try {
      await submitSupportTicket({ subject: subject.trim(), body: body.trim(), priority });
      setDone(true);
      setTimeout(() => onSubmitted?.(), 1200);
    } catch (e) {
      setErr(e?.message || 'Submit failed.');
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>✓</div>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.success, marginBottom: 4 }}>Ticket submitted</div>
        <div style={{ fontSize: 13, color: C.muted }}>You'll get an email reply when we respond.</div>
      </div>
    );
  }

  return (
    <form onSubmit={submit}>
      <label style={lbl}>Subject</label>
      <input
        value={subject}
        onChange={e => setSubject(e.target.value)}
        maxLength={200}
        placeholder="One-line summary"
        style={input}
      />

      <label style={lbl}>Priority</label>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <PrioPill active={priority === 'low'}  onClick={() => setPriority('low')}  color={C.muted}>Low (email)</PrioPill>
        <PrioPill active={priority === 'high'} onClick={() => setPriority('high')} color={C.danger}>High (email + SMS)</PrioPill>
      </div>

      <label style={lbl}>Message</label>
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        maxLength={8000}
        rows={6}
        placeholder="What's going on? Recent activity, browser errors, and the screen you're on are auto-attached."
        style={{ ...input, resize: 'vertical', minHeight: 110 }}
      />

      {err && <div style={{ fontSize: 12, color: C.danger, marginBottom: 10 }}>{err}</div>}

      <button type="submit" disabled={sending} style={{
        marginTop: 4, padding: '10px 18px', fontSize: 14, fontWeight: 700,
        background: sending ? C.muted : C.plum, color: '#fff',
        border: 'none', borderRadius: 8, cursor: sending ? 'default' : 'pointer',
        fontFamily: 'inherit',
      }}>{sending ? 'Sending…' : 'Send ticket'}</button>
    </form>
  );
}

function PrioPill({ active, onClick, color, children }) {
  return (
    <button type="button" onClick={onClick} style={{
      flex: 1, padding: '8px 12px', fontSize: 12, fontWeight: 600,
      background: active ? color : '#fff',
      color: active ? '#fff' : color,
      border: `1px solid ${color}`, borderRadius: 8,
      cursor: 'pointer', fontFamily: 'inherit',
    }}>{children}</button>
  );
}

function TicketsList({ onOpen }) {
  const [rows,    setRows]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  useEffect(() => {
    setLoading(true);
    fetchRecentTickets()
      .then(r => setRows(r))
      .catch(e => setError(e?.message || 'Failed to load.'))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <div style={{ color: C.mutedSoft, fontSize: 12, padding: 16 }}>Loading…</div>;
  if (error)   return <div style={{ color: C.danger,    fontSize: 12, padding: 16 }}>{error}</div>;
  if (!rows?.length) return (
    <div style={{ padding: 20, color: C.mutedSoft, fontSize: 13, textAlign: 'center' }}>
      No tickets yet. Use Submit if you need help.
    </div>
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(t => (
        <button key={t.id} onClick={() => onOpen(t.id)} style={{
          textAlign: 'left', background: '#fff', border: `1px solid ${C.rule}`,
          borderRadius: 10, padding: 12, cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
            <div style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{t.subject}</div>
            <StatusChip status={t.status} priority={t.priority} />
          </div>
          <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 4 }}>
            Last activity: {timeAgo(t.lastReplyAt)} · {t.repliesCount || 0} replies
          </div>
        </button>
      ))}
    </div>
  );
}

function TicketThread({ ticketId, onBack }) {
  const [ticket,  setTicket]  = useState(null);
  const [replies, setReplies] = useState([]);
  const [body,    setBody]    = useState('');
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    fetchTicket(ticketId).then(setTicket).catch(() => {});
    const unsub = subscribeToReplies(ticketId, setReplies);
    return () => unsub?.();
  }, [ticketId]);

  async function send() {
    if (!body.trim()) return;
    setSending(true); setErr('');
    try {
      await submitOwnerReply({ ticketId, body: body.trim() });
      setBody('');
    } catch (e) {
      setErr(e?.message || 'Reply failed.');
    } finally {
      setSending(false);
    }
  }

  if (!ticket) return <div style={{ padding: 20, color: C.mutedSoft }}>Loading…</div>;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${C.rule}`, background: C.ruleSoft }}>
        <button onClick={onBack} style={{
          background: 'none', border: 'none', color: C.muted, fontSize: 12, padding: 0, cursor: 'pointer', marginBottom: 6, fontFamily: 'inherit',
        }}>← Back to my tickets</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{ticket.subject}</div>
          <StatusChip status={ticket.status} priority={ticket.priority} />
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <MessageBubble from="owner" body={ticket.initialBody} at={ticket.createdAt} authorName={ticket.createdBy?.name || ticket.createdBy?.email} />
        {replies.map(r => (
          <MessageBubble key={r.id} from={r.from} body={r.body} at={r.at} authorName={r.authorName || r.authorEmail} />
        ))}
      </div>
      {ticket.status !== 'closed' && (
        <div style={{ padding: 16, borderTop: `1px solid ${C.rule}`, background: '#fff' }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={8000}
            rows={3}
            placeholder="Reply…"
            style={{ ...input, marginBottom: 8, resize: 'vertical' }}
          />
          {err && <div style={{ fontSize: 11, color: C.danger, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={send} disabled={sending || !body.trim()} style={{
              padding: '8px 16px', fontSize: 13, fontWeight: 700,
              background: sending || !body.trim() ? C.muted : C.plum, color: '#fff',
              border: 'none', borderRadius: 8,
              cursor: sending || !body.trim() ? 'default' : 'pointer', fontFamily: 'inherit',
            }}>{sending ? 'Sending…' : 'Send reply'}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Assistant ────────────────────────────────────────────────────────────

function AskAiChat({ onClose }) {
  // Local conversation state. Each entry is { role: 'user'|'assistant', text, actions? }
  // We don't persist across modal close — sessions are intentionally
  // ephemeral so a new context is built each time.
  const [messages, setMessages] = useState([{
    role:     'assistant',
    text:     "Hi — I'm your salon assistant. I can answer questions, walk you to the right screen, or change settings for you (try: \"set my hours\", \"add a $45 gel manicure\", \"open the marketing tab\"). What can I help with?",
    actions:  [],
  }]);
  const [input,    setInput]   = useState('');
  const [sending,  setSending] = useState(false);
  const [error,    setError]   = useState('');
  const sessionIdRef = useRef(genSessionId());
  const scrollRef    = useRef(null);

  // Auto-scroll on new messages.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput(''); setError('');
    const nextHistory = [...messages, { role: 'user', text }];
    setMessages(nextHistory);
    setSending(true);
    try {
      const currentView = window.history?.state?.view || 'home';
      // Send the trailing N messages so context stays cheap.
      const wire = nextHistory.slice(-12).map(m => ({
        role: m.role,
        content: m.text,
      }));
      const res = await chatWithSalonAdmin({
        sessionId:   sessionIdRef.current,
        messages:    wire,
        currentView,
      });
      const reply = res?.reply || '';
      const actions = Array.isArray(res?.actions) ? res.actions : [];
      // If the AI navigated, perform the navigation client-side now.
      for (const a of actions) {
        if (a.tool === 'navigate' && a.ok && typeof window.__plumeNavigate === 'function') {
          window.__plumeNavigate(a.input?.target, { tab: a.input?.tab, scrollTo: a.input?.scrollTo });
        }
      }
      setMessages([...nextHistory, { role: 'assistant', text: reply, actions }]);
    } catch (e) {
      setError(e?.message || 'AI is unreachable. Try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: 480 }}>
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 18 }}>
        {messages.map((m, i) => (
          <ChatBubble key={i} role={m.role} text={m.text} actions={m.actions} />
        ))}
        {sending && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 12px', fontSize: 12, color: C.muted, fontStyle: 'italic',
          }}>
            <Dots /> thinking…
          </div>
        )}
        {error && (
          <div style={{
            padding: '8px 12px', background: C.dangerSoft, color: C.danger,
            borderRadius: 8, fontSize: 12, marginBottom: 10,
          }}>{error}</div>
        )}
      </div>
      <div style={{ padding: 14, borderTop: `1px solid ${C.rule}`, background: '#fff' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          maxLength={4000}
          rows={2}
          placeholder='Try: "Change Monday hours to 10–7", "Add a gel mani for $45", "Take me to marketing"'
          style={{ ...input, resize: 'vertical', minHeight: 60, marginBottom: 8 }}
          disabled={sending}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 10, color: C.mutedSoft }}>
            ⌘ + Enter to send · Powered by Claude · Session is not saved
          </div>
          <button onClick={send} disabled={sending || !input.trim()} style={{
            padding: '8px 18px', fontSize: 13, fontWeight: 700,
            background: sending || !input.trim() ? C.muted : C.blue, color: '#fff',
            border: 'none', borderRadius: 8,
            cursor: sending || !input.trim() ? 'default' : 'pointer', fontFamily: 'inherit',
          }}>{sending ? 'Thinking…' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ role, text, actions }) {
  const isUser = role === 'user';
  return (
    <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '92%', padding: '10px 14px', borderRadius: 12,
        background: isUser ? C.blue : C.ruleSoft,
        color: isUser ? '#fff' : C.ink,
        fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>
        {text || (isUser ? '' : '…')}
      </div>
      {!isUser && Array.isArray(actions) && actions.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, maxWidth: '92%' }}>
          {actions.map((a, i) => <ActionChip key={i} a={a} />)}
        </div>
      )}
    </div>
  );
}

function ActionChip({ a }) {
  if (a.requiresConfirmation) {
    return (
      <div style={{
        fontSize: 11, padding: '6px 10px', borderRadius: 8,
        background: C.warningSoft, color: C.warning,
        display: 'inline-flex', alignItems: 'center', gap: 6,
        width: 'fit-content',
        border: `1px solid ${C.warning}40`,
      }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.warning }} />
        <span style={{ fontWeight: 700 }}>⏸ Awaiting your confirmation</span>
      </div>
    );
  }
  const ok = a.ok !== false;
  const color = ok ? C.success : C.danger;
  const bg    = ok ? C.successSoft : C.dangerSoft;
  const label = describeAction(a);
  return (
    <div style={{
      fontSize: 11, padding: '4px 9px', borderRadius: 6,
      background: bg, color,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      width: 'fit-content',
    }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color }} />
      <span style={{ fontWeight: 600 }}>{ok ? '✓' : '⚠'} {label}</span>
    </div>
  );
}

function describeAction(a) {
  if (!a) return '';
  switch (a.tool) {
    case 'navigate':         return `Navigated to ${a.input?.target || ''}${a.input?.tab ? ` → ${a.input.tab}` : ''}`;
    case 'updateBusinessHours': return 'Updated business hours';
    case 'updateSettings':   return `Updated settings: ${Object.keys(a.input || {}).join(', ')}`;
    case 'addService':       return `Added service: ${a.input?.name || ''}`;
    case 'updateService':    return `Updated service ${a.input?.serviceId || ''}`;
    case 'removeService':    return `Removed service ${a.input?.serviceId || ''}`;
    case 'updateEmployee':   return `Updated employee ${a.input?.employeeId || ''}`;
    case 'updateMarketingTemplate': return `Updated ${a.input?.templateKey || 'template'}`;
    default:                 return a.tool || 'action';
  }
}

function Dots() {
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {[0, 0.15, 0.3].map(d => (
        <span key={d} style={{
          width: 4, height: 4, borderRadius: '50%', background: C.mutedSoft,
          animation: `pdot 0.9s ${d}s infinite ease-in-out`,
        }} />
      ))}
      <style>{`@keyframes pdot{0%,100%{opacity:.3;transform:translateY(0)}50%{opacity:1;transform:translateY(-2px)}}`}</style>
    </span>
  );
}

function genSessionId() {
  return 's_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function MessageBubble({ from, body, at, authorName }) {
  const isAdmin = from === 'admin';
  return (
    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', alignItems: isAdmin ? 'flex-start' : 'flex-end' }}>
      <div style={{
        maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
        background: isAdmin ? C.ruleSoft : C.plum,
        color: isAdmin ? C.ink : '#fff',
        fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>{body}</div>
      <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>
        {isAdmin ? 'Plume Nexus' : (authorName || 'You')} · {timeAgo(at)}
      </div>
    </div>
  );
}

function StatusChip({ status, priority }) {
  const meta = {
    open:           { label: 'Open',       bg: C.warningSoft, color: C.warning },
    pending_owner:  { label: 'Awaiting you', bg: '#eff6ff',   color: '#1e40af' },
    resolved:       { label: 'Resolved',   bg: C.successSoft, color: C.success },
    closed:         { label: 'Closed',     bg: C.ruleSoft,   color: C.muted },
  }[status] || { label: status || '—', bg: C.ruleSoft, color: C.muted };
  return (
    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      {priority === 'high' && (
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 3,
          background: C.dangerSoft, color: C.danger, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
        }}>High</span>
      )}
      <span style={{
        fontSize: 9, padding: '2px 7px', borderRadius: 3,
        background: meta.bg, color: meta.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em',
      }}>{meta.label}</span>
    </div>
  );
}

function timeAgo(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)     return 'just now';
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const lbl   = { display: 'block', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 };
const input = {
  width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 13,
  border: `1px solid ${C.rule}`, borderRadius: 8, marginBottom: 14,
  background: '#fff', fontFamily: 'inherit', outline: 'none', color: C.text,
};
