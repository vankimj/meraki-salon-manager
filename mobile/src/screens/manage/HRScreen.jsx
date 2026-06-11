import { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import ManageCrud from './ManageCrud';
import useTenantAccess from '../../hooks/useTenantAccess';
import useTrashHeader from '../../hooks/useTrashHeader';
import {
  fetchBonuses, createBonus, deleteBonus,
  fetchReviews, saveReview, deleteReview,
  fetchContinuingEducation, saveCE, deleteCE,
  fetchBonusRules, saveBonusRule, deleteBonusRule,
  fetchServiceRatingsByRange,
  fetchPayrollRuns, fetchSettings, getGustoAuthUrl,
  fetchEmployeesWithComp, fetchAppointmentsByRange, fetchReceiptsByRange, createPayrollRun, gustoSubmitPayroll,
} from '../../lib/firestore';
import { techPayAdjust } from '../../lib/metrics';
import { CE_CATEGORIES } from '../../lib/ceIdeas';
import { BONUS_METRICS, PAYOUT_TYPES, buildBonusContext, evaluateBonusRules } from '../../lib/bonusRules';
import OAuthConnect from '../../components/OAuthConnect';
import { useTheme, useThemedStyles } from '../../theme/ThemeContext';

function lastNDays(n) {
  const end = new Date(), start = new Date();
  start.setDate(start.getDate() - n);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}
// Port of the web payrollRows computation (commission on service revenue +
// manual bonuses + structured rule bonuses). Only techs with a positive total.
function computePayroll(employees, appts, receipts, bonuses, startDate, extra = {}) {
  const { rules = [], ratings = [], ctxAppts = [], endDate = '' } = extra;
  const done = appts.filter(a => a.status === 'done');
  return employees.filter(e => e.active !== false).map(emp => {
    const techAppts = done.filter(a => a.payment?.techSplit
      ? a.payment.techSplit.some(t => t.techName === emp.name)
      : a.techName === emp.name);
    const grossRevenue = techAppts.reduce((s, a) => {
      if (a.payment?.techSplit) { const sp = a.payment.techSplit.find(t => t.techName === emp.name); return s + (sp?.revenue || 0); }
      return s + (a.services || []).reduce((t, sv) => t + (Number(sv.price) || 0), 0);
    }, 0);
    // Net withheld refunds + redo transfers so commission matches the tech dashboards.
    const adj = techPayAdjust(receipts, emp.name);
    const serviceRevenue = Math.max(0, Math.round((grossRevenue - adj.refundWithheld - adj.redoOut + adj.redoIn) * 100) / 100);
    const commissionPct = Number(emp.commissionPct) || 0;
    const commissionAmt = commissionPct ? Math.round(serviceRevenue * commissionPct / 100 * 100) / 100 : 0;
    const bonusTotal = bonuses.filter(b => b.techName === emp.name && (b.createdAt || '').slice(0, 10) >= startDate)
      .reduce((s, b) => s + (Number(b.amount) || 0), 0);
    const ctx = buildBonusContext({ techName: emp.name, serviceRevenue, techAppts, allAppts: ctxAppts, receipts, ratings, hireDate: emp.hireDate || '', startDate, endDate });
    const { ruleBonusTotal, ruleBonusLines } = evaluateBonusRules(rules, ctx);
    const isHourly = emp.rateType === 'hourly';
    const earned = isHourly ? null : commissionAmt;
    const total = (earned || 0) + bonusTotal + ruleBonusTotal;
    return { emp, apptCount: techAppts.length, serviceRevenue, commissionPct, earned, bonusTotal, ruleBonusTotal, ruleBonusLines, total };
  }).filter(r => r.total > 0);
}

const isoToday = () => new Date().toISOString().slice(0, 10);

const CE_FIELDS = [
  { key: 'employeeName', label: 'Employee', type: 'text', required: true },
  { key: 'title',    label: 'Course / certification', type: 'text', required: true },
  { key: 'category', label: 'Category', type: 'select', options: CE_CATEGORIES },
  { key: 'status',   label: 'Status', type: 'select', options: [{ value: 'planned', label: 'Planned' }, { value: 'completed', label: 'Completed' }] },
  { key: 'provider', label: 'Provider', type: 'text', placeholder: 'Academy, school…' },
  { key: 'date',     label: 'Date (YYYY-MM-DD)', type: 'text', placeholder: isoToday() },
  { key: 'hours',    label: 'Hours', type: 'number', placeholder: '0' },
  { key: 'credits',  label: 'Credits', type: 'number', placeholder: '0' },
  { key: 'cost',     label: 'Cost ($)', type: 'number', placeholder: '0' },
  { key: 'notes',    label: 'Notes', type: 'text', placeholder: 'Takeaways…' },
];

// Mobile rule editor is a simplified SINGLE-criterion form. Multi-criterion
// rules created on the web still evaluate fully; editing one here collapses it
// to its first criterion (documented limitation).
const RULE_FIELDS = [
  { key: 'name',        label: 'Rule name', type: 'text', required: true },
  { key: 'enabled',     label: 'Active', type: 'bool' },
  { key: '_metric',     label: 'When metric', type: 'select', options: BONUS_METRICS.map(m => ({ value: m.key, label: m.label })) },
  { key: '_threshold',  label: 'Is at least', type: 'number', placeholder: '0' },
  { key: 'payoutType',  label: 'Payout', type: 'select', options: PAYOUT_TYPES.map(p => ({ value: p.key, label: p.label })) },
  { key: 'payoutValue', label: 'Payout amount / %', type: 'number', placeholder: '0' },
  { key: 'payoutMax',   label: 'Cap ($, 0 = none)', type: 'number', placeholder: '0' },
];

function ruleToFlat(r) {
  return { ...r, _metric: r.criteria?.[0]?.metric || 'serviceRevenue', _threshold: r.criteria?.[0]?.value ?? 0 };
}
function flatToRule(d) {
  const { _metric, _threshold, ...rest } = d;
  return { ...rest, criteria: [{ metric: _metric || 'serviceRevenue', value: Number(_threshold) || 0 }], scopeTechNames: rest.scopeTechNames || [] };
}
function ruleSubtitle(r) {
  const m = BONUS_METRICS.find(x => x.key === (r.criteria?.[0]?.metric)) || {};
  const pt = PAYOUT_TYPES.find(p => p.key === r.payoutType) || {};
  return `${r.enabled ? '● ' : '○ '}${m.label || ''} ≥ ${r.criteria?.[0]?.value ?? 0} → ${pt.label || ''} ${r.payoutValue || 0}`;
}

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
  useTrashHeader(navigation, ['bonuses', 'reviews', 'continuingEducation', 'bonusRules'], isAdmin);
  const [tab, setTab] = useState('bonuses');
  const styles = useThemedStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.tabs}>
        {[['bonuses', 'Bonuses'], ['rules', 'Rules'], ['reviews', 'Reviews'], ['education', 'Education'], ['payroll', 'Payroll']].map(([id, label]) => (
          <TouchableOpacity key={id} onPress={() => setTab(id)} style={[styles.tab, tab === id && styles.tabOn]}>
            <Text style={[styles.tabText, tab === id && styles.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {tab === 'rules' ? (
        <ManageCrud
          load={async () => (await fetchBonusRules()).map(ruleToFlat)}
          create={(d) => saveBonusRule(null, flatToRule(d))}
          save={(id, d) => saveBonusRule(id, flatToRule(d))}
          remove={deleteBonusRule}
          canEdit={isAdmin}
          blank={() => ({ name: '', enabled: true, _metric: 'serviceRevenue', _threshold: 0, payoutType: 'fixed', payoutValue: 0, payoutMax: 0 })}
          fields={RULE_FIELDS}
          titleOf={(r) => r.name}
          subtitleOf={ruleSubtitle}
          addLabel="New rule"
          headerNote={() => 'Bonuses preview on the Payroll tab and are recorded when you run payroll.'}
        />
      ) : tab === 'education' ? (
        <ManageCrud
          load={fetchContinuingEducation}
          create={(d) => saveCE(null, d)} save={(id, d) => saveCE(id, d)} remove={deleteCE}
          canEdit={isAdmin}
          blank={() => ({ employeeName: '', title: '', category: CE_CATEGORIES[0], status: 'planned', provider: '', date: isoToday(), hours: 0, credits: 0, cost: 0, notes: '' })}
          fields={CE_FIELDS}
          titleOf={(r) => r.title}
          subtitleOf={(r) => `${r.employeeName || '—'} · ${r.status}${(Number(r.hours) || 0) > 0 ? ` · ${r.hours}h` : ''}`}
          addLabel="Log education"
        />
      ) : tab === 'bonuses' ? (
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
  const [gusto, setGusto] = useState(null);
  const [busy, setBusy]   = useState(false);
  const { isAdmin } = useTenantAccess();
  const styles = useThemedStyles(makeStyles);
  const { theme } = useTheme();

  const load = useCallback(async () => {
    try { setRuns(await fetchPayrollRuns()); } catch { setRuns([]); }
    try { const s = await fetchSettings(); setGusto(s?.gusto || null); } catch { setGusto(null); }
  }, []);
  const reloadGusto = useCallback(async () => { try { const s = await fetchSettings(); setGusto(s?.gusto || null); } catch {} }, []);
  useEffect(() => { load(); }, [load]);

  async function runPayroll() {
    if (busy) return;
    setBusy(true);
    try {
      const { startDate, endDate } = lastNDays(14);
      const ctxStart = lastNDays(14 + 365).startDate;
      const ctxEnd = (() => { const d = new Date(`${endDate}T12:00:00`); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10); })();
      const [emps, appts, receipts, bonuses, rules, ratings, ctxAppts] = await Promise.all([
        fetchEmployeesWithComp(), fetchAppointmentsByRange(startDate, endDate),
        fetchReceiptsByRange(startDate, endDate).catch(() => []), fetchBonuses(),
        fetchBonusRules().catch(() => []),
        fetchServiceRatingsByRange(startDate, endDate).catch(() => []),
        fetchAppointmentsByRange(ctxStart, ctxEnd).catch(() => []),
      ]);
      const rows = computePayroll(emps, appts, receipts || [], bonuses, startDate, { rules, ratings, ctxAppts, endDate });
      if (rows.length === 0) { Alert.alert('Nothing to pay', 'No commission or bonuses in the last 14 days.'); return; }
      const grandTotal = rows.reduce((s, r) => s + r.total, 0);
      Alert.alert(
        `Create payroll run?`,
        `${startDate} – ${endDate}\n${rows.length} tech${rows.length === 1 ? '' : 's'} · $${grandTotal.toFixed(2)} total.\n\nThis saves a draft run (it does NOT pay anyone yet).`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Create run', onPress: async () => {
            try {
              await createPayrollRun({
                startDate, endDate, grandTotal,
                techs: rows.map(r => ({
                  techName: r.emp.name, gustoId: r.emp.gustoId || null,
                  apptCount: r.apptCount, serviceRevenue: r.serviceRevenue,
                  commissionPct: r.commissionPct, earned: r.earned, bonusTotal: r.bonusTotal,
                  ruleBonusTotal: r.ruleBonusTotal || 0, ruleBonusLines: r.ruleBonusLines || [],
                  total: r.total, method: r.emp.paymentPref || null, paidAt: null,
                })),
              });
              await load();
            } catch (e) { Alert.alert('Couldn\'t create run', e?.message || 'Try again.'); }
          } },
        ],
      );
    } catch (e) { Alert.alert('Payroll failed', e?.message || 'Try again.'); }
    finally { setBusy(false); }
  }

  function submitToGusto(run) {
    Alert.alert(
      'Submit to Gusto?',
      `This creates a REAL off-cycle payroll in Gusto for ${(run.techs || []).length} tech(s), $${(Number(run.grandTotal) || 0).toFixed(2)}. This moves money.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', style: 'destructive', onPress: async () => {
          try { await gustoSubmitPayroll(run.id); Alert.alert('Submitted', 'Sent to Gusto.'); await load(); }
          catch (e) { Alert.alert('Gusto submit failed', e?.message || 'Try again.'); }
        } },
      ],
    );
  }

  if (runs === null) return <View style={styles.center}><ActivityIndicator color={theme.green} /></View>;
  return (
    <FlatList
      data={runs}
      keyExtractor={(r) => r.id}
      contentContainerStyle={{ padding: 14 }}
      ListHeaderComponent={
        <View style={{ marginBottom: 10 }}>
          <Text style={styles.gustoLabel}>Gusto payroll</Text>
          <OAuthConnect
            label="Connect Gusto"
            getUrl={getGustoAuthUrl}
            onReturn={reloadGusto}
            connected={!!gusto?.accessToken}
            connectedLabel={gusto?.companyName ? `Gusto · ${gusto.companyName}` : 'Gusto connected'}
          />
          {isAdmin && (
            <TouchableOpacity style={[styles.runBtn, busy && { opacity: 0.6 }]} onPress={runPayroll} disabled={busy}>
              <Text style={styles.runText}>{busy ? 'Computing…' : '＋ Run payroll · last 14 days'}</Text>
            </TouchableOpacity>
          )}
        </View>
      }
      ListEmptyComponent={<Text style={styles.empty}>No payroll runs yet.</Text>}
      renderItem={({ item }) => {
        const submitted = !!item.gustoSubmittedAt || !!item.gustoPayrollId;
        return (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.startDate || '?'} – {item.endDate || '?'}</Text>
              <Text style={styles.sub}>{(item.techs || item.employees || []).length} techs · {submitted ? 'submitted to Gusto' : (item.status || 'draft')}</Text>
            </View>
            <Text style={styles.amount}>${(Number(item.grandTotal || item.total) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</Text>
            {isAdmin && !submitted && gusto?.accessToken && (
              <TouchableOpacity style={styles.submitBtn} onPress={() => submitToGusto(item)}><Text style={styles.submitText}>Gusto</Text></TouchableOpacity>
            )}
          </View>
        );
      }}
    />
  );
}

const makeStyles = (t) => StyleSheet.create({
  wrap:      { flex: 1, backgroundColor: t.bg },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
  tabs:      { flexDirection: 'row', backgroundColor: t.surface, padding: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: t.border },
  tab:       { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center', backgroundColor: t.surfaceAlt },
  tabOn:     { backgroundColor: t.greenSoft },
  tabText:   { fontSize: 13, fontWeight: '700', color: t.textMuted },
  tabTextOn: { color: t.green },
  empty:     { textAlign: 'center', color: t.textFaint, marginTop: 50, fontSize: 13 },
  note:      { fontSize: 12, color: t.textFaint, marginTop: 8 },
  gustoLabel:{ fontSize: 13, fontWeight: '800', color: t.text, marginBottom: 4 },
  runBtn:    { marginTop: 12, backgroundColor: t.greenSoft, borderWidth: 1, borderColor: t.green, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  runText:   { color: t.green, fontWeight: '800', fontSize: 14 },
  submitBtn: { marginLeft: 10, backgroundColor: t.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  submitText:{ color: '#fff', fontWeight: '800', fontSize: 12 },
  row:       { flexDirection: 'row', alignItems: 'center', backgroundColor: t.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: t.border, gap: 10 },
  name:      { fontSize: 14.5, fontWeight: '700', color: t.text },
  sub:       { fontSize: 12, color: t.textMuted, marginTop: 2 },
  amount:    { fontSize: 15, fontWeight: '800', color: t.green },
});
