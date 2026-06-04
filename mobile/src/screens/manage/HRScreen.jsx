import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import {
  fetchBonuses, createBonus, deleteBonus,
  fetchReviews, saveReview, deleteReview,
  fetchPayrollRuns,
} from '../../lib/firestore';

const BONUS_FIELDS = [
  { key: 'techName', label: 'Tech',   type: 'text',   required: true },
  { key: 'amount',   label: 'Amount ($)', type: 'number', placeholder: '50' },
  { key: 'notes',    label: 'Notes',  type: 'text',   placeholder: 'Reason (optional)' },
];
const REVIEW_FIELDS = [
  { key: 'techName', label: 'Tech',    type: 'text',   required: true },
  { key: 'period',   label: 'Period',  type: 'text',   placeholder: 'Q1 2026' },
  { key: 'rating',   label: 'Rating (1-5)', type: 'number', placeholder: '5' },
  { key: 'content',  label: 'Notes',   type: 'text',   placeholder: 'Performance summary' },
];

export default function HRScreen({ navigation }) {
  const { isAdmin } = useTenantAccess();
  useTrashHeader(navigation, ['bonuses', 'reviews'], isAdmin);
  const [tab, setTab] = useState('bonuses');

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {[['bonuses', 'Bonuses'], ['reviews', 'Reviews'], ['payroll', 'Payroll']].map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'bonuses' ? (
        <ManageCrud
          load={fetchBonuses} create={createBonus} save={() => {}} remove={deleteBonus}
          canEdit={isAdmin}
          blank={() => ({ techName: '', amount: 0, notes: '' })}
          fields={BONUS_FIELDS}
          titleOf={(b) => b.techName}
          subtitleOf={(b) => `$${b.amount || 0}${b.notes ? ` · ${b.notes}` : ''}`}
          addLabel="Add bonus"
        />
      ) : tab === 'reviews' ? (
        <ManageCrud
          load={fetchReviews} create={(d) => saveReview(null, d)} save={(id, d) => saveReview(id, d)} remove={deleteReview}
          canEdit={isAdmin}
          blank={() => ({ techName: '', period: '', rating: 5, content: '' })}
          fields={REVIEW_FIELDS}
          titleOf={(r) => `${r.techName}${r.period ? ` · ${r.period}` : ''}`}
          subtitleOf={(r) => `${r.rating ? '★'.repeat(Math.min(5, Number(r.rating) || 0)) + ' · ' : ''}${r.content || ''}`}
          addLabel="Add review"
        />
      ) : (
        <PayrollList />
      )}
    </View>
  );
}

function PayrollList() {
  const [runs, setRuns] = useState(null);
  const load = useCallback(async () => { try { setRuns(await fetchPayrollRuns()); } catch { setRuns([]); } }, []);
  useEffect(() => { load(); }, [load]);
  if (runs === null) return <View style={styles.center}><ActivityIndicator color="#2D7A5F" /></View>;
  return (
    <FlatList
      data={runs}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 14 }}
      ListHeaderComponent={<Text style={styles.note}>Run payroll + Gusto sync are on the web app.</Text>}
      ListEmptyComponent={<Text style={styles.empty}>No payroll runs yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{item.startDate || '?'} – {item.endDate || '?'}</Text>
            <Text style={styles.sub}>{(item.employees || []).length} employees · {item.status || 'draft'}</Text>
          </View>
          <Text style={styles.amount}>${(Number(item.grandTotal || item.total) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: '#f5f7fa' },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f5f7fa' },
  tabs:      { flexDirection: 'row', backgroundColor: '#fff', padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: '#ececec' },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: '#f1f3f5' },
  tabOn:     { backgroundColor: '#eef5f2' },
  tabText:   { fontSize: 13, fontWeight: '700', color: '#888' },
  tabTextOn: { color: '#2D7A5F' },
  empty:     { textAlign: 'center', color: '#999', marginTop: 50, fontSize: 13 },
  note:      { fontSize: 12, color: '#aaa', marginBottom: 10 },
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#ececec', gap: 10 },
  name:      { fontSize: 14.5, fontWeight: '700', color: '#1a1a1a' },
  sub:       { fontSize: 12, color: '#8a8a8a', marginTop: 2 },
  amount:    { fontSize: 15, fontWeight: '800', color: '#2D7A5F' },
});
