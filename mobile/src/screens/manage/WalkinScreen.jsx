import { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, RefreshControl, Alert, Modal, ScrollView } from 'react-native';
import useTenantAccess from '../../hooks/useTenantAccess';
import {
  fetchTurnRoster, saveTurnRoster, fetchWaitlist, addWaitlistEntry, updateWaitlistEntry, removeWaitlistEntry,
  fetchEmployees, fetchAttendance, fetchSettings, fetchServices,
  fetchClientByPhone, createClient,
} from '../../lib/firestore';

const fmtTurns = (n) => { const v = Number(n) || 0; return Number.isInteger(v) ? String(v) : v.toFixed(1); };
import { playChime } from '../../lib/chime';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import TurnHelpSheet from '../../components/TurnHelpSheet';

// Walk-in kiosk: today's turn rotation (next tech up = fewest turns) +
// a waitlist. Front-desk tool — any staff can operate it.
export default function WalkinScreen() {
  const { canEditSchedule, isAdmin } = useTenantAccess();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const canEdit = isAdmin;   // Walk-in Manager is read-only to everyone except admins
  const [roster,  setRoster]  = useState(null);
  const [waitlist, setWaitlist] = useState([]);
  const [emps,    setEmps]    = useState([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [foundClient, setFoundClient] = useState(null); // existing client matched by phone
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);          // add-walk-in modal open
  const [newServiceIds, setNewServiceIds] = useState([]); // services the walk-in wants
  const [newTechId, setNewTechId] = useState(null);     // requested tech id, or null = no preference
  const [seatingFor, setSeatingFor] = useState(null); // waitlist entry being assigned
  const [cfg, setCfg] = useState({ partialTurns: false, requestNoTurn: false, seniority: false });
  const [services, setServices] = useState([]);
  const [seatWeight, setSeatWeight] = useState(1);        // numeric turn weight (partial-turns mode)
  const [seatRequested, setSeatRequested] = useState(false);
  const [lastSeat, setLastSeat] = useState(null);         // { entryId, techId, delta, clientName, techName } — undo target
  const [showHelp, setShowHelp] = useState(false);        // "how turns work" explainer

  // Auto-dismiss the undo banner after a few seconds.
  useEffect(() => {
    if (!lastSeat) return;
    const id = setTimeout(() => setLastSeat(null), 7000);
    return () => clearTimeout(id);
  }, [lastSeat]);

  const load = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [r, w, e, att, s, svc] = await Promise.all([
      fetchTurnRoster(),
      fetchWaitlist(),
      fetchEmployees().catch(() => []),
      fetchAttendance(today).catch(() => ({ entries: [] })),
      fetchSettings().catch(() => ({})),
      fetchServices().catch(() => []),
    ]);
    setCfg({ partialTurns: !!s?.walkinPartialTurns, requestNoTurn: !!s?.walkinRequestNoTurn, seniority: !!s?.walkinSeniorityOrder });
    setServices((svc || []).filter(x => x.active !== false));
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
  // Manual correction partner to +1 — back a turn out (over-counted, or a +1
  // misfire). Clamped at 0 so a tech can't go negative.
  function subTurn(techId) {
    if (!canEdit) return;
    persistRoster(roster.map(t => t.techId === techId ? { ...t, turnsTaken: Math.max(0, (t.turnsTaken || 0) - 1) } : t));
  }
  function removeTech(techId) {
    if (!canEdit) return;
    persistRoster(roster.filter(t => t.techId !== techId));
  }
  function addTech(emp) {
    if (!canEdit || roster.some(t => t.techId === emp.id)) return;
    persistRoster([...roster, { techId: emp.id, techName: emp.name, clockInAt: new Date().toISOString(), turnsTaken: 0 }]);
  }
  function openAdd() {
    if (!canEdit) return;
    setNewName(''); setNewPhone(''); setFoundClient(null);
    setNewServiceIds([]); setNewTechId(null); setAdding(true);
  }
  async function searchPhone() {
    const digits = (newPhone.match(/\d/g) || []).join('');
    if (digits.replace(/^1(?=\d{10}$)/, '').length < 10) { Alert.alert('Enter a 10-digit phone number'); return; }
    setSearching(true);
    try {
      const c = await fetchClientByPhone(newPhone);
      if (c) { setFoundClient(c); setNewName(c.name || ''); }
      else { setFoundClient(null); Alert.alert('No match', 'No client found — enter a name to create a new profile.'); }
    } catch (e) { Alert.alert('Search failed', e?.message || 'Try again.'); }
    finally { setSearching(false); }
  }
  async function addWaiter() {
    const name = newName.trim();
    const digits = (newPhone.match(/\d/g) || []).join('');
    if (!name) { Alert.alert('Name required'); return; }
    if (!foundClient && digits.replace(/^1(?=\d{10}$)/, '').length < 10) { Alert.alert('Phone required', 'A phone number is needed to create a profile.'); return; }
    const serviceNames = services.filter(s => newServiceIds.includes(s.id)).map(s => s.name);
    const reqTech = newTechId ? emps.find(e => e.id === newTechId) : null;
    setAdding(false);
    try {
      // Existing client → link; otherwise create a profile from name + phone.
      let clientId = foundClient?.id || null;
      if (!clientId) { clientId = await createClient({ name, phone: newPhone.trim() }); }
      await addWaitlistEntry({
        clientId,
        clientName: name,
        clientPhone: foundClient?.phone || newPhone.trim(),
        serviceIds: newServiceIds,
        serviceNames,
        requestedTechId: reqTech?.id || null,
        requestedTechName: reqTech?.name || null,
      });
      setNewName(''); setNewPhone(''); setFoundClient(null); setNewServiceIds([]); setNewTechId(null);
      await load();
    } catch (e) { Alert.alert('Couldn\'t add', e?.message || 'Try again.'); }
  }
  // Seating a walk-in assigns them to a tech AND advances that tech's turn —
  // the two halves were previously disconnected, so the rotation only stayed
  // accurate if someone also hit "+1 turn" by hand. With no techs on the
  // roster, seat without an assignment. Default to the next-up tech but let
  // the picker override (clients often request a specific tech).
  function seat(entry) {
    if (!canEdit) return;
    setSeatWeight(1); setSeatRequested(false);
    if (roster.length === 0) { assignSeat(entry, null); return; }
    setSeatingFor(entry);
  }
  async function assignSeat(entry, tech) {
    setSeatingFor(null);
    // Turn weight: full/half/none in partial-turns mode, else a full turn.
    // A client-requested tech takes no turn when that policy is on (Mango-style).
    let delta = 0;
    if (tech) {
      delta = cfg.partialTurns ? (Number(seatWeight) || 0) : 1;
      if (seatRequested && cfg.requestNoTurn) delta = 0;
      persistRoster(roster.map(t => t.techId === tech.techId ? { ...t, turnsTaken: (t.turnsTaken || 0) + delta } : t));
    }
    try {
      await updateWaitlistEntry(entry.id, {
        status: 'seated', seatedAt: new Date().toISOString(),
        seatedTechId: tech?.techId || null, seatedTechName: tech?.techName || null,
        seatTurnDelta: delta,
      });
      setLastSeat({ entryId: entry.id, techId: tech?.techId || null, delta, clientName: entry.clientName || 'Walk-in', techName: tech?.techName || null });
      await load();
    } catch {}
  }
  // Undo the most recent seating: put the turn back on the tech and return the
  // walk-in to the waitlist. Covers the "seated the wrong tech" misclick.
  async function undoSeat() {
    const ls = lastSeat;
    if (!ls) return;
    setLastSeat(null);
    if (ls.techId && ls.delta) {
      persistRoster(roster.map(t => t.techId === ls.techId ? { ...t, turnsTaken: Math.max(0, (t.turnsTaken || 0) - ls.delta) } : t));
    }
    try {
      await updateWaitlistEntry(ls.entryId, {
        status: 'waiting', seatedAt: null, seatedTechId: null, seatedTechName: null, seatTurnDelta: null,
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
  // available, fewest turns first, then (optionally) by seniority (employee
  // sortOrder), then earliest clocked in.
  const senById = {};
  const empById = {};
  emps.forEach(e => { senById[e.id] = Number.isFinite(e.sortOrder) ? e.sortOrder : 999; empById[e.id] = e; });
  const sorted = [...roster].sort((a, b) =>
    (a.away ? 1 : 0) - (b.away ? 1 : 0)
    || (a.turnsTaken || 0) - (b.turnsTaken || 0)
    || (cfg.seniority ? ((senById[a.techId] ?? 999) - (senById[b.techId] ?? 999)) : 0)
    || (a.clockInAt || '').localeCompare(b.clockInAt || ''));
  // Can this tech perform every requested service? Empty skill list = unconfigured
  // → treat as can-do-all (so salons that haven't set skills aren't blocked).
  const canDoServices = (techId, serviceIds) => {
    if (!serviceIds || serviceIds.length === 0) return true;
    const skills = empById[techId]?.serviceIds;
    if (!Array.isArray(skills) || skills.length === 0) return true;
    return serviceIds.every(sid => skills.includes(sid));
  };
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
      ListHeaderComponent={
        <View style={styles.sectionRow}>
          <Text style={styles.section}>Rotation — next up first</Text>
          <TouchableOpacity style={styles.helpBtn} onPress={() => setShowHelp(true)}>
            <Text style={styles.helpBtnText}>? How turns work</Text>
          </TouchableOpacity>
        </View>
      }
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
              {(item.turnsTaken || 0) > 0 && (
                <TouchableOpacity style={styles.minusBtn} onPress={() => subTurn(item.techId)}><Text style={styles.minusText}>−1</Text></TouchableOpacity>
              )}
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
            <TouchableOpacity style={styles.addWalkinBtn} onPress={openAdd}>
              <Text style={styles.addWalkinText}>＋ Add walk-in</Text>
            </TouchableOpacity>
          )}
          {waiting.length === 0 ? (
            <Text style={styles.empty}>No one waiting.</Text>
          ) : waiting.map(w => {
            const svc = (w.serviceNames && w.serviceNames.length) ? w.serviceNames.join(', ') : (w.services || '');
            const pref = w.requestedTechName ? `wants ${w.requestedTechName}` : 'no preference';
            const time = w.addedAt ? new Date(w.addedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
            return (
            <View key={w.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{w.clientName || 'Walk-in'}</Text>
                <Text style={styles.sub} numberOfLines={2}>{[time, svc, pref].filter(Boolean).join(' · ')}</Text>
              </View>
              {canEdit && (
                <>
                  <TouchableOpacity style={styles.turnBtn} onPress={() => seat(w)}><Text style={styles.turnText}>Seat</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.xBtn} onPress={() => removeWaiter(w.id)}><Text style={styles.xText}>✕</Text></TouchableOpacity>
                </>
              )}
            </View>
            );
          })}
        </View>
      }
    />

    {lastSeat && (
      <View style={styles.undoBar}>
        <Text style={styles.undoText} numberOfLines={1}>
          Seated {lastSeat.clientName}{lastSeat.techName ? ` with ${lastSeat.techName}` : ''}
        </Text>
        <TouchableOpacity style={styles.undoBtn} onPress={undoSeat}>
          <Text style={styles.undoBtnText}>Undo</Text>
        </TouchableOpacity>
      </View>
    )}

    <TurnHelpSheet visible={showHelp} onClose={() => setShowHelp(false)} />

    <Modal visible={adding} transparent animationType="fade" onRequestClose={() => setAdding(false)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setAdding(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <Text style={styles.sheetTitle}>Add walk-in</Text>
          <Text style={styles.sheetSub}>Search an existing client by phone, or enter name + phone to create a profile.</Text>
          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            <Text style={styles.fieldLbl}>Phone</Text>
            <View style={styles.addRow}>
              <TextInput style={styles.input} value={newPhone} onChangeText={t => { setNewPhone(t); setFoundClient(null); }} keyboardType="phone-pad" placeholder="(555) 123-4567" placeholderTextColor={theme.placeholder} />
              <TouchableOpacity style={[styles.addBtn, searching && { opacity: 0.6 }]} onPress={searchPhone} disabled={searching}>
                <Text style={styles.addText}>{searching ? '…' : 'Search'}</Text>
              </TouchableOpacity>
            </View>
            {!!foundClient && (
              <View style={styles.foundBanner}><Text style={styles.foundText}>✓ {foundClient.name} — existing client</Text></View>
            )}

            <Text style={styles.fieldLbl}>Name</Text>
            <TextInput style={styles.inputFull} value={newName} onChangeText={setNewName} placeholder="Customer name" placeholderTextColor={theme.placeholder} editable={!foundClient} />

            <Text style={styles.fieldLbl}>Services wanted</Text>
            <View style={styles.svcWrap}>
              {services.length === 0 ? <Text style={styles.hint}>No services configured.</Text> : services.map(s => {
                const on = newServiceIds.includes(s.id);
                return (
                  <TouchableOpacity key={s.id} onPress={() => setNewServiceIds(on ? newServiceIds.filter(x => x !== s.id) : [...newServiceIds, s.id])} style={[styles.svcChip, on && styles.svcChipOn]}>
                    <Text style={[styles.svcChipText, on && styles.svcChipTextOn]} numberOfLines={1}>{s.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.fieldLbl}>Tech preference</Text>
            <View style={styles.svcWrap}>
              <TouchableOpacity onPress={() => setNewTechId(null)} style={[styles.svcChip, !newTechId && styles.svcChipOn]}>
                <Text style={[styles.svcChipText, !newTechId && styles.svcChipTextOn]}>No preference</Text>
              </TouchableOpacity>
              {emps.map(e => {
                const on = newTechId === e.id;
                const elig = newServiceIds.length === 0 || canDoServices(e.id, newServiceIds);
                return (
                  <TouchableOpacity key={e.id} onPress={() => setNewTechId(e.id)} style={[styles.svcChip, on && styles.svcChipOn, !elig && { opacity: 0.45 }]}>
                    <Text style={[styles.svcChipText, on && styles.svcChipTextOn]} numberOfLines={1}>{e.name}{!elig ? ' ⚠︎' : ''}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
          <TouchableOpacity style={styles.addWalkinSubmit} onPress={addWaiter}>
            <Text style={styles.addWalkinSubmitText}>Add to waitlist</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>

    <Modal visible={!!seatingFor} transparent animationType="fade" onRequestClose={() => setSeatingFor(null)}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setSeatingFor(null)}>
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Seat {seatingFor?.clientName || 'walk-in'} with…</Text>
          <Text style={styles.sheetSub}>{cfg.partialTurns ? `Pick the turn amount (now: ${fmtTurns(seatWeight)}), then a tech.` : 'This adds a turn to the tech you pick.'}</Text>

          <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
            {cfg.partialTurns && (
              <>
                <View style={styles.weightRow}>
                  {[['Full', 1], ['Half', 0.5], ['None', 0]].map(([label, w]) => (
                    <TouchableOpacity key={label} onPress={() => setSeatWeight(w)} style={[styles.weightChip, seatWeight === w && styles.weightChipOn]}>
                      <Text style={[styles.weightChipText, seatWeight === w && styles.weightChipTextOn]}>{label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {services.length > 0 && (
                  <View style={styles.svcWrap}>
                    {services.map(s => {
                      const w = Number(s.turnWeight) || 1;
                      return (
                        <TouchableOpacity key={s.id} onPress={() => setSeatWeight(w)} style={[styles.svcChip, seatWeight === w && styles.svcChipOn]}>
                          <Text style={[styles.svcChipText, seatWeight === w && styles.svcChipTextOn]} numberOfLines={1}>{s.name} ·{fmtTurns(w)}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </>
            )}
            {cfg.requestNoTurn && (
              <TouchableOpacity style={styles.reqRow} activeOpacity={0.7} onPress={() => setSeatRequested(v => !v)}>
                <View style={[styles.reqBox, seatRequested && styles.reqBoxOn]}>{seatRequested && <Text style={styles.reqCheck}>✓</Text>}</View>
                <Text style={styles.reqLabel}>Client requested this tech (doesn't take a turn)</Text>
              </TouchableOpacity>
            )}

            {(() => {
              // Route by skill: techs who can do the requested service(s) come
              // first (requested tech pinned to top); those who can't are dimmed
              // with a note at the bottom but stay tappable as an override.
              const reqSvc = seatingFor?.serviceIds || [];
              const reqSvcNames = (seatingFor?.serviceNames || []).join(', ');
              const reqTechId = seatingFor?.requestedTechId || null;
              const ordered = sorted
                .map(t => ({ ...t, _elig: canDoServices(t.techId, reqSvc), _req: reqTechId === t.techId }))
                .sort((a, b) => (b._req ? 1 : 0) - (a._req ? 1 : 0) || (b._elig ? 1 : 0) - (a._elig ? 1 : 0));
              const nextId = ordered.find(t => !t.away && t._elig)?.techId;
              return ordered.map(t => (
                <TouchableOpacity key={t.techId} style={[styles.pickRow, t.techId === nextId && styles.pickRowNext, (t.away || !t._elig) && { opacity: 0.5 }]} onPress={() => assignSeat(seatingFor, t)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pickName}>{t.techId === nextId ? '⭐ ' : ''}{t.away ? '💤 ' : ''}{t.techName}{t._req ? '  ·  requested' : ''}</Text>
                    {!t._elig && <Text style={styles.pickWarn}>doesn't do {reqSvcNames || 'this service'}</Text>}
                  </View>
                  <Text style={styles.pickTurns}>{fmtTurns(t.turnsTaken)} turn{(t.turnsTaken || 0) === 1 ? '' : 's'}</Text>
                </TouchableOpacity>
              ));
            })()}
            <TouchableOpacity style={styles.pickSkip} onPress={() => assignSeat(seatingFor, null)}>
              <Text style={styles.pickSkipText}>Seat without assigning a turn</Text>
            </TouchableOpacity>
          </ScrollView>
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
  minusBtn:   { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 7 },
  minusText:  { color: t.textMuted, fontWeight: '800', fontSize: 12 },
  awayRow:    { opacity: 0.6 },
  awayBtn:    { backgroundColor: t.surfaceAlt, borderWidth: 1, borderColor: t.border, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  awayText:   { color: t.textMuted, fontWeight: '800', fontSize: 12 },
  weightRow:  { flexDirection: 'row', gap: 8, marginBottom: 12 },
  weightChip: { flex: 1, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: t.border, alignItems: 'center', backgroundColor: t.surfaceAlt },
  weightChipOn:{ backgroundColor: t.greenSoft, borderColor: t.green },
  weightChipText:{ fontSize: 13, fontWeight: '700', color: t.textMuted },
  weightChipTextOn:{ color: t.green },
  svcWrap:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  svcChip:    { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: t.border, backgroundColor: t.surfaceAlt, maxWidth: '100%' },
  svcChipOn:  { backgroundColor: t.greenSoft, borderColor: t.green },
  svcChipText:{ fontSize: 12, fontWeight: '600', color: t.textMuted },
  svcChipTextOn:{ color: t.green },
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
  addWalkinBtn: { backgroundColor: t.green, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginBottom: 10 },
  addWalkinText:{ color: '#fff', fontWeight: '800', fontSize: 14 },
  undoBar:    { position: 'absolute', left: 14, right: 14, bottom: 20, backgroundColor: t.text, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.22, shadowRadius: 8, elevation: 6 },
  undoText:   { flex: 1, color: t.bg, fontSize: 14, fontWeight: '600' },
  undoBtn:    { backgroundColor: t.green, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  undoBtnText:{ color: '#fff', fontSize: 14, fontWeight: '800' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 8 },
  helpBtn:    { backgroundColor: t.blueSoft, borderWidth: 1, borderColor: t.blue, borderRadius: 14, paddingHorizontal: 11, paddingVertical: 6 },
  helpBtnText:{ color: t.blue, fontWeight: '700', fontSize: 12 },
  helpBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' },
  helpSheet:  { backgroundColor: t.bg, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '88%' },
  helpHead:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: t.border },
  helpTitle:  { fontSize: 17, fontWeight: '800', color: t.text, flex: 1 },
  helpClose:  { fontSize: 18, color: t.textMuted, fontWeight: '700', paddingLeft: 12 },
  helpIntro:  { fontSize: 14, lineHeight: 21, color: t.text },
  helpH:      { fontSize: 14, fontWeight: '800', color: t.green, marginBottom: 6 },
  helpP:      { fontSize: 13.5, lineHeight: 20, color: t.textMuted, marginBottom: 6 },
  helpBulletRow: { flexDirection: 'row', gap: 8, marginBottom: 5, paddingRight: 4 },
  helpBulletDot: { fontSize: 14, color: t.green, lineHeight: 20 },
  helpBulletText:{ flex: 1, fontSize: 13.5, lineHeight: 20, color: t.textMuted },
  helpExample: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 14, marginBottom: 10 },
  helpExampleTitle: { fontSize: 13.5, fontWeight: '700', color: t.text, marginBottom: 8 },
  helpExLineRow: { flexDirection: 'row', gap: 8, marginBottom: 5 },
  helpExArrow: { color: t.green, fontWeight: '800', fontSize: 14, lineHeight: 19 },
  helpExLine: { flex: 1, fontSize: 13, lineHeight: 19, color: t.textMuted },
  helpFooter: { fontSize: 13, fontStyle: 'italic', color: t.textFaint, marginTop: 14, lineHeight: 19 },
  fieldLbl:   { fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 12, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  inputFull:  { backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  foundBanner:{ backgroundColor: t.greenSoft, borderRadius: 10, padding: 10, marginTop: 8, borderWidth: 1, borderColor: t.green },
  foundText:  { color: t.green, fontWeight: '700', fontSize: 13 },
  addWalkinSubmit: { marginTop: 14, backgroundColor: t.green, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  addWalkinSubmitText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  pickWarn:   { fontSize: 11, color: t.danger, marginTop: 2 },
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
