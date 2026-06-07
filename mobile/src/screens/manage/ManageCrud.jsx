import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl, Switch,
} from 'react-native';
import Icon from '../../components/Icon';
import useResponsive from '../../hooks/useResponsive';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';


// Reusable CRUD list + add/edit modal for the SMALL management modules
// (Services, Products, Gift Cards, Memberships…). Mirrors the
// ClientsScreen list pattern + an inline modal editor driven by a field
// schema, so each module is just a thin config rather than a full screen.
//
// Props:
//   load()                async → items[]
//   create(data)/save(id,data)/remove(id)   async mutations
//   canEdit               bool — hides Add/Edit/Delete when false (techs)
//   blank()               → empty draft
//   fields                [{ key, label, placeholder?, type:'text'|'number'|'bool'|'select', options?, required? }]
//   titleOf(item)         row title
//   subtitleOf(item)      row subtitle
//   addLabel              FAB / header label e.g. "New service"
//   headerNote(items)     optional summary string shown atop the list
export default function ManageCrud({
  load, create, save, remove, canEdit = false, blank, fields,
  titleOf, subtitleOf, addLabel = 'Add', headerNote,
}) {
  const { contentMaxWidth } = useResponsive();
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // draft object (with optional id) or null
  const [saving,  setSaving]  = useState(false);

  const refresh = useCallback(async () => {
    try { setItems(await load()); } catch { setItems([]); }
  }, [load]);

  useEffect(() => { refresh().finally(() => setLoading(false)); }, [refresh]);

  function openNew()  { setEditing({ ...blank() }); }
  function openEdit(item) { if (canEdit) setEditing({ ...item }); }

  async function doSave() {
    for (const f of fields) {
      if (f.required && !String(editing[f.key] ?? '').trim()) {
        Alert.alert(`${f.label} required`); return;
      }
    }
    setSaving(true);
    try {
      const { id, ...data } = editing;
      // Coerce number fields.
      fields.forEach(f => { if (f.type === 'number') data[f.key] = Number(data[f.key]) || 0; });
      if (id) await save(id, data); else await create(data);
      setEditing(null);
      await refresh();
    } catch (e) {
      Alert.alert('Couldn\'t save', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function confirmRemove(item) {
    Alert.alert('Delete?', `${titleOf(item)} will be removed. An admin can restore it from the web Trash within 30 days.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await remove(item.id); await refresh(); }
        catch (e) { Alert.alert('Couldn\'t delete', e?.message || 'Please try again.'); }
      } },
    ]);
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 90, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={theme.green} />}
        ListHeaderComponent={headerNote ? <Text style={styles.note}>{headerNote(items)}</Text> : null}
        ListEmptyComponent={<Text style={styles.empty}>Nothing here yet.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            activeOpacity={canEdit ? 0.6 : 1}
            onPress={() => openEdit(item)}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{titleOf(item)}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{subtitleOf(item)}</Text>
            </View>
            {canEdit && (
              <TouchableOpacity onPress={() => confirmRemove(item)} style={styles.rowDel} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="trash" size={16} color={theme.danger} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
        )}
      />

      {canEdit && (
        <TouchableOpacity style={styles.fab} onPress={openNew} activeOpacity={0.85}>
          <Text style={styles.fabText}>＋ {addLabel}</Text>
        </TouchableOpacity>
      )}

      <Modal visible={!!editing} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }]}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{editing?.id ? 'Edit' : addLabel}</Text>
              <TouchableOpacity onPress={() => setEditing(null)} style={styles.close}><Text style={styles.closeText}>×</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 440 }}>
              {!!editing && fields.map(f => {
                if (f.show && !f.show(editing)) return null;
                return (
                <View key={f.key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  {f.type === 'bool' ? (
                    <Switch
                      value={!!editing[f.key]}
                      onValueChange={v => setEditing({ ...editing, [f.key]: v })}
                      trackColor={{ true: theme.green }}
                    />
                  ) : f.type === 'select' ? (
                    <View style={styles.selectRow}>
                      {f.options.map(opt => {
                        const val = typeof opt === 'string' ? opt : opt.value;
                        const lbl = typeof opt === 'string' ? opt : opt.label;
                        const on = editing[f.key] === val;
                        return (
                          <TouchableOpacity key={val} onPress={() => setEditing({ ...editing, [f.key]: val })}
                            style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : f.type === 'multiselect' ? (
                    <View style={styles.selectRow}>
                      {(f.options || []).length === 0 && <Text style={styles.multiEmpty}>{f.emptyLabel || 'Nothing to choose from.'}</Text>}
                      {(f.options || []).map(opt => {
                        const val = typeof opt === 'string' ? opt : opt.value;
                        const lbl = typeof opt === 'string' ? opt : opt.label;
                        const arr = Array.isArray(editing[f.key]) ? editing[f.key] : [];
                        const on = arr.includes(val);
                        return (
                          <TouchableOpacity key={val}
                            onPress={() => setEditing({ ...editing, [f.key]: on ? arr.filter(x => x !== val) : [...arr, val] })}
                            style={[styles.chip, on && styles.chipOn]}>
                            <Text style={[styles.chipText, on && styles.chipTextOn]}>{on ? '✓ ' : ''}{lbl}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : f.type === 'custom' ? (
                    f.render(editing, setEditing)
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={editing[f.key] == null ? '' : String(editing[f.key])}
                      onChangeText={v => setEditing({ ...editing, [f.key]: v })}
                      placeholder={f.placeholder || ''}
                      placeholderTextColor={theme.placeholder}
                      keyboardType={f.type === 'number' ? 'decimal-pad' : (f.keyboard || 'default')}
                      autoCapitalize={f.type === 'number' ? 'none' : 'sentences'}
                    />
                  )}
                </View>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={doSave} disabled={saving}>
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : (editing?.id ? 'Save changes' : 'Create')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  note:    { fontSize: 12.5, color: t.textMuted, marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: t.border },
  rowTitle:{ fontSize: 15, fontWeight: '700', color: t.text },
  rowSub:  { fontSize: 12.5, color: t.textMuted, marginTop: 3 },
  rowDel:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: t.dangerBg, marginLeft: 8 },
  fab:     { position: 'absolute', right: 18, bottom: 24, backgroundColor: t.green, borderRadius: 26, paddingHorizontal: 20, paddingVertical: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop:{ flex: 1, backgroundColor: t.overlay, justifyContent: 'flex-end' },
  sheet:   { backgroundColor: t.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle:  { fontSize: 18, fontWeight: '800', color: t.text },
  close:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.surfaceAlt },
  closeText:{ fontSize: 22, color: t.textMuted, lineHeight: 24 },
  field:    { marginTop: 12 },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: t.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:    { backgroundColor: t.surfaceAlt, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  selectRow:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  multiEmpty:{ fontSize: 13, color: t.textFaint, fontStyle: 'italic' },
  chip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: t.surfaceMuted, borderWidth: 1, borderColor: t.border },
  chipOn:   { backgroundColor: t.greenSoft, borderColor: t.green },
  chipText: { fontSize: 13, color: t.textMuted, fontWeight: '600' },
  chipTextOn:{ color: t.green, fontWeight: '800' },
  saveBtn:  { marginTop: 18, backgroundColor: t.blue, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
