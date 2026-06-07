import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchReceiptsByRange } from '../../lib/firestore';
import ResendReceiptRow from '../../components/ResendReceiptRow';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return String(d);
  return `${Number(m)}/${Number(day)}/${String(y).slice(2)}`;
}

// Recent sales (last 60 days). Tap a row to text or email its receipt — the
// resend row routes a typed contact to SMS or email. Sales are the receipts
// completeSale writes per checkout; each carries the stable viewToken (saleId).
export default function ReceiptsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [list, setList]   = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - 60);
    const fmt = (d) => d.toISOString().slice(0, 10);
    try {
      const r = await fetchReceiptsByRange(fmt(start), fmt(end));
      setList((r || []).filter(x => x._deleted !== true));
    } catch {
      setList([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  if (list === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={list}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.green} />}
      ListEmptyComponent={<Text style={styles.empty}>No sales in the last 60 days.</Text>}
      ListHeaderComponent={list.length ? <Text style={styles.hint}>Tap a sale to text or email its receipt.</Text> : null}
      renderItem={({ item }) => {
        const open = openId === item.id;
        const contact = item.clientPhone || item.clientEmail || '';
        const method  = item.payment?.method || '';
        return (
          <View style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => setOpenId(open ? null : item.id)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{item.clientName || 'Walk-in'}</Text>
                <Text style={styles.meta} numberOfLines={1}>{fmtDate(item.date)}{item.techName ? ` · ${item.techName}` : ''}{method ? ` · ${method}` : ''}</Text>
              </View>
              <Text style={styles.total}>{money(item.payment?.total)}</Text>
              <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
            </TouchableOpacity>
            {open && (
              <View style={styles.expand}>
                <ResendReceiptRow receiptId={item.id} viewToken={item.viewToken || null} defaultContact={contact} compact />
              </View>
            )}
          </View>
        );
      }}
    />
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  hint:    { fontSize: 12.5, color: t.textMuted, marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  card:    { backgroundColor: t.surface, borderRadius: 12, marginBottom: 9, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
  row:     { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  name:    { fontSize: 15, fontWeight: '700', color: t.text },
  meta:    { fontSize: 12, color: t.textMuted, marginTop: 2 },
  total:   { fontSize: 16, fontWeight: '800', color: t.text },
  chev:    { fontSize: 14, color: t.textMuted, width: 16, textAlign: 'center' },
  expand:  { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2, borderTopWidth: 1, borderTopColor: t.border },
});
