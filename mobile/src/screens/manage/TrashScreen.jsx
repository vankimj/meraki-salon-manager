import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { fetchRecentlyDeleted, restoreDocFromBQ, clearTombstone } from '../../lib/firestore';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

// Scoped trash/restore list. `route.params.collections` (optional) limits
// it to one module's collections; omitted = the global Admin trash. Mirrors
// the web <TrashPanel>: BQ-mirrored collections restore losslessly, the rest
// un-tombstone in place.
function previewLabel(item) {
  const c = item.collection;
  if (c === 'clients' || c === 'employees') return item.name || '(no name)';
  if (c === 'appointments') return `${item.date || '?'} ${item.startTime || ''} · ${item.clientName || '?'} w/ ${item.techName || '?'}`;
  if (c === 'receipts') return `${item.date || '?'} · ${item.clientName || '?'} · $${(item.payment?.total || 0).toFixed(2)}`;
  if (c === 'services' || c === 'products') return item.name || '(no name)';
  if (c === 'giftCards') return `${item.code || '?'} · $${(item.originalAmount || item.balance || 0).toFixed(0)}`;
  if (c === 'promoCodes') return item.code || '?';
  if (c === 'memberships') return `${item.clientName || '?'} · ${item.planName || item.planId || ''}`;
  if (c === 'membershipPlans') return item.name || '(no name)';
  if (c === 'timeOff') return `${item.techName || '?'} · ${item.startDate || ''}–${item.endDate || item.startDate || ''}`;
  if (c === 'bonuses') return `${item.techName || '?'} · $${item.amount || 0}`;
  if (c === 'reviews') return `${item.techName || '?'} · ${item.period || ''}`;
  if (c === 'meetings') return `${item.subject || '?'}`;
  if (c === 'campaigns') return item.subject || item.name || '?';
  return '(no preview)';
}

export default function TrashScreen({ route }) {
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();
  const collections = route?.params?.collections || null;
  const [items,   setItems]   = useState(null);
  const [busy,    setBusy]     = useState(false);

  const load = useCallback(async () => {
    setItems(null);
    try { setItems(await fetchRecentlyDeleted(collections ? { collections } : {})); }
    catch { setItems([]); }
  }, [JSON.stringify(collections)]);

  useEffect(() => { load(); }, [load]);

  function confirmRestore(item) {
    Alert.alert('Restore?', `Restore this ${item.collection.replace(/s$/, '')}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Restore', onPress: async () => {
        setBusy(true);
        try {
          if (item.restorable) {
            const res = await restoreDocFromBQ(item.collection, item.id);
            if (!res?.restored) throw new Error('Restore did not complete — see Cloud Function logs');
          } else {
            await clearTombstone(item.collection, item.id);
          }
          await load();
        } catch (e) {
          Alert.alert('Restore failed', e?.message || 'Please try again.');
        } finally { setBusy(false); }
      } },
    ]);
  }

  if (items === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <View style={styles.wrap}>
      <View style={styles.banner}>
        <Text style={styles.bannerText}>
          Deleted in the last 30 days. After that they're purged — BigQuery keeps a copy for clients, appointments, receipts & employees only.
        </Text>
      </View>
      <FlatList
        data={items}
        keyExtractor={(it) => `${it.collection}-${it.id}`}
        contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={theme.green} />}
        ListEmptyComponent={<Text style={styles.empty}>Nothing in the trash.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.badge}><Text style={styles.badgeText}>{item.collection}</Text></View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.title} numberOfLines={1}>{previewLabel(item)}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item._deletedAt ? new Date(item._deletedAt).toLocaleDateString() : 'unknown'}
                {item._deletedBy ? ` · ${item._deletedBy}` : ''}
                {!item.restorable ? ' · no BQ history' : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={() => confirmRestore(item)} disabled={busy} style={styles.restoreBtn}>
              <Text style={styles.restoreText}>↩ Restore</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </View>
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:       { flex: 1, backgroundColor: t.bg },
  center:     { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  banner:     { backgroundColor: t.warningBg, borderBottomWidth: 1, borderBottomColor: t.warning, padding: 12 },
  bannerText: { fontSize: 11.5, color: t.warning, lineHeight: 16 },
  empty:      { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  row:        { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: t.border, gap: 10 },
  badge:      { backgroundColor: t.dangerBg, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, minWidth: 78, alignItems: 'center' },
  badgeText:  { fontSize: 9, fontWeight: '800', color: t.danger, textTransform: 'uppercase' },
  title:      { fontSize: 13.5, fontWeight: '600', color: t.text },
  meta:       { fontSize: 11, color: t.textFaint, marginTop: 2 },
  restoreBtn: { borderWidth: 1, borderColor: t.success, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  restoreText:{ fontSize: 12, fontWeight: '700', color: t.success },
});
