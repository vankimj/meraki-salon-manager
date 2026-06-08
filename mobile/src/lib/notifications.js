import { collection, addDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getCurrentTenant } from './currentTenant';

// Mobile mirror of web src/lib/notifications.js. Writes notification docs to
// tenants/{id}/notifications; the sendApptNotification Cloud Function turns each
// into a push to the affected tech. Same diff logic as web so behavior matches:
// new → assigned tech; reassign → both techs; same-tech change → modified.
// The editor is never notified about their own change.

function fmtTime(str) {
  if (!str) return '';
  const [h, m] = str.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}
function fmtDate(str) {
  if (!str) return str;
  return new Date(str + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export async function notifyAffectedTechs(original, updated, editorUser = auth.currentUser) {
  const editorName = editorUser?.displayName?.split(' ')[0] || editorUser?.email || 'Someone';
  const origTech   = original?.techName || null;
  const newTech    = updated.techName   || null;
  const isNew      = !original?.id;
  const client     = updated.clientName || 'a walk-in';
  const when       = `${fmtDate(updated.date)} at ${fmtTime(updated.startTime)}`;
  const pending    = [];

  if (isNew) {
    if (newTech && newTech !== editorName) {
      pending.push({ techName: newTech, message: `Hi ${newTech}! ${editorName} booked an appointment for ${client} on ${when}.`, changeType: 'appt_added' });
    }
  } else if (origTech !== newTech) {
    if (origTech && origTech !== editorName) {
      pending.push({ techName: origTech, message: `Hi ${origTech}! ${editorName} reassigned your appointment for ${client} on ${when} to ${newTech}.`, changeType: 'appt_removed' });
    }
    if (newTech && newTech !== editorName) {
      pending.push({ techName: newTech, message: `Hi ${newTech}! ${editorName} assigned an appointment for ${client} on ${when} to you.`, changeType: 'appt_assigned' });
    }
  } else if (newTech && newTech !== editorName) {
    const changes = [];
    if (original.date !== updated.date || original.startTime !== updated.startTime) changes.push(`rescheduled to ${when}`);
    else if (original.status !== updated.status) changes.push(updated.status === 'cancelled' ? 'cancelled' : `status → ${updated.status}`);
    else if (JSON.stringify(original.services) !== JSON.stringify(updated.services)) changes.push('services updated');
    else changes.push('details updated');
    pending.push({ techName: newTech, message: `Hi ${newTech}! ${editorName} updated your appointment for ${client} on ${when}: ${changes.join(', ')}.`, changeType: 'appt_modified' });
  }

  if (!pending.length) return;
  const base = {
    apptId:         updated.id || null,
    date:           updated.date,
    clientName:     client,
    startTime:      updated.startTime,
    changedBy:      editorName,
    changedByEmail: editorUser?.email || '',
    createdAt:      new Date().toISOString(),
    sent:           false,
  };
  const col = collection(db, 'tenants', getCurrentTenant(), 'notifications');
  await Promise.all(pending.map(n => addDoc(col, { ...base, ...n })));
}
