import { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { subscribeToChats, subscribeToChat, sendChatMessage, sendSmsToClient, markChatRead } from '../../lib/firestore';

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

  useEffect(() => subscribeToChats(setThreads), []);

  const totalUnread = (threads || []).reduce((s, t) => s + (t.unreadStaff || 0), 0);

  if (active) {
    const thread = threads?.find(t => t.clientId === active);
    return (
      <ThreadView
        thread={thread}
        clientId={active}
        senderName={gUser?.displayName?.split(' ')[0] || gUser?.email?.split('@')[0] || 'Staff'}
        onBack={() => setActive(null)}
      />
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', letterSpacing: '.06em', textTransform: 'uppercase' }}>
          Client Messages
        </div>
        {totalUnread > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, background: '#3D95CE', color: '#fff', borderRadius: 10, padding: '1px 7px' }}>
            {totalUnread}
          </span>
        )}
      </div>

      {threads === null ? (
        <div style={{ textAlign: 'center', padding: 48, color: '#bbb', fontSize: 13 }}>Loading…</div>
      ) : threads.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>💬</div>
          <div style={{ fontSize: 13, color: '#aaa' }}>No messages yet.</div>
          <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>Clients can send messages from their portal.</div>
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
      background: '#fff', border: '1px solid #f0f0f0', borderRadius: 12,
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
          <span style={{ fontSize: 13, fontWeight: unread ? 700 : 600, color: '#1a1a1a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
            {thread.clientName}
          </span>
          <span style={{ fontSize: 11, color: '#bbb', flexShrink: 0, marginLeft: 8 }}>
            {fmtTime(thread.lastAt)}
          </span>
        </div>
        <div style={{ fontSize: 12, color: unread ? '#555' : '#aaa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: unread ? 600 : 400 }}>
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
  const [sending, setSending] = useState(false);
  // Channel selector — defaults to 'sms' if the client has a phone, else 'app'.
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
    setSending(true);
    setSendError('');
    const previous = text;
    setText('');
    try {
      if (channel === 'sms') {
        await sendSmsToClient(clientId, trimmed);
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 0 12px', borderBottom: '1px solid #f0f0f0', marginBottom: 12, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3D95CE', fontSize: 13, fontWeight: 500, fontFamily: 'inherit', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
          ‹ Back
        </button>
        <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
          {initials(thread?.clientName || '?')}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{thread?.clientName || 'Client'}</div>
          {thread?.clientEmail && <div style={{ fontSize: 11, color: '#aaa' }}>{thread.clientEmail}</div>}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 32, color: '#bbb', fontSize: 13 }}>No messages yet.</div>
        )}
        {messages.map((m, i) => (
          <MessageBubble key={i} msg={m} isStaff={m.from === 'staff'} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ paddingTop: 10, borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
        {/* Channel selector — only show SMS option when client has a phone */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={() => setChannel('app')}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'app' ? '#2D7A5F' : '#d8d8d8'}`, background: channel === 'app' ? '#f0faf6' : '#fafafa', color: channel === 'app' ? '#2D7A5F' : '#666', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            💬 In-app chat
          </button>
          <button onClick={() => setChannel('sms')} disabled={!thread?.clientPhone && !thread?.clientPhone}
            title={thread?.clientPhone ? `Sends an SMS to ${thread.clientPhone}` : 'No phone on file'}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 14, border: `1px solid ${channel === 'sms' ? '#2D7A5F' : '#d8d8d8'}`, background: channel === 'sms' ? '#f0faf6' : '#fafafa', color: channel === 'sms' ? '#2D7A5F' : '#666', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            📱 SMS
          </button>
        </div>
        {sendError && (
          <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 6, padding: '4px 8px', background: '#fef2f2', borderRadius: 6, border: '1px solid #fca5a5' }}>{sendError}</div>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder={channel === 'sms' ? 'Send SMS to client…' : 'Reply to client…'}
            style={{ flex: 1, fontFamily: 'inherit', border: '1.5px solid #e0e0e0', borderRadius: 22, padding: '9px 16px', fontSize: 13, outline: 'none', background: '#fafafa' }}
          />
          <button onClick={handleSend} disabled={!text.trim() || sending}
            style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: text.trim() && !sending ? '#2D7A5F' : '#e0e0e0', color: '#fff', fontSize: 18, cursor: text.trim() && !sending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontFamily: 'inherit' }}>
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
  const channelBadge = isSms ? '📱 SMS' : channel === 'email' ? '✉️ Email' : null;
  // SMS bubbles get a slightly different look (dotted border) to make the
  // channel obvious at a glance even without reading the badge.
  const bubbleStyle = {
    maxWidth: '75%',
    background: isStaff ? (isSms ? '#1d4ed8' : '#2D7A5F') : '#f0f0f0',
    color:      isStaff ? '#fff' : '#1a1a1a',
    borderRadius: isStaff ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
    padding: '9px 14px',
  };
  return (
    <div style={{ display: 'flex', justifyContent: isStaff ? 'flex-end' : 'flex-start' }}>
      <div style={bubbleStyle}>
        {(channelBadge || (!isStaff && msg.senderName)) && (
          <div style={{ fontSize: 10, fontWeight: 700, color: isStaff ? 'rgba(255,255,255,.7)' : '#888', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!isStaff && msg.senderName && <span>{msg.senderName}</span>}
            {channelBadge && <span>{channelBadge}</span>}
          </div>
        )}
        <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{msg.text}</div>
        <div style={{ fontSize: 10, color: isStaff ? 'rgba(255,255,255,.6)' : '#bbb', marginTop: 4, textAlign: isStaff ? 'right' : 'left', display: 'flex', justifyContent: isStaff ? 'flex-end' : 'flex-start', gap: 6 }}>
          <span>{fmtTime(msg.sentAt || msg.at)}</span>
          {isSms && msg.twilioStatus && msg.twilioStatus !== 'sent' && msg.twilioStatus !== 'delivered' && msg.twilioStatus !== 'queued' && (
            <span style={{ color: '#fca5a5' }}>· {msg.twilioStatus}</span>
          )}
          {isSms && msg.twilioError && (
            <span style={{ color: '#fca5a5' }}>· error</span>
          )}
        </div>
      </div>
    </div>
  );
}
