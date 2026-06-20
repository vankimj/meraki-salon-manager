// Pure helpers for the structured training-program builder. Kept free of React
// and Firestore so the deep-copy-on-assign logic (the part that must not share
// references between a template and an assigned client copy) is unit-testable.

let _eid = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}_${(_eid++).toString(36)}`;

export function newExercise() {
  return { id: uid('ex'), name: '', sets: '', reps: '', load: '', tempo: '', rest: '', videoUrl: '', notes: '' };
}
export function newDay(n = 1) {
  return { id: uid('day'), name: `Day ${n}`, exercises: [newExercise()] };
}
export function newWeek(n = 1) {
  return { id: uid('wk'), name: `Week ${n}`, days: [newDay(1)] };
}
export function blankProgram() {
  return { name: '', description: '', weeks: [newWeek(1)], active: true };
}

// Count totals across a program's nested structure (for summaries / badges).
export function programStats(program) {
  const weeks = Array.isArray(program?.weeks) ? program.weeks : [];
  let days = 0, exercises = 0;
  for (const w of weeks) {
    const ds = Array.isArray(w.days) ? w.days : [];
    days += ds.length;
    for (const d of ds) exercises += (Array.isArray(d.exercises) ? d.exercises.length : 0);
  }
  return { weeks: weeks.length, days, exercises };
}

// Deep-clone the nested weeks/days/exercises so an assigned client program can
// be edited without mutating the source template (and vice-versa). Uses
// structuredClone when available, falling back to a JSON round-trip.
export function cloneWeeks(weeks) {
  const src = Array.isArray(weeks) ? weeks : [];
  if (typeof structuredClone === 'function') return structuredClone(src);
  return JSON.parse(JSON.stringify(src));
}

// Build the clientPrograms doc payload from a template + client. Stamps
// `clientEmail` (lowercased) so the portal can read the doc via the
// clientEmail-match Firestore rule without a Cloud Function.
export function assignProgram(template, client, { startDate } = {}) {
  return {
    templateId:   template.id || null,
    templateName: template.name || '',
    name:         template.name || 'Program',
    description:  template.description || '',
    weeks:        cloneWeeks(template.weeks),
    clientId:     client?.id || '',
    clientName:   client?.name || '',
    clientEmail:  String(client?.email || '').toLowerCase(),
    status:       'active',
    currentWeek:  1,
    startDate:    startDate || new Date().toISOString().slice(0, 10),
    notes:        '',
  };
}
