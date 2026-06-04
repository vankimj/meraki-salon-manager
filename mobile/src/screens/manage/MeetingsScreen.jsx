import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import { fetchMeetings, createMeeting, updateMeeting, deleteMeeting } from '../../lib/firestore';

const TYPES = [
  { value: 'team',     label: 'Team' },     { value: 'training', label: 'Training' },
  { value: '1on1',     label: '1:1' },      { value: 'review',   label: 'Review' },
  { value: 'huddle',   label: 'Huddle' },
];

const FIELDS = [
  { key: 'subject',     label: 'Subject',   type: 'text',   required: true, placeholder: 'Monthly team meeting' },
  { key: 'date',        label: 'Date',      type: 'text',   placeholder: 'YYYY-MM-DD' },
  { key: 'startTime',   label: 'Time',      type: 'text',   placeholder: 'HH:MM (e.g. 18:00)' },
  { key: 'type',        label: 'Type',      type: 'select', options: TYPES },
  { key: 'location',    label: 'Location',  type: 'text',   placeholder: 'Back room / Zoom' },
  { key: 'description', label: 'Notes',     type: 'text',   placeholder: 'Optional' },
];

// Derive the web-compatible startTimestamp from date + time so web reads
// (which order by startTimestamp) stay sorted.
function withTimestamp(d) {
  let startTimestamp = d.startTimestamp;
  if (d.date && d.startTime) {
    const t = new Date(`${d.date}T${d.startTime}`);
    if (!isNaN(t.getTime())) startTimestamp = t.toISOString();
  }
  return { ...d, startTimestamp };
}

export default function MeetingsScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['meetings'], isAdmin);
  return (
    <ManageCrud
      load={fetchMeetings}
      create={(d) => createMeeting(withTimestamp(d))}
      save={(id, d) => updateMeeting(id, withTimestamp(d))}
      remove={deleteMeeting}
      canEdit={isAdmin}
      blank={() => ({ subject: '', date: '', startTime: '', type: 'team', location: '', description: '' })}
      fields={FIELDS}
      titleOf={(m) => m.subject}
      subtitleOf={(m) => [m.date, m.startTime, m.type].filter(Boolean).join(' · ') || '—'}
      addLabel="New meeting"
    />
  );
}
