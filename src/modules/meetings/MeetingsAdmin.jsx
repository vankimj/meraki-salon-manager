import { useState, useEffect, useMemo } from 'react';
import { fetchMeetings, createMeeting, updateMeeting, deleteMeeting, fetchEmployees } from '../../lib/firestore';
import TrashButton from '../../components/TrashButton';
import { logActivity } from '../../lib/logger';
import { useApp } from '../../context/AppContext';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh   = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

function todayStr() { return new Date().toISOString().slice(0, 10); }

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / (1000 * 60 * 60 * 24));
}

function uid() { return Math.random().toString(36).slice(2, 10); }

const DURATIONS = [
  { label: '15 min',  value: 15  },
  { label: '30 min',  value: 30  },
  { label: '45 min',  value: 45  },
  { label: '1 hour',  value: 60  },
  { label: '1.5 hrs', value: 90  },
  { label: '2 hours', value: 120 },
  { label: '3 hours', value: 180 },
];
function durationLabel(min) { return DURATIONS.find(d => d.value === min)?.label || `${min} min`; }

// Meeting types — badges + filter chips. Color matches the section's
// accent so types are scannable without reading the label.
const MEETING_TYPES = [
  { id: 'team',     label: 'Team meeting',  short: 'Team',     emoji: '👥', color: '#2D7A5F', bg: '#ecfdf5' },
  { id: 'training', label: 'Training',      short: 'Training', emoji: '🎓', color: '#7c3aed', bg: '#f5f3ff' },
  { id: '1on1',     label: '1:1',           short: '1:1',      emoji: '🤝', color: '#3D95CE', bg: '#eff6ff' },
  { id: 'review',   label: 'Performance review', short: 'Review',  emoji: '📊', color: '#f59e0b', bg: '#fffbeb' },
  { id: 'huddle',   label: 'Daily huddle',  short: 'Huddle',   emoji: '⚡', color: '#10b981', bg: '#ecfdf5' },
  { id: 'other',    label: 'Other',         short: 'Other',    emoji: '📝', color: '#6b7280', bg: '#f3f4f6' },
];
const TYPE_BY_ID = Object.fromEntries(MEETING_TYPES.map(t => [t.id, t]));

// ── iCal / Google Calendar helpers ─────────────────────

function fmtISOCompact(d) { return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }

