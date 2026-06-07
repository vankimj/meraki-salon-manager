import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Alert, Modal } from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import {
  fetchTurnRoster, saveTurnRoster, fetchWaitlist, addWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry,
  fetchEmployees, fetchAttendance, fetchSettings,
} from '../../lib/firestore';

const TURN_WEIGHTS = { full: 1, half: 0.5, none: 0 };
const fmtTurns = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
import { playChime } from '../../lib/chime';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Walk-in kiosk: today's turn rotation (next tech up = fewest turns) +
// a waitlist. Front-desk tool — any staff can operate it.
export default function WalkinScreen() {
  const { canEditSchedule, isAdmin } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const canEdit = isAdmin || canEditSchedule;
  const [roster,  setRoster]  = useState(null);
  const [waitlist, setWaitlist] = useState([]);
  const [emps,    setEmps]    = useState([]);
  const [newName, setNewName] = useState('');
  const [seatingFor, setSeatingFor] = useState(null); // waitlist entry being assigned
  const [cfg, setCfg] = useState({ partialTurns: false, requestNoTurn: false });
  const [seatWeight, setSeatWeight] = useState('full');   // full | half | none (partial-turns mode)
  const [seatRequested, setSeatRequested] = useState(false);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [r, w, e, att, s] = await Promise.all([
      fetchTurnRoster(),
      fetchWaitlist(),
      fetchEmployees().catch(() => []),
      fetchAttendance(today).catch(() => ({ entries: [] })),
      fetchSettings().catch(() => ({})),
    ]);
    setCfg({ partialTurns: !!s?.walkinPartialTurns, requestNoTurn: !!s?.walkinRequestNoTurn });
    const savedRoster = r.roster || [];
    const activeEmps = e.filter(x => x.active !== false);

    // Sync the rotation with the time clock (Clock Kiosk / Attendance): a tech
    // who's clocked in auto-joins the rotation, and a tech who clocks out drops
    // off. Manually-added techs (no attendance record at all) are left alone.
    const attByEmp = {};
    (att.entries || []).forEach(en => { if (en.employeeId) attByEmp[en.employeeId] = en; });
    const clockedIn  = (id) => { const a = attByEmp[id]; return !!(a && a.clockInAt && !a.clockOutAt); };
    const clockedOut = (id) => { const a = attByEmp[id]; return !!(a && a.clockOutAt); };

    let next = savedRoster.filter(t => !clockedOut(t.techId));   // drop the ones who clocked out
    activeEmps.forEach(emp => {                                   // add the ones now clocked in
      if (clockedIn(emp.id) && !next.some(t => t.techId === emp.id)) {
        next.push({ techId: emp.id, techName: emp.name, clockInAt: attByEmp[emp.id].clockInAt, turnsTaken: 0 });
      }
    });

    setRoster(next);
    setWaitlist(w);
    setEmps(activeEmps);
    // Persist only when membership actually changed, so the 15s poll doesn't write-loop.
    if (savedRoster.map(t => t.techId).sort().join(',') !== next.map(t => t.techId).sort().join(',')) {
      try { await saveTurnRoster(today, next); } catch {}
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Chime when the waitlist grows (a new walk-in arrived). First render
  // initializes the ref silently so a fresh open doesn't ding.
  const prevWaitingRef = useRef(null);
  useEffect(() => {
    const n = waitlist.filter(w => w.status !== 'seated').length;
    if (prevWaitingRef.current !== null && n > prevWaitingRef.current) playChime();
    prevWaitingRef.current = n;
  }, [waitlist]);

  // Light polling so a front-desk kiosk picks up walk-ins added on another
  // device (and chimes) without a full live subscription.
  useEffect(() => {
    const id = setInterval(() => { load(); }, 15000);
    return () => clearInterval(id);
  }, [load]);

  async function persistRoster(next) {
    setRoster(next);
    try { await saveTurnRoster(new Date().toISOString().slice(0, 10), next); } catch { load(); }
  }
  function addTurn(techId) {
    if (!canEdit) return;
    persistRoster(roster.map(t => t.techId === techId ? { ...t, turnsTaken: (t.turnsTaken || 0) + 1 } : t));
  }
  function removeTech(techId) {
    if (!canEdit) return;
    persistRoster(roster.filter(t => t.techId !== techId));
  }
  function addTech(emp) {
    if (!canEdit || roster.some(t => t.techId === emp.id)) return;
    persistRoster([...roster, { techId: emp.id, techName: emp.name, clockInAt: new Date().toISOString(), turnsTaken: 0 }]);
  }
  async function addWaiter() {
    const name = newName.trim();
    if (!name) return;
    setNewName('');
    try { await addWaitlistEntry({ clientName: name }); await load(); }
    catch (e) { Alert.alert('Couldn\'t add', e?.message || 'Try again.'); }
  }
  // Seating a walk-in assigns them to a tech AND advances that tech's turn —
  // the two halves were previously disconnected, so the rotation only stayed
  // accurate if someone also hit "+1 turn" by hand. With no techs on the
  // roster, seat without an assignment. Default to the next-up tech but let
  // the picker override (clients often request a specific tech).
  function seat(entry) {
    if (!canEdit) return;
    setSeatWeight('full'); setSeatRequested(false);
    if (roster.length === 0) { assignSeat(entry, null); return; }
    setSeatingFor(entry);
  }
  async function assignSeat(entry, tech) {
    setSeatingFor(null);
    if (tech) {
      // Turn weight: full/half/none in partial-turns mode, else a full turn.
      // A client-requested tech takes no turn when that policy is on (Mango-style).
      let delta = cfg.partialTurns ? (TURN_WEIGHTS[seatWeight] ?? 1) : 1;
      if (seatRequested && cfg.requestNoTurn) delta = 0;
      persistRoster(roster.map(t => t.techId === tech.techId ? { ...t, turnsTaken: (t.turnsTaken || 0) + delta } : t));
    }
    try {
      await updateWaitlistEntry(entry.id, {
        status: 'seated', seatedAt: new Date().toISOString(),
        seatedTechId: tech?.techId || null, seatedTechName: tech?.techName || null,
      });
      await load();
    } catch {}
  }
  function toggleAway(techId) {
    if (!canEdit) return;
    persistRoster(roster.map(t => t.techId === techId ? { ...t, away: !t.away } : t));
  }
  async function removeWaiter(id) {
    try { await removeWaitlistEntry(id); await load(); } catch {}
  }

  if (roster === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  // Away techs sink to the bottom and never hold the "next up" star; among the
  // available, fewest turns first, then earliest clocked in.
  const sorted = [...roster].sort((a, b) =>
    (a.away ? 1 : 0) - (b.away ? 1 : 0)
    || (a.turnsTaken || 0) - (b.turnsTaken || 0)
    || (a.clockInAt || '').localeCompare(b.clockInAt || ''));
  const waiting = waitlist.filter(w => w.status !== 'seated');
  const offRoster = emps.filter(e => !roster.some(t => t.techId === e.id));

  return (
    <>
    <FlatList
      style={styles.wrap}
      data={sorted}
      keyExtractor={(t) => t.techId}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
      ListHeaderComponent={<Text style={styles.section}>Rotation — next up first</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No techs clocked in yet — they appear here automatically when they clock in at the Clock Kiosk. Or add one manually below.</Text>}
      renderItem={({ item, index }) => {
        const isNext = index === 0 && !item.away;
        return (
        <View style={[styles.row, isNext && styles.nextRow, item.away && styles.awayRow]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{isNext ? '⭐ ' : ''}{item.away ? '💤 ' : ''}{item.techName}</Text>
            <Text style={styles.sub}>{fmtTurns(item.turnsTaken)} turn{(item.turnsTaken || 0) === 1 ? '' : 's'} today{item.away ? ' · away' : ''}</Text>
          </View>
          {canEdit && (
            <>
              <TouchableOpacity style={styles.awayBtn} onPress={() => toggleAway(item.techId)}><Text style={styles.awayText}>{item.away ? 'Back' : 'Away'}</Text></TouchableOpacity>
              <TouchableOpacity style={styles.turnBtn} onPress={() => addTurn(item.techId)}><Text style={styles.turnText}>+1</Text></TouchableOpacity>
              <TouchableOpacity style={styles.xBtn} onPress={() => removeTech(item.techId)}><Text style={styles.xText}>✕</Text></TouchableOpacity>
            </>
          )}
        </View>
        );
      }}
      ListFooterComponent={
        <View>
          {canEdit && offRoster.length > 0 && (
            <>
              <Text style={styles.subSection}>Add a tech manually</Text>
              <Text style={styles.hint}>Techs who clock in at the Clock Kiosk join automatically.</Text>
              <View style={styles.chipWrap}>
                {offRoster.map(e => (
                  <TouchableOpacity key={e.id} style={styles.chip} onPress={() => addTech(e)}>
                    <Text style={styles.chipText}>+ {e.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={styles.section}>Waitlist ({waiting.length})</Text>
          {canEdit && (
            <View style={styles.addRow}>
              <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Walk-in name" placeholderTextColor={theme.placeholder} onSubmitEditing={addWaiter} returnKeyType="done" />
              <TouchableOpacity style={styles.addBtn} onPress={addWaiter}><Text style={styles.addText}>Add</Text></TouchableOpacity>
            </View>
          )}
          {waiting.length === 0 ? (
            <Text style={styles.empty}>No one waiting.</Text>
          ) : waiting.map(w => (
            <View key={w.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{w.clientName || 'Walk-in'}</Text>
                <Text style={styles.sub}>{w.addedAt ? new Date(w.addedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}{w.services ? ` · ${w.services}` : ''}</Text>
              </View>
              {canEdit && (
                <>
                  <TouchableOpacity style={styles.turnBtn} onPress={() => seat(w)}><Text style={styles.turnText}>Seat</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.xBtn} onPress={() => removeWaiter(w.id)}><Text style={styles.xText}>✕</Text></TouchableOpacity>
                </>
              )}
            </View>
          ))}
        </View>
      }
    />

    <Modal visible={!!seatingFor} transparent animationType="fade" onRequestClose={() => setSeatingFor(null)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSeatingFor(null)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Seat {seatingFor?.clientName || 'walk-in'} with…</Text>
          <Text style={styles.sheetSub}>{cfg.partialTurns ? 'Pick the turn amount, then a tech.' : 'This adds a turn to the tech you pick.'}</Text>

          {cfg.partialTurns && (
            <View style={styles.weightRow}>
              {[['full', 'Full turn'], ['half', 'Half turn'], ['none', 'No turn']].map(([w, label]) => (
                <TouchableOpacity key={w} onPress={() => setSeatWeight(w)} style={[styles.weightChip, seatWeight === w && styles.weightChipOn]}>
                  <Text style={[styles.weightChipText, seatWeight === w && styles.weightChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {cfg.requestNoTurn && (
            <TouchableOpacity style={styles.reqRow} activeOpacity={0.7} onPress={() => setSeatRequested(v => !v)}>
              <View style={[styles.reqBox, seatRequested && styles.reqBoxOn]}>{seatRequested && <Text style={styles.reqCheck}>✓</Text>}</View>
              <Text style={styles.reqLabel}>Client requested this tech (doesn't take a turn)</Text>
            </TouchableOpacity>
          )}

          {sorted.map((t, i) => (
            <TouchableOpacity key={t.techId} style={[styles.pickRow, i === 0 && !t.away && styles.pickRowNext, t.away && { opacity: 0.55 }]} onPress={() => assignSeat(seatingFor, t)}>
              <Text style={styles.pickName}>{i === 0 && !t.away ? '⭐ ' : ''}{t.away ? '💤 ' : ''}{t.techName}</Text>
              <Text style={styles.pickTurns}>{fmtTurns(t.turnsTaken)} turn{(t.turnsTaken || 0) === 1 ? '' : 's'}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.pickSkip} onPress={() => assignSeat(seatingFor, null)}>
            <Text style={styles.pickSkipText}>Seat without assigning a turn</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    </Modal>
    </>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:       { flex: 1, backgroundColor: t.bg },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  section:    { fontSize: 14, fontWeight: '800', color: t.text, marginTop: 18, marginBottom: 8 },
  subSection: { fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 16, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.3 },
  hint:       { fontSize: 11.5, color: t.textFaint, marginBottom: 8, lineHeight: 16 },
  empty:      { color: t.textFaint, fontSize: 13, paddingVertical: 14 },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 8 },
  nextRow:    { borderColor: t.green, backgroundColor: t.greenSoft },
  name:       { fontSize: 15, fontWeight: '700', color: t.text },
  sub:        { fontSize: 12, color: t.textMuted, marginTop: 2 },
  turnBtn:    { backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 },
  turnText:   { color: t.green, fontWeight: '800', fontSize: 12 },
  awayRow:    { opacity: 0.6 },
  awayBtn:    { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  awayText:   { color: t.textMuted, fontWeight: '800', fontSize: 12 },
  weightRow:  { flexDirection: 'row', gap: 8, marginBottom: 12 },
  weightChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: t.surfaceAlt },
  weightChipOn:{ backgroundColor: t.greenSoft, borderColor: t.green },
  weightChipText:{ fontSize: 13, fontWeight: '700', color: t.textMuted },
  weightChipTextOn:{ color: t.green },
  reqRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12, paddingVertical: 4 },
  reqBox:     { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: t.border, alignItems: 'center', justifyContent: 'center' },
  reqBoxOn:   { backgroundColor: t.green, borderColor: t.green },
  reqCheck:   { color: '#fff', fontSize: 14, fontWeight: '900' },
  reqLabel:   { flex: 1, fontSize: 13, color: t.text },
  xBtn:       { width: 30, height: 30, borderRadius: 15, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  xText:      { color: t.textFaint, fontSize: 14, fontWeight: '700' },
  chipWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:       { backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  chipText:   { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  addRow:     { flexDirection: 'row', gap: 8, marginBottom: 10 },
  input:      { flex: 1, backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  addBtn:     { backgroundColor: t.green, borderRadius: 10, paddingHorizontal: 18, justifyContent: 'center' },
  addText:    { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop:   { flex: 1, backgroundColor: t.overlay, justifyContent: 'center', padding: 24 },
  sheet:      { backgroundColor: t.surface, borderRadius: 18, padding: 18, borderWidth: 1, borderColor: t.border },
  sheetTitle: { fontSize: 16, fontWeight: '800', color: t.text },
  sheetSub:   { fontSize: 12, color: t.textMuted, marginTop: 3, marginBottom: 12 },
  pickRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: t.border, marginBottom: 8 },
  pickRowNext:{ borderColor: t.green, backgroundColor: t.greenSoft },
  pickName:   { fontSize: 15, fontWeight: '700', color: t.text },
  pickTurns:  { fontSize: 12, color: t.textMuted },
  pickSkip:   { paddingVertical: 12, alignItems: 'center', marginTop: 2 },
  pickSkipText:{ fontSize: 13, color: t.textFaint, fontWeight: '600' },
});
