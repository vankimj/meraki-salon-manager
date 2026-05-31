import { useEffect, useState } from 'react';
import {
  listOpenSupportTickets, fetchTicket, subscribeToReplies, subscribeToTicket,
  submitAdminReply, updateTicketStatus,
  fetchMyAlertContact, setMyAlertContact,
} from '../lib/tickets.js';
import { auth } from '../lib/firebase.js';
import { C, FONT, radius, shadow } from '../theme.js';

export default function TicketsQueue() {
  const [statusFilter, setStatusFilter] = useState('open');
  const [tickets,      setTickets]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [selected,     setSelected]     = useState(null); // { tenantId, ticketId }

  async function load() {
    setLoading(true); setError('');
    try {
      const data = await listOpenSupportTickets(statusFilter);
      setTickets(data);
    } catch (e) {
      setError(e?.message || 'Failed to load tickets.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [statusFilter]);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 2px', color: C.ink, letterSpacing: '-.005em' }}>Support tickets</h1>
          <div style={{ fontSize: 13, color: C.muted }}>
            {tickets ? `${tickets.length} ${statusFilter === 'all' ? '' : statusFilter} ` : 'Loading…'}
            ticket{tickets?.length === 1 ? '' : 's'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{
            padding: '8px 12px', fontSize: 13, border: `1px solid ${C.rule}`, borderRadius: 8,
            background: C.bgCard, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
          }}>
            <option value="open">Open</option>
            <option value="pending_owner">Awaiting owner</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <button onClick={load} style={{
            padding: '8px 14px', fontSize: 13, fontWeight: 600,
            background: C.bgCard, color: C.text,
            border: `1px solid ${C.rule}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
          }}>↻ Refresh</button>
        </div>
      </div>

      <AlertContactCard />

      {error && (
        <div style={{ padding: '10px 14px', marginBottom: 16, background: C.dangerSoft, border: `1px solid ${C.danger}40`, borderRadius: 8, fontSize: 13, color: '#991b1b' }}>
          {error}
        </div>
      )}

      <div style={{ background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.lg, overflow: 'hidden' }}>
        {loading ? (
          <Empty>Loading tickets…</Empty>
        ) : !tickets || tickets.length === 0 ? (
          <Empty>No tickets match this filter.</Empty>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: C.bgCode, borderBottom: `1px solid ${C.rule}` }}>
                <Th>Subject</Th>
                <Th>Tenant</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Last reply</Th>
                <Th align="right" style={{ width: 80 }}></Th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t, i) => (
                <tr key={t.tenantId + '/' + t.id} style={{
                  borderBottom: `1px solid ${C.ruleSoft}`,
                  background: i % 2 ? C.bgCode : 'transparent',
                  cursor: 'pointer',
                }} onClick={() => setSelected({ tenantId: t.tenantId, ticketId: t.id })}>
                  <Td>
                    <div style={{ fontWeight: 600, color: C.ink }}>{t.subject}</div>
                    <div style={{ fontSize: 11, color: C.mutedSoft, marginTop: 2 }}>
                      from {t.createdBy?.email || 'unknown'}
                      {t.lastReplyFrom === 'owner' && t.repliesCount > 0 && (
                        <span style={{ marginLeft: 6, color: '#1e40af', fontWeight: 600 }}>· owner replied</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div style={{ fontWeight: 600, color: C.text }}>{t.tenantName || t.tenantId}</div>
                    <code style={{ fontSize: 10, color: C.mutedSoft }}>{t.tenantId}</code>
                  </Td>
                  <Td><PriorityChip p={t.priority} /></Td>
                  <Td><StatusChip s={t.status} /></Td>
                  <Td>
                    <div style={{ fontSize: 11, color: C.muted }}>{relTime(t.lastReplyAt)}</div>
                    <div style={{ fontSize: 10, color: C.mutedSoft }}>{t.repliesCount || 0} replies</div>
                  </Td>
                  <Td align="right">
                    <span style={{ fontSize: 12, color: C.plum, fontWeight: 600 }}>Open →</span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <TicketDetail
          tenantId={selected.tenantId}
          ticketId={selected.ticketId}
          onClose={() => { setSelected(null); load(); }}
        />
      )}
    </>
  );
}

function AlertContactCard() {
  const email = auth.currentUser?.email || '';
  const [phone,      setPhone]      = useState('');
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [loaded,     setLoaded]     = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [msg,        setMsg]        = useState('');
  const [err,        setErr]        = useState('');

  useEffect(() => {
    if (!email) return;
    fetchMyAlertContact(email).then(c => {
      setPhone(c.phone || '');
      setSmsEnabled(c.smsEnabled);
      setLoaded(true);
    });
  }, [email]);

  async function save() {
    setSaving(true); setErr(''); setMsg('');
    try {
      const trimmed = phone.trim();
      const res = await setMyAlertContact(trimmed, smsEnabled);
      setMsg(trimmed ? `Saved: high-priority alerts will ${res.smsEnabled ? '' : 'NOT '}SMS ${res.phone}` : 'Cleared.');
    } catch (e) {
      setErr(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
      setTimeout(() => setMsg(''), 4500);
    }
  }

  if (!loaded) return null;

  return (
    <div style={{
      background: C.bgCard, border: `1px solid ${C.rule}`, borderRadius: radius.md,
      padding: 14, marginBottom: 16, display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap',
    }}>
      <div style={{ flex: '0 0 auto' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
          My SMS alert phone
        </div>
        <div style={{ fontSize: 11, color: C.muted, maxWidth: 360, lineHeight: 1.45 }}>
          High-priority tickets fan out via email (always) + SMS (only to admins who opted in below). E.164 format, e.g. <code style={{ background: C.bgCode, padding: '0 4px', borderRadius: 3 }}>+16145551234</code>.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="+1…"
          style={{ padding: '8px 12px', fontSize: 13, border: `1px solid ${C.rule}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none', minWidth: 180 }}
        />
        <label style={{ fontSize: 12, color: C.text, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={smsEnabled} onChange={e => setSmsEnabled(e.target.checked)} />
          Send me SMS on high-priority
        </label>
        <button onClick={save} disabled={saving} style={{
          padding: '8px 14px', fontSize: 12, fontWeight: 600,
          background: saving ? C.muted : C.plum, color: '#fff',
          border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit',
        }}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: C.success, flexBasis: '100%' }}>{msg}</div>}
      {err && <div style={{ fontSize: 11, color: C.danger,  flexBasis: '100%' }}>{err}</div>}
    </div>
  );
}

function TicketDetail({ tenantId, ticketId, onClose }) {
  const [ticket,  setTicket]  = useState(null);
  const [replies, setReplies] = useState([]);
  const [body,    setBody]    = useState('');
  const [status,  setStatus]  = useState('pending_owner');
  const [sending, setSending] = useState(false);
  const [err,     setErr]     = useState('');

  useEffect(() => {
    let statusInitialized = false;
    const unsubTicket = subscribeToTicket(tenantId, ticketId, t => {
      setTicket(t);
      if (!statusInitialized && t?.status) {
        setStatus(t.status === 'open' ? 'pending_owner' : t.status);
        statusInitialized = true;
      }
    });
    const unsubReplies = subscribeToReplies(tenantId, ticketId, setReplies);
    return () => { unsubTicket?.(); unsubReplies?.(); };
  }, [tenantId, ticketId]);

  async function send() {
    if (!body.trim()) return;
    setSending(true); setErr('');
    try {
      await submitAdminReply(tenantId, ticketId, body.trim(), status);
      setBody('');
    } catch (e) { setErr(e?.message || 'Reply failed.'); }
    finally     { setSending(false); }
  }

  async function setOnly(newStatus) {
    try {
      await updateTicketStatus(tenantId, ticketId, newStatus);
      setStatus(newStatus);
      // subscribeToTicket will reflect the update on the next snapshot.
    } catch (e) { setErr(e?.message || 'Status change failed.'); }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(15,25,35,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 999, padding: 20,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 14, maxWidth: 720, width: '100%',
        maxHeight: '90vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(0,0,0,.35)', overflow: 'hidden',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.rule}`, background: C.bgCode }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, color: C.mutedSoft, marginBottom: 2, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>
                Ticket · {ticket?.tenantName || tenantId}
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.ink }}>{ticket?.subject || 'Loading…'}</div>
              {ticket && (
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>
                  from {ticket.createdBy?.email} · created {relTime(ticket.createdAt)} · {ticket.repliesCount || 0} replies
                </div>
              )}
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, color: C.muted, cursor: 'pointer' }}>×</button>
          </div>
          {ticket && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <PriorityChip p={ticket.priority} />
              <StatusChip s={ticket.status} />
              <span style={{ flex: 1 }} />
              <button onClick={() => setOnly('resolved')} style={btnInk(ticket.status === 'resolved', C.success)}>Mark resolved</button>
              <button onClick={() => setOnly('closed')}   style={btnInk(ticket.status === 'closed',   C.muted)}>Close</button>
              <a href={`/t/${tenantId}`} style={{
                padding: '5px 11px', fontSize: 11, fontWeight: 600,
                background: 'transparent', color: C.plum,
                border: `1px solid ${C.plum}40`, borderRadius: 6, textDecoration: 'none', fontFamily: 'inherit',
              }}>Open tenant →</a>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
          {ticket && (
            <AiTriagePanel ticket={ticket} onUseDraft={() => setBody(ticket.aiSuggestedReply || '')} />
          )}
          {ticket && (
            <MessageBubble from="owner" body={ticket.initialBody} at={ticket.createdAt} authorName={ticket.createdBy?.name || ticket.createdBy?.email} />
          )}
          {replies.map(r => (
            <MessageBubble key={r.id} from={r.from} body={r.body} at={r.at} authorName={r.authorName || r.authorEmail} />
          ))}
        </div>
        <div style={{ padding: 16, borderTop: `1px solid ${C.rule}`, background: '#fff' }}>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={8000}
            rows={3}
            placeholder="Reply…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 13, border: `1px solid ${C.rule}`, borderRadius: 8, marginBottom: 8, resize: 'vertical', fontFamily: 'inherit', outline: 'none', color: C.text }}
          />
          {err && <div style={{ fontSize: 11, color: C.danger, marginBottom: 8 }}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11, color: C.mutedSoft }}>
              Sending emails the owner back at <strong>{ticket?.createdBy?.email || '…'}</strong>.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={status} onChange={e => setStatus(e.target.value)} style={{ padding: '7px 10px', fontSize: 12, border: `1px solid ${C.rule}`, borderRadius: 6, fontFamily: 'inherit', outline: 'none' }}>
                <option value="open">After reply: keep open</option>
                <option value="pending_owner">After reply: awaiting owner</option>
                <option value="resolved">After reply: mark resolved</option>
              </select>
              <button onClick={send} disabled={sending || !body.trim()} style={{
                padding: '8px 16px', fontSize: 13, fontWeight: 700,
                background: sending || !body.trim() ? C.muted : C.plum, color: '#fff',
                border: 'none', borderRadius: 8,
                cursor: sending || !body.trim() ? 'default' : 'pointer', fontFamily: 'inherit',
              }}>{sending ? 'Sending…' : 'Send reply'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// AI triage card. Renders only when the aiTriageTicket trigger has
// written its fields onto the ticket (~3-5s after submission). Shows
// summary, category, suggested priority, suggested reply, plus an
// optional "what to try first" self-service hint. The "Use as draft"
// button just fills the reply textarea — engineer can edit before send.
function AiTriagePanel({ ticket, onUseDraft }) {
  const [open, setOpen] = useState(true);

  if (!ticket.aiTriagedAt && !ticket.aiSummary) {
    // Triage not done yet — show a quiet placeholder so the engineer
    // knows it's coming. Tickets created before this feature shipped
    // won't ever populate, which is fine.
    const isRecent = ticket.createdAt && (Date.now() - new Date(ticket.createdAt).getTime() < 60_000);
    if (!isRecent) return null;
    return (
      <div style={{
        background: '#eef2ff', border: `1px solid #c7d2fe`, borderRadius: 10,
        padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#3730a3',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#6366f1' }} />
        AI triage running…
      </div>
    );
  }

  if (!ticket.aiTriagedAt) return null;

  const priorityMismatch =
    ticket.aiSuggestedPriority &&
    ticket.aiSuggestedPriority !== ticket.priority;

  return (
    <div style={{
      background: 'linear-gradient(180deg, #faf5ff 0%, #fff 100%)',
      border: `1px solid #d8b4fe`,
      borderRadius: 10, padding: 14, marginBottom: 16,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
            background: '#7c3aed', color: '#fff', textTransform: 'uppercase', letterSpacing: '.06em',
          }}>AI triage</span>
          {ticket.aiCategory && (
            <span style={{ fontSize: 11, color: '#5b3b8c', fontWeight: 600, textTransform: 'capitalize' }}>{ticket.aiCategory}</span>
          )}
          {priorityMismatch && (
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
              background: C.warningSoft, color: C.warning, textTransform: 'uppercase',
            }}>
              suggests {ticket.aiSuggestedPriority}
            </span>
          )}
        </div>
        <span style={{ fontSize: 16, color: C.mutedSoft }}>{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          {ticket.aiSummary && (
            <div style={{ fontSize: 12, color: C.text, fontWeight: 600, marginBottom: 8, lineHeight: 1.5 }}>
              {ticket.aiSummary}
            </div>
          )}
          {ticket.aiSelfServiceHint && (
            <div style={{
              background: '#fef9c3', border: '1px solid #fde047', borderRadius: 6,
              padding: '6px 10px', fontSize: 11, color: '#854d0e', lineHeight: 1.5,
              marginBottom: 10,
            }}>
              <strong style={{ textTransform: 'uppercase', letterSpacing: '.04em', fontSize: 9 }}>Try first:</strong>{' '}
              {ticket.aiSelfServiceHint}
            </div>
          )}
          {ticket.aiSuggestedReply && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.mutedSoft, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
                Suggested reply
              </div>
              <div style={{
                background: '#fff', border: `1px dashed ${C.rule}`, borderRadius: 8,
                padding: '8px 12px', fontSize: 12, color: C.text, lineHeight: 1.6,
                whiteSpace: 'pre-wrap', marginBottom: 8,
              }}>
                {ticket.aiSuggestedReply}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: C.mutedSoft }}>
                <button onClick={onUseDraft} style={{
                  padding: '5px 11px', fontSize: 11, fontWeight: 600,
                  background: '#7c3aed', color: '#fff', border: 'none', borderRadius: 6,
                  cursor: 'pointer', fontFamily: 'inherit',
                }}>Use as draft →</button>
                <span>Edit before sending.</span>
                <span style={{ flex: 1 }} />
                <span>Triaged {relTime(ticket.aiTriagedAt)}</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ from, body, at, authorName }) {
  const isOwner = from === 'owner';
  return (
    <div style={{ marginBottom: 14, display: 'flex', flexDirection: 'column', alignItems: isOwner ? 'flex-start' : 'flex-end' }}>
      <div style={{
        maxWidth: '85%', padding: '10px 14px', borderRadius: 12,
        background: isOwner ? C.ruleSoft : C.plum,
        color: isOwner ? C.ink : '#fff',
        fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap',
      }}>{body}</div>
      <div style={{ fontSize: 10, color: C.mutedSoft, marginTop: 4 }}>
        {isOwner ? (authorName || 'Owner') : 'You'} · {relTime(at)}
      </div>
    </div>
  );
}

