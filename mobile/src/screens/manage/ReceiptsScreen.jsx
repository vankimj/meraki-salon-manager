import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { fetchReceiptsByRange, fetchReceiptsByClientName } from '../../lib/firestore';
import ResendReceiptRow from '../../components/ResendReceiptRow';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const RANGES = [{ d: 30, label: '30 days' }, { d: 90, label: '3 months' }, { d: 180, label: '6 months' }, { d: 365, label: '1 year' }];

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return String(d);
  return `${Number(m)}/${Number(day)}/${String(y).slice(2)}`;
}

// Sales / receipts. Browse a recent window (default 6 months) or search a
// client by exact name across ALL time — so an old receipt a customer asks for
// can always be pulled up + re-sent. Sales are the receipts completeSale writes
// per checkout; each carries the stable viewToken (saleId).
export default function ReceiptsScreen() {
  const { theme } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [rangeDays, setRangeDays] = useState(180);
  const [list, setList]       = useState(null);   // current browse window
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId]   = useState(null);
  const [q, setQ]             = useState('');
  const [allTime, setAllTime] = useState(null);   // {name, results} when an all-time name search is active
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - rangeDays);
    const fmt = (d) => d.toISOString().slice(0, 10);
    try {
      const r = await fetchReceiptsByRange(fmt(start), fmt(end));
      setList((r || []).filter(x => x._deleted !== true));
    } catch {
      setList([]);
    }
  }, [rangeDays]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() { setRefreshing(true); await load(); setRefreshing(false); }

  async function searchAllTime() {
    const name = q.trim();
    if (!name) return;
    setSearching(true);
    try {
      const r = await fetchReceiptsByClientName(name);
      setAllTime({ name, results: (r || []).filter(x => x._deleted !== true) });
    } catch {
      setAllTime({ name, results: [] });
    } finally {
      setSearching(false);
    }
  }
  function clearAllTime() { setAllTime(null); }

  // In browse mode, filter the loaded window live by name/phone.
  const filtered = useMemo(() => {
    if (allTime) return allTime.results;
    const term = q.trim().toLowerCase();
    if (!term || list === null) return list || [];
    return list.filter(r =>
      String(r.clientName || '').toLowerCase().includes(term) ||
      String(r.clientPhone || '').includes(term) ||
      String(r.clientEmail || '').toLowerCase().includes(term));
  }, [allTime, q, list]);

  function renderItem({ item }) {
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
  }

  const header = (
    <View>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          value={q}
          onChangeText={(t) => { setQ(t); if (allTime) setAllTime(null); }}
          placeholder="Search by client name"
          placeholderTextColor={theme.placeholder}
          autoCapitalize="words"
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={searchAllTime}
        />
        {!!q.trim() && (
          <TouchableOpacity style={styles.allBtn} onPress={searchAllTime} disabled={searching}>
            {searching ? <ActivityIndicator color="#fff" /> : <Text style={styles.allBtnText}>All dates</Text>}
          </TouchableOpacity>
        )}
      </View>

      {allTime ? (
        <TouchableOpacity style={styles.banner} onPress={clearAllTime} activeOpacity={0.7}>
          <Text style={styles.bannerText}>All-time results for “{allTime.name}” · {allTime.results.length} found — tap to clear</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.chips}>
          {RANGES.map(r => (
            <TouchableOpacity key={r.d} onPress={() => { setList(null); setRangeDays(r.d); }} style={[styles.chip, rangeDays === r.d && styles.chipOn]}>
              <Text style={[styles.chipText, rangeDays === r.d && styles.chipTextOn]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <Text style={styles.hint}>
        {allTime ? 'Tap a sale to text or email its receipt.'
          : 'Showing recent sales. Older receipt? Search a name, then tap “All dates”.'}
      </Text>
    </View>
  );

  if (list === null && !allTime) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;

  return (
    <FlatList
      style={styles.wrap}
      data={filtered}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 14, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.green} />}
      ListHeaderComponent={header}
      ListEmptyComponent={<Text style={styles.empty}>{allTime ? `No sales found for “${allTime.name}”.` : q.trim() ? 'No matches in this window — try “All dates”.' : 'No sales in this window.'}</Text>}
      renderItem={renderItem}
    />
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:    { flex: 1, backgroundColor: t.bg },
  center:  { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  searchRow:{ flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 10 },
  search:  { flex: 1, backgroundColor: t.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: t.text, borderWidth: 1, borderColor: t.border },
  allBtn:  { backgroundColor: t.blue, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', minWidth: 84 },
  allBtnText:{ color: '#fff', fontWeight: '800', fontSize: 13 },
  chips:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  chip:    { paddingHorizontal: 13, paddingVertical: 8, borderRadius: 16, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border },
  chipOn:  { backgroundColor: t.greenSoft, borderColor: t.green },
  chipText:{ fontSize: 13, color: t.textMuted, fontWeight: '700' },
  chipTextOn:{ color: t.green },
  banner:  { backgroundColor: t.blueSoft, borderRadius: 10, padding: 11, marginBottom: 8, borderWidth: 1, borderColor: t.blue },
  bannerText:{ fontSize: 12.5, color: t.blue, fontWeight: '700' },
  hint:    { fontSize: 12, color: t.textMuted, marginBottom: 10, paddingHorizontal: 2 },
  empty:   { textAlign: 'center', color: t.textFaint, marginTop: 40, fontSize: 13 },
  card:    { backgroundColor: t.surface, borderRadius: 12, marginBottom: 9, borderWidth: 1, borderColor: t.border, overflow: 'hidden' },
  row:     { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 10 },
  name:    { fontSize: 15, fontWeight: '700', color: t.text },
  meta:    { fontSize: 12, color: t.textMuted, marginTop: 2 },
  total:   { fontSize: 16, fontWeight: '800', color: t.text },
  chev:    { fontSize: 14, color: t.textMuted, width: 16, textAlign: 'center' },
  expand:  { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2, borderTopWidth: 1, borderTopColor: t.border },
});
