import { fetchTurnRoster, saveTurnRoster, fetchAppointments, saveAppointment } from './firestore';
import { buildTurnValueMap, turnValueForLineName } from './turnValue';

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Mango POS model: every completed appointment counts as +1 turn for the
// performing tech. Walk-ins, scheduled appts, customer-requested techs — all
// the same. Drops the tech to the back of the walk-in rotation as fairly
// representing the work they actually did.
//
// Idempotent guard: each appointment that's been credited gets a
// _turnCredited timestamp written back, so re-saving the same appt (or
// double-firing through both checkout + manual status edit) won't double-
// count. Returns true if credit was applied, false otherwise.
//
// Today-only: the roster is per-day, so completing an appointment for a
// past or future date doesn't move today's rotation.
export async function applyTurnCredit(appt, turnMode = 'count') {
  // In value mode, turns are credited at checkout by the creditTurnsOnReceipt
  // Cloud Function from the real ticket value — never +1 here (would double-count).
  if (turnMode === 'value') return false;
  if (!appt) return false;
  if (!appt.techName) return false;
  if (appt.date !== todayStr()) return false;
  if (appt._turnCredited) return false;       // already credited — no-op

  const today = todayStr();
  try {
    const data = await fetchTurnRoster(today);
    const roster = (data && data.roster) || [];
    const idx = roster.findIndex(r => r.techName === appt.techName);
    if (idx < 0) return false;                 // tech not in today's roster
    const next = roster.map((r, i) =>
      i === idx ? { ...r, turnsTaken: (Number(r.turnsTaken) || 0) + 1 } : r
    );
    await saveTurnRoster(today, next);
    // Stamp the appt so we don't credit again.
    if (appt.id) {
      const { id, createdAt, ...rest } = appt;
      saveAppointment(id, { ...rest, _turnCredited: new Date().toISOString() }).catch(() => {});
    }
    return true;
  } catch (e) {
    console.warn('[turn credit]', e);
    return false;
  }
}

// Recompute today's roster turnsTaken from scratch by counting every
// non-cancelled, non-no_show appointment that's marked done today. Used
// to catch up after the rule changed (e.g., past checkouts that didn't
// credit) or to manually fix drift. Returns { recounted, byTech }.
export async function recomputeTodayTurns(turnMode = 'count', services = []) {
  const today = todayStr();
  const data = await fetchTurnRoster(today);
  const roster = (data && data.roster) || [];
  if (roster.length === 0) return { recounted: 0, byTech: {} };

  const todayAppts = await fetchAppointments(today);
  const counted = todayAppts.filter(a => a.status === 'done');
  // 'value' mode sums each done appt's per-service turn value; 'count' = +1 each.
  const valueMap = turnMode === 'value' ? buildTurnValueMap(services) : null;
  const byTech = {};
  counted.forEach(a => {
    if (!a.techName) return;
    const add = turnMode === 'value'
      ? (Array.isArray(a.services) ? a.services : []).reduce((s, sv) => s + turnValueForLineName(sv && (sv.name || sv.customName), valueMap), 0)
      : 1;
    byTech[a.techName] = (byTech[a.techName] || 0) + add;
  });
  const next = roster.map(r => ({ ...r, turnsTaken: byTech[r.techName] || 0 }));
  await saveTurnRoster(today, next);
  return { recounted: counted.length, byTech };
}
