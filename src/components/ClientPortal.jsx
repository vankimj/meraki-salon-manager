import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { fetchClient, saveClient, fetchClientAppointments, subscribeToChat, sendChatMessage } from '../lib/firestore';
import { resizeImg } from '../utils/helpers';

function fmtDate(str) {
  if (!str) return '—';
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h > 12 ? h - 12 : h === 0 ? 12 : h}:${String(m).padStart(2,'0')} ${ampm}`;
}

export default function ClientPortal() {
  const { gUser, portalClientId, signOut, showToast, settings } = useApp();
  const salonName = settings?.salonName || 'Plume Nexus';
  const [tab,      setTab]      = useState('upcoming');
  const [client,   setClient]   = useState(null);
  const [appts,    setAppts]    = useState(null);
  const [editing,  setEditing]  = useState(false);
  const [draft,    setDraft]    = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [chat,     setChat]     = useState(null);
  const fileRef = useRef(null);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetchClient(portalClientId).then(c => { setClient(c); setDraft(c); }).catch(() => {});
    fetchClientAppointments(portalClientId).then(setAppts).catch(() => setAppts([]));
    const unsub = subscribeToChat(portalClientId, setChat);
    return unsub;
  }, [portalClientId]); // eslint-disable-line

  const upcoming = (appts || []).filter(a => a.date >= today && a.status !== 'done').sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
  const past     = (appts || []).filter(a => a.date < today || a.status === 'done').sort((a, b) => b.date.localeCompare(a.date));

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const img = await resizeImg(file, 300, 300, 0.82);
      setDraft(d => ({ ...d, picture: img }));
    } catch { showToast('Could not process photo', 3000); }
  }

  async function handleSave() {
    if (!draft.name?.trim()) return;
    setSaving(true);
    try {
      const { id, createdAt, ...data } = draft;
      await saveClient(id, { ...data, name: draft.name.trim(), phone: draft.phone?.trim() || null, birthday: draft.birthday || null });
      setClient({ ...draft, name: draft.name.trim() });
      setEditing(false);
      showToast('Profile updated');
    } catch { showToast('Save failed', 3000); }
    finally  { setSaving(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: '100dvh', background: '#f8f9fa' }}>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #ebebeb', padding: '0 16px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#2D7A5F,#4A7DB5)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg viewBox="0 0 60 60" fill="none" width={16} height={16}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a', lineHeight: 1.2 }}>{salonName}</div>
            <div style={{ fontSize: 10, color: '#aaa' }}>My Account</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {gUser?.photoURL && <img src={gUser.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }} />}
          <button onClick={signOut} style={{ fontSize: 12, color: '#888', background: 'none', border: '1px solid #e0e0e0', borderRadius: 8, padding: '5px 12px', cursor: 'pointer', fontFamily: 'inherit' }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Welcome banner */}
      {client && (
        <div style={{ background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', padding: '20px 20px 16px', color: '#fff', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {client.picture
              ? <img src={client.picture} alt="" style={{ width: 54, height: 54, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,.4)', flexShrink: 0 }} />
              : <div style={{ width: 54, height: 54, borderRadius: '50%', background: 'rgba(255,255,255,.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>💅</div>
            }
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>Hi, {client.name?.split(' ')[0] || 'there'}!</div>
              <div style={{ fontSize: 12, opacity: .8, marginTop: 2 }}>Welcome back to {salonName}</div>
              {(client.credit || 0) > 0 && (
                <div style={{ fontSize: 11, marginTop: 4, background: 'rgba(255,255,255,.2)', borderRadius: 8, padding: '3px 10px', display: 'inline-block' }}>
                  💳 ${Number(client.credit).toFixed(2)} store credit
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid #e8e8e8', flexShrink: 0 }}>
        {[
          { id: 'upcoming', label: `Upcoming${upcoming.length ? ` (${upcoming.length})` : ''}` },
          { id: 'history',  label: `History${past.length ? ` (${past.length})` : ''}` },
          { id: 'messages', label: 'Messages' },
          { id: 'profile',  label: 'Profile' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{ flex: 1, padding: '11px 0', fontSize: 12, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#3D95CE' : '#888', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #3D95CE' : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>

        {/* Upcoming */}
        {tab === 'upcoming' && (
          <>
            {appts === null
              ? <Loading />
              : upcoming.length === 0
                ? <Empty>No upcoming appointments. Give us a call to book! 💅</Empty>
                : upcoming.map(a => <ApptCard key={a.id} appt={a} />)
            }
          </>
        )}

        {/* History */}
        {tab === 'history' && (
          <>
            {appts === null
              ? <Loading />
              : past.length === 0
                ? <Empty>No visit history yet.</Empty>
                : past.map(a => <ApptCard key={a.id} appt={a} past />)
            }
          </>
        )}

        {/* Messages */}
        {tab === 'messages' && (
          <ClientChatView
            clientId={portalClientId}
            clientName={client?.name || gUser?.displayName || 'Me'}
            clientEmail={client?.email || gUser?.email || ''}
            chat={chat}
          />
        )}

        {/* Profile */}
        {tab === 'profile' && draft && (
          <div style={{ maxWidth: 460, margin: '0 auto' }}>
            {/* Photo */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div style={{ position: 'relative' }}>
                <div
                  onClick={editing ? () => fileRef.current?.click() : undefined}
                  style={{ width: 88, height: 88, borderRadius: '50%', overflow: 'hidden', background: '#e8e8e8', border: '3px solid #e0e0e0', cursor: editing ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {draft.picture
                    ? <img src={draft.picture} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ fontSize: 36 }}>💅</span>
                  }
                </div>
                {editing && (
                  <div onClick={() => fileRef.current?.click()} style={{ position: 'absolute', bottom: 0, right: 0, width: 26, height: 26, borderRadius: '50%', background: '#3D95CE', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 12, border: '2px solid #fff' }}>✎</div>
                )}
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" style={{ display: 'none' }} onChange={handlePhoto} />
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              {[
                { label: 'Name',     key: 'name',     type: 'text',  placeholder: 'Your name' },
                { label: 'Phone',    key: 'phone',    type: 'tel',   placeholder: '(555) 000-0000' },
                { label: 'Birthday', key: 'birthday', type: 'date',  placeholder: '' },
              ].map(({ label, key, type, placeholder }, i, arr) => (
                <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ width: 80, fontSize: 12, color: '#aaa', fontWeight: 600, flexShrink: 0 }}>{label}</div>
                  {editing
                    ? <input type={type} value={draft[key] || ''} onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))} placeholder={placeholder}
                        style={{ flex: 1, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '6px 10px', fontSize: 13, outline: 'none', background: '#fafafa' }} />
                    : <span style={{ fontSize: 13, color: draft[key] ? '#1a1a1a' : '#ccc' }}>
                        {key === 'birthday' && draft[key] ? fmtDate(draft[key]) : (draft[key] || '—')}
                      </span>
                  }
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px' }}>
                <div style={{ width: 80, fontSize: 12, color: '#aaa', fontWeight: 600, flexShrink: 0 }}>Email</div>
                <span style={{ fontSize: 13, color: '#888' }}>{draft.email || gUser?.email || '—'}</span>
              </div>
            </div>

            {editing ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setDraft(client); setEditing(false); }}
                  style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #d0d0d0', background: '#fff', fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', color: '#555' }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving || !draft.name?.trim()}
                  style={{ flex: 2, padding: '11px', borderRadius: 10, border: 'none', background: saving || !draft.name?.trim() ? '#d0d0d0' : '#2D7A5F', color: '#fff', fontSize: 14, fontWeight: 600, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            ) : (
              <button onClick={() => setEditing(true)}
                style={{ width: '100%', padding: '11px', borderRadius: 10, border: '1.5px solid #3D95CE', background: '#fff', color: '#3D95CE', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                Edit Profile
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

function ApptCard({ appt, past }) {
  const services = (appt.services || []).map(s => s.name).filter(Boolean).join(', ') || 'Nail services';
  const total    = appt.payment?.total;
  return (
    <div style={{ background: '#fff', border: `1px solid ${past ? '#e8e8e8' : '#c7dff7'}`, borderRadius: 12, padding: '14px 16px', marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{fmtDate(appt.date)}</div>
          {appt.startTime && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{fmtTime(appt.startTime)}</div>}
        </div>
        {!past && (
          <span style={{ fontSize: 10, background: '#e8f4ee', color: '#2D7A5F', borderRadius: 10, padding: '3px 9px', fontWeight: 600 }}>Upcoming</span>
        )}
        {past && total != null && (
          <span style={{ fontSize: 13, fontWeight: 700, color: '#2D7A5F' }}>${Number(total).toFixed(2)}</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#555', marginBottom: 4 }}>💅 {services}</div>
      <div style={{ fontSize: 11, color: '#aaa' }}>👩‍💼 {appt.techName || '—'}</div>
    </div>
  );
}

function Loading() {
  return <div style={{ textAlign: 'center', padding: 48, color: '#bbb', fontSize: 13 }}>Loading…</div>;
}

function Empty({ children }) {
  return <div style={{ textAlign: 'center', padding: 48, color: '#bbb', fontSize: 13 }}>{children}</div>;
}

function fmtMsgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now - d) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ClientChatView({ clientId, clientName, clientEmail, chat }) {
  const [text,    setText]    = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const messages  = chat?.messages || [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setText('');
    await sendChatMessage(clientId, { name: clientName, email: clientEmail }, {
      text:       trimmed,
      from:       'client',
      senderName: clientName,
      sentAt:     new Date().toISOString(),
    }).catch(() => {});
    setSending(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 480, margin: '0 auto', width: '100%', height: 'calc(100dvh - 220px)', minHeight: 300 }}>
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 13, color: '#aaa' }}>Send us a message!</div>
            <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>We'll reply as soon as we can.</div>
          </div>
        )}
        {messages.map((m, i) => {
          const isMe = m.from === 'client';
          return (
            <div key={i} style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start' }}>
              <div style={{
                maxWidth: '78%',
                background: isMe ? '#2D7A5F' : '#f0f0f0',
                color:      isMe ? '#fff'    : '#1a1a1a',
                borderRadius: isMe ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                padding: '9px 14px',
              }}>
                {!isMe && (
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    {m.senderName || salonName}
                  </div>
                )}
                <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
                <div style={{ fontSize: 10, color: isMe ? 'rgba(255,255,255,.6)' : '#bbb', marginTop: 4, textAlign: isMe ? 'right' : 'left' }}>
                  {fmtMsgTime(m.sentAt)}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ display: 'flex', gap: 8, paddingTop: 10, borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
          placeholder={`Message ${salonName}…`}
          style={{ flex: 1, fontFamily: 'inherit', border: '1.5px solid #e0e0e0', borderRadius: 22, padding: '9px 16px', fontSize: 13, outline: 'none', background: '#fafafa' }}
        />
        <button onClick={handleSend} disabled={!text.trim() || sending}
          style={{ width: 42, height: 42, borderRadius: '50%', border: 'none', background: text.trim() && !sending ? '#2D7A5F' : '#e0e0e0', color: '#fff', fontSize: 18, cursor: text.trim() && !sending ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          ↑
        </button>
      </div>
    </div>
  );
}
