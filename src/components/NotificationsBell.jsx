import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { IconBell, IconMessage } from './Icons';

function relativeTime(iso) {
  if (!iso) return '';
  const ms  = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1)   return 'just now';
  if (min < 60)  return `${min}m ago`;
  const hr  = Math.floor(min / 60);
  if (hr < 24)   return `${hr}h ago`;
  const d   = Math.floor(hr / 24);
  if (d < 7)     return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtTimeForNotif(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  if (Number.isNaN(h)) return str;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtDateForNotif(str) {
  if (!str) return '';
  try {
    return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return str; }
}
function apptDetail(n) {
  // Pre-built message wins (set by notifyAffectedTechs); fall back to
  // composing from the structured fields if it's missing.
  if (n.message) return n.message;
  const who   = n.clientName || 'a walk-in';
  const when  = [fmtDateForNotif(n.date), fmtTimeForNotif(n.startTime)].filter(Boolean).join(' at ');
  const tech  = n.techName ? ` with ${n.techName}` : '';
  return `${who}${tech}${when ? ` · ${when}` : ''}`;
}

function formatNotif(n) {
  switch (n.changeType) {
    case 'handbook_reminder':
      return { title: 'Handbook reminder', body: `${n.techName || 'A tech'} needs to sign ${n.handbookTitle || 'the handbook'}` };
    case 'access_request':
      return { title: 'New access request', body: n.email || n.name || '' };
    case 'feedback':
      return { title: 'New feedback', body: n.summary || n.body || '' };
    case 'online_booking':
      return { title: 'New online booking', body: `${n.clientName || 'Guest'} — ${n.serviceName || ''}`.trim() };
    case 'review_received':
      return { title: 'New review', body: n.author ? `From ${n.author}` : '' };
    case 'appt_added':    return { title: 'New appointment',       body: apptDetail(n) };
    case 'appt_modified': return { title: 'Appointment updated',   body: apptDetail(n) };
    case 'appt_assigned': return { title: 'Appointment assigned',  body: apptDetail(n) };
    case 'appt_removed':  return { title: 'Appointment reassigned', body: apptDetail(n) };
    default: {
      if (n.title || n.body || n.message) return { title: n.title || 'Notification', body: n.body || n.message || '' };
      const fallback = (n.changeType || 'Update').replace(/_/g, ' ');
      return { title: fallback.charAt(0).toUpperCase() + fallback.slice(1), body: '' };
    }
  }
}

export default function NotificationsBell() {
  const { gUser, recentNotifs, totalChatUnread, markNotifRead } = useApp();
  const [open, setOpen] = useState(false);
  const wrapRef    = useRef(null);
  const seenIdsRef = useRef(null);  // null = not initialized; populated on first load to suppress auto-open
  const myEmail = gUser?.email;

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Auto-open the panel when a brand-new unread notification arrives.
  // First subscription frame just seeds the seen-set so we don't open on initial load.
  useEffect(() => {
    if (!recentNotifs) return;
    if (seenIdsRef.current === null) {
      seenIdsRef.current = new Set(recentNotifs.map(n => n.id));
      return;
    }
    const newUnread = recentNotifs.filter(n =>
      !seenIdsRef.current.has(n.id) &&
      !(n.readBy || []).includes(myEmail)
    );
    newUnread.forEach(n => seenIdsRef.current.add(n.id));
    if (newUnread.length > 0) setOpen(true);
  }, [recentNotifs, myEmail]);

  if (!gUser) return null;

  const unreadItems = (recentNotifs || []).filter(n => !(n.readBy || []).includes(myEmail));
  const totalIndicator = unreadItems.length + totalChatUnread;

  function markAllRead() {
    unreadItems.forEach(n => markNotifRead(n.id));
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(!open)} title="Notifications"
        style={{ height: 40, width: 40, borderRadius: 20, border: '1px solid #e0e0e0', background: open ? '#f0f0f0' : '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', position: 'relative', flexShrink: 0, transition: 'background .15s' }}>
        <IconBell size={18} />
        {totalIndicator > 0 && (
          <span style={{ position: 'absolute', top: 4, right: 4, minWidth: 16, height: 16, padding: '0 4px', borderRadius: 8, background: '#ef4444', color: '#fff', fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #fff', lineHeight: 1, boxShadow: '0 1px 3px rgba(0,0,0,.2)' }}>
            {totalIndicator > 9 ? '9+' : totalIndicator}
          </span>
        )}
      </button>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 360, maxWidth: 'calc(100vw - 24px)', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 14, boxShadow: '0 16px 40px rgba(0,0,0,.14)', zIndex: 1000, overflow: 'hidden', maxHeight: '70vh', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Notifications</div>
            {unreadItems.length > 0 && (
              <button onClick={markAllRead} style={{ fontSize: 11, fontWeight: 600, color: 'var(--tm-accent, #3D95CE)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
                Mark all as read
              </button>
            )}
          </div>

          <div style={{ overflowY: 'auto', flex: 1 }}>
            {totalChatUnread > 0 && (
              <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #f5f5f5', background: '#fafafa' }}>
                <div style={{ color: '#1a5f8a', display: 'flex', alignItems: 'center' }}>
                  <IconMessage size={16} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a' }}>Unread client messages</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{totalChatUnread} unread thread{totalChatUnread === 1 ? '' : 's'}</div>
                </div>
              </div>
            )}

            {unreadItems.length === 0 && totalChatUnread === 0 ? (
              <div style={{ padding: '32px 14px', textAlign: 'center', color: '#aaa', fontSize: 12 }}>You're all caught up.</div>
            ) : unreadItems.length === 0 ? null : (
              unreadItems.map(n => {
                const { title, body } = formatNotif(n);
                return (
                  <div key={n.id} onClick={() => markNotifRead(n.id)}
                    style={{ padding: '10px 14px', borderBottom: '1px solid #f5f5f5', display: 'flex', alignItems: 'flex-start', gap: 10, background: '#f8fbfd', cursor: 'pointer' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', marginTop: 6, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 2 }}>{title}</div>
                      {body && <div style={{ fontSize: 11, color: '#666', lineHeight: 1.45, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{body}</div>}
                      <div style={{ fontSize: 10, color: '#aaa', marginTop: 2 }}>{relativeTime(n.createdAt)}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
