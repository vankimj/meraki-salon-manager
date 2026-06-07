import { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { fetchReceiptsByRange, fetchReceiptsByClientName, fetchAppointmentsByIds, fetchClient, fetchSettings } from '../../lib/firestore';
import ResendReceiptRow from '../../components/ResendReceiptRow';
import RefundSheet from '../../components/RefundSheet';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
const RANGES = [{ d: 30, label: '30 days' }, { d: 90, label: '3 months' }, { d: 180, label: '6 months' }, { d: 365, label: '1 year' }];

function fmtDate(d) {
  if (!d) return '';
  const [y, m, day] = String(d).split('-');
  if (!y || !m || !day) return String(d);
  return `${Number(m)}/${Number(day)}/${String(y).slice(2)}`;
}
const cap = (s) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1) : '';
// Card brand + last4 if captured (in-person sales, going forward); else blank.
function paidWith(pay) {
  if (pay?.method === 'card' && pay.cardBrand && pay.cardLast4) return `${cap(pay.cardBrand)} ••${pay.cardLast4}`;
  return '';
}
function refundTypeLabel(r) {
  const m = r?.method;
  if (m === 'store_credit' || r?.addedCredit) return 'Store-credit';
  if (m === 'card') return 'Card';
  if (m === 'cash') return 'Cash';
  return 'Recorded';
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
  const [refundReceipt, setRefundReceipt] = useState(null);
  const [commissionDefault, setCommissionDefault] = useState('withhold');
  useEffect(() => { fetchSettings().then(s => { if (s?.refundCommissionDefault === 'goodwill') setCommissionDefault('goodwill'); }).catch(() => {}); }, []);

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
    const pay     = item.payment || {};
    const method  = pay.method || '';
    const refunded = Number(item.refundedAmount) || 0;
    const remaining = Math.max(0, (Number(pay.total) || 0) - refunded);
    return (
      <View style={styles.card}>
        <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => setOpenId(open ? null : item.id)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{item.clientName || 'Walk-in'}</Text>
            <Text style={styles.meta} numberOfLines={1}>{fmtDate(item.date)}{item.techName ? ` · ${item.techName}` : ''}{method ? ` · ${method}` : ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[styles.total, refunded > 0 && { textDecorationLine: 'line-through', color: theme.textMuted }]}>{money(pay.total)}</Text>
            {refunded > 0 && <Text style={styles.refundedTag}>−{money(refunded)} refunded</Text>}
          </View>
          <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
        </TouchableOpacity>
        {open && (
          <View style={styles.expand}>
            {(item.services || []).map((s, i) => (
              <View key={`s${i}`} style={styles.liRow}>
                <Text style={styles.liName} numberOfLines={1}>{s.name || '—'}{s.techName ? ` · ${s.techName}` : ''}</Text>
                <Text style={styles.liVal}>{money(s.price)}</Text>
              </View>
            ))}
            {(item.retailProducts || []).map((p, i) => (
              <View key={`p${i}`} style={styles.liRow}>
                <Text style={styles.liName} numberOfLines={1}>{p.name}{p.qty > 1 ? ` ×${p.qty}` : ''}</Text>
                <Text style={styles.liVal}>{money((Number(p.price) || 0) * (p.qty || 1))}</Text>
              </View>
            ))}
            {pay.discountAmount > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Discount</Text><Text style={styles.liMuted}>−{money(pay.discountAmount)}</Text></View>}
            {pay.promoAmount > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Promo</Text><Text style={styles.liMuted}>−{money(pay.promoAmount)}</Text></View>}
            {pay.giftCard?.applied > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Gift card used</Text><Text style={styles.liMuted}>−{money(pay.giftCard.applied)}</Text></View>}
            {pay.creditApplied > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Store credit used</Text><Text style={styles.liMuted}>−{money(pay.creditApplied)}</Text></View>}
            {pay.tax > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Tax</Text><Text style={styles.liMuted}>{money(pay.tax)}</Text></View>}
            {pay.tip > 0 && <View style={styles.liRow}><Text style={styles.liMuted}>Tip</Text><Text style={styles.liMuted}>{money(pay.tip)}</Text></View>}
            <View style={[styles.liRow, styles.liTotal]}><Text style={styles.liName}>Total</Text><Text style={styles.liVal}>{money(pay.total)}{paidWith(pay) ? ` · ${paidWith(pay)}` : ''}</Text></View>

            {(item.refunds || (item.refund ? [item.refund] : [])).map((r, i) => (
              <View key={`rf${i}`} style={[styles.liRow, i === 0 && { marginTop: 6 }]}>
                <Text style={styles.refundLine} numberOfLines={1}>↩ {refundTypeLabel(r)} refund{r.reason ? ` · ${r.reason}` : ''}</Text>
                <Text style={styles.refundLine}>−{money(r.amount)}</Text>
              </View>
            ))}

            <Text style={styles.expandLabel}>Resend receipt</Text>
            {(item.apptIds || []).length > 1
              ? <ReceiptRecipients receipt={item} theme={theme} styles={styles} />
              : <ResendReceiptRow receiptId={item.id} viewToken={item.viewToken || null} defaultContact={contact} compact />}

            {remaining > 0 ? (
              <TouchableOpacity style={styles.refundBtn} onPress={() => setRefundReceipt(item)} activeOpacity={0.85}>
                <Text style={styles.refundBtnText}>↩ Refund{refunded > 0 ? ` (${money(remaining)} left)` : ''}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.fullyRefunded}>Fully refunded</Text>
            )}
          </View>
        )}
      </View>
    );
  }

  function afterRefund(info) {
    setRefundReceipt(null);
    if (allTime) searchAllTime(); else load();
    if (info?.message) Alert.alert('Refund issued', `${info.message}\nAll admins have been notified.`);
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
    <>
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
      <RefundSheet receipt={refundReceipt} onClose={() => setRefundReceipt(null)} onDone={afterRefund} commissionDefault={commissionDefault} />
    </>
  );
}

