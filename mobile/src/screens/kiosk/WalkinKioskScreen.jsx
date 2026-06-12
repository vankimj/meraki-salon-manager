import { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  Image, StyleSheet, Switch, useWindowDimensions,
} from 'react-native';
import {
  fetchServices, fetchEmployees, fetchWaitlist, addWaitlistEntry,
  kioskRegisterClient, kioskWalkinOptions,
} from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';
import {
  digitsOnly, fmtPhoneInput, fmtPhoneStored, waitLabel, availabilityView,
} from '../../lib/kioskWalkin';

// Reusable UI built once per (styles, theme) and memoized in the component so
// these stay STABLE across re-renders — otherwise a TextInput nested under an
// inline-defined component would remount on every keystroke and lose focus.
function makeKioskUI(styles, theme) {
  const Shell = ({ children }) => (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={styles.shell} keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', maxWidth: 560 }}>{children}</View>
    </ScrollView>
  );
  const Hero = ({ title, sub, tint }) => (
    <View style={styles.hero}>
      <Text style={[styles.heroMark, tint ? { color: tint } : null]}>✦</Text>
      <Text style={styles.heroTitle}>{title}</Text>
      {!!sub && <Text style={styles.heroSub}>{sub}</Text>}
    </View>
  );
  const Primary = ({ label, onPress, disabled }) => (
    <TouchableOpacity style={[styles.btn, styles.btnPrimary, disabled && styles.btnDisabled]} onPress={onPress} disabled={disabled} activeOpacity={0.85}>
      <Text style={styles.btnPrimaryText}>{label}</Text>
    </TouchableOpacity>
  );
  const Secondary = ({ label, onPress }) => (
    <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={onPress} activeOpacity={0.85}>
      <Text style={styles.btnSecondaryText}>{label}</Text>
    </TouchableOpacity>
  );
  const AvailCard = ({ techName, wait, note, tint }) => (
    <View style={[styles.availCard, tint ? { borderColor: tint } : null]}>
      <Text style={styles.availTech}>{techName}</Text>
      <Text style={[styles.availWait, tint ? { color: tint } : null]}>{wait != null ? `~${waitLabel(wait)} wait` : 'Wait time TBD'}</Text>
      {!!note && <Text style={styles.availNote}>{note}</Text>}
    </View>
  );
  return { Shell, Hero, Primary, Secondary, AvailCard };
}

