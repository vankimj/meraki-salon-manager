import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  Image, Alert, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { fetchSlidesDoc, saveSlides, fetchEmployees, fetchSettings, updateSettings } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const KIOSK_MODE_OPTIONS = [
  { key: 'walkin',  label: 'Walk-in sign-in', desc: 'Customers sign into the queue' },
  { key: 'tipflow', label: 'TipFlow',         desc: 'Rotating tech display + tip QR' },
  { key: 'checkout',label: 'Checkout',        desc: 'TipFlow idle, focused on checkout' },
];

const cleanHandle = (v) => (v || '').trim().replace(/^@+/, '').replace(/\s+/g, '');
const normUrl = (v) => { const s = (v || '').trim(); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

// TipFlow slide manager. Slides drive the front-desk kiosk's idle TipFlow (a
// tech headshot + a Venmo/social QR a waiting client can tip with). Mirrors the
// web Admin → Settings → TipFlow editor so slides can be managed on either app.
export default function AdminTipFlowScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [slides, setSlides] = useState(null);
  const [def, setDef] = useState(0);
  const [saving, setSaving] = useState(false);
  const [editIndex, setEditIndex] = useState(-2); // -2 closed, -1 new, >=0 editing
  const [kioskMode, setKioskMode] = useState('walkin');
  const [savingMode, setSavingMode] = useState(false);

  const load = useCallback(async () => {
    const d = await fetchSlidesDoc();
    setSlides(d.slides); setDef(d.def);
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { fetchSettings().then(s => setKioskMode(s?.kioskDefaultMode || 'walkin')).catch(() => {}); }, []);

  async function pickKioskMode(mode) {
    if (mode === kioskMode || savingMode) return;
    const prev = kioskMode;
    setKioskMode(mode); setSavingMode(true);
    try { await updateSettings({ kioskDefaultMode: mode }); }
    catch (e) { setKioskMode(prev); Alert.alert("Couldn't save", e?.message || 'Try again.'); }
    finally { setSavingMode(false); }
  }

  async function persist(nextSlides, nextDef) {
    setSaving(true);
    try {
      await saveSlides(nextSlides, nextDef);
      setSlides(nextSlides); setDef(nextDef);
    } catch (e) { Alert.alert("Couldn't save", e?.message || 'Try again.'); }
    finally { setSaving(false); }
  }

  function onSaveSlide(data) {
    const next = editIndex >= 0 ? slides.map((s, i) => (i === editIndex ? data : s)) : [...slides, data];
    const nextDef = editIndex >= 0 ? def : (next.length - 1 >= 0 ? def : 0);
    setEditIndex(-2);
    persist(next, nextDef);
  }

  function deleteSlide(i) {
    Alert.alert('Delete slide?', slides[i]?.name || 'This slide', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        const next = slides.filter((_, idx) => idx !== i);
        const nextDef = next.length ? Math.min(def, next.length - 1) : 0;
        persist(next, nextDef);
      } },
    ]);
  }

  function setDefault(i) { persist(slides, i); }

  if (slides === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Text style={styles.sectionTitle}>Kiosk idle screen</Text>
        <Text style={styles.note}>What the front-desk kiosk shows when no checkout is happening. (A checkout always takes over automatically, then returns here.)</Text>
        <View style={styles.modeWrap}>
          {KIOSK_MODE_OPTIONS.map(o => {
            const on = kioskMode === o.key;
            return (
              <TouchableOpacity key={o.key} style={[styles.modeCard, on && styles.modeCardOn]} onPress={() => pickKioskMode(o.key)} disabled={savingMode} activeOpacity={0.85}>
                <Text style={[styles.modeLabel, on && styles.modeLabelOn]}>{on ? '● ' : ''}{o.label}</Text>
                <Text style={styles.modeDesc}>{o.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {savingMode && <Text style={styles.note}>Saving…</Text>}

        <Text style={[styles.sectionTitle, { marginTop: 22 }]}>TipFlow slides</Text>
        <Text style={styles.note}>Slides show on the front-desk kiosk while it's idle — each tech's photo with a Venmo (or social) QR a waiting client can tip with.</Text>

        {slides.length === 0 && <Text style={styles.empty}>No slides yet. Add your first below.</Text>}

        {slides.map((s, i) => (
          <View key={i} style={styles.row}>
            {s.img
              ? <Image source={{ uri: s.img }} style={styles.thumb} />
              : <View style={[styles.thumb, styles.thumbEmpty]}><Text style={{ color: theme.textFaint, fontSize: 20 }}>✦</Text></View>}
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{s.name || 'Untitled'}</Text>
              <Text style={styles.rowSub}>{[s.vu && `venmo @${s.vu}`, s.iu && `ig @${s.iu}`].filter(Boolean).join(' · ') || 'No links'}</Text>
              {i === def && <Text style={styles.defaultBadge}>★ Default</Text>}
            </View>
            <View style={styles.rowActions}>
              <TouchableOpacity onPress={() => setEditIndex(i)} style={styles.iconBtn}><Text style={styles.iconBtnText}>Edit</Text></TouchableOpacity>
              {i !== def && <TouchableOpacity onPress={() => setDefault(i)} style={styles.iconBtn}><Text style={styles.iconBtnText}>★</Text></TouchableOpacity>}
              <TouchableOpacity onPress={() => deleteSlide(i)} style={styles.iconBtn}><Text style={[styles.iconBtnText, { color: theme.danger }]}>Delete</Text></TouchableOpacity>
            </View>
          </View>
        ))}

        <TouchableOpacity style={styles.addBtn} onPress={() => setEditIndex(-1)} disabled={saving}>
          <Text style={styles.addBtnText}>＋ Add slide</Text>
        </TouchableOpacity>
        {saving && <Text style={styles.note}>Saving…</Text>}
      </ScrollView>

      {editIndex !== -2 && (
        <SlideEditor
          slide={editIndex >= 0 ? slides[editIndex] : null}
          onClose={() => setEditIndex(-2)}
          onSave={onSaveSlide}
          styles={styles}
          theme={theme}
        />
      )}
    </View>
  );
}

function SlideEditor({ slide, onClose, onSave, styles, theme }) {
  const editing = !!slide;
  const [name, setName] = useState(slide?.name || '');
  const [venmo, setVenmo] = useState(slide?.vu || '');
  const [ig, setIg] = useState(slide?.iu || '');
  const [fb, setFb] = useState(slide?.fu || '');
  const [url, setUrl] = useState(slide?.hu || '');
  const [img, setImg] = useState(slide?.img || null);
  const [emps, setEmps] = useState([]);
  const [showEmps, setShowEmps] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetchEmployees().then(e => setEmps((e || []).filter(x => x.active !== false))).catch(() => {}); }, []);

  async function pickPhoto() {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Enable photo access in Settings to add a photo.'); return; }
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [4, 5], quality: 0.9 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setBusy(true);
      const out = await ImageManipulator.manipulateAsync(res.assets[0].uri, [{ resize: { width: 400 } }], { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      setImg(`data:image/jpeg;base64,${out.base64}`);
    } catch (e) { Alert.alert("Couldn't add photo", e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  function importEmp(emp) {
    if (emp.name) setName(emp.name);
    if (emp.venmo) setVenmo(cleanHandle(emp.venmo));
    if (emp.instagram) setIg(cleanHandle(emp.instagram));
    if (emp.facebook) setFb(cleanHandle(emp.facebook));
    if (emp.homepage) setUrl(emp.homepage || '');
    if (emp.photo) setImg(emp.photo);
    setShowEmps(false);
  }

  function save() {
    const vu = cleanHandle(venmo), iu = cleanHandle(ig), fu = cleanHandle(fb), hu = normUrl(url);
    const nm = name.trim();
    if (!nm && !vu && !iu && !fu && !hu) { Alert.alert('Add something', 'Enter a name or at least one link.'); return; }
    onSave({ img: img || null, name: nm || null, vu: vu || null, iu: iu || null, fu: fu || null, hu: hu || null });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{editing ? 'Edit slide' : 'New slide'}</Text>
            <TouchableOpacity onPress={onClose}><Text style={styles.sheetClose}>✕</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {emps.length > 0 && (
              <>
                <TouchableOpacity style={styles.importBtn} onPress={() => setShowEmps(v => !v)}>
                  <Text style={styles.importBtnText}>↓ Import from employee</Text>
                </TouchableOpacity>
                {showEmps && emps.map(e => (
                  <TouchableOpacity key={e.id} style={styles.empRow} onPress={() => importEmp(e)}>
                    <Text style={styles.empName}>{e.name}</Text>
                  </TouchableOpacity>
                ))}
              </>
            )}

            <Text style={styles.fieldLabel}>Photo</Text>
            <TouchableOpacity style={styles.photoBox} onPress={pickPhoto} disabled={busy}>
              {img
                ? <Image source={{ uri: img }} style={styles.photoPreview} />
                : <Text style={styles.photoHint}>{busy ? 'Processing…' : 'Tap to add a photo'}</Text>}
            </TouchableOpacity>
            {!!img && <TouchableOpacity onPress={() => setImg(null)}><Text style={styles.removePhoto}>Remove photo</Text></TouchableOpacity>}

            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="e.g. Jane Smith" placeholderTextColor={theme.placeholder} />

            <Text style={styles.fieldLabel}>Venmo username</Text>
            <TextInput style={styles.input} value={venmo} onChangeText={setVenmo} placeholder="username" placeholderTextColor={theme.placeholder} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.fieldLabel}>Instagram username</Text>
            <TextInput style={styles.input} value={ig} onChangeText={setIg} placeholder="username" placeholderTextColor={theme.placeholder} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.fieldLabel}>Facebook username</Text>
            <TextInput style={styles.input} value={fb} onChangeText={setFb} placeholder="username" placeholderTextColor={theme.placeholder} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.fieldLabel}>Homepage URL</Text>
            <TextInput style={styles.input} value={url} onChangeText={setUrl} placeholder="example.com" placeholderTextColor={theme.placeholder} autoCapitalize="none" autoCorrect={false} />

            <TouchableOpacity style={styles.saveSlideBtn} onPress={save} disabled={busy}>
              <Text style={styles.saveSlideText}>{editing ? 'Save changes' : 'Add slide'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (t) => StyleSheet.create({
  center:   { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  note:     { fontSize: 12.5, color: t.textFaint, lineHeight: 18, marginBottom: 14 },
  sectionTitle:{ fontSize: 16, fontWeight: '800', color: t.text, marginBottom: 6 },
  modeWrap: { gap: 8, marginBottom: 6 },
  modeCard: { backgroundColor: t.surface, borderRadius: 12, padding: 13, borderWidth: 1.5, borderColor: t.border },
  modeCardOn:{ borderColor: t.green, backgroundColor: t.blueSoft },
  modeLabel:{ fontSize: 15, fontWeight: '700', color: t.text },
  modeLabelOn:{ color: t.green },
  modeDesc: { fontSize: 12.5, color: t.textMuted, marginTop: 3 },
  empty:    { fontSize: 14, color: t.textMuted, textAlign: 'center', paddingVertical: 20 },
  row:      { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: t.surface, borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  thumb:    { width: 52, height: 64, borderRadius: 8, backgroundColor: t.surfaceAlt },
  thumbEmpty:{ alignItems: 'center', justifyContent: 'center' },
  rowName:  { fontSize: 15, fontWeight: '700', color: t.text },
  rowSub:   { fontSize: 12, color: t.textMuted, marginTop: 2 },
  defaultBadge:{ fontSize: 11, fontWeight: '800', color: t.green, marginTop: 4 },
  rowActions:{ alignItems: 'flex-end', gap: 6 },
  iconBtn:  { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, backgroundColor: t.surfaceAlt },
  iconBtnText:{ fontSize: 12, fontWeight: '700', color: t.textMuted },
  addBtn:   { marginTop: 6, borderWidth: 1, borderColor: t.borderStrong, borderStyle: 'dashed', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addBtnText:{ color: t.textMuted, fontWeight: '800', fontSize: 14 },
  backdrop: { flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  sheet:    { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 28, maxHeight: '92%' },
  sheetHead:{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle:{ fontSize: 18, fontWeight: '800', color: t.text },
  sheetClose:{ fontSize: 20, color: t.textMuted, paddingHorizontal: 6 },
  importBtn:{ backgroundColor: t.blueSoft, borderRadius: 10, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: t.blue, marginBottom: 8 },
  importBtnText:{ color: t.blue, fontWeight: '800', fontSize: 13 },
  empRow:   { paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: t.border },
  empName:  { fontSize: 14, color: t.text, fontWeight: '600' },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: t.textMuted, marginTop: 14, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:    { backgroundColor: t.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  photoBox: { height: 150, borderRadius: 12, borderWidth: 1, borderColor: t.border, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, overflow: 'hidden' },
  photoPreview:{ width: '100%', height: '100%' },
  photoHint:{ color: t.textFaint, fontSize: 13 },
  removePhoto:{ color: t.danger, fontSize: 12, fontWeight: '700', marginTop: 8 },
  saveSlideBtn:{ marginTop: 22, backgroundColor: t.blue, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveSlideText:{ color: '#fff', fontWeight: '800', fontSize: 15 },
});
