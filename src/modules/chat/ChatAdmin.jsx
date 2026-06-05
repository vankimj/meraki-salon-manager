import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { subscribeToChats, subscribeToChat, sendChatMessage, sendSmsToClient, sendEmailToClient, markChatRead, fetchClients } from '../../lib/firestore';

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7)  return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function ChatAdmin() {
  const { gUser } = useApp();
  const [threads, setThreads] = useState(null);
  const [active,  setActive]  = useState(null);
  const [composing, setComposing] = useState(false);

  useEffect(() => subscribeToChats(setThreads), []);

  const totalUnread = (threads || []).reduce((s, t) => s + (t.unreadStaff || 0), 0);
  const senderName = gUser?.displayName?.split(' ')[0] || gUser?.email?.split('@')[0] || 'Staff';

  if (active) {
    const thread = threads?.find(t => t.clientId === active);
    return (
      <ThreadView
        thread={thread}
        clientId={active}
        senderName={senderName}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Client Messages
        </div>
        {totalUnread > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: '#3D95CE', color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
            {totalUnread}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <button onClick={() => setComposing(true)}
          style={{ fontSize: 12, padding: '6px 12px', borderRadius: 8, border: 'none', background: '#2D7A5F', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          + New conversation
        </button>
      </div>

      {composing && (
        <ComposeModal
          senderName={senderName}
          onClose={() => setComposing(false)}
          onSent={(clientId) => { setComposing(false); setActive(clientId); }}
        />
      )}

      {threads === null ? (
        <div style={{ textAlign: 'center', padding: 48, color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>
      ) : threads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
          <div style={{ fontSize: 13, color: 'var(--pn-text-faint)' }}>No messages yet.</div>
          <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 4 }}>Clients can send messages from their portal.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {threads.map(t => (
            <ThreadRow key={t.clientId} thread={t} onClick={() => setActive(t.clientId)} />
          ))}
        </div>
      )}
    </div>
  );
}

function ThreadRow({ thread, onClick }) {
  const unread = thread.unreadStaff || 0;
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
      background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12,
      cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit', width: '100%',
    }}>
      <div style={{
        width: 42, height: 42, borderRadius: '50%', flexShrink: 0,
        background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: 14, fontWeight: 700,
      }}>
        {initials(thread.clientName)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: unread ? 700 : 600, color: 'var(--pn-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {thread.clientName}
          </span>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flexShrink: 0, marginLeft: 8 }}>
            {fmtTime(thread.lastAt)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: unread ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: unread ? 600 : 400 }}>
          {thread.lastMessage || 'No messages yet'}
        </div>
      </div>
      {unread > 0 && (
        <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#3D95CE', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          {unread > 9 ? '9+' : unread}
        </div>
      )}
    </button>
  );
}