function generateICS(meeting) {
  const start = new Date(`${meeting.date}T${meeting.startTime}:00`);
  const end   = new Date(start.getTime() + (meeting.duration || 60) * 60000);
  const attendees = (meeting.participants || [])
    .filter(p => p.email)
    .map(p => `ATTENDEE;CN="${p.name}";RSVP=TRUE:mailto:${p.email}`)
    .join('\r\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0',
    'PRODID:-//Plume Nexus//Salon Manager//EN',
    'CALSCALE:GREGORIAN', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    `DTSTART:${fmtISOCompact(start)}`, `DTEND:${fmtISOCompact(end)}`,
    `SUMMARY:${meeting.title}`,
    meeting.description ? `DESCRIPTION:${meeting.description.replace(/\n/g, '\\n')}` : null,
    meeting.location ? `LOCATION:${meeting.location}` : null,
    `UID:${meeting.id}@plumenexus.com`,
    'ORGANIZER:mailto:jvankim@gmail.com',
    attendees || null, 'STATUS:CONFIRMED',
    `DTSTAMP:${fmtISOCompact(new Date())}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function downloadICS(meeting) {
  const blob = new Blob([generateICS(meeting)], { type: 'text/calendar;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${meeting.title.replace(/[^a-z0-9]/gi, '_')}.ics`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function googleCalendarUrl(meeting) {
  const start = new Date(`${meeting.date}T${meeting.startTime}:00`);
  const end   = new Date(start.getTime() + (meeting.duration || 60) * 60000);
  const params = new URLSearchParams({
    action: 'TEMPLATE', text: meeting.title,
    dates: `${fmtISOCompact(start)}/${fmtISOCompact(end)}`,
    details: meeting.description || '',
    location: meeting.location || '',
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

// ── Main component ──────────────────────────────────────

// Types that default to private (creator + listed participants only).
// Other types default public — visible to all tenant staff in the module.
const PRIVATE_BY_DEFAULT = new Set(['1on1', 'review']);

export default function MeetingsAdmin() {
  const { showToast, gUser, isAdmin } = useApp();
  const [meetings,  setMeetings]  = useState([]);
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [editMtg,   setEditMtg]   = useState(null);
  const [showPast,  setShowPast]  = useState(false);
  const [query,     setQuery]     = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [viewMode,  setViewMode]  = useState('list'); // 'list' | 'calendar'
  const [calMonth,  setCalMonth]  = useState(() => todayStr().slice(0, 7)); // YYYY-MM

  useEffect(() => {
    Promise.all([
      fetchMeetings().then(setMeetings),
      fetchEmployees().then(setEmployees),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  async function handleSave(data) {
    // Stamp the creator on first write so private-meeting access checks
    // can grant the organizer ongoing access even if they aren't in the
    // participants list themselves.
    //
    // Also maintain `participantEmails` — a flat lowercased-email array
    // mirroring `participants[*].email`. firestore.rules uses this to
    // gate private-meeting reads, since rules can't iterate over the
    // structured participants array. Re-derived on every save so it
    // stays in sync.
    const participantEmails = (data.participants || [])
      .map(p => (p.email || '').trim().toLowerCase())
      .filter(Boolean);
    const stamped = data.id
      ? { ...data, participantEmails }
      : { ...data, participantEmails, createdBy: data.createdBy || (gUser?.email || '').toLowerCase(), createdAt: data.createdAt || new Date().toISOString() };
    try {
      if (stamped.id) {
        await updateMeeting(stamped.id, stamped);
        logActivity('meeting_updated', `"${stamped.title}" on ${stamped.date}`);
        setMeetings(m =>
          m.map(x => x.id === stamped.id ? { ...x, ...stamped } : x)
           .sort((a, b) => a.startTimestamp - b.startTimestamp)
        );
        showToast('Meeting updated');
      } else {
        const id  = await createMeeting(stamped);
        logActivity('meeting_created', `"${stamped.title}" on ${stamped.date}${stamped.private ? ' [private]' : ''}`);
        setMeetings(m => [...m, { id, ...stamped }].sort((a, b) => a.startTimestamp - b.startTimestamp));
        showToast('Meeting created');
      }
    } catch (e) { showToast('Save failed: ' + e.message, 4000); throw e; }
  }

  // Privacy filter — applied BEFORE search/type filter so a private meeting
  // a user can't access never appears anywhere (no count in stats, no peek
  // through type chips). Admins see everything (they need to manage).
  const myEmail = (gUser?.email || '').toLowerCase();
  function canSee(m) {
    if (!m.private) return true;
    if (isAdmin) return true;
    if (myEmail && (m.createdBy || '').toLowerCase() === myEmail) return true;
    return (m.participants || []).some(p => (p.email || '').toLowerCase() === myEmail);
  }
  const visibleMeetings = useMemo(() => meetings.filter(canSee), [meetings, myEmail, isAdmin]); // eslint-disable-line

  async function handleDelete(meeting) {
    if (!confirm(`Delete "${meeting.title}"?`)) return;
    try {
      await deleteMeeting(meeting.id);
      logActivity('meeting_deleted', `"${meeting.title}" on ${meeting.date}`);
      setMeetings(m => m.filter(x => x.id !== meeting.id));
      showToast('Meeting deleted');
    } catch (e) { showToast('Delete failed: ' + e.message, 4000); }
  }

  async function handleSendInvites(meeting) {
    const parts = (meeting.participants || []).filter(p => (p.email || '').trim());
    if (parts.length === 0) { showToast('No participants with email addresses to invite.', 4000); return; }
    if (!confirm(`Send invites to ${parts.length} participant${parts.length === 1 ? '' : 's'}?\n\n${parts.map(p => `• ${p.name || p.email}`).join('\n')}`)) return;
    try {
      const res = await httpsCallable(functions, 'sendMeetingInvites')({ meetingId: meeting.id });
      const { sent, skipped } = res.data || {};
      showToast(`Sent ${sent} invite${sent === 1 ? '' : 's'}${skipped ? ` (${skipped} skipped — no email)` : ''}`);
      logActivity('meeting_invites_sent', `"${meeting.title}" → ${sent} sent`);
      const fresh = await fetchMeetings();
      setMeetings(fresh);
    } catch (e) { showToast('Send failed: ' + (e.message || 'unknown'), 5000); }
  }

  // Duplicate an existing meeting (to schedule the next instance) — copies
  // title, type, participants, agenda template, and bumps the date by a week.
  function handleDuplicate(meeting) {
    const next = new Date(meeting.date + 'T12:00:00');
    next.setDate(next.getDate() + 7);
    const draft = {
      ...meeting,
      id: undefined,
      date: next.toISOString().slice(0, 10),
      // Reset state: clear actuals, keep the template
      attendance:    {},
      actionItems:   [],
      minutes:       '',
      // Reset agenda check states but keep the items
      agenda:        (meeting.agenda || []).map(a => ({ ...a, done: false })),
      // Reset participant RSVP/invite states
      participants:  (meeting.participants || []).map(p => ({ name: p.name, email: p.email })),
    };
    setEditMtg(draft);
  }

  const today    = todayStr();

  // Apply search + type filter (only over meetings the user can see)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return visibleMeetings.filter(m => {
      if (typeFilter !== 'all' && (m.type || 'other') !== typeFilter) return false;
      if (!q) return true;
      const hay = [
        m.title, m.location, m.description, m.minutes,
        ...(m.participants || []).map(p => `${p.name} ${p.email}`),
        ...(m.agenda || []).map(a => a.text),
        ...(m.actionItems || []).map(a => `${a.text} ${a.assignee}`),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [visibleMeetings, query, typeFilter]);

  const upcoming = filtered.filter(m => m.date >= today);
  const past     = filtered.filter(m => m.date <  today).slice().reverse();

  // Stats (across only meetings the user can see)
  const stats = useMemo(() => computeStats(visibleMeetings, today, gUser?.email || ''), [visibleMeetings, today, gUser]);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>;
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', paddingBottom: 32 }}>

      {/* Stats summary strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 18 }}>
        <StatTile label="This month"      value={stats.thisMonth}        sublabel={`${stats.thisMonthHours} hrs total`} accent="#2D7A5F" />
        <StatTile label="Next 7 days"     value={stats.nextWeek}         sublabel={stats.nextMeetingDate ? `next: ${stats.nextMeetingLabel}` : 'nothing scheduled'} accent="#3D95CE" />
        <StatTile label="Open action items" value={stats.openActions}    sublabel={stats.overdueActions > 0 ? `${stats.overdueActions} overdue` : 'on track'} accent={stats.overdueActions > 0 ? '#ef4444' : '#10b981'} />
        <StatTile label="Avg attendance"  value={stats.attendancePct == null ? '—' : `${stats.attendancePct}%`} sublabel={stats.attendanceN ? `across ${stats.attendanceN} meetings` : 'no data yet'} accent="#7c3aed" />
      </div>

      {/* My open action items — only shown when the current user has any */}
      {stats.myActions.length > 0 && (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid #fde68a', borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--pn-warning)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 8 }}>
            ⚡ My open action items ({stats.myActions.length})
          </div>
          {stats.myActions.slice(0, 5).map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: i < Math.min(4, stats.myActions.length - 1) ? '1px solid #fef3c7' : 'none' }}>
              <span style={{ fontSize: 13, flex: 1, color: 'var(--pn-text)' }}>{a.text}</span>
              {a.dueDate && (
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10, background: a.overdue ? 'var(--pn-danger-bg)' : 'var(--pn-warning-bg)', color: a.overdue ? 'var(--pn-danger)' : 'var(--pn-warning)' }}>
                  {a.overdue ? 'OVERDUE · ' : ''}{a.dueDate}
                </span>
              )}
              <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>{a.meetingTitle}</span>
            </div>
          ))}
        </div>
      )}

      {/* Toolbar — search + view toggle + new */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search meetings…"
          style={{ flex: '1 1 220px', minWidth: 0, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', fontFamily: 'inherit', fontSize: 13 }}
        />
        <div style={{ display: 'inline-flex', borderRadius: 8, border: '1px solid var(--pn-border-strong)', overflow: 'hidden', flexShrink: 0 }}>
          {[{ id: 'list', label: '☰ List' }, { id: 'calendar', label: '📅 Calendar' }].map(v => (
            <button key={v.id} onClick={() => setViewMode(v.id)}
              style={{ padding: '7px 14px', border: 'none', background: viewMode === v.id ? '#3D95CE' : 'var(--pn-surface)', color: viewMode === v.id ? '#fff' : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: viewMode === v.id ? 700 : 500 }}>
              {v.label}
            </button>
          ))}
        </div>
        <TrashButton collections={['meetings']} scope="Meetings" />
        <button onClick={() => setEditMtg({})}
          style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
          + New Meeting
        </button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 18, flexWrap: 'wrap' }}>
        <TypeChip id="all" label="All" active={typeFilter === 'all'} onClick={() => setTypeFilter('all')} count={visibleMeetings.length} />
        {MEETING_TYPES.map(t => {
          const n = visibleMeetings.filter(m => (m.type || 'other') === t.id).length;
          if (n === 0 && typeFilter !== t.id) return null;
          return <TypeChip key={t.id} id={t.id} label={`${t.emoji} ${t.short}`} active={typeFilter === t.id} onClick={() => setTypeFilter(t.id)} count={n} accent={t.color} bg={t.bg} />;
        })}
      </div>

      {viewMode === 'calendar' && (
        <MonthCalendar
          month={calMonth}
          setMonth={setCalMonth}
          meetings={filtered}
          today={today}
          onMeetingClick={m => setEditMtg(m)}
          onDayClick={dateStr => setEditMtg({ _newOnDay: dateStr })}
        />
      )}

      {viewMode === 'list' && (
        upcoming.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--pn-text-faint)', fontSize: 13, background: 'var(--pn-bg)', borderRadius: 12, marginBottom: 16 }}>
            {query || typeFilter !== 'all'
              ? 'No upcoming meetings match your filter.'
              : 'No upcoming meetings. Create one to get started.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {upcoming.map(m => (
              <MeetingCard key={m.id} meeting={m}
                onEdit={() => setEditMtg(m)}
                onDelete={() => handleDelete(m)}
                onSendInvites={() => handleSendInvites(m)}
                onDuplicate={() => handleDuplicate(m)}
              />
            ))}
          </div>
        )
      )}

      {/* Past meetings (list view only) */}
      {viewMode === 'list' && past.length > 0 && (
        <>
          <button onClick={() => setShowPast(p => !p)}
            style={{ fontSize: 12, color: 'var(--pn-text-faint)', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 10 }}>
            {showPast ? '▲' : '▼'} Past meetings ({past.length})
          </button>
          {showPast && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {past.map(m => (
                <MeetingCard key={m.id} meeting={m} past
                  onEdit={() => setEditMtg(m)}
                  onDelete={() => handleDelete(m)}
                  onDuplicate={() => handleDuplicate(m)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {editMtg !== null && (
        <MeetingModal
          existing={editMtg?.id ? editMtg : null}
          draft={editMtg && !editMtg.id && (editMtg.title || editMtg._newOnDay) ? editMtg : null}
          employees={employees.filter(e => e.active !== false)}
          onSave={handleSave}
          onClose={() => setEditMtg(null)}
          author={gUser?.email || gUser?.displayName || ''}
        />
      )}
    </div>
  );
}

// ── Month calendar ─────────────────────────────────────

// 6×7 month grid with meeting chips per day. Click a chip to edit;
// click empty space (or the "+ N more" overflow) to start a new
// meeting on that date. Off-month leading/trailing days are rendered
// dimmed so the grid is always rectangular.
function MonthCalendar({ month, setMonth, meetings, today, onMeetingClick, onDayClick }) {
  // month = "YYYY-MM"
  const [y, m] = month.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd   = new Date(y, m, 0);

  // First cell = preceding Sunday. Always render 42 cells (6 weeks × 7 days)
  // so the grid height stays stable as the user navigates.
  const firstCell = new Date(monthStart);
  firstCell.setDate(monthStart.getDate() - monthStart.getDay());
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(firstCell);
    d.setDate(firstCell.getDate() + i);
    cells.push(d);
  }

  function shift(delta) {
    const next = new Date(y, m - 1 + delta, 1);
    setMonth(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`);
  }
  function goToday() { setMonth(today.slice(0, 7)); }

  const fmtDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const byDay = useMemo(() => {
    const map = {};
    meetings.forEach(mtg => {
      if (!mtg.date) return;
      (map[mtg.date] = map[mtg.date] || []).push(mtg);
    });
    Object.values(map).forEach(list => list.sort((a, b) => (a.startTime || '').localeCompare(b.startTime || '')));
    return map;
  }, [meetings]);

  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const isCurrentMonth = month === today.slice(0, 7);

  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
      {/* Calendar header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)' }}>{monthLabel}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => shift(-1)} title="Previous month"
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>‹</button>
          <button onClick={goToday} disabled={isCurrentMonth}
            style={{ padding: '5px 12px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: isCurrentMonth ? 'var(--pn-surface-alt)' : 'var(--pn-surface)', color: isCurrentMonth ? 'var(--pn-text-faint)' : 'var(--pn-text-muted)', cursor: isCurrentMonth ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600 }}>
            Today
          </button>
          <button onClick={() => shift(1)} title="Next month"
            style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 14 }}>›</button>
        </div>
      </div>

      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--pn-border)', background: 'var(--pn-bg)' }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={{ padding: '6px 8px', textAlign: 'center', fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(96px, 1fr)' }}>
        {cells.map((d, i) => {
          const ds       = fmtDate(d);
          const inMonth  = d.getMonth() === m - 1;
          const isToday  = ds === today;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const dayMtgs  = byDay[ds] || [];
          const visibleMtgs = dayMtgs.slice(0, 3);
          const overflow    = dayMtgs.length - visibleMtgs.length;
          return (
            <div key={i}
              onClick={(e) => {
                if (e.target === e.currentTarget) onDayClick?.(ds);
              }}
              style={{
                borderRight: i % 7 === 6 ? 'none' : '1px solid var(--pn-border)',
                borderBottom: i < 35 ? '1px solid var(--pn-border)' : 'none',
                padding: '4px 6px',
                background: isToday ? 'var(--pn-info-bg)' : isWeekend && inMonth ? 'var(--pn-bg)' : 'var(--pn-surface)',
                opacity: inMonth ? 1 : 0.45,
                position: 'relative', minHeight: 96, cursor: 'pointer',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{
                  fontSize: 11, fontWeight: isToday ? 800 : 600,
                  color: isToday ? 'var(--pn-info)' : inMonth ? 'var(--pn-text)' : 'var(--pn-text-faint)',
                  background: isToday ? '#3D95CE' : 'transparent',
                  WebkitBackgroundClip: isToday ? 'text' : 'unset',
                  padding: isToday ? '0 4px' : 0, borderRadius: 4,
                }}>
                  {d.getDate()}
                </span>
                {dayMtgs.length > 0 && <span style={{ fontSize: 9, color: 'var(--pn-text-faint)', fontWeight: 600 }}>{dayMtgs.length}</span>}
              </div>

              {visibleMtgs.map(mtg => {
                const t = TYPE_BY_ID[mtg.type || 'other'] || TYPE_BY_ID.other;
                return (
                  <div key={mtg.id}
                    onClick={e => { e.stopPropagation(); onMeetingClick?.(mtg); }}
                    title={`${mtg.title} · ${fmtTime(mtg.startTime)} · ${durationLabel(mtg.duration)}${mtg.location ? ' · ' + mtg.location : ''}${mtg.private ? ' · private' : ''}`}
                    style={{
                      background: t.bg,
                      borderLeft: `3px solid ${t.color}`,
                      color: t.color,
                      padding: '2px 5px',
                      borderRadius: 3,
                      fontSize: 10, fontWeight: 600,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      cursor: 'pointer',
                      lineHeight: 1.3,
                    }}>
                    {mtg.private && <span style={{ marginRight: 3 }}>🔒</span>}
                    <span style={{ opacity: .7, fontWeight: 500 }}>{fmtTime(mtg.startTime).replace(' ', '')}</span>{' '}
                    {mtg.title}
                  </div>
                );
              })}
              {overflow > 0 && (
                <div onClick={e => { e.stopPropagation(); onDayClick?.(ds); }}
                  style={{ fontSize: 10, color: '#3D95CE', cursor: 'pointer', padding: '1px 5px', fontWeight: 600 }}>
                  + {overflow} more
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Stat tile ──────────────────────────────────────────

function StatTile({ label, value, sublabel, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '12px 14px', borderLeft: `3px solid ${accent}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--pn-text)', lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{sublabel}</div>
    </div>
  );
}

function TypeChip({ id, label, active, onClick, count, accent, bg }) {
  return (
    <button onClick={onClick}
      style={{
        fontSize: 11, padding: '4px 10px', borderRadius: 20,
        border: `1.5px solid ${active ? (accent || '#3D95CE') : 'var(--pn-border-strong)'}`,
        background: active ? (bg || '#eff6ff') : 'var(--pn-surface)',
        color: active ? (accent || '#3D95CE') : 'var(--pn-text-muted)',
        cursor: 'pointer', fontFamily: 'inherit', fontWeight: active ? 700 : 500,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
      {label}
      <span style={{ fontSize: 10, color: active ? (accent || '#3D95CE') : 'var(--pn-text-faint)', opacity: .8 }}>{count}</span>
    </button>
  );
}

function computeStats(meetings, today, myEmail) {
  const monthPrefix = today.slice(0, 7);
  const inMonth = meetings.filter(m => (m.date || '').startsWith(monthPrefix));
  const thisMonthMin = inMonth.reduce((s, m) => s + (Number(m.duration) || 0), 0);

  const next7End = new Date(today + 'T12:00:00'); next7End.setDate(next7End.getDate() + 7);
  const next7EndStr = next7End.toISOString().slice(0, 10);
  const upcomingWeek = meetings.filter(m => m.date >= today && m.date <= next7EndStr).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const next = upcomingWeek[0];

  // Action items
  const allActions = meetings.flatMap(m => (m.actionItems || []).map(a => ({ ...a, meetingTitle: m.title, meetingDate: m.date })));
  const openActions = allActions.filter(a => a.status !== 'done');
  const overdueActions = openActions.filter(a => a.dueDate && a.dueDate < today).length;
  const myActions = openActions
    .filter(a => myEmail && (a.assignee || '').toLowerCase() === myEmail.toLowerCase())
    .map(a => ({ ...a, overdue: a.dueDate && a.dueDate < today }))
    .sort((a, b) => (a.dueDate || '~').localeCompare(b.dueDate || '~'));

  // Attendance %
  let attendees = 0, present = 0;
  meetings.forEach(m => {
    if (m.date >= today) return;
    const att = m.attendance || {};
    Object.values(att).forEach(s => {
      attendees++;
      if (s === 'present' || s === 'late') present++;
    });
  });

  return {
    thisMonth: inMonth.length,
    thisMonthHours: (thisMonthMin / 60).toFixed(thisMonthMin % 60 === 0 ? 0 : 1),
    nextWeek: upcomingWeek.length,
    nextMeetingDate: next?.date || null,
    nextMeetingLabel: next ? `${new Date(next.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtTime(next.startTime)}` : '',
    openActions: openActions.length,
    overdueActions,
    myActions,
    attendancePct: attendees ? Math.round((present / attendees) * 100) : null,
    attendanceN: meetings.filter(m => m.date < today && Object.keys(m.attendance || {}).length).length,
  };
}

// ── Meeting card ───────────────────────────────────────

function MeetingCard({ meeting, past, onEdit, onDelete, onSendInvites, onDuplicate }) {
  const parts = meeting.participants || [];
  const counts = parts.reduce((acc, p) => {
    if (p.response === 'accept')  acc.accepted++;
    else if (p.response === 'maybe')   acc.maybe++;
    else if (p.response === 'decline') acc.declined++;
    else acc.pending++;
    return acc;
  }, { accepted: 0, maybe: 0, declined: 0, pending: 0 });
  const anySent = parts.some(p => p.inviteSentAt);
  const [showAttendance, setShowAttendance] = useState(false);
  const type = TYPE_BY_ID[meeting.type || 'other'] || TYPE_BY_ID.other;

  const agenda      = meeting.agenda      || [];
  const actionItems = meeting.actionItems || [];
  const openItems   = actionItems.filter(a => a.status !== 'done').length;
  const today       = todayStr();
  const isToday     = meeting.date === today;
  const daysAway    = !past ? daysBetween(today, meeting.date) : null;

  return (
    <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: `1.5px solid ${past ? 'var(--pn-border)' : isToday ? '#bfdbfe' : 'var(--pn-border)'}`, overflow: 'hidden', opacity: past ? 0.75 : 1, boxShadow: isToday ? '0 0 0 3px #eff6ff' : 'none' }}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>

        {/* Date column */}
        <div style={{ width: 76, flexShrink: 0, background: past ? 'var(--pn-surface-alt)' : `linear-gradient(135deg,${type.color},${type.color}cc)`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '12px 6px', color: past ? 'var(--pn-text-faint)' : '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .85 }}>
            {new Date(meeting.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short' })}
          </div>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1.1 }}>
            {new Date(meeting.date + 'T12:00:00').getDate()}
          </div>
          <div style={{ fontSize: 10, opacity: .75 }}>
            {new Date(meeting.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
          {!past && (
            <div style={{ fontSize: 9, marginTop: 4, opacity: .85, fontWeight: 600 }}>
              {isToday ? 'TODAY' : daysAway === 1 ? 'tomorrow' : daysAway > 0 ? `in ${daysAway}d` : ''}
            </div>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: '12px 14px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, justifyContent: 'space-between' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>{meeting.title}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: type.bg, color: type.color, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                  {type.emoji} {type.short}
                </span>
                {meeting.private && (
                  <span title="Private — only the creator and listed participants can see this meeting's contents"
                    style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 10, background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', letterSpacing: '.04em', textTransform: 'uppercase', border: '1px solid #fecaca' }}>
                    🔒 Private
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12, color: 'var(--pn-text-muted)' }}>
                <span>🕐 {fmtTime(meeting.startTime)}</span>
                <span>⏱ {durationLabel(meeting.duration)}</span>
                {meeting.location && <span>📍 {meeting.location}</span>}
              </div>

              {/* Agenda + action item summary */}
              {(agenda.length > 0 || actionItems.length > 0 || meeting.minutes) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 11, marginTop: 8 }}>
                  {agenda.length > 0 && (
                    <span style={{ background: 'var(--pn-surface-alt)', borderRadius: 4, padding: '1px 7px', color: 'var(--pn-text)' }}>
                      📋 {agenda.filter(a => a.done).length}/{agenda.length} agenda
                    </span>
                  )}
                  {actionItems.length > 0 && (
                    <span style={{ background: openItems > 0 ? 'var(--pn-warning-bg)' : 'var(--pn-success-bg)', borderRadius: 4, padding: '1px 7px', color: openItems > 0 ? 'var(--pn-warning)' : 'var(--pn-success)' }}>
                      ⚡ {openItems > 0 ? `${openItems} open` : 'all done'} action item{actionItems.length === 1 ? '' : 's'}
                    </span>
                  )}
                  {meeting.minutes && (
                    <span style={{ background: 'var(--pn-info-bg)', borderRadius: 4, padding: '1px 7px', color: 'var(--pn-info)' }}>📝 minutes</span>
                  )}
                </div>
              )}

              {meeting.description && (
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 6, lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {meeting.description}
                </div>
              )}

              {parts.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => setShowAttendance(s => !s)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '4px 10px', borderRadius: 20, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--pn-text-muted)' }}>
                    <span>👥 {parts.length}</span>
                    {anySent ? (
                      <>
                        {counts.accepted > 0 && <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ {counts.accepted}</span>}
                        {counts.maybe    > 0 && <span style={{ color: '#f59e0b', fontWeight: 700 }}>? {counts.maybe}</span>}
                        {counts.declined > 0 && <span style={{ color: '#ef4444', fontWeight: 700 }}>✗ {counts.declined}</span>}
                        {counts.pending  > 0 && <span style={{ color: 'var(--pn-text-muted)' }}>⏳ {counts.pending}</span>}
                      </>
                    ) : (
                      <span style={{ color: 'var(--pn-text-faint)' }}>not yet invited</span>
                    )}
                    <span style={{ color: 'var(--pn-text-faint)' }}>{showAttendance ? '▴' : '▾'}</span>
                  </button>
                  {showAttendance && (
                    <div style={{ marginTop: 8, background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '8px 12px' }}>
                      {parts.map((p, i) => {
                        const att = (meeting.attendance || {})[p.email || p.name];
                        const sty = p.response === 'accept'  ? { color: '#16a34a', label: '✓ Accepted' }
                                  : p.response === 'maybe'   ? { color: '#f59e0b', label: '? Maybe' }
                                  : p.response === 'decline' ? { color: '#ef4444', label: '✗ Declined' }
                                  : p.inviteSentAt           ? { color: 'var(--pn-text-muted)',   label: '⏳ No response yet' }
                                  :                            { color: 'var(--pn-text-faint)',   label: 'not invited' };
                        return (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0', borderBottom: i < parts.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                            <div style={{ fontSize: 12, color: 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.name || p.email}
                              {p.email && p.name && <span style={{ color: 'var(--pn-text-faint)', marginLeft: 6, fontSize: 11 }}>{p.email}</span>}
                            </div>
                            <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                              {att && <AttBadge value={att} />}
                              <span style={{ fontSize: 11, fontWeight: 600, color: sty.color }}>{sty.label}</span>
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, flexShrink: 0, justifyContent: 'flex-end' }}>
              {!past && parts.some(p => (p.email || '').trim()) && onSendInvites && (
                <button onClick={onSendInvites} title={anySent ? 'Resend invitation emails' : 'Send invitation emails to all participants'}
                  style={{ ...btnStyle, background: anySent ? 'var(--pn-bg)' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: anySent ? 'var(--pn-text-muted)' : '#fff', border: anySent ? '1px solid var(--pn-border-strong)' : 'none', fontWeight: 700 }}>
                  {anySent ? '✉ Resend' : '✉ Send invites'}
                </button>
              )}
              <button onClick={() => downloadICS(meeting)} title="Download .ics file" style={btnStyle}>⬇ iCal</button>
              <button onClick={() => window.open(googleCalendarUrl(meeting), '_blank')} title="Add to Google Calendar" style={btnStyle}>📅 GCal</button>
              {onDuplicate && <button onClick={onDuplicate} title="Duplicate (next week)" style={btnStyle}>⎘ Repeat</button>}
              <button onClick={onEdit} style={btnStyle}>{past ? 'Notes' : 'Edit'}</button>
              <button onClick={onDelete} style={{ ...btnStyle, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)' }}>✕</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ATT_STYLE = {
  present: { color: 'var(--pn-success)', bg: 'var(--pn-success-bg)', label: 'PRESENT' },
  late:    { color: 'var(--pn-warning)', bg: 'var(--pn-warning-bg)', label: 'LATE' },
  absent:  { color: 'var(--pn-danger)',  bg: 'var(--pn-danger-bg)',  label: 'ABSENT' },
  excused: { color: 'var(--pn-info)', bg: 'var(--pn-info-bg)', label: 'EXCUSED' },
};
function AttBadge({ value }) {
  const s = ATT_STYLE[value]; if (!s) return null;
  return <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, color: s.color, background: s.bg, letterSpacing: '.04em' }}>{s.label}</span>;
}

// ── Create / Edit modal — tabbed ────────────────────────

function MeetingModal({ existing, draft, employees, onSave, onClose, author }) {
  const seed = existing || draft || {};
  const [tab,         setTab]         = useState('details');
  const [title,       setTitle]       = useState(seed.title       || '');
  const [type,        setType]        = useState(seed.type        || 'team');
  // _newOnDay is a calendar-cell click; pre-seed the date but leave the
  // rest blank so the user can fill in title / time / participants.
  const initialDate = seed.date || seed._newOnDay || todayStr();
  // Private meetings hide their content from staff who aren't a participant
  // or the organizer. Defaults true for 1:1s and performance reviews; the
  // creator can override per meeting. Stamped explicitly so non-private
  // public meetings keep `private: false` (not undefined) on the doc.
  const [isPrivate, setIsPrivate] = useState(seed.private != null ? !!seed.private : PRIVATE_BY_DEFAULT.has(seed.type || 'team'));
  const [date,        setDate]        = useState(initialDate);
  const [startTime,   setStartTime]   = useState(seed.startTime   || '10:00');
  const [duration,    setDuration]    = useState(seed.duration    || 60);
  const [location,    setLocation]    = useState(seed.location    || '');
  const [desc,        setDesc]        = useState(seed.description || '');
  const [agenda,      setAgenda]      = useState(seed.agenda      || []);
  const [attendance,  setAttendance]  = useState(seed.attendance  || {});
  const [actionItems, setActionItems] = useState(seed.actionItems || []);
  const [minutes,     setMinutes]     = useState(seed.minutes     || '');
  const [selected,    setSelected]    = useState(() =>
    (seed.participants || []).map(p => `${p.name}||${p.email || ''}`)
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
      const orig = (existing?.participants || []).find(p => p.email === email);
      return orig
        ? { ...orig, name: name || orig.name, email: email || orig.email }
        : { name: name || email, email: email || '' };
    });
  }

  // Agenda CRUD
  function addAgenda()     { setAgenda(a => [...a, { id: uid(), text: '', done: false }]); }
  function patchAgenda(i, patch) { setAgenda(a => a.map((x, idx) => idx === i ? { ...x, ...patch } : x)); }
  function removeAgenda(i) { setAgenda(a => a.filter((_, idx) => idx !== i)); }

  // Action item CRUD
  function addAction()     { setActionItems(a => [...a, { id: uid(), text: '', assignee: '', dueDate: '', status: 'open', createdBy: author, createdAt: new Date().toISOString() }]); }
  function patchAction(i, patch) { setActionItems(a => a.map((x, idx) => idx === i ? { ...x, ...patch } : x)); }
  function removeAction(i) { setActionItems(a => a.filter((_, idx) => idx !== i)); }

  // Attendance
  function setAtt(key, value) {
    setAttendance(a => {
      const next = { ...a };
      if (next[key] === value) delete next[key]; else next[key] = value;
      return next;
    });
  }

  async function handleSubmit() {
    if (!title.trim() || !date || !startTime) return;
    setSaving(true);
    try {
      await onSave({
        ...(existing || {}),
        title:        title.trim(),
        type,
        private:      isPrivate,
        date,
        startTime,
        startTimestamp: new Date(`${date}T${startTime}:00`).getTime(),
        duration,
        location:     location.trim(),
        description:  desc.trim(),
        participants: buildParticipants(),
        agenda:       agenda.filter(a => (a.text || '').trim()),
        actionItems:  actionItems.filter(a => (a.text || '').trim()),
        attendance,
        minutes:      minutes.trim(),
      });
      onClose();
    } catch { setSaving(false); }
  }

  const canSubmit = title.trim() && date && startTime && !saving;
  const isPast = date < todayStr();
  const participantsForAttendance = buildParticipants().filter(p => p.name || p.email);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 200, overflowY: 'auto', padding: '20px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,.3)', marginBottom: 20 }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>
            {existing?.id ? 'Edit Meeting' : draft ? 'Schedule (from copy)' : 'New Meeting'}
          </div>
          <button onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--pn-border)', padding: '0 12px', overflowX: 'auto' }}>
          {[
            { id: 'details',    label: 'Details' },
            { id: 'agenda',     label: `Agenda${agenda.length ? ` (${agenda.length})` : ''}` },
            { id: 'attendance', label: 'Attendance', hide: !isPast && participantsForAttendance.length === 0 },
            { id: 'outcomes',   label: `Outcomes${actionItems.length ? ` · ${actionItems.length}` : ''}` },
          ].filter(t => !t.hide).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: '12px 14px', border: 'none', background: 'none', fontFamily: 'inherit', fontSize: 13,
                fontWeight: tab === t.id ? 700 : 500, color: tab === t.id ? '#2D7A5F' : 'var(--pn-text-muted)',
                borderBottom: tab === t.id ? '2px solid #2D7A5F' : '2px solid transparent',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 320 }}>

          {tab === 'details' && (
            <>
              <div>
                <label style={lbl}>Title *</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Monthly team check-in" autoFocus={!existing} style={inp} />
              </div>

              <div>
                <label style={lbl}>Type</label>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {MEETING_TYPES.map(t => (
                    <button key={t.id} onClick={() => {
                      setType(t.id);
                      // Re-default privacy when the user picks a new type and
                      // hasn't customized it yet — sensitive types (1:1, review)
                      // toggle private on; team / huddle toggle off.
                      if (seed.private == null) setIsPrivate(PRIVATE_BY_DEFAULT.has(t.id));
                    }} type="button"
                      style={{ fontSize: 12, padding: '5px 10px', borderRadius: 8, border: `1.5px solid ${type === t.id ? t.color : 'var(--pn-border-strong)'}`, background: type === t.id ? t.bg : 'var(--pn-surface)', color: type === t.id ? t.color : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: type === t.id ? 700 : 500 }}>
                      {t.emoji} {t.short}
                    </button>
                  ))}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 10, border: `1.5px solid ${isPrivate ? '#fca5a5' : 'var(--pn-border)'}`, background: isPrivate ? 'var(--pn-danger-bg)' : 'var(--pn-bg)', cursor: 'pointer' }}>
                <input type="checkbox" checked={isPrivate} onChange={e => setIsPrivate(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#991b1b', flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: isPrivate ? 'var(--pn-danger)' : 'var(--pn-text)' }}>
                    🔒 Private meeting
                  </div>
                  <div style={{ fontSize: 11, color: isPrivate ? 'var(--pn-danger)' : 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.45 }}>
                    {isPrivate
                      ? 'Only you (the organizer) and listed participants can see the title, agenda, minutes, and action items. Other staff won\'t see this meeting in their list.'
                      : 'Visible to all tenant staff. Recommended for team meetings, training, daily huddles.'}
                  </div>
                </div>
              </label>

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

              <div>
                <label style={lbl}>Location</label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="e.g. salon back room, Zoom link" style={inp} />
              </div>

              <div>
                <label style={lbl}>Pre-meeting notes / brief</label>
                <textarea value={desc} onChange={e => setDesc(e.target.value)}
                  rows={3} placeholder="Why are we meeting? What's the goal?"
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              <div>
                <label style={lbl}>Participants (receive email reminders)</label>
                <div style={{ background: 'var(--pn-bg)', borderRadius: 10, border: '1px solid var(--pn-border)', padding: '10px 12px', maxHeight: 200, overflowY: 'auto' }}>
                  {employees.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>No employees on record.</div>
                  ) : employees.map(emp => {
                    const key     = `${emp.name}||${emp.email || ''}`;
                    const checked = selected.includes(key);
                    return (
                      <label key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', cursor: 'pointer' }}>
                        <input type="checkbox" checked={checked} onChange={() => toggleEmp(emp)}
                          style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#2D7A5F' }} />
                        <span style={{ fontSize: 13, color: 'var(--pn-text)', flex: 1 }}>{emp.name}</span>
                        {emp.email
                          ? <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{emp.email}</span>
                          : <span style={{ fontSize: 11, color: '#fca5a5' }}>no email</span>
                        }
                      </label>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <input type="email" value={customEmail}
                    onChange={e => setCustomEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addCustomEmail()}
                    placeholder="Add guest email…"
                    style={{ ...inp, flex: 1 }} />
                  <button onClick={addCustomEmail} type="button"
                    style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--pn-text-muted)', flexShrink: 0 }}>Add</button>
                </div>
                {selected.some(k => !empKeys.includes(k)) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {selected.filter(k => !empKeys.includes(k)).map(k => {
                      const email = k.split('||')[1];
                      return (
                        <div key={k} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 20, background: 'var(--pn-info-bg)', color: 'var(--pn-info)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {email}
                          <button onClick={() => setSelected(s => s.filter(x => x !== k))}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--pn-info)', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === 'agenda' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>
                What needs to be discussed. Check items off as you go through the meeting.
              </div>
              {agenda.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 12, border: '1px dashed var(--pn-border)', borderRadius: 8 }}>No agenda items yet.</div>
              )}
              {agenda.map((a, i) => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: i < agenda.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                  <input type="checkbox" checked={!!a.done} onChange={e => patchAgenda(i, { done: e.target.checked })}
                    style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2D7A5F', flexShrink: 0 }} />
                  <input value={a.text} onChange={e => patchAgenda(i, { text: e.target.value })}
                    placeholder="Discuss…"
                    style={{ flex: 1, border: 'none', background: 'none', fontFamily: 'inherit', fontSize: 13, padding: 4, outline: 'none', textDecoration: a.done ? 'line-through' : 'none', color: a.done ? 'var(--pn-text-faint)' : 'var(--pn-text)' }} />
                  <button onClick={() => removeAgenda(i)} type="button" style={{ border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                </div>
              ))}
              <button onClick={addAgenda} type="button"
                style={{ width: '100%', marginTop: 8, padding: '8px', borderRadius: 8, border: '1px dashed var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--pn-text-muted)' }}>
                + Add agenda item
              </button>
            </div>
          )}

          {tab === 'attendance' && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>
                Mark who actually showed up. Separate from RSVP — a "Present" mark stays even if RSVP was a maybe.
              </div>
              {participantsForAttendance.length === 0 && (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 12, border: '1px dashed var(--pn-border)', borderRadius: 8 }}>No participants yet — add some on the Details tab.</div>
              )}
              {participantsForAttendance.map((p, i) => {
                const key = p.email || p.name;
                const cur = attendance[key];
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: i < participantsForAttendance.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name || p.email}</div>
                      {p.email && p.name && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{p.email}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {Object.entries(ATT_STYLE).map(([k, s]) => (
                        <button key={k} type="button" onClick={() => setAtt(key, k)}
                          style={{ fontSize: 10, fontWeight: 700, padding: '4px 8px', borderRadius: 6, border: `1px solid ${cur === k ? s.color : 'var(--pn-border-strong)'}`, background: cur === k ? s.bg : 'var(--pn-surface)', color: cur === k ? s.color : 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', letterSpacing: '.04em' }}>
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'outcomes' && (
            <div>
              <div>
                <label style={lbl}>Meeting minutes</label>
                <textarea value={minutes} onChange={e => setMinutes(e.target.value)}
                  rows={6} placeholder="What was discussed, decided, and concluded…"
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} />
              </div>

              <div style={{ marginTop: 18 }}>
                <label style={lbl}>Action items</label>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 8 }}>
                  Tasks that came out of this meeting. Surface in each assignee's "My open action items" panel.
                </div>
                {actionItems.length === 0 && (
                  <div style={{ padding: '18px', textAlign: 'center', color: 'var(--pn-text-faint)', fontSize: 12, border: '1px dashed var(--pn-border)', borderRadius: 8 }}>No action items yet.</div>
                )}
                {actionItems.map((a, i) => (
                  <div key={a.id} style={{ marginBottom: 8, padding: 10, background: a.status === 'done' ? 'var(--pn-bg)' : 'var(--pn-warning-bg)', border: `1px solid ${a.status === 'done' ? 'var(--pn-border)' : '#fde68a'}`, borderRadius: 8, opacity: a.status === 'done' ? 0.7 : 1 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                      <input type="checkbox" checked={a.status === 'done'}
                        onChange={e => patchAction(i, { status: e.target.checked ? 'done' : 'open', completedAt: e.target.checked ? new Date().toISOString() : '' })}
                        style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2D7A5F', marginTop: 4, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <input value={a.text} onChange={e => patchAction(i, { text: e.target.value })}
                          placeholder="What needs to happen…"
                          style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '5px 8px', fontFamily: 'inherit', fontSize: 13, marginBottom: 6, textDecoration: a.status === 'done' ? 'line-through' : 'none' }} />
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <select value={a.assignee} onChange={e => patchAction(i, { assignee: e.target.value })}
                            style={{ flex: '1 1 140px', minWidth: 0, border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 8px', fontFamily: 'inherit', fontSize: 12, background: 'var(--pn-surface)' }}>
                            <option value="">Assign to…</option>
                            {employees.map(e => e.email && <option key={e.id} value={e.email}>{e.name} ({e.email})</option>)}
                          </select>
                          <input type="date" value={a.dueDate || ''} onChange={e => patchAction(i, { dueDate: e.target.value })}
                            style={{ flex: '1 1 120px', minWidth: 0, border: '1px solid var(--pn-border-strong)', borderRadius: 6, padding: '4px 8px', fontFamily: 'inherit', fontSize: 12, background: 'var(--pn-surface)' }} />
                        </div>
                      </div>
                      <button onClick={() => removeAction(i)} type="button"
                        style={{ border: 'none', background: 'none', color: 'var(--pn-text-faint)', cursor: 'pointer', fontSize: 16, padding: '0 4px', flexShrink: 0 }}>×</button>
                    </div>
                  </div>
                ))}
                <button onClick={addAction} type="button"
                  style={{ width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, color: 'var(--pn-text-muted)' }}>
                  + Add action item
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={handleSubmit} disabled={!canSubmit}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: canSubmit ? 'linear-gradient(135deg,#2D7A5F,#3D95CE)' : 'var(--pn-border-strong)', color: '#fff', cursor: canSubmit ? 'pointer' : 'default', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : existing?.id ? 'Save Changes' : 'Create Meeting'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Shared styles ──────────────────────────────────────
const lbl     = { fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' };
const inp     = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-bg)', boxSizing: 'border-box' };
const btnStyle = { padding: '5px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, color: 'var(--pn-text-muted)', fontWeight: 500 };
