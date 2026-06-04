import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator,
  Modal, TextInput, ScrollView, Alert, RefreshControl, Switch,
} from 'react-native';
import Icon from '../../components/Icon';
import useResponsive from '../../hooks/useResponsive';

const GREEN = '#2D7A5F';
const BLUE  = '#3D95CE';

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

  if (loading) return <View style={styles.center}><ActivityIndicator color={GREEN} /></View>;

  return (
    <View style={styles.wrap}>
      <FlatList
        data={items}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: 14, paddingBottom: 90, maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={refresh} tintColor={GREEN} />}
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
                <Icon name="trash" size={16} color="#c0392b" />
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
              {!!editing && fields.map(f => (
                <View key={f.key} style={styles.field}>
                  <Text style={styles.fieldLabel}>{f.label}</Text>
                  {f.type === 'bool' ? (
                    <Switch
                      value={!!editing[f.key]}
                      onValueChange={v => setEditing({ ...editing, [f.key]: v })}
                      trackColor={{ true: GREEN }}
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
                  ) : (
                    <TextInput
                      style={styles.input}
                      value={editing[f.key] == null ? '' : String(editing[f.key])}
                      onChangeText={v => setEditing({ ...editing, [f.key]: v })}
                      placeholder={f.placeholder || ''}
                      placeholderTextColor="#bbb"
                      keyboardType={f.type === 'number' ? 'decimal-pad' : (f.keyboard || 'default')}
                      autoCapitalize={f.type === 'number' ? 'none' : 'sentences'}
                    />
                  )}
                </View>
              ))}
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

const styles = StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: '#f5f7fa' },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  note:    { fontSize: 12.5, color: '#6b7280', marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  row:     { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ececec' },
  rowTitle:{ fontSize: 15, fontWeight: '700', color: '#1a1a1a' },
  rowSub:  { fontSize: 12.5, color: '#8a8a8a', marginTop: 3 },
  rowDel:  { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fdecea', marginLeft: 8 },
  fab:     { position: 'absolute', right: 18, bottom: 24, backgroundColor: GREEN, borderRadius: 26, paddingHorizontal: 20, paddingVertical: 14, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4 },
  fabText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdrop:{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet:   { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 30 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  sheetTitle:  { fontSize: 18, fontWeight: '800', color: '#1a1a1a' },
  close:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f5f5' },
  closeText:{ fontSize: 22, color: '#888', lineHeight: 24 },
  field:    { marginTop: 12 },
  fieldLabel:{ fontSize: 12, fontWeight: '700', color: '#888', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  input:    { backgroundColor: '#f6f7f9', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: '#1a1a1a', borderWidth: 1, borderColor: '#ececec' },
  selectRow:{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip:     { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: '#f1f3f5', borderWidth: 1, borderColor: '#e3e6e8' },
  chipOn:   { backgroundColor: '#eef5f2', borderColor: GREEN },
  chipText: { fontSize: 13, color: '#666', fontWeight: '600' },
  chipTextOn:{ color: GREEN, fontWeight: '800' },
  saveBtn:  { marginTop: 18, backgroundColor: BLUE, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
