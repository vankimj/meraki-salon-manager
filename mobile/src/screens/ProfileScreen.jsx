import { useState, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, TouchableOpacity, StyleSheet, Image,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking, ActionSheetIOS, Modal,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { auth } from '../lib/firebase';
import { saveEmployee, fetchTimeOff, createTimeOff, deleteTimeOff } from '../lib/firestore';
import { clearPushTokenForUser } from '../hooks/usePushRegistration';
import { clearCurrentTenant } from '../lib/currentTenant';
import { getPrefs, setTheme, setAutoLogoutMin, subscribePrefs } from '../lib/userPrefs';
import useCurrentEmployee from '../hooks/useCurrentEmployee';
import useMyTenants from '../hooks/useMyTenants';

export default function ProfileScreen({ navigation }) {
  const user = auth.currentUser;
  const { employee, loading: empLoading } = useCurrentEmployee();
  const { tenants, current: currentTenant, switchTo, loading: tenantsLoading } = useMyTenants();
  const [draft,   setDraft]   = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [prefs, setPrefs] = useState(getPrefs());
  useEffect(() => subscribePrefs(setPrefs), []);
  // Time off — list of upcoming entries for THIS tech, refetched when
  // the employee record changes (sign-in, tenant switch).
  const [myTimeOff, setMyTimeOff] = useState([]);
  const [timeOffOpen, setTimeOffOpen] = useState(false);
  async function reloadTimeOff() {
    if (!employee?.name) { setMyTimeOff([]); return; }
    try {
      const all = await fetchTimeOff();
      const todayIso = new Date().toISOString().slice(0, 10);
      const mine = all.filter(t =>
        (t.techName || '').toLowerCase() === employee.name.toLowerCase() &&
        (t.endDate || t.startDate || '') >= todayIso
      );
      setMyTimeOff(mine);
    } catch { setMyTimeOff([]); }
  }
  useEffect(() => { reloadTimeOff(); }, [employee?.id, employee?.name]);

  useEffect(() => {
    if (employee) setDraft(employee);
  }, [employee?.id]);

  // Header right: Edit ↔ Save (only show if there's an employee record).
  useLayoutEffect(() => {
    if (!employee) {
      navigation.setOptions({ headerRight: undefined });
      return;
    }
    navigation.setOptions({
      headerRight: () => (
        editing
          ? <TouchableOpacity onPress={handleSave} disabled={saving} style={{ marginRight: 12 }}>
              <Text style={[styles.headerBtn, saving && { opacity: 0.5 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>
          : <TouchableOpacity onPress={() => setEditing(true)} style={{ marginRight: 12 }}>
              <Text style={styles.headerBtn}>Edit</Text>
            </TouchableOpacity>
      ),
    });
  }, [navigation, editing, saving, draft, employee]);

  const handleSave = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      // Editable-by-self fields only — comp data lives in
      // employees/{id}/private/comp and is admin-only.
      const payload = {
        name:      draft.name      || '',
        email:     draft.email     || '',
        phone:     draft.phone     || '',
        instagram: draft.instagram || '',
        facebook:  draft.facebook  || '',
        tiktok:    draft.tiktok    || '',
        venmo:     draft.venmo     || '',
        homepage:  draft.homepage  || '',
      };
      await saveEmployee(employee.id, payload);
      setEditing(false);
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      // Saves will fail today because rules require admin to write
      // the parent employee doc; surface the rejection so the user
      // knows they need an admin to update for them.
      Alert.alert(
        'Couldn\'t save',
        e?.code === 'permission-denied'
          ? 'Self-edit isn\'t enabled yet — ask your salon admin to update this for you.'
          : (e?.message || 'Try again later.'),
      );
    } finally {
      setSaving(false);
    }
  }, [draft, saving, employee?.id]);

  async function handleSignOut() {
    try { await clearPushTokenForUser(user?.uid); } catch {}
    try { await clearCurrentTenant(); } catch {}
    await auth.signOut();
  }

  // Pick + upload a profile photo. Resized to 400x400 JPEG ~80% quality
  // and stored as a base64 data-URI on the employee.photo field — same
  // format as the web's resizeImg() pipeline so a photo set on either
  // surface displays correctly on the other. Skips if no employee record
  // (mobile profile screen requires an employee for self-edit anyway).
  const pickAndUploadPhoto = useCallback(async (source /* 'camera' | 'library' */) => {
    if (!employee?.id) {
      Alert.alert('No employee record', 'Ask an admin to add you to the employees list first.');
      return;
    }
    try {
      // Permissions: image library / camera have separate prompts.
      const perm = source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', `Enable ${source === 'camera' ? 'camera' : 'photos'} access in Settings to add a profile picture.`);
        return;
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.9 });
      if (result.canceled || !result.assets?.[0]) return;

      setUploadingPhoto(true);
      const sourceUri = result.assets[0].uri;
      // Resize down to 400x400 JPEG so the base64 payload stays
      // reasonable (≈40-60KB). Anything bigger bloats the Firestore
      // doc and slows every fetch of this employee.
      const resized = await ImageManipulator.manipulateAsync(
        sourceUri,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      const dataUri = `data:image/jpeg;base64,${resized.base64}`;
      await saveEmployee(employee.id, { photo: dataUri });
      // Reflect in the local draft so the avatar updates immediately
      // without waiting for the next useCurrentEmployee refetch.
      setDraft(d => ({ ...(d || {}), photo: dataUri }));
    } catch (e) {
      console.warn('[profile] photo upload failed:', e?.message);
      Alert.alert('Couldn\'t update photo', e?.message || 'Try again or pick a different image.');
    } finally {
      setUploadingPhoto(false);
    }
  }, [employee?.id]);

  // ── Working-hours editing ─────────────────────────────
  // Each weekday is { on, start, end }. Persisted on the employee
  // record (the same field the schedule grid + week-view gap math
  // already read from). Tapping a row opens an action sheet with
  // toggle + time presets; full hour-by-hour editing keeps the UI
  // tractable on a phone without dragging in a date-time picker
  // native module.
  async function setWorkDay(dow, patch) {
    if (!employee?.id) return;
    const current = employee.workDays?.[dow] || { on: true, start: '09:00', end: '18:00' };
    const next = { ...current, ...patch };
    const workDays = { ...(employee.workDays || {}), [dow]: next };
    try {
      await saveEmployee(employee.id, { workDays });
      setDraft(d => ({ ...(d || {}), workDays }));
    } catch (e) {
      Alert.alert('Couldn\'t save hours', e?.message || 'Try again.');
    }
  }
  function pickWorkDay(dow) {
    const cfg = (draft?.workDays?.[dow] || employee?.workDays?.[dow] || { on: true, start: '09:00', end: '18:00' });
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: `${dow} hours`,
          options: ['Cancel', cfg.on ? 'Mark this day OFF' : 'Mark this day ON', 'Set hours…'],
          cancelButtonIndex: 0,
        },
        (idx) => {
          if (idx === 1) setWorkDay(dow, { on: !cfg.on });
          if (idx === 2) editWorkDayHours(dow);
        },
      );
    } else {
      Alert.alert(`${dow} hours`, undefined, [
        { text: cfg.on ? 'Mark this day OFF' : 'Mark this day ON', onPress: () => setWorkDay(dow, { on: !cfg.on }) },
        { text: 'Set hours…', onPress: () => editWorkDayHours(dow) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }
  function editWorkDayHours(dow) {
    const cfg = (draft?.workDays?.[dow] || employee?.workDays?.[dow] || { start: '09:00', end: '18:00' });
    pickFromSheet({
      title: `${dow} start time`,
      options: HOUR_OPTIONS,
      currentLabel: HOUR_LABEL[cfg.start] || cfg.start,
      onPick: (start) => {
        setWorkDay(dow, { start, on: true });
        // After start, prompt for end.
        setTimeout(() => pickFromSheet({
          title: `${dow} end time`,
          options: HOUR_OPTIONS,
          currentLabel: HOUR_LABEL[cfg.end] || cfg.end,
          onPick: (end) => setWorkDay(dow, { end, on: true }),
        }), 350);
      },
    });
  }

  // ── Settings sheet pickers ────────────────────────────
  // Each one shows an iOS action sheet (with Android Alert fallback)
  // listing the options. Picking a row applies immediately — no save
  // confirmation, since each is a single setting and the change is
  // visible in the row's right-aligned label.

  function pickFromSheet({ title, options, currentLabel, onPick }) {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title, options: ['Cancel', ...options.map(o => o.label + (o.label === currentLabel ? '  ✓' : ''))], cancelButtonIndex: 0 },
        (idx) => { if (idx > 0) onPick(options[idx - 1].value); },
      );
    } else {
      Alert.alert(title, undefined, [
        ...options.map(o => ({ text: o.label, onPress: () => onPick(o.value) })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  function pickTheme() {
    pickFromSheet({
      title: 'Theme',
      options: [
        { label: 'System (auto)', value: 'system' },
        { label: 'Light',         value: 'light' },
        { label: 'Dark',          value: 'dark' },
      ],
      currentLabel: prefs.theme === 'dark' ? 'Dark' : prefs.theme === 'light' ? 'Light' : 'System (auto)',
      onPick: setTheme,
    });
  }

  function pickAutoLogout() {
    pickFromSheet({
      title: 'Auto sign-out after inactivity',
      options: [
        { label: 'Off',         value: 0 },
        { label: '5 minutes',   value: 5 },
        { label: '15 minutes',  value: 15 },
        { label: '30 minutes',  value: 30 },
        { label: '1 hour',      value: 60 },
      ],
      currentLabel: prefs.autoLogoutMin === 0 ? 'Off'
        : prefs.autoLogoutMin === 60 ? '1 hour'
        : `${prefs.autoLogoutMin} minutes`,
      onPick: setAutoLogoutMin,
    });
  }

  // Notification preferences live on the employee doc (shared with web's
  // tech-reminder system). Three independent fields:
  //   techReminderOptOut      — master toggle (true = no appt reminders)
  //   techReminderLeadMinutes — how far ahead to send (15 default)
  //   techReminderChannel     — 'email' | 'sms' | 'push' | 'all' etc.
  async function setNotifPref(patch) {
    if (!employee?.id) return;
    try {
      await saveEmployee(employee.id, patch);
      setDraft(d => ({ ...(d || {}), ...patch }));
    } catch (e) {
      Alert.alert('Couldn\'t save', e?.message || 'Try again.');
    }
  }
  function pickNotifLead() {
    pickFromSheet({
      title: 'Send reminder this far ahead',
      options: [
        { label: '5 minutes',   value: 5 },
        { label: '15 minutes',  value: 15 },
        { label: '30 minutes',  value: 30 },
        { label: '1 hour',      value: 60 },
      ],
      currentLabel: `${(draft?.techReminderLeadMinutes || employee?.techReminderLeadMinutes || 15)} minutes`,
      onPick: (v) => setNotifPref({ techReminderLeadMinutes: v }),
    });
  }
  function pickNotifChannel() {
    const labels = { email: 'Email', sms: 'SMS', push: 'Push', 'email+push': 'Email + Push', 'email+sms': 'Email + SMS', all: 'All channels' };
    const cur = draft?.techReminderChannel || employee?.techReminderChannel || 'email';
    pickFromSheet({
      title: 'Reminder delivery',
      options: [
        { label: 'Push only',     value: 'push' },
        { label: 'Email only',    value: 'email' },
        { label: 'SMS only',      value: 'sms' },
        { label: 'Email + Push',  value: 'email+push' },
        { label: 'All channels',  value: 'all' },
      ],
      currentLabel: labels[cur] || cur,
      onPick: (v) => setNotifPref({ techReminderChannel: v }),
    });
  }
  function toggleNotifOptOut() {
    const next = !(draft?.techReminderOptOut ?? employee?.techReminderOptOut ?? false);
    setNotifPref({ techReminderOptOut: next });
  }

  function presentPhotoOptions() {
    if (!employee?.id) return;   // no-op if no employee record
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options: ['Cancel', 'Take Photo', 'Choose from Library', ...(draft?.photo || employee?.photo ? ['Remove Photo'] : [])],
          cancelButtonIndex: 0,
          destructiveButtonIndex: (draft?.photo || employee?.photo) ? 3 : undefined,
          title: 'Profile picture',
        },
        async (idx) => {
          if (idx === 1) pickAndUploadPhoto('camera');
          if (idx === 2) pickAndUploadPhoto('library');
          if (idx === 3) {
            try {
              setUploadingPhoto(true);
              await saveEmployee(employee.id, { photo: '' });
              setDraft(d => ({ ...(d || {}), photo: '' }));
            } catch (e) {
              Alert.alert('Couldn\'t remove photo', e?.message || 'Try again.');
            } finally {
              setUploadingPhoto(false);
            }
          }
        },
      );
    } else {
      // Android — Alert with buttons (no native action sheet wrapper bundled).
      Alert.alert('Profile picture', undefined, [
        { text: 'Take Photo',          onPress: () => pickAndUploadPhoto('camera') },
        { text: 'Choose from Library', onPress: () => pickAndUploadPhoto('library') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }

  const displayName = draft?.name || employee?.name || user?.displayName || user?.email || '';
  // Prefer the local draft so a freshly-uploaded photo shows immediately
  // after save, before useCurrentEmployee's next re-fetch swaps it in.
  const photo       = draft?.photo || employee?.photo || user?.photoURL || null;

  if (empLoading) {
    return <ActivityIndicator style={{ marginTop: 60 }} color="#3D95CE" />;
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={88}
    >
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Identity card */}
        <View style={styles.identity}>
          <TouchableOpacity
            onPress={presentPhotoOptions}
            disabled={!employee?.id || uploadingPhoto}
            activeOpacity={0.75}
            style={styles.avatarWrap}
          >
            {photo
              ? <Image source={{ uri: photo }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarFallback]}>
                  <Text style={styles.avatarInitial}>{(displayName[0] || '?').toUpperCase()}</Text>
                </View>
            }
            {employee?.id && (
              <View style={styles.avatarEditBadge}>
                {uploadingPhoto
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.avatarEditBadgeText}>＋</Text>}
              </View>
            )}
          </TouchableOpacity>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {!employee && (
            <View style={styles.warningPill}>
              <Text style={styles.warningPillText}>
                No employee record linked to this account
              </Text>
            </View>
          )}
        </View>

        {/* Profile fields — only when employee record exists */}
        {employee && draft && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionLabel}>Contact</Text>
            <Field label="Display name" value={draft.name}  onChange={v => setDraft({ ...draft, name: v })}  editing={editing} />
            <Field label="Email"        value={draft.email} onChange={v => setDraft({ ...draft, email: v })} editing={editing} keyboard="email-address" mail={!editing && draft.email} />
            <Field label="Phone"        value={draft.phone} onChange={v => setDraft({ ...draft, phone: v })} editing={editing} keyboard="phone-pad"     tel={!editing && draft.phone} />

            <Text style={[styles.sectionLabel, { marginTop: 18 }]}>Social</Text>
            <Field label="Instagram" value={draft.instagram} onChange={v => setDraft({ ...draft, instagram: v })} editing={editing} placeholder="@handle" />
            <Field label="Facebook"  value={draft.facebook}  onChange={v => setDraft({ ...draft, facebook: v })}  editing={editing} placeholder="profile.url or @handle" />
            <Field label="TikTok"    value={draft.tiktok}    onChange={v => setDraft({ ...draft, tiktok: v })}    editing={editing} placeholder="@handle" />
            <Field label="Venmo"     value={draft.venmo}     onChange={v => setDraft({ ...draft, venmo: v })}     editing={editing} placeholder="@username" />
            <Field label="Homepage"  value={draft.homepage}  onChange={v => setDraft({ ...draft, homepage: v })}  editing={editing} placeholder="https://" keyboard="url" />
          </View>
        )}

        {/* Salon — visible only when the user has access to ≥1 tenant.
            Single-tenant users still see their current salon name as a
            confirmation. Multi-tenant users get a switcher. */}
        {!tenantsLoading && tenants.length > 0 && (
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionLabel}>
              {tenants.length > 1 ? `Salon (${tenants.length})` : 'Salon'}
            </Text>
            {tenants.map(t => {
              const isCurrent = t.id === currentTenant;
              return (
                <TouchableOpacity
                  key={t.id}
                  disabled={tenants.length === 1 || isCurrent}
                  onPress={() => switchTo(t.id)}
                  style={[styles.tenantRow, isCurrent && styles.tenantRowActive]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tenantName}>{t.name}</Text>
                    <Text style={styles.tenantMeta}>
                      {t.role === 'admin' ? 'Admin' : 'Staff'}
                      {t.plan ? ` · ${t.plan}` : ''}
                    </Text>
                  </View>
                  {isCurrent && <Text style={styles.tenantCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Working hours — only when an employee record exists.
            Per-day on/off + start/end. Schedule grid + week-view gap
            calculator already read from this same employee.workDays
            field, so changes here flow through immediately. */}
        {employee?.id && (
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionLabel}>Working hours</Text>
            {WEEK_DOW.map(dow => {
              const cfg = (draft?.workDays?.[dow] || employee?.workDays?.[dow]);
              const off = cfg?.on === false;
              const value = off
                ? 'Off'
                : `${HOUR_LABEL[cfg?.start || '09:00'] || cfg?.start || '9:00 AM'} – ${HOUR_LABEL[cfg?.end || '18:00'] || cfg?.end || '6:00 PM'}`;
              return (
                <SettingRow key={dow} label={dow} value={value} onPress={() => pickWorkDay(dow)} />
              );
            })}
          </View>
        )}

        {/* Time off — list of upcoming entries for this tech, plus a
            tappable "+ Add" row to create new (PTO / sick / personal). */}
        {employee?.id && (
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionLabel}>Time off</Text>
            {myTimeOff.length === 0 ? (
              <View style={styles.cardRow}>
                <Text style={styles.settingsBody}>No upcoming time off scheduled.</Text>
              </View>
            ) : (
              myTimeOff.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.timeOffRow}
                  onPress={() => Alert.alert(
                    timeOffTypeLabel(t.type),
                    `${formatDateRange(t)}${t.reason ? '\n\n' + t.reason : ''}`,
                    [
                      { text: 'Delete', style: 'destructive', onPress: async () => {
                        try { await deleteTimeOff(t.id); reloadTimeOff(); }
                        catch (e) { Alert.alert('Couldn\'t delete', e?.message || 'Try again.'); }
                      } },
                      { text: 'Close', style: 'cancel' },
                    ],
                  )}
                  activeOpacity={0.6}
                >
                  <Text style={styles.timeOffRowType}>{timeOffTypeLabel(t.type)}</Text>
                  <Text style={styles.timeOffRowRange}>{formatDateRange(t)}</Text>
                  {!!t.reason && <Text style={styles.timeOffRowReason} numberOfLines={1}>{t.reason}</Text>}
                </TouchableOpacity>
              ))
            )}
            <TouchableOpacity style={styles.timeOffAddBtn} onPress={() => setTimeOffOpen(true)} activeOpacity={0.6}>
              <Text style={styles.timeOffAddBtnText}>＋ Add time off</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Notifications — only show when an employee record exists,
            since the prefs live on that doc. */}
        {employee?.id && (
          <View style={{ marginTop: 18 }}>
            <Text style={styles.sectionLabel}>Notifications</Text>
            <SettingRow
              label="Appointment reminders"
              value={(draft?.techReminderOptOut ?? employee?.techReminderOptOut) ? 'Off' : 'On'}
              onPress={toggleNotifOptOut}
            />
            {!(draft?.techReminderOptOut ?? employee?.techReminderOptOut) && (
              <>
                <SettingRow
                  label="Send reminder ahead"
                  value={`${draft?.techReminderLeadMinutes || employee?.techReminderLeadMinutes || 15} min`}
                  onPress={pickNotifLead}
                />
                <SettingRow
                  label="Delivery channel"
                  value={(() => {
                    const v = draft?.techReminderChannel || employee?.techReminderChannel || 'email';
                    const map = { email: 'Email', sms: 'SMS', push: 'Push', 'email+push': 'Email + Push', 'email+sms': 'Email + SMS', all: 'All channels' };
                    return map[v] || v;
                  })()}
                  onPress={pickNotifChannel}
                />
              </>
            )}
          </View>
        )}

        <View style={{ marginTop: 18 }}>
          <Text style={styles.sectionLabel}>Appearance & security</Text>
          <SettingRow
            label="Theme"
            value={prefs.theme === 'dark' ? 'Dark' : prefs.theme === 'light' ? 'Light' : 'System'}
            onPress={pickTheme}
          />
          <SettingRow
            label="Auto sign-out"
            value={prefs.autoLogoutMin === 0 ? 'Off'
              : prefs.autoLogoutMin === 60 ? '1 hour'
              : `${prefs.autoLogoutMin} min`}
            onPress={pickAutoLogout}
          />
        </View>

        <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      <AddTimeOffModal
        open={timeOffOpen}
        onClose={() => setTimeOffOpen(false)}
        onSaved={() => { setTimeOffOpen(false); reloadTimeOff(); }}
        techName={employee?.name}
      />
    </KeyboardAvoidingView>
  );
}

// Time-off type label — mirrors web's typeLabel().
function timeOffTypeLabel(t) {
  if (t === 'sick') return '🩹 Sick';
  if (t === 'personal') return '🏠 Personal';
  return '🌴 Vacation';
}
function formatDateRange(t) {
  const fmt = (iso) => { try { return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return iso; } };
  if (!t.endDate || t.endDate === t.startDate) return fmt(t.startDate);
  return `${fmt(t.startDate)} – ${fmt(t.endDate)}`;
}

// ── Add time off modal ────────────────────────────────
// Three fields: start date (YYYY-MM-DD), end date (YYYY-MM-DD,
// defaults to start), type, optional reason. Date inputs are plain
// text — we deliberately avoid pulling in a native date picker module
// so this doesn't trigger another dev-client rebuild. Today's date is
// pre-filled into both fields as a sensible starting point.
function AddTimeOffModal({ open, onClose, onSaved, techName }) {
  const today = new Date().toISOString().slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [endDate,   setEndDate]   = useState(today);
  const [type,      setType]      = useState('vacation');
  const [reason,    setReason]    = useState('');
  const [saving,    setSaving]    = useState(false);

  useEffect(() => {
    if (open) {
      setStartDate(today);
      setEndDate(today);
      setType('vacation');
      setReason('');
    }
  }, [open, today]);

  if (!open) return null;
  const isoRe = /^\d{4}-\d{2}-\d{2}$/;
  const valid = isoRe.test(startDate) && isoRe.test(endDate) && endDate >= startDate;

  async function save() {
    if (!valid || saving) return;
    if (!techName) { Alert.alert('No tech', 'Need an employee record to attribute time off to.'); return; }
    setSaving(true);
    try {
      await createTimeOff({ techName, startDate, endDate, type, reason: reason.trim() });
      onSaved?.();
    } catch (e) {
      Alert.alert('Couldn\'t save', e?.message || 'Try again.');
    } finally { setSaving(false); }
  }

  const TYPES = [
    { id: 'vacation', label: '🌴 Vacation' },
    { id: 'sick',     label: '🩹 Sick' },
    { id: 'personal', label: '🏠 Personal' },
  ];

  return (
    <Modal visible={open} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={timeOffStyles.backdrop}>
          <View style={timeOffStyles.sheet}>
            <View style={timeOffStyles.header}>
              <Text style={timeOffStyles.title}>New time off</Text>
              <TouchableOpacity onPress={onClose} style={timeOffStyles.closeBtn}>
                <Text style={timeOffStyles.closeBtnText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
              <Text style={timeOffStyles.label}>Type</Text>
              <View style={timeOffStyles.typeRow}>
                {TYPES.map(t => (
                  <TouchableOpacity
                    key={t.id}
                    onPress={() => setType(t.id)}
                    style={[timeOffStyles.typeChip, type === t.id && timeOffStyles.typeChipActive]}
                  >
                    <Text style={[timeOffStyles.typeChipText, type === t.id && timeOffStyles.typeChipTextActive]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={[timeOffStyles.label, { marginTop: 16 }]}>Start date</Text>
              <TextInput
                style={timeOffStyles.input}
                value={startDate}
                onChangeText={setStartDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#bbb"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />

              <Text style={[timeOffStyles.label, { marginTop: 12 }]}>End date</Text>
              <TextInput
                style={timeOffStyles.input}
                value={endDate}
                onChangeText={setEndDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#bbb"
                keyboardType="numbers-and-punctuation"
                maxLength={10}
              />
              {!valid && (startDate || endDate) && (
                <Text style={timeOffStyles.hint}>Use YYYY-MM-DD; end date must be on or after start.</Text>
              )}

              <Text style={[timeOffStyles.label, { marginTop: 16 }]}>Reason (optional)</Text>
              <TextInput
                style={[timeOffStyles.input, { minHeight: 80, textAlignVertical: 'top' }]}
                value={reason}
                onChangeText={setReason}
                placeholder="What's it for?"
                placeholderTextColor="#bbb"
                multiline
                maxLength={400}
              />

              <TouchableOpacity
                style={[timeOffStyles.saveBtn, (!valid || saving) && { opacity: 0.5 }, { marginTop: 18 }]}
                onPress={save}
                disabled={!valid || saving}
              >
                <Text style={timeOffStyles.saveBtnText}>{saving ? 'Saving…' : 'Save time off'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const timeOffStyles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,.55)' },
  sheet:    { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, height: '80%', paddingBottom: 20 },
  header:   { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  title:    { flex: 1, fontSize: 16, fontWeight: '700', color: '#1a1a1a' },
  closeBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  closeBtnText: { fontSize: 22, color: '#666', lineHeight: 24 },
  label:    { fontSize: 11, fontWeight: '700', color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  input:    { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#1a1a1a', backgroundColor: '#fafafa' },
  hint:     { fontSize: 11, color: '#b91c1c', marginTop: 4 },
  typeRow:  { flexDirection: 'row', gap: 6 },
  typeChip: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#f5f5f5', borderWidth: 1, borderColor: '#e5e7eb', alignItems: 'center' },
  typeChipActive: { backgroundColor: '#EBF4FB', borderColor: '#3D95CE' },
  typeChipText:        { fontSize: 13, fontWeight: '600', color: '#666' },
  typeChipTextActive:  { color: '#1a5f8a', fontWeight: '700' },
  saveBtn:     { backgroundColor: '#2D7A5F', borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});

// 30-min slot options for the work-hours start/end pickers, 7 AM
// through 9 PM. Anything outside this is rare enough that the user
// can edit on web instead.
const HOUR_OPTIONS = [];
const HOUR_LABEL   = {};
for (let h = 7; h <= 21; h++) {
  for (const m of [0, 30]) {
    const v = `${String(h).padStart(2, '0')}:${m === 0 ? '00' : '30'}`;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const display = `${(h % 12 || 12)}:${m === 0 ? '00' : '30'} ${ampm}`;
    HOUR_OPTIONS.push({ label: display, value: v });
    HOUR_LABEL[v] = display;
  }
}
const WEEK_DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// One row in the Settings list — shows a label on the left + the
// current value on the right, tap to open a sheet picker. Same pattern
// as iOS native Settings.
function SettingRow({ label, value, onPress }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.settingRow} activeOpacity={0.6}>
      <Text style={styles.settingRowLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Text style={styles.settingRowValue}>{value}</Text>
        <Text style={styles.settingRowChevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
}

function Field({ label, value, onChange, editing, multiline, keyboard, placeholder, tel, mail }) {
  if (!editing) {
    if (!value) return null;
    return (
      <View style={styles.viewRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        {tel ? (
          <TouchableOpacity onPress={() => Linking.openURL(`tel:${value.replace(/[^0-9+]/g, '')}`)}>
            <Text style={[styles.fieldValue, styles.linkText]}>{value}</Text>
          </TouchableOpacity>
        ) : mail ? (
          <TouchableOpacity onPress={() => Linking.openURL(`mailto:${value}`)}>
            <Text style={[styles.fieldValue, styles.linkText]}>{value}</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.fieldValue}>{value}</Text>
        )}
      </View>
    );
  }
  return (
    <View style={styles.editRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value || ''}
        onChangeText={onChange}
        multiline={multiline}
        keyboardType={keyboard}
        placeholder={placeholder}
        placeholderTextColor="#bbb"
        autoCapitalize={keyboard === 'email-address' || keyboard === 'url' ? 'none' : 'sentences'}
        style={styles.editInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f7fa' },
  content:   { padding: 16, paddingBottom: 32 },
  headerBtn: { color: '#2D7A5F', fontSize: 15, fontWeight: '600' },

  identity:    { alignItems: 'center', paddingVertical: 22, backgroundColor: '#fff', borderRadius: 14 },
  avatarWrap:  { position: 'relative', marginBottom: 10 },
  avatar:      { width: 88, height: 88, borderRadius: 44 },
  avatarFallback: { backgroundColor: '#2D7A5F', alignItems: 'center', justifyContent: 'center' },
  avatarInitial:  { color: '#fff', fontSize: 36, fontWeight: '700' },
  avatarEditBadge: { position: 'absolute', right: -2, bottom: -2, width: 28, height: 28, borderRadius: 14, backgroundColor: '#3D95CE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  avatarEditBadgeText: { fontSize: 18, color: '#fff', fontWeight: '700', lineHeight: 20 },
  name:        { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  email:       { fontSize: 13, color: '#888', marginTop: 4 },

  warningPill:     { marginTop: 10, paddingVertical: 5, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fef3c7' },
  warningPillText: { fontSize: 12, color: '#92400e', fontWeight: '600' },

  sectionLabel: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '700', marginBottom: 8, marginLeft: 4 },

  viewRow: { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8 },
  editRow: { backgroundColor: '#fff', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8 },
  fieldLabel: { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600', marginBottom: 4 },
  fieldValue: { fontSize: 14, color: '#1a1a1a' },
  linkText:   { color: '#3D95CE', textDecorationLine: 'underline' },
  editInput:  { fontSize: 14, color: '#1a1a1a', padding: 0 },

  cardRow:      { backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  settingsBody: { fontSize: 13, color: '#888', lineHeight: 19 },

  settingRow:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#fff', paddingVertical: 14, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8 },
  settingRowLabel:   { fontSize: 14, color: '#1a1a1a', fontWeight: '500' },
  settingRowValue:   { fontSize: 14, color: '#888', fontWeight: '500' },
  settingRowChevron: { fontSize: 20, color: '#cbd0d6', lineHeight: 22 },

  timeOffRow:        { backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8 },
  timeOffRowType:    { fontSize: 13, fontWeight: '700', color: '#1a1a1a' },
  timeOffRowRange:   { fontSize: 12, color: '#666', marginTop: 2 },
  timeOffRowReason:  { fontSize: 11, color: '#888', marginTop: 4, fontStyle: 'italic' },
  timeOffAddBtn:     { paddingVertical: 11, alignItems: 'center', borderRadius: 12, backgroundColor: '#f0faf6', borderWidth: 1, borderColor: '#bbf7d0' },
  timeOffAddBtnText: { fontSize: 13, color: '#2D7A5F', fontWeight: '700' },

  tenantRow:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, marginBottom: 8 },
  tenantRowActive: { backgroundColor: '#f0faf6', borderWidth: 1, borderColor: '#2D7A5F' },
  tenantName:      { fontSize: 15, fontWeight: '600', color: '#1a1a1a' },
  tenantMeta:      { fontSize: 12, color: '#888', marginTop: 2 },
  tenantCheck:     { fontSize: 18, color: '#2D7A5F', fontWeight: '700' },

  signOutBtn:  { marginTop: 20, alignSelf: 'center', paddingVertical: 10, paddingHorizontal: 30, borderRadius: 22, backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  signOutText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});