// Native front-desk-kiosk walk-in sign-in. Phone-first: look the customer up by
// number (guarded CF — no PII on-device), greet returning clients or capture a
// new one, pick a service + tech preference, see the server-computed wait, and
// join the walk-in queue. Mirrors the web /?queue (QueueKiosk) flow + backend so
// the two surfaces stay identical. The walk-in entries land in the same waitlist
// the Schedule queue / Walk-in Manager seat from.
export default function WalkinKioskScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { width, height } = useWindowDimensions();
  const narrow = width < height; // portrait
  const { Shell, Hero, Primary, Secondary, AvailCard } = useMemo(() => makeKioskUI(styles, theme), [styles, theme]);

  const [services, setServices] = useState([]);
  const [techs, setTechs] = useState([]);
  const [queueCount, setQueueCount] = useState(0);

  const [step, setStep] = useState('welcome');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [identity, setIdentity] = useState(null); // { clientId, firstName, fullName, todayAppt }
  const [svcSel, setSvcSel] = useState(null);
  const [removalNeeded, setRemovalNeeded] = useState(false);
  const [techSel, setTechSel] = useState('Any');
  const [avail, setAvail] = useState(null);
  const [working, setWorking] = useState(false);
  const [position, setPosition] = useState(null);
  const [arrPhone, setArrPhone] = useState('');
  const [arrMatched, setArrMatched] = useState(null);

  useEffect(() => {
    fetchServices().then(s => setServices((s || []).filter(sv => sv.active !== false))).catch(() => {});
    fetchEmployees().then(e => setTechs((e || []).filter(emp => emp.active !== false))).catch(() => {});
  }, []);

  const refreshCount = useCallback(() => {
    fetchWaitlist().then(list => setQueueCount((list || []).filter(e => e.status !== 'seated').length)).catch(() => {});
  }, []);
  useEffect(() => { refreshCount(); }, [refreshCount]);

  function reset() {
    setStep('welcome'); setPhone(''); setFirstName(''); setLastName(''); setIdentity(null);
    setSvcSel(null); setRemovalNeeded(false); setTechSel('Any'); setAvail(null);
    setWorking(false); setPosition(null); setArrPhone(''); setArrMatched(null);
    refreshCount();
  }

  async function lookupPhone() {
    if (phone.length !== 10 || working) return;
    setWorking(true); setStep('lookup');
    try {
      const res = await kioskRegisterClient({ phone });
      if (!res || res.error || res.banned) return setStep('frontdesk');
      if (res.matched) {
        setIdentity({ clientId: res.clientId, firstName: res.firstName, fullName: res.firstName, todayAppt: res.todayAppt || null });
        setStep('greet');
      } else {
        setStep('new-prompt');
      }
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  async function createClient() {
    if (!firstName.trim() || !lastName.trim() || working) return;
    setWorking(true);
    try {
      const res = await kioskRegisterClient({ phone, firstName: firstName.trim(), lastName: lastName.trim() });
      if (!res || res.error || res.banned) return setStep('frontdesk');
      setIdentity({
        clientId: res.clientId,
        firstName: res.firstName || firstName.trim(),
        fullName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        todayAppt: res.todayAppt || null,
      });
      setStep('service');
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  async function chooseTech(t) {
    if (working) return;
    setWorking(true); setTechSel(t); setAvail(null); setStep('availability');
    try {
      const res = await kioskWalkinOptions({ serviceId: svcSel.id, requestedTechName: t === 'Any' ? '' : t });
      if (!res || res.error) return setStep('frontdesk');
      setAvail(res);
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  async function joinQueue({ techName, requestedTechName, waitMin }) {
    if (working) return;
    setWorking(true);
    try {
      const reqTech = requestedTechName ? techs.find(t => t.name === requestedTechName) : null;
      await addWaitlistEntry({
        clientId: identity?.clientId || '',
        clientName: identity?.fullName || identity?.firstName || 'Guest',
        clientPhone: fmtPhoneStored(phone),
        serviceId: svcSel?.id || '',
        serviceName: svcSel?.name || '',
        serviceIds: svcSel?.id ? [svcSel.id] : [],
        serviceNames: svcSel?.name ? [svcSel.name] : [],
        removal: removalNeeded,
        techName: techName || 'Any',
        requestedTechName: requestedTechName || '',
        requestedTechId: reqTech?.id || null,
        estimatedWaitMin: Number.isFinite(waitMin) ? waitMin : null,
        isWalkIn: true,
        hasAppointment: !!identity?.todayAppt,
      });
      setPosition(queueCount + 1);
      setStep('done-walkin');
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  async function submitArrival() {
    if (arrPhone.length !== 10 || working) return;
    setWorking(true);
    try {
      const res = await kioskRegisterClient({ phone: arrPhone });
      if (!res || res.error || res.banned) return setStep('frontdesk');
      const appt = res.todayAppt || null;
      await addWaitlistEntry({
        clientId: res.clientId || '',
        clientName: res.firstName || 'Guest',
        clientPhone: fmtPhoneStored(arrPhone),
        apptId: appt?.apptId || '',
        serviceName: appt?.serviceName || '',
        serviceNames: appt?.serviceName ? [appt.serviceName] : [],
        techName: appt?.techName || 'Any',
        isWalkIn: false,
        hasAppointment: !!appt,
      });
      setArrMatched({ firstName: res.firstName || '', appt });
      setStep('done-arrival');
    } catch { setStep('frontdesk'); } finally { setWorking(false); }
  }

  // availability sub-renderer (uses the tested availabilityView descriptor)
  function renderAvailability(v) {
    if (v.kind === 'loading') return <View style={styles.loadingBox}><ActivityIndicator size="large" color={theme.green} /><Text style={styles.loadingText}>Checking availability…</Text></View>;
    if (v.kind === 'closed') return (<><Hero title="We're closed right now" sub="Please check our hours and come back during open times." /><Primary label="Done" onPress={reset} /></>);
    if (v.kind === 'noTech') return (
      <>
        <Hero title="No tech is open right now" sub={`for ${svcSel?.name || 'this service'}`} />
        <Text style={styles.heroSub}>You can still join the queue and we'll fit you in as soon as someone's free.</Text>
        <Primary label={working ? 'Joining…' : 'Join the queue anyway'} onPress={() => joinQueue({ techName: 'Any', requestedTechName: techSel === 'Any' ? '' : techSel, waitMin: null })} disabled={working} />
        <Secondary label="Pick a different service" onPress={() => setStep('service')} />
      </>
    );
    if (v.kind === 'noPref') return (
      <>
        <Hero title="Here's the soonest opening" sub={svcSel?.name ? `for your ${svcSel.name}` : ''} />
        <AvailCard tint={theme.green} techName={v.primary.techName} wait={v.primary.waitMinutes} note={v.primary.note} />
        <View style={styles.btnRow}>
          <Secondary label="‹ Back" onPress={() => setStep('tech')} />
          <Primary label={working ? 'Joining…' : 'Join the queue'} onPress={() => joinQueue(v.join)} disabled={working} />
        </View>
      </>
    );
    if (v.kind === 'soon') return (
      <>
        <Hero title={`${v.primary.techName} can see you soon`} />
        <AvailCard tint={theme.green} techName={v.primary.techName} wait={v.primary.waitMinutes} note={v.primary.note} />
        <View style={styles.btnRow}>
          <Secondary label="‹ Back" onPress={() => setStep('tech')} />
          <Primary label={working ? 'Joining…' : 'Join the queue'} onPress={() => joinQueue(v.join)} disabled={working} />
        </View>
      </>
    );
    if (v.kind === 'techUnavailable') return (
      <>
        <Hero title={`${v.techSel} isn't available today`} sub={v.alt ? 'Someone else can help you sooner.' : ''} />
        {v.alt && <AvailCard tint={theme.green} techName={v.alt.techName} wait={v.alt.waitMinutes} note="available instead" />}
        {v.joinAlt && <Primary label={`Choose ${v.alt.techName}`} onPress={() => joinQueue(v.joinAlt)} disabled={working} />}
        <Secondary label={`Wait for ${v.techSel} anyway`} onPress={() => joinQueue(v.joinWait)} />
        <Secondary label="Pick someone else" onPress={() => setStep('tech')} />
      </>
    );
    // 'wait' — requested tech > 1hr
    return (
      <>
        <Hero title={`${v.techSel} has a bit of a wait`} sub={`About ${waitLabel(v.primaryWaitMinutes)}.`} />
        {v.suggest && <AvailCard tint={theme.green} techName={v.suggest.techName} wait={v.suggest.waitMinutes} note={v.suggest.immediate ? 'available now' : 'available sooner'} />}
        {v.joinSuggest && <Primary label={`Switch to ${v.suggest.techName} (${waitLabel(v.suggest.waitMinutes)})`} onPress={() => joinQueue(v.joinSuggest)} disabled={working} />}
        <Secondary label={`Keep ${v.techSel} (${waitLabel(v.primaryWaitMinutes)})`} onPress={() => joinQueue(v.joinKeep)} />
        <Secondary label="‹ Back" onPress={() => setStep('tech')} />
      </>
    );
  }

  // ── steps ──
  if (step === 'welcome') {
    return (
      <Shell>
        <View style={{ alignItems: 'center', marginBottom: 28, marginTop: 12 }}>
          <Text style={styles.welcomeTitle}>How can we help?</Text>
          <Text style={styles.welcomeSub}>Tap one to get started.</Text>
          {queueCount > 0 && <Text style={styles.queuePill}>⏱  {queueCount} {queueCount === 1 ? 'person' : 'people'} waiting</Text>}
        </View>
        <View style={[styles.choiceWrap, narrow ? null : { flexDirection: 'row' }]}>
          <TouchableOpacity style={[styles.choice, { borderColor: theme.green }]} onPress={() => setStep('phone')} activeOpacity={0.85}>
            <Text style={styles.choiceIcon}>💺</Text>
            <Text style={styles.choiceTitle}>Walk in</Text>
            <Text style={styles.choiceDesc}>Add me to the queue</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.choice, { borderColor: theme.blue }]} onPress={() => setStep('arrival')} activeOpacity={0.85}>
            <Text style={styles.choiceIcon}>📅</Text>
            <Text style={styles.choiceTitle}>I have an appointment</Text>
            <Text style={styles.choiceDesc}>Let us know you've arrived</Text>
          </TouchableOpacity>
        </View>
      </Shell>
    );
  }

  if (step === 'phone' || step === 'arrival') {
    const isArr = step === 'arrival';
    const val = isArr ? arrPhone : phone;
    const setVal = isArr ? setArrPhone : setPhone;
    const ok = val.length === 10;
    return (
      <Shell>
        <Hero title={isArr ? "Let us know you're here" : "What's your phone number?"}
          sub={isArr ? 'Enter the number on your appointment.' : "We'll check if you've been here before."} />
        <TextInput
          style={styles.phoneInput}
          value={fmtPhoneInput(val)}
          onChangeText={v => setVal(digitsOnly(v))}
          placeholder="(555) 555-5555"
          placeholderTextColor={theme.placeholder}
          keyboardType="number-pad"
          autoFocus
        />
        <View style={styles.btnRow}>
          <Secondary label="‹ Back" onPress={reset} />
          <Primary label={working ? 'Checking…' : (isArr ? 'Check in' : 'Continue')} onPress={isArr ? submitArrival : lookupPhone} disabled={!ok || working} />
        </View>
      </Shell>
    );
  }

  if (step === 'lookup') {
    return <Shell><View style={styles.loadingBox}><ActivityIndicator size="large" color={theme.green} /><Text style={styles.loadingText}>Looking you up…</Text></View></Shell>;
  }

  if (step === 'greet') {
    const appt = identity?.todayAppt;
    return (
      <Shell>
        <Hero tint={theme.green}
          title={identity?.firstName ? `Welcome back, ${identity.firstName}!` : 'Welcome back!'}
          sub={appt ? `We see your ${appt.startTime || ''} appointment${appt.techName ? ` with ${appt.techName}` : ''}.` : "Let's get you into the walk-in queue."} />
        <View style={styles.btnRow}>
          <Secondary label="‹ Start over" onPress={reset} />
          <Primary label="Continue" onPress={() => setStep('service')} />
        </View>
      </Shell>
    );
  }

  if (step === 'new-prompt') {
    return (
      <Shell>
        <Hero title="We don't see that number" sub="Are you new to the salon?" />
        <Primary label="Yes, I'm new — sign me up" onPress={() => setStep('new-name')} />
        <Secondary label="Re-enter my number" onPress={() => { setPhone(''); setStep('phone'); }} />
        <Secondary label="Ask the front desk" onPress={() => setStep('frontdesk')} />
      </Shell>
    );
  }

  if (step === 'new-name') {
    const canSubmit = firstName.trim() && lastName.trim() && !working;
    return (
      <Shell>
        <Hero title="Welcome! What's your name?" sub="We'll set up your profile." />
        <TextInput style={styles.input} value={firstName} onChangeText={setFirstName} placeholder="First name *" placeholderTextColor={theme.placeholder} autoFocus />
        <TextInput style={styles.input} value={lastName} onChangeText={setLastName} placeholder="Last name *" placeholderTextColor={theme.placeholder} />
        <Text style={styles.phoneEcho}>📱 {fmtPhoneInput(phone)}</Text>
        <View style={styles.btnRow}>
          <Secondary label="‹ Back" onPress={() => setStep('new-prompt')} />
          <Primary label={working ? 'Setting up…' : 'Continue'} onPress={createClient} disabled={!canSubmit} />
        </View>
      </Shell>
    );
  }

  if (step === 'service') {
    return (
      <Shell>
        <Hero title="What can we do for you?" sub="Tap a service." />
        {services.map(s => {
          const sel = svcSel?.id === s.id;
          const price = Number(s.price ?? s.basePrice);
          return (
            <TouchableOpacity key={s.id} style={[styles.svcCard, sel && { borderColor: theme.green, borderWidth: 2 }]} onPress={() => setSvcSel({ id: s.id, name: s.name })} activeOpacity={0.85}>
              {!!s.image && <Image source={{ uri: s.image }} style={styles.svcImg} />}
              <View style={{ flex: 1 }}>
                <Text style={styles.svcName}>{s.name}</Text>
                {!!s.description && <Text style={styles.svcDesc} numberOfLines={2}>{s.description}</Text>}
                <Text style={styles.svcMeta}>{Number.isFinite(price) && price > 0 ? `$${price.toFixed(0)}` : ''}{s.duration ? `${(Number.isFinite(price) && price > 0) ? '  ·  ' : ''}${s.duration} min` : ''}</Text>
              </View>
              {sel && <Text style={styles.svcCheck}>✓</Text>}
            </TouchableOpacity>
          );
        })}
        <View style={styles.removalRow}>
          <Text style={styles.removalLabel}>Do you need a removal?</Text>
          <Switch value={removalNeeded} onValueChange={setRemovalNeeded} trackColor={{ true: theme.green }} />
        </View>
        <View style={styles.btnRow}>
          <Secondary label="‹ Start over" onPress={reset} />
          <Primary label="Continue" onPress={() => setStep('tech')} disabled={!svcSel} />
        </View>
      </Shell>
    );
  }

  if (step === 'tech') {
    return (
      <Shell>
        <Hero title="Any tech preference?" sub={svcSel?.name ? `For your ${svcSel.name}` : ''} />
        <View style={styles.pillWrap}>
          <TouchableOpacity style={styles.pill} onPress={() => chooseTech('Any')} activeOpacity={0.85}><Text style={styles.pillText}>No preference</Text></TouchableOpacity>
          {techs.map(t => (
            <TouchableOpacity key={t.id} style={styles.pill} onPress={() => chooseTech(t.name)} activeOpacity={0.85}><Text style={styles.pillText}>{t.name}</Text></TouchableOpacity>
          ))}
        </View>
        <View style={styles.btnRow}>
          <Secondary label="‹ Back" onPress={() => setStep('service')} />
        </View>
      </Shell>
    );
  }

  if (step === 'availability') {
    return <Shell>{renderAvailability(availabilityView(avail, techSel))}</Shell>;
  }

  if (step === 'done-walkin') {
    return (
      <Shell>
        <Hero tint={theme.green}
          title="You're in the queue!"
          sub={`${position > 1 ? `You're #${position} in line. ` : "You're next! "}${techSel !== 'Any' ? `Requesting ${techSel}` : 'Any available tech'}${svcSel?.name ? ` · ${svcSel.name}` : ''}.`} />
        <Text style={styles.doneTagline}>Have a seat — we'll call your name shortly!</Text>
        <Primary label="Done" onPress={reset} />
      </Shell>
    );
  }

  if (step === 'done-arrival') {
    const appt = arrMatched?.appt;
    return (
      <Shell>
        <Hero tint={theme.blue}
          title={arrMatched?.firstName ? `Welcome, ${arrMatched.firstName}!` : "You're checked in!"}
          sub={appt
            ? `We found your appointment${appt.startTime ? ` at ${appt.startTime}` : ''}${appt.techName && appt.techName !== 'TBD' ? ` with ${appt.techName}` : ''}. Have a seat — your tech will be with you shortly.`
            : "We couldn't find an appointment under that number, but we've let the front desk know you're here."} />
        <Primary label="Done" onPress={reset} />
      </Shell>
    );
  }

  // frontdesk fallback
  return (
    <Shell>
      <Hero tint={theme.blue} title="Please see the front desk" sub="A team member will get you checked in. Thank you!" />
      <Primary label="Done" onPress={reset} />
    </Shell>
  );
}

const makeStyles = (t) => StyleSheet.create({
  shell: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  hero: { alignItems: 'center', marginBottom: 22 },
  heroMark: { fontSize: 44, color: t.green, marginBottom: 10 },
  heroTitle: { fontSize: 28, fontWeight: '800', color: t.text, textAlign: 'center' },
  heroSub: { fontSize: 15, color: t.textMuted, marginTop: 10, textAlign: 'center', lineHeight: 21 },
  welcomeTitle: { fontSize: 34, fontWeight: '800', color: t.text, textAlign: 'center' },
  welcomeSub: { fontSize: 16, color: t.textMuted, marginTop: 8 },
  queuePill: { marginTop: 16, fontSize: 14, color: t.textMuted, backgroundColor: t.surfaceAlt, paddingVertical: 7, paddingHorizontal: 16, borderRadius: 30, overflow: 'hidden' },
  choiceWrap: { gap: 14 },
  choice: { flex: 1, backgroundColor: t.surface, borderWidth: 1.5, borderRadius: 20, padding: 28, alignItems: 'flex-start' },
  choiceIcon: { fontSize: 34, marginBottom: 12 },
  choiceTitle: { fontSize: 20, fontWeight: '800', color: t.text },
  choiceDesc: { fontSize: 14, color: t.textMuted, marginTop: 6 },
  phoneInput: { backgroundColor: t.surface, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 18, fontSize: 30, fontWeight: '700', color: t.text, textAlign: 'center', borderWidth: 1, borderColor: t.border, letterSpacing: 1 },
  input: { backgroundColor: t.surface, borderRadius: 14, paddingVertical: 15, paddingHorizontal: 16, fontSize: 18, color: t.text, borderWidth: 1, borderColor: t.border, marginBottom: 12 },
  phoneEcho: { fontSize: 14, color: t.textMuted, marginBottom: 6 },
  btn: { borderRadius: 14, paddingVertical: 16, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  btnPrimary: { backgroundColor: t.green, flex: 1 },
  btnPrimaryText: { color: '#fff', fontSize: 17, fontWeight: '800' },
  btnSecondary: { backgroundColor: t.surfaceAlt, flex: 1 },
  btnSecondaryText: { color: t.textMuted, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  btnRow: { flexDirection: 'row', gap: 12, marginTop: 6 },
  loadingBox: { alignItems: 'center', paddingVertical: 50 },
  loadingText: { color: t.textMuted, fontSize: 15, marginTop: 16 },
  svcCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: t.surface, borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  svcImg: { width: 56, height: 56, borderRadius: 10, backgroundColor: t.surfaceAlt },
  svcName: { fontSize: 17, fontWeight: '700', color: t.text },
  svcDesc: { fontSize: 13, color: t.textMuted, marginTop: 3, lineHeight: 18 },
  svcMeta: { fontSize: 14, fontWeight: '700', color: t.green, marginTop: 5 },
  svcCheck: { fontSize: 22, color: t.green, fontWeight: '800' },
  removalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.surface, borderRadius: 14, padding: 16, marginTop: 4, borderWidth: 1, borderColor: t.border },
  removalLabel: { fontSize: 16, fontWeight: '700', color: t.text },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  pill: { backgroundColor: t.surface, borderWidth: 1, borderColor: t.borderStrong, borderRadius: 30, paddingVertical: 13, paddingHorizontal: 20 },
  pillText: { fontSize: 16, fontWeight: '700', color: t.text },
  availCard: { backgroundColor: t.surface, borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 1.5, borderColor: t.border, marginVertical: 8 },
  availTech: { fontSize: 22, fontWeight: '800', color: t.text },
  availWait: { fontSize: 16, fontWeight: '700', color: t.green, marginTop: 6 },
  availNote: { fontSize: 13, color: t.textMuted, marginTop: 4 },
  doneTagline: { fontSize: 15, color: t.textMuted, textAlign: 'center', marginVertical: 12 },
});
