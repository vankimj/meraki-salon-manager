import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  submitSupportTicket, submitOwnerReply,
  fetchRecentTickets, fetchTicket, subscribeToReplies,
} from '../lib/support';

// Bottom-right floating button → modal with two views:
//   "Submit a ticket" (new) and "My tickets" (history + threads).
//
// Tickets are owner→Plume-Nexus support. Per principle #10 this is the
// ONLY channel by which the platform team learns about a tenant's
// problems — there is no impersonation flow. Low priority → email only;
// high → email + SMS to platform admins who opted in.

const C = {
  ink: '#0f1923', text: '#1a1f2e', muted: '#5e6776', mutedSoft: '#8b94a3',
  rule: '#e3e6ed', ruleSoft: '#eef0f4', bg: '#f5f6f9', card: '#fff',
  plum: '#5b3b8c', plumDeep: '#3f2767',
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
        title="Support"
        aria-label="Open support"
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
      {open && <SupportModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SupportModal({ onClose }) {
  const [tab, setTab] = useState('new'); // 'new' | 'mine'
  const [openTicketId, setOpenTicketId] = useState(null);

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,25,35,.5)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 560, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.35)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '16px 20px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>Plume Nexus support</div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'none', border: 'none', fontSize: 22, color: C.muted, cursor: 'pointer', lineHeight: 1,
          }}>×</button>
        </div>

        {openTicketId ? (
          <TicketThread ticketId={openTicketId} onBack={() => setOpenTicketId(null)} />
        ) : (
          <>
            <div style={{ padding: '10px 20px', display: 'flex', gap: 4, borderBottom: `1px solid ${C.rule}` }}>
              <Tab active={tab === 'new'}  onClick={() => setTab('new')}>Submit a ticket</Tab>
              <Tab active={tab === 'mine'} onClick={() => setTab('mine')}>My tickets</Tab>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              {tab === 'new'  && <SubmitForm onSubmitted={() => setTab('mine')} />}
              {tab === 'mine' && <TicketsList onOpen={setOpenTicketId} />}
            </div>
          </>
        )}
      </div>
    </div>
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
        placeholder="What's going on? Include any error messages, screenshots are best emailed as a reply after we open a thread."
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
      No tickets yet. Use the Submit tab if you need help.
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