// A combined checkout writes one receipt covering everyone but stores only the
// primary contact. Resolve each participant from the receipt's apptIds → clients
// so the receipt can be sent to each person individually (one send row each,
// prefilled with their phone/email). Falls back to a single row if it resolves
// to one person.
function ReceiptRecipients({ receipt, theme, styles }) {
  const [people, setPeople] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const appts = await fetchAppointmentsByIds(receipt.apptIds || []);
        const byKey = new Map();
        for (const a of appts) {
          const k = a.clientId || `walkin:${a.clientName || a.id}`;
          if (!byKey.has(k)) byKey.set(k, { clientId: a.clientId || null, name: a.clientName || 'Walk-in', contact: '' });
        }
        const list = [...byKey.values()];
        await Promise.all(list.map(async (p) => {
          if (!p.clientId) return;
          const c = await fetchClient(p.clientId).catch(() => null);
          if (c) { p.contact = c.phone || c.email || ''; p.name = c.name || p.name; }
        }));
        if (alive) setPeople(list);
      } catch {
        if (alive) setPeople([]);
      }
    })();
    return () => { alive = false; };
  }, [receipt.id]);

  if (people === null) return <ActivityIndicator color={theme.green} style={{ marginTop: 12 }} />;
  if (people.length <= 1) {
    const only = people[0];
    return <ResendReceiptRow receiptId={receipt.id} viewToken={receipt.viewToken || null} defaultContact={only?.contact || receipt.clientPhone || receipt.clientEmail || ''} compact />;
  }
  return (
    <View>
      <Text style={styles.recipientsHint}>Combined sale — send the receipt to each person:</Text>
      {people.map((p, i) => (
        <View key={p.clientId || `w${i}`} style={{ marginTop: i ? 12 : 6 }}>
          <Text style={styles.recipientName}>{p.name}</Text>
          <ResendReceiptRow receiptId={receipt.id} viewToken={receipt.viewToken || null} defaultContact={p.contact} compact />
        </View>
      ))}
    </View>
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
  refundedTag:{ fontSize: 10.5, color: t.danger, fontWeight: '700', marginTop: 2 },
  chev:    { fontSize: 14, color: t.textMuted, width: 16, textAlign: 'center' },
  expand:  { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: t.border },
  liRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  liName:  { fontSize: 13.5, color: t.text, fontWeight: '600', flex: 1, marginRight: 10 },
  liVal:   { fontSize: 13.5, color: t.text, fontWeight: '700' },
  liMuted: { fontSize: 12.5, color: t.textMuted },
  liTotal: { borderTopWidth: 1, borderTopColor: t.border, marginTop: 5, paddingTop: 6 },
  refundLine: { fontSize: 12.5, color: t.danger, fontWeight: '700' },
  expandLabel:{ fontSize: 12, fontWeight: '800', color: t.textMuted, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.3 },
  recipientsHint:{ fontSize: 12, color: t.textMuted, marginTop: 4, marginBottom: 2 },
  recipientName:{ fontSize: 13.5, fontWeight: '700', color: t.text, marginBottom: 4 },
  refundBtn:{ marginTop: 14, borderWidth: 1, borderColor: t.danger, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  refundBtnText:{ color: t.danger, fontWeight: '800', fontSize: 14 },
  fullyRefunded:{ marginTop: 14, textAlign: 'center', color: t.textFaint, fontSize: 12.5, fontWeight: '700' },
});
