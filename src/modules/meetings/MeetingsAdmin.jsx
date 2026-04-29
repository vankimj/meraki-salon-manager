import { useState, useEffect } from 'react';
import { fetchMeetings, createMeeting, updateMeeting, deleteMeeting, fetchEmployees } from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import { useApp } from '../../context/AppContext';

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

const DURATIONS = [
  { label: '15 min',  value: 15  },
  { label: '30 min',  value: 30  },
  { label: '45 min',  value: 45  },
  { label: '1 hour',  value: 60  },
  { label: '1.5 hrs', value: 90  },
  { label: '2 hours', value: 120 },
  { label: '3 hours', value: 180 },
];

function durationLabel(min) {
  return DURATIONS.find(d => d.value === min)?.label || `${min} min`;
}

// ── iCal / Google Calendar helpers ─────────────────────

function fmtISOCompact(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function generateICS(meeting) {
  const start = new Date(`${meeting.date}T${meeting.startTime}:00`);
  const end   = new Date(start.getTime() + (meeting.duration || 60) * 60000);

  const attendees = (meeting.participants || [])
    .filter(p => p.email)
    .map(p => `ATTENDEE;CN="${p.name}";RSVP=TRUE:mailto:${p.email}`)
    .join('\r\n');

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Meraki Nail Studio//Salon Manager//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `DTSTART:${fmtISOCompact(start)}`,
    `DTEND:${fmtISOCompact(end)}`,
    `SUMMARY:${meeting.title}`,
    meeting.description ? `DESCRIPTION:${meeting.description.replace(/\n/g, '\\n')}` : null,
    `LOCATION:${meeting.location || 'Meraki Nail Studio, Columbus OH'}`,
    `UID:${meeting.id}@meraki-salon-manager`,
    'ORGANIZER:mailto:jvankim@gmail.com',
    attendees || null,
    'STATUS:CONFIRMED',
    `DTSTAMP:${fmtISOCompact(new Date())}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function downloadICS(meeting) {
  const blob = new Blob([generateICS(meeting)], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${meeting.title.replace(/[^a-z0-9]/gi, '_')}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function googleCalendarUrl(meeting) {
  const start = new Date(`${meeting.date}T${meeting.startTime}:00`);
  const end   = new Date(start.getTime() + (meeting.duration || 60) * 60000);
  const params = new URLSearchParams({
    action:   'TEMPLATE',
    text:     meeting.title,
    dates:    `${fmtISOCompact(start)}/${fmtISOCompact(end)}`,
    details:  meeting.description || '',
    location: meeting.location || 'Meraki Nail Studio, Columbus OH',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ── Main component ──────────────────────────────────────

export default function MeetingsAdmin() {
  const { showToast } = useApp();
  const [meetings,  setMeetings]  = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editMtg,   setEditMtg]   = useState(null);
  const [showPast,  setShowPast]  = useState(false);

  useEffect(() => {
    Promise.all([
      fetchMeetings().then(setMeetings),
      fetchEmployees().then(setEmployees),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave(data) {
    try {
      if (data.id) {
        await updateMeeting(data.id, data);
        logActivity('meeting_updated', `"${data.title}" on ${data.date}`);
        setMeetings(m =>
          m.map(x => x.id === data.id ? { ...x, ...data } : x)
           .sort((a, b) => a.startTimestamp - b.startTimestamp)
        );
        showToast('Meeting updated');
      } else {
        const id  = await createMeeting(data);
        logActivity('meeting_created', `"${data.title}" on ${data.date}`);
        setMeetings(m => [...m, { id, ...data }].sort((a, b) => a.startTimestamp - b.startTimestamp));
        showToast('Meeting created');
      }
    } catch (e) {
      showToast('Save failed: ' + e.message, 4000);
      throw e;
    }
  }

  async function handleDelete(meeting) {
    if (!confirm(`Delete "${meeting.title}"?`)) return;
    try {
      await deleteMeeting(meeting.id);
      logActivity('meeting_deleted', `"${meeting.title}" on ${meeting.date}`);
      setMeetings(m => m.filter(x => x.id !== meeting.id));
      showToast('Meeting deleted');
    } catch (e) {
      showToast('Delete failed: ' + e.message, 4000);
    }
  }

  const today    = todayStr();
  const upcoming = meetings.filter(m => m.date >= today);
  const past     = meetings.filter(m => m.date <  today).slice().reverse();

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 32 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>
            {upcoming.length} upcoming meeting{upcoming.length !== 1 ? 's' : ''}
          </div>
          <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>
            Participants receive email reminders 1 hr and 15 min before
          </div>
        </div>
        <button onClick={() => setEditMtg({})}
          style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
          + New Meeting
        </button>
      </div>

      {/* Upcoming */}
      {upcoming.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: '#bbb', fontSize: 13 }}>
          No upcoming meetings. Create one to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
          {upcoming.map(m => (
            <MeetingCard key={m.id} meeting={m}
              onEdit={() => setEditMtg(m)}
              onDelete={() => handleDelete(m)}
            />
          ))}
        </div>
      )}

      {/* Past meetings */}
      {past.length > 0 && (
        <>
          <button onClick={() => setShowPast(p => !p)}
            style={{ fontSize: 12, color: '#aaa', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10 }}>
            {showPast ? '▲' : '▼'} Past meetings ({past.length})
          </button>
          {showPast && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {past.map(m => (
                <MeetingCard key={m.id} meeting={m} past
                  onEdit={() => setEditMtg(m)}
                  onDelete={() => handleDelete(m)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {editMtg !== null && (
        <MeetingModal
          existing={editMtg?.id ? editMtg : null}
          employees={employees.filter(e => e.active !== false)}
          onSave={handleSave}
          onClose={() => setEditMtg(null)}
        />
      )}
    </div>
  );
}

// ── Meeting card ───────────────────────────────────────

function MeetingCard({ meeting, past, onEdit, onDelete }) {
  const parts = meeting.participants || [];

  return (
    <div style={{ background: '#fff', borderRadius: 12, border: `1.5px solid ${past ? '#f0f0f0' : '#e8e8e8'}`, overflow: 'hidden', opacity: past ? 0.65 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>

        {/* Date column */}
        <div style={{ width: 76, flexShrink: 0, background: past ? '#f5f5f5' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 6px', color: past ? '#bbb' : '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .85 }}>
            {new Date(meeting.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>
            {new Date(meeting.date + 'T12:00:00').getDate()}
          </div>
          <div style={{ fontSize: 10, opacity: .75 }}>
            {new Date(meeting.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 }}>{meeting.title}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: '#666' }}>
                <span>🕐 {fmtTime(meeting.startTime)}</span>
                <span>⏱ {durationLabel(meeting.duration)}</span>
                {meeting.location && <span>📍 {meeting.location}</span>}
              </div>
              {meeting.description && (
                <div style={{ fontSize: 12, color: '#888', marginTop: 5, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {meeting.description}
                </div>
              )}
              {parts.length > 0 && (
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 5 }}>
                  👥 {parts.map(p => p.name || p.email).join(', ')}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0, justifyContent: 'flex-end' }}>
              <button onClick={() => downloadICS(meeting)} title="Download .ics file"
                style={btnStyle}>⬇ iCal</button>
              <button onClick={() => window.open(googleCalendarUrl(meeting), '_blank')} title="Add to Google Calendar"
                style={btnStyle}>📅 GCal</button>
              <button onClick={onEdit} style={btnStyle}>Edit</button>
              <button onClick={onDelete}
                style={{ ...btnStyle, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444' }}>✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create / Edit modal ────────────────────────────────

function MeetingModal({ existing, employees, onSave, onClose }) {
  const [title,       setTitle]       = useState(existing?.title       || '');
  const [date,        setDate]        = useState(existing?.date        || todayStr());
  const [startTime,   setStartTime]   = useState(existing?.startTime   || '10:00');
  const [duration,    setDuration]    = useState(existing?.duration    || 60);
  const [location,    setLocation]    = useState(existing?.location    || 'Meraki Nail Studio');
  const [desc,        setDesc]        = useState(existing?.description || '');
  const [selected,    setSelected]    = useState(() =>
    (existing?.participants || []).map(p => `${p.name}||${p.email || ''}`)
  );
  const [customEmail, setCustomEmail] = useState('');
  const [saving,      setSaving]      = useState(false);

  const empKeys = employees.map(e => `${e.name}||${e.email || ''}`);

  function toggleEmp(emp) {
    const key = `${emp.name}||${emp.email || ''}`;
    setSelected(s => s.includes(key) ? s.filter(x => x !== key) : [...s, key]);
  }

  function addCustomEmail() {
    const trimmed = customEmail.trim();
    if (!trimmed.includes('@')) return;
    const key = `||${trimmed}`;
    if (!selected.includes(key)) setSelected(s => [...s, key]);
    setCustomEmail('');
  }

  function buildParticipants() {
    return selected.map(key => {
      const [name, email] = key.split('||');
      return { name: name || email, email: email || '' };
    });
  }

  async function handleSubmit() {
    if (!title.trim() || !date || !startTime) return;
    setSaving(true);
    try {
      await onSave({
        ...(existing || {}),
        title:        title.trim(),
        date,
        startTime,
        startTimestamp: new Date(`${date}T${startTime}:00`).getTime(),
        duration,
        location:     location.trim(),
        description:  desc.trim(),
        participants: buildParticipants(),
      });
      onClose();
    } catch {
      setSaving(false);
    }
  }

  const canSubmit = title.trim() && date && startTime && !saving;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '20px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,.3)', marginBottom: 20 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {existing?.id ? 'Edit Meeting' : 'New Meeting'}
          </div>
          <button onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Title */}
          <div>
            <label style={lbl}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Monthly team check-in" autoFocus style={inp} />
          </div>

          {/* Date / Time / Duration */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 140px' }}>
              <label style={lbl}>Date *</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={lbl}>Start time *</label>
              <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={inp} />
            </div>
            <div style={{ flex: '1 1 100px' }}>
              <label style={lbl}>Duration</label>
              <select value={duration} onChange={e => setDuration(Number(e.target.value))} style={inp}>
                {DURATIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          {/* Location */}
          <div>
            <label style={lbl}>Location</label>
            <input value={location} onChange={e => setLocation(e.target.value)}
              placeholder="Meraki Nail Studio" style={inp} />
          </div>

          {/* Notes */}
          <div>
            <label style={lbl}>Notes / Agenda</label>
            <textarea value={desc} onChange={e => setDesc(e.target.value)}
              rows={3} placeholder="Meeting agenda or notes…"
              style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
          </div>

          {/* Participants */}
          <div>
            <label style={lbl}>Participants (receive email reminders)</label>
            <div style={{ background: '#fafafa', borderRadius: 10, border: '1px solid #e8e8e8', padding: '10px 12px', maxHeight: 200, overflowY: 'auto' }}>
              {employees.length === 0 ? (
                <div style={{ fontSize: 12, color: '#bbb' }}>No employees on record.</div>
              ) : employees.map(emp => {
                const key     = `${emp.name}||${emp.email || ''}`;
                const checked = selected.includes(key);
                return (
                  <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleEmp(emp)}
                      style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#2D7A5F' }} />
                    <span style={{ fontSize: 13, color: '#333', flex: 1 }}>{emp.name}</span>
                    {emp.email
                      ? <span style={{ fontSize: 11, color: '#aaa' }}>{emp.email}</span>
                      : <span style={{ fontSize: 11, color: '#fca5a5' }}>no email</span>
                    }
                  </label>
                );
              })}
            </div>

            {/* Custom email */}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
              <input type="email" value={customEmail}
                onChange={e => setCustomEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustomEmail()}
                placeholder="Add guest email…"
                style={{ ...inp, flex: 1 }} />
              <button onClick={addCustomEmail}
                style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d8d8d8', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: '#555', flexShrink: 0 }}>
                Add
              </button>
            </div>

            {/* Guest chips */}
            {selected.some(k => !empKeys.includes(k)) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {selected.filter(k => !empKeys.includes(k)).map(k => {
                  const email = k.split('||')[1];
                  return (
                    <div key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: '#EBF5FF', color: '#1a5f8a', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {email}
                      <button onClick={() => setSelected(s => s.filter(x => x !== k))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1a5f8a', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: canSubmit ? 'linear-gradient(135deg,#2D7A5F,#3D95CE)' : '#d0d0d0', color: '#fff', cursor: canSubmit ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : existing?.id ? 'Save Changes' : 'Create Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────
const lbl     = { fontSize: 11, color: '#888', display: 'block', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' };
const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
const btnStyle = { padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: '#555', fontWeight: 500 };