function ThreadView({ thread: initialThread, clientId, senderName, onBack }) {
  const [thread,  setThread]  = useState(initialThread || null);
  const [text,    setText]    = useState('');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  // Channel selector — in-app | sms | email. We don't auto-default to a channel
  // because each has different fields visible (email needs subject, etc.).
  const [channel, setChannel] = useState('app');
  const [sendError, setSendError] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    const unsub = subscribeToChat(clientId, t => {
      setThread(t);
    });
    markChatRead(clientId).catch(() => {});
    return unsub;
  }, [clientId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    if (channel === 'email' && !subject.trim()) {
      setSendError('Subject is required for email.');
      return;
    }
    setSending(true);
    setSendError('');
    const previous = text;
    setText('');
    try {
      if (channel === 'sms') {
        await sendSmsToClient(clientId, trimmed);
      } else if (channel === 'email') {
        await sendEmailToClient(clientId, subject.trim(), trimmed);
        setSubject(''); // reset for next email
      } else {
        const msg = {
          text:       trimmed,
          from:       'staff',
          channel:    'app',
          senderName: senderName,
          sentAt:     new Date().toISOString(),
        };
        await sendChatMessage(clientId, {
          name:  thread?.clientName  || '',
          email: thread?.clientEmail || '',
        }, msg);
      }
    } catch (e) {
      setSendError(e?.message || 'Send failed');
      setText(previous); // restore so user can fix + retry
    } finally {
      setSending(false);
    }
  }

  const messages = thread?.messages || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100dvh - 84px)' }}>
      {/* Thread header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 12px', borderBottom: '1px solid var(--pn-border)', marginBottom: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3D95CE', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          ‹ Back
        </button>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {initials(thread?.clientName || '?')}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{thread?.clientName || 'Client'}</div>
          {thread?.clientEmail && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{thread.clientEmail}</div>}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: 'var(--pn-text-faint)', fontSize: 13 }}>No messages yet.</div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} isStaff={m.from === 'staff'} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ paddingTop: 10, borderTop: '1px solid var(--pn-border)', flexShrink: 0 }}>
        {/* Channel selector — buttons disable when contact info isn't on file */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
          <button onClick={() => setChannel('app')}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'app' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'app' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'app' ? '#2D7A5F' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            💬 In-app chat
          </button>
          <button onClick={() => setChannel('sms')} disabled={!thread?.clientPhone}
            title={thread?.clientPhone ? `Sends an SMS to ${thread.clientPhone}` : 'No phone on file'}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'sms' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'sms' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'sms' ? '#2D7A5F' : (thread?.clientPhone ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)'), cursor: thread?.clientPhone ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>
            📱 SMS
          </button>
          <button onClick={() => setChannel('email')} disabled={!thread?.clientEmail}
            title={thread?.clientEmail ? `Sends an email to ${thread.clientEmail}` : 'No email on file'}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'email' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'email' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'email' ? '#2D7A5F' : (thread?.clientEmail ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)'), cursor: thread?.clientEmail ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>
            ✉️ Email
          </button>
        </div>
        {channel === 'email' && (
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject"
            style={{ width: '100%', fontFamily: 'inherit', border: '1.5px solid var(--pn-border)', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', background: 'var(--pn-surface)', marginBottom: 6, boxSizing: 'border-box' }}
          />
        )}
        {sendError && (
          <div style={{ fontSize: 11, color: 'var(--pn-danger)', marginBottom: 6, padding: '4px 8px', background: 'var(--pn-danger-bg)', borderRadius: 6, border: '1px solid #fca5a5' }}>{sendError}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={channel === 'sms' ? 'Send SMS to client…' : channel === 'email' ? 'Email body…' : 'Reply to client…'}
            style={{ flex: 1, fontFamily: 'inherit', border: '1.5px solid var(--pn-border)', borderRadius: 22, padding: '9px 16px', fontSize: 13, outline: 'none', background: 'var(--pn-surface-alt)' }}
          />
          <button onClick={handleSend} disabled={!text.trim() || sending}
            style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: text.trim() && !sending ? '#2D7A5F' : 'var(--pn-surface-alt)', color: '#fff', fontSize: 18, cursor: text.trim() && !sending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'inherit' }}>
            ↑
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, isStaff }) {
  const channel = msg.channel || 'app';
  const isSms = channel === 'sms';
  const isEmail = channel === 'email';
  const channelBadge = isSms ? '📱 SMS' : isEmail ? '✉️ Email' : null;
  // Color-code the staff-side bubble per channel so the medium is obvious
  // at a glance: green = in-app, blue = SMS, purple = email.
  const staffBg = isSms ? '#1d4ed8' : isEmail ? '#7c3aed' : '#2D7A5F';
  const bubbleStyle = {
    maxWidth: '75%',
    background: isStaff ? staffBg : 'var(--pn-surface-alt)',
    color:      isStaff ? '#fff' : 'var(--pn-text)',
    borderRadius: isStaff ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    padding: '9px 14px',
  };
  return (
    <div style={{ display: 'flex', justifyContent: isStaff ? 'flex-end' : 'flex-start' }}>
      <div style={bubbleStyle}>
        {(channelBadge || (!isStaff && msg.senderName)) && (
          <div style={{ fontSize: 10, fontWeight: 700, color: isStaff ? 'rgba(255,255,255,.7)' : 'var(--pn-text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isStaff && msg.senderName && <span>{msg.senderName}</span>}
            {channelBadge && <span>{channelBadge}</span>}
          </div>
        )}
        {isEmail && msg.subject && (
          <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, opacity: .9 }}>{msg.subject}</div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
        <div style={{ fontSize: 10, color: isStaff ? 'rgba(255,255,255,.6)' : 'var(--pn-text-faint)', marginTop: 4, textAlign: isStaff ? 'right' : 'left', display: 'flex', justifyContent: isStaff ? 'flex-end' : 'flex-start', gap: 6 }}>
          <span>{fmtTime(msg.sentAt || msg.at)}</span>
          {isSms && msg.twilioStatus && msg.twilioStatus !== 'sent' && msg.twilioStatus !== 'delivered' && msg.twilioStatus !== 'queued' && (
            <span style={{ color: '#fca5a5' }}>· {msg.twilioStatus}</span>
          )}
          {isSms && msg.twilioError && (
            <span style={{ color: '#fca5a5' }}>· error</span>
          )}
          {isEmail && msg.providerError && (
            <span style={{ color: '#fca5a5' }}>· error</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Compose new conversation ──────────────────────────────────────────────
// Modal for staff-initiated outreach. Pick a client (search), pick a channel
// (the buttons disable when contact info is missing for that channel), type
// + send. After successful send, parent navigates into the freshly-created
// thread so staff can keep going.
function ComposeModal({ senderName, onClose, onSent }) {
  const [allClients, setAllClients] = useState(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState(null);
  const [channel, setChannel] = useState('sms');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { fetchClients().then(setAllClients).catch(() => setAllClients([])); }, []);

  // Default channel based on what the picked client has on file: prefer SMS
  // when both phone + email exist, fall back to whichever is available.
  useEffect(() => {
    if (!picked) return;
    if (picked.phone && (channel === 'app' || (channel === 'email' && !picked.email))) setChannel('sms');
    else if (!picked.phone && picked.email) setChannel('email');
  }, [picked]); // eslint-disable-line

  const filtered = !allClients ? [] : (search.trim()
    ? allClients.filter(c => {
        const q = search.toLowerCase();
        return (c.name || '').toLowerCase().includes(q)
            || (c.phone || '').toLowerCase().includes(q)
            || (c.email || '').toLowerCase().includes(q);
      }).slice(0, 30)
    : allClients.slice(0, 30));

  const canSend = !!picked && !!body.trim() && !sending && (channel !== 'email' || subject.trim()) &&
    (channel === 'sms' ? !!picked.phone : channel === 'email' ? !!picked.email : true);

  async function send() {
    if (!canSend) return;
    setSending(true); setError('');
    try {
      if (channel === 'sms') {
        await sendSmsToClient(picked.id, body.trim());
      } else if (channel === 'email') {
        await sendEmailToClient(picked.id, subject.trim(), body.trim());
      } else {
        await sendChatMessage(picked.id, { name: picked.name, email: picked.email || '' }, {
          text: body.trim(), from: 'staff', channel: 'app',
          senderName, sentAt: new Date().toISOString(),
        });
      }
      onSent && onSent(picked.id);
    } catch (e) {
      setError(e?.message || 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 14, padding: 18, width: '100%', maxWidth: 480, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>New conversation</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 14 }}>×</button>
        </div>

        {!picked ? (
          <>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search clients by name, phone, or email…" autoFocus
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1.5px solid var(--pn-border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, outline: 'none', marginBottom: 10 }} />
            <div style={{ overflowY: 'auto', flex: 1, border: '1px solid var(--pn-border)', borderRadius: 10 }}>
              {allClients === null ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 12 }}>Loading…</div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 20, textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 12 }}>No clients match "{search}"</div>
              ) : filtered.map(c => (
                <div key={c.id} onClick={() => setPicked(c)}
                  style={{ padding: '10px 12px', borderBottom: '1px solid var(--pn-border)', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 1 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--pn-surface-muted)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{c.name || '(no name)'}</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'flex', gap: 10 }}>
                    {c.phone && <span>📱 {c.phone}</span>}
                    {c.email && <span>✉️ {c.email}</span>}
                    {!c.phone && !c.email && <span style={{ color: 'var(--pn-text-faint)' }}>no contact info</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ background: 'var(--pn-surface-alt)', borderRadius: 10, padding: '8px 12px', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{picked.name}</div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
                  {channel === 'sms' && picked.phone}
                  {channel === 'email' && picked.email}
                  {channel === 'app' && 'In-app chat'}
                </div>
              </div>
              <button onClick={() => setPicked(null)} style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Change</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
              <button onClick={() => setChannel('sms')} disabled={!picked.phone}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'sms' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'sms' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'sms' ? '#2D7A5F' : (picked.phone ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)'), cursor: picked.phone ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>📱 SMS</button>
              <button onClick={() => setChannel('email')} disabled={!picked.email}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'email' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'email' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'email' ? '#2D7A5F' : (picked.email ? 'var(--pn-text-muted)' : 'var(--pn-text-faint)'), cursor: picked.email ? 'pointer' : 'not-allowed', fontFamily: 'inherit', fontWeight: 600 }}>✉️ Email</button>
              <button onClick={() => setChannel('app')}
                style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'app' ? '#2D7A5F' : 'var(--pn-border-strong)'}`, background: channel === 'app' ? '#f0faf6' : 'var(--pn-surface-alt)', color: channel === 'app' ? '#2D7A5F' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>💬 In-app</button>
            </div>
            {channel === 'email' && (
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject"
                style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1.5px solid var(--pn-border)', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', marginBottom: 8 }} />
            )}
            <textarea value={body} onChange={e => setBody(e.target.value)}
              placeholder={channel === 'sms' ? `Send an SMS to ${picked.name}…` : channel === 'email' ? `Email body…` : `Message ${picked.name}…`}
              rows={5}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', border: '1.5px solid var(--pn-border)', borderRadius: 10, padding: '10px 14px', fontSize: 13, outline: 'none', resize: 'vertical', lineHeight: 1.5 }} />
            {error && <div style={{ fontSize: 11, color: 'var(--pn-danger)', marginTop: 6, padding: '4px 8px', background: 'var(--pn-danger-bg)', borderRadius: 6 }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
              <button onClick={send} disabled={!canSend}
                style={{ flex: 2, padding: '10px', borderRadius: 10, border: 'none', background: canSend ? '#2D7A5F' : 'var(--pn-surface-alt)', color: '#fff', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, cursor: canSend ? 'pointer' : 'default' }}>
                {sending ? 'Sending…' : `Send ${channel === 'sms' ? 'SMS' : channel === 'email' ? 'email' : 'message'}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