function PriorityChip({ p }) {
  const isHigh = p === 'high';
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: isHigh ? C.dangerSoft : C.ruleSoft,
      color:      isHigh ? C.danger     : C.muted,
      textTransform: 'uppercase', letterSpacing: '.05em',
    }}>{isHigh ? 'High' : 'Low'}</span>
  );
}

function StatusChip({ s }) {
  const meta = {
    open:          { label: 'Open',          bg: C.warningSoft, color: C.warning },
    pending_owner: { label: 'Awaiting owner', bg: '#eff6ff',    color: '#1e40af' },
    resolved:      { label: 'Resolved',      bg: C.successSoft, color: C.success },
    closed:        { label: 'Closed',        bg: C.ruleSoft,    color: C.muted },
  }[s] || { label: s || '—', bg: C.ruleSoft, color: C.muted };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: meta.bg, color: meta.color,
      textTransform: 'uppercase', letterSpacing: '.05em',
    }}>{meta.label}</span>
  );
}

function btnInk(active, color) {
  return {
    padding: '5px 11px', fontSize: 11, fontWeight: 600,
    background: active ? color : 'transparent', color: active ? '#fff' : color,
    border: `1px solid ${color}40`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
  };
}

function relTime(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)     return 'just now';
  if (ms < 3_600_000)  return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.round(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Th({ children, align = 'left', style = {} }) {
  return <th style={{ textAlign: align, padding: '10px 14px', fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em', ...style }}>{children}</th>;
}
function Td({ children, align = 'left' }) {
  return <td style={{ padding: '10px 14px', textAlign: align, verticalAlign: 'middle' }}>{children}</td>;
}
function Empty({ children }) {
  return <div style={{ padding: '40px 20px', textAlign: 'center', color: C.muted, fontSize: 13 }}>{children}</div>;
}
