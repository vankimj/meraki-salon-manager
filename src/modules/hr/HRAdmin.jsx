import { useState, useEffect, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import {
  fetchEmployeesWithComp, fetchAppointmentsByRange, fetchReceiptsByRange,
  fetchBonuses, createBonus, deleteBonus,
  fetchPayrollRuns, createPayrollRun, savePayrollRun,
  fetchReviews, saveReview, deleteReview,
  fetchContinuingEducation, saveCE, deleteCE,
  fetchBonusRules, saveBonusRule, deleteBonusRule,
  fetchServiceRatingsByRange,
  fetchHandbook, saveHandbook, fetchHandbookSigs, sendHandbookReminderNotif,
  fetchTaxForms, fetchTaxFormsByEmail, upsertTaxForm, deleteTaxForm,
  fetchPayrollRunsForYear,
} from '../../lib/firestore';
import { EmpAvatar } from '../employees/EmployeesAdmin';
import { logActivity } from '../../lib/logger';
import { useApp } from '../../context/AppContext';
import TrashButton from '../../components/TrashButton';
import { escapeHtml } from '../../utils/helpers';
import { techPayAdjust } from '../reports/metrics';
import { POLICIES_TEMPLATE } from './policiesTemplate';
import { CE_IDEAS, CE_CATEGORIES } from './ceIdeas';
import { buildBonusContext, evaluateBonusRules, BONUS_METRICS, PAYOUT_TYPES } from './bonusRules';

const gustoGetAuthUrlFn    = httpsCallable(functions, 'gustoGetAuthUrl');
const gustoSyncEmployeesFn = httpsCallable(functions, 'gustoSyncEmployees');
const gustoSubmitPayrollFn = httpsCallable(functions, 'gustoSubmitPayroll');

function todayStr() { return new Date().toISOString().slice(0, 10); }

function startOf(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function shiftDay(iso, deltaDays) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

function fmt$(n) {
  return '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDateShort(iso) {
  return new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtDateFull(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const PERIODS = [
  { label: '7D',  days: 7  },
  { label: '14D', days: 14 },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

const METHODS = [
  { id: 'cash',           label: 'Cash'           },
  { id: 'check',          label: 'Check'          },
  { id: 'direct_deposit', label: 'Direct Deposit' },
  { id: 'venmo',          label: 'Venmo'          },
];

export default function HRAdmin() {
  const { isAdmin, isTech, isScheduler, myTechName, gUser, settings } = useApp();
  const defaultTab = isTech ? 'handbook' : 'payroll';
  const [tab,          setTab]          = useState(defaultTab);
  const [periodDays,   setPeriodDays]   = useState(14);
  const [employees,    setEmployees]    = useState([]);
  const [appts,        setAppts]        = useState(null);
  const [receipts,     setReceipts]     = useState([]);   // for refund-withhold + redo-transfer payroll adjustments
  const [bonuses,      setBonuses]      = useState([]);
  const [payrollRuns,  setPayrollRuns]  = useState([]);
  const [reviews,      setReviews]      = useState([]);
  const [ceRecords,    setCeRecords]    = useState([]);
  const [bonusRules,   setBonusRules]   = useState([]);
  const [ratings,      setRatings]      = useState([]);   // service ratings in period (bonus-rule metric)
  const [ctxAppts,     setCtxAppts]     = useState([]);   // wider appt window for rebook/new-client metrics
  const [taxForms,     setTaxForms]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showRunModal, setShowRunModal] = useState(false);
  const [editReview,   setEditReview]   = useState(null); // null = closed, {} = new, {id,...} = edit
  const [editCE,       setEditCE]       = useState(null);
  const [editRule,     setEditRule]     = useState(null);

  const endDate   = todayStr();
  const startDate = startOf(periodDays);

  useEffect(() => {
    fetchEmployeesWithComp().then(setEmployees).catch(() => {});
    loadTaxForms();
    loadCE();
    if (!isTech) {
      loadBonuses();
      loadBonusRules();
      loadPayrollRuns();
      loadReviews();
    }
  }, []); // eslint-disable-line

  useEffect(() => { if (!isTech) loadAppts(); else setLoading(false); }, [periodDays, isTech]); // eslint-disable-line

  async function loadAppts() {
    setLoading(true);
    try {
      const [a, r] = await Promise.all([
        fetchAppointmentsByRange(startDate, endDate),
        fetchReceiptsByRange(startDate, endDate).catch(() => []),
      ]);
      setAppts(a); setReceipts(r || []);
    }
    catch { setAppts([]); setReceipts([]); }
    finally { setLoading(false); }
    // Bonus-rule metric inputs: service ratings in the period + a wider
    // appointment window (1y back → 60d forward) so new-client and rebooking
    // rates can be computed. Best-effort — failures leave the metrics at 0.
    try { setRatings(await fetchServiceRatingsByRange(startDate, endDate)); } catch { setRatings([]); }
    try { setCtxAppts(await fetchAppointmentsByRange(startOf(periodDays + 365), shiftDay(endDate, 60))); }
    catch { setCtxAppts([]); }
  }

  async function loadBonuses() {
    try { setBonuses(await fetchBonuses()); }
    catch {}
  }

  async function loadBonusRules() {
    try { setBonusRules(await fetchBonusRules()); }
    catch {}
  }

  async function loadCE() {
    // Non-admin staff may only read their own CE (rules gate on createdBy), so
    // scope the query to their uid; admins read all.
    try { setCeRecords(await fetchContinuingEducation(isAdmin ? undefined : gUser?.uid)); }
    catch {}
  }

  async function loadPayrollRuns() {
    try { setPayrollRuns(await fetchPayrollRuns()); }
    catch {}
  }

  async function loadReviews() {
    try { setReviews(await fetchReviews()); }
    catch {}
  }

  async function loadTaxForms() {
    try {
      if (isTech && gUser?.email) {
        setTaxForms(await fetchTaxFormsByEmail(gUser.email));
      } else {
        setTaxForms(await fetchTaxForms());
      }
    } catch {}
  }

  async function handleGenerate1099s(year) {
    const runs = await fetchPayrollRunsForYear(year);
    const emps = await fetchEmployeesWithComp();
    const empMap = {};
    emps.forEach(e => { empMap[e.name] = e; });

    // Aggregate earnings per tech
    const totals = {};
    runs.forEach(run => {
      (run.techs || []).forEach(t => {
        if (!t.techName) return;
        totals[t.techName] = (totals[t.techName] || 0) + (Number(t.total) || 0);
      });
    });

    const payer = {
      name:    settings?.salonName    || '',
      address: settings?.salonAddress || '',
      ein:     settings?.ein          || '',
    };

    let count = 0;
    for (const [techName, totalEarnings] of Object.entries(totals)) {
      const emp = empMap[techName] || {};
      await upsertTaxForm(year, techName, {
        techEmail:        emp.email || '',
        techAddress:      emp.address || '',
        techTaxId:        emp.taxId || '',
        totalEarnings:    Math.round(totalEarnings * 100) / 100,
        federalWithheld:  0,
        payer,
        generatedAt:      new Date().toISOString(),
        generatedBy:      gUser?.email || 'admin',
      });
      count++;
    }
    logActivity('1099s_generated', `${year} · ${count} form(s)`);
    await loadTaxForms();
    return count;
  }

  async function handleSaveReview(data) {
    const id = await saveReview(data.id || null, data);
    logActivity(data.id ? 'review_updated' : 'review_created', `${data.employeeName} · ${data.periodStart} – ${data.periodEnd} [${data.status}]`);
    await loadReviews();
    return id;
  }

  async function handleDeleteReview(id) {
    if (!confirm('Delete this review?')) return;
    const rev = reviews.find(r => r.id === id);
    await deleteReview(id);
    logActivity('review_deleted', rev ? `${rev.employeeName} · ${rev.periodStart}` : id);
    setReviews(rs => rs.filter(r => r.id !== id));
  }

  async function handleSaveCE(data) {
    const id = await saveCE(data.id || null, data);
    logActivity(data.id ? 'ce_updated' : 'ce_logged', `${data.employeeName} · ${data.title} [${data.status}]`);
    await loadCE();
    return id;
  }

  async function handleDeleteCE(id) {
    if (!confirm('Delete this education record?')) return;
    const rec = ceRecords.find(r => r.id === id);
    await deleteCE(id);
    logActivity('ce_deleted', rec ? `${rec.employeeName} · ${rec.title}` : id);
    setCeRecords(rs => rs.filter(r => r.id !== id));
  }

  async function handleSaveRule(data) {
    const id = await saveBonusRule(data.id || null, data);
    logActivity(data.id ? 'bonus_rule_updated' : 'bonus_rule_created', `${data.name} [${data.enabled ? 'on' : 'off'}]`);
    await loadBonusRules();
    return id;
  }

  async function handleDeleteRule(id) {
    if (!confirm('Delete this bonus rule?')) return;
    const rule = bonusRules.find(r => r.id === id);
    await deleteBonusRule(id);
    logActivity('bonus_rule_deleted', rule ? rule.name : id);
    setBonusRules(rs => rs.filter(r => r.id !== id));
  }

  async function handleAddBonus(techName, amount, notes) {
    await createBonus({ techName, amount: Number(amount), notes: notes || '' });
    logActivity('bonus_added', `${techName} +$${Number(amount).toFixed(2)}`);
    await loadBonuses();
  }

  async function handleDeleteBonus(id) {
    if (!confirm('Delete this bonus?')) return;
    const bonus = bonuses.find(b => b.id === id);
    await deleteBonus(id);
    logActivity('bonus_deleted', bonus ? `${bonus.techName} $${Number(bonus.amount).toFixed(2)}` : id);
    setBonuses(b => b.filter(x => x.id !== id));
  }

  async function handleRunPayroll(techPayments) {
    const run = {
      startDate,
      endDate,
      grandTotal: techPayments.reduce((s, t) => s + t.total, 0),
      techs: techPayments.map(t => ({
        techName:       t.emp.name,
        apptCount:      t.techAppts.length,
        serviceRevenue: t.serviceRevenue,
        commissionPct:  t.commissionPct,
        earned:         t.earned,
        bonusTotal:     t.bonusTotal,
        ruleBonusTotal: t.ruleBonusTotal || 0,
        ruleBonusLines: t.ruleBonusLines || [],
        total:          t.total,
        method:         t.method,
        paidAt:         null,
      })),
    };
    await createPayrollRun(run);
    logActivity('payroll_run', `${startDate} – ${endDate} · $${run.grandTotal.toFixed(2)}`);
    await loadPayrollRuns();
    setShowRunModal(false);
  }

  async function handleMarkTechPaid(runId, techName) {
    const run = payrollRuns.find(r => r.id === runId);
    if (!run) return;
    const updatedTechs = run.techs.map(t =>
      t.techName === techName ? { ...t, paidAt: new Date().toISOString() } : t
    );
    await savePayrollRun(runId, { techs: updatedTechs });
    logActivity('payroll_marked_paid', `${techName} · run ${runId.slice(-6)}`);
    setPayrollRuns(runs => runs.map(r => r.id === runId ? { ...r, techs: updatedTechs } : r));
  }

  const payrollRows = useMemo(() => {
    if (!appts) return [];
    const doneAppts = appts.filter(a => a.status === 'done');
    return employees
      .filter(e => e.active !== false)
      .map(emp => {
        // Include appointments where tech is primary OR appears in a multi-tech split
        const techAppts = doneAppts.filter(a =>
          a.payment?.techSplit
            ? a.payment.techSplit.some(t => t.techName === emp.name)
            : a.techName === emp.name
        );
        const grossRevenue = techAppts.reduce((s, a) => {
          if (a.payment?.techSplit) {
            const split = a.payment.techSplit.find(t => t.techName === emp.name);
            return s + (split?.revenue || 0);
          }
          return s + (a.services || []).reduce((t, sv) => t + (Number(sv.price) || 0), 0);
        }, 0);
        // Net withheld refunds + redo transfers (mirrors the tech dashboards) so
        // payroll commission matches what each tech sees. Clamp at 0 — payroll
        // never goes negative even if a tech's period was fully refunded/redone.
        const adj = techPayAdjust(receipts, emp.name);
        const serviceRevenue = Math.max(0, Math.round((grossRevenue - adj.refundWithheld - adj.redoOut + adj.redoIn) * 100) / 100);
        const commissionPct = Number(emp.commissionPct) || 0;
        const commissionAmt = commissionPct
          ? Math.round(serviceRevenue * commissionPct / 100 * 100) / 100
          : 0;
        const periodBonuses = bonuses.filter(b =>
          b.techName === emp.name && (b.createdAt || '').slice(0, 10) >= startDate);
        const bonusTotal = periodBonuses.reduce((s, b) => s + (Number(b.amount) || 0), 0);
        // Structured rule bonuses — computed live as a PREVIEW from the current
        // period metrics; never persisted as bonus docs (no double-pay risk).
        const ctx = buildBonusContext({
          techName: emp.name, serviceRevenue, techAppts, allAppts: ctxAppts,
          receipts, ratings, hireDate: emp.hireDate || '', startDate, endDate,
        });
        const { ruleBonusTotal, ruleBonusLines } = evaluateBonusRules(bonusRules, ctx);
        const isHourly   = emp.rateType === 'hourly';
        const earned     = isHourly ? null : commissionAmt;
        const total      = (earned || 0) + bonusTotal + ruleBonusTotal;
        return { emp, techAppts, serviceRevenue, grossRevenue, adj, commissionPct, commissionAmt, periodBonuses, bonusTotal, ruleBonusTotal, ruleBonusLines, bonusCtx: ctx, earned, isHourly, total };
      });
  }, [employees, appts, receipts, bonuses, bonusRules, ratings, ctxAppts, startDate, endDate]);

  const grandTotal = payrollRows.reduce((s, r) => s + r.total, 0);

  if (isScheduler) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--pn-text-faint)', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 600, color: 'var(--pn-text-muted)', marginBottom: 8 }}>Access Restricted</div>
        <div>HR is available to admin staff only.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 24 }}>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--pn-border)', marginBottom: 20, flexShrink: 0, overflowX: 'auto' }}>
        {(isTech ? [
          { id: 'education', label: 'Education', badge: ceRecords.length || null },
          { id: 'handbook',  label: 'Company Policies' },
          { id: '1099s',     label: '1099s'    },
        ] : [
          { id: 'payroll',    label: 'Payroll' },
          { id: 'history',    label: 'History', badge: payrollRuns.length || null },
          { id: 'bonuses',    label: 'Bonuses' },
          { id: 'bonusRules', label: 'Bonus Rules', badge: bonusRules.length || null },
          { id: 'reviews',    label: 'Reviews', badge: reviews.length || null },
          { id: 'education',  label: 'Education', badge: ceRecords.length || null },
          { id: 'handbook',   label: 'Company Policies' },
          { id: '1099s',      label: '1099s', badge: taxForms.length || null },
          { id: 'gusto',      label: 'Gusto' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-faint)', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid var(--pn-text)' : '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: 'var(--pn-border)', color: 'var(--pn-text-muted)', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'payroll' && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <TrashButton collections={['bonuses', 'reviews', 'continuingEducation', 'bonusRules']} scope="HR" />
        </div>
      )}
      {tab === 'payroll' && (
        <PayrollTab
          periodDays={periodDays}
          setPeriodDays={setPeriodDays}
          startDate={startDate}
          endDate={endDate}
          rows={payrollRows}
          loading={loading}
          grandTotal={grandTotal}
          onAddBonus={handleAddBonus}
          onRunPayroll={() => setShowRunModal(true)}
        />
      )}

      {tab === 'history' && (
        <HistoryTab
          runs={payrollRuns}
          onMarkPaid={handleMarkTechPaid}
        />
      )}

      {tab === 'bonuses' && (
        <BonusesTab
          bonuses={bonuses}
          employees={employees.filter(e => e.active !== false)}
          onAdd={handleAddBonus}
          onDelete={handleDeleteBonus}
        />
      )}

      {tab === 'reviews' && (
        <ReviewsTab
          reviews={reviews}
          employees={employees.filter(e => e.active !== false)}
          onNew={() => setEditReview({})}
          onEdit={r => setEditReview(r)}
          onDelete={handleDeleteReview}
        />
      )}

      {tab === 'bonusRules' && (
        <BonusRulesTab
          rules={bonusRules}
          rows={payrollRows}
          loading={loading}
          onNew={() => setEditRule({})}
          onEdit={r => setEditRule(r)}
          onToggle={async r => { await handleSaveRule({ ...r, enabled: !r.enabled }); }}
          onDelete={handleDeleteRule}
        />
      )}

      {tab === 'education' && (
        <ContinuingEducationTab
          records={isTech ? ceRecords.filter(r => r.createdBy === gUser?.uid || r.employeeName === myTechName) : ceRecords}
          employees={employees.filter(e => e.active !== false)}
          isTech={isTech}
          onNew={() => setEditCE({})}
          onEdit={r => setEditCE(r)}
          onDelete={handleDeleteCE}
        />
      )}

      {tab === 'handbook' && (
        <HandbookTab employees={employees.filter(e => e.active !== false)} />
      )}

      {tab === '1099s' && (
        <TaxFormsTab
          forms={taxForms}
          employees={employees}
          isAdmin={isAdmin}
          isTech={isTech}
          myTechName={myTechName}
          settings={settings}
          onGenerate={handleGenerate1099s}
          onDelete={async id => { await deleteTaxForm(id); await loadTaxForms(); }}
        />
      )}

      {tab === 'gusto' && (
        <GustoTab
          employees={employees.filter(e => e.active !== false)}
          payrollRuns={payrollRuns}
        />
      )}

      {editReview !== null && (
        <NewReviewModal
          existing={editReview.id ? editReview : null}
          employees={employees.filter(e => e.active !== false)}
          onSave={handleSaveReview}
          onClose={() => setEditReview(null)}
        />
      )}

      {editCE !== null && (
        <EditCEModal
          seed={editCE}
          employees={employees.filter(e => e.active !== false)}
          isTech={isTech}
          myTechName={myTechName}
          myUid={gUser?.uid}
          onSave={handleSaveCE}
          onClose={() => setEditCE(null)}
        />
      )}

      {editRule !== null && (
        <EditRuleModal
          existing={editRule.id ? editRule : null}
          employees={employees.filter(e => e.active !== false)}
          onSave={handleSaveRule}
          onClose={() => setEditRule(null)}
        />
      )}

      {showRunModal && (
        <RunPayrollModal
          rows={payrollRows}
          startDate={startDate}
          endDate={endDate}
          grandTotal={grandTotal}
          onConfirm={handleRunPayroll}
          onClose={() => setShowRunModal(false)}
        />
      )}
    </div>
  );
}

// ── Payroll tab ────────────────────────────────────────
function PayrollTab({ periodDays, setPeriodDays, startDate, endDate, rows, loading, grandTotal, onAddBonus, onRunPayroll }) {
  const [addBonusFor, setAddBonusFor] = useState(null);
  const [bonusAmt,    setBonusAmt]    = useState('');
  const [bonusNote,   setBonusNote]   = useState('');
  const [saving,      setSaving]      = useState(false);
  const [expanded,    setExpanded]    = useState({});
  // A tech with a Tax ID on file is treated as a 1099 contractor — warn that
  // discretionary bonuses can affect their classification.
  const addBonusEmp   = addBonusFor ? rows.find(r => r.emp?.name === addBonusFor)?.emp : null;
  const addBonusIs1099 = !!(addBonusEmp && addBonusEmp.tin);

  async function submitBonus() {
    if (!bonusAmt) return;
    setSaving(true);
    try {
      await onAddBonus(addBonusFor, bonusAmt, bonusNote);
      setAddBonusFor(null); setBonusAmt(''); setBonusNote('');
    } finally { setSaving(false); }
  }

  const COL = '1fr 56px 88px 72px 72px 68px 80px 76px';
  const hasPayable = rows.some(r => r.total > 0);

  return (
    <>
      {/* Period + Run Payroll toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16 }}>
        {PERIODS.map(p => (
          <PillBtn key={p.days} active={periodDays === p.days} onClick={() => setPeriodDays(p.days)}>
            {p.label}
          </PillBtn>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>
            {fmtDateShort(startDate)} – {fmtDateShort(endDate)}
          </span>
          {!loading && hasPayable && (
            <button onClick={onRunPayroll}
              style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 700 }}>
              Run Payroll
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="scroll-x" style={{ borderRadius: 12, border: '1px solid var(--pn-border)' }}>
        <div style={{ background: 'var(--pn-surface)', borderRadius: 12, minWidth: 560, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '8px 16px', background: 'var(--pn-surface-muted)', borderBottom: '1px solid var(--pn-border)', fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            <span>Tech</span>
            <span style={{ textAlign: 'right' }}>Appts</span>
            <span style={{ textAlign: 'right' }}>Revenue</span>
            <span style={{ textAlign: 'right' }}>Rate</span>
            <span style={{ textAlign: 'right' }}>Earned</span>
            <span style={{ textAlign: 'right' }}>Bonus</span>
            <span style={{ textAlign: 'right' }}>Total</span>
            <span />
          </div>

          {rows.map((row, i) => {
            const isLast     = i === rows.length - 1;
            const isExpanded = expanded[row.emp.name];
            return (
              <div key={row.emp.name}>
                <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '10px 16px', borderBottom: isLast && !isExpanded ? 'none' : '1px solid var(--pn-border)', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <EmpAvatar emp={row.emp} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{row.emp.name}</span>
                    {row.techAppts.length > 0 && (
                      <button onClick={() => setExpanded(e => ({ ...e, [row.emp.name]: !e[row.emp.name] }))}
                        style={{ fontSize: 10, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'inherit' }}>
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                  <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--pn-text-muted)' }}>{row.techAppts.length}</span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--pn-text-muted)' }}>
                    {fmt$(row.serviceRevenue)}
                    {(() => {
                      const delta = Math.round((row.serviceRevenue - row.grossRevenue) * 100) / 100;
                      if (Math.abs(delta) < 0.005) return null;
                      const parts = [
                        row.adj.refundWithheld > 0 ? `−${fmt$(row.adj.refundWithheld)} withheld refunds` : '',
                        row.adj.redoOut > 0 ? `−${fmt$(row.adj.redoOut)} redos given` : '',
                        row.adj.redoIn > 0 ? `+${fmt$(row.adj.redoIn)} redos received` : '',
                      ].filter(Boolean).join(' · ');
                      return (
                        <div title={`Gross ${fmt$(row.grossRevenue)} · ${parts}`} style={{ fontSize: 10, color: delta < 0 ? '#ef4444' : '#22c55e' }}>
                          {delta < 0 ? '' : '+'}{fmt$(delta)} adj
                        </div>
                      );
                    })()}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--pn-text-muted)' }}>
                    {row.commissionPct ? `${row.commissionPct}%` : row.isHourly ? `$${row.emp.hourlyRate}/hr` : '—'}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: 'var(--pn-text)' }}>
                    {row.earned !== null
                      ? fmt$(row.earned)
                      : <span style={{ color: 'var(--pn-text-faint)', fontSize: 11 }}>hourly</span>}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: (row.bonusTotal + row.ruleBonusTotal) > 0 ? '#22c55e' : 'var(--pn-text-faint)' }}
                    title={row.ruleBonusTotal > 0 ? `${fmt$(row.bonusTotal)} manual · ${fmt$(row.ruleBonusTotal)} rule bonuses` : ''}>
                    {(row.bonusTotal + row.ruleBonusTotal) > 0 ? fmt$(row.bonusTotal + row.ruleBonusTotal) : '—'}
                    {row.ruleBonusTotal > 0 && <span style={{ fontSize: 9, color: 'var(--pn-text-faint)', display: 'block' }}>incl. rules</span>}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>{fmt$(row.total)}</span>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setAddBonusFor(row.emp.name); setBonusAmt(''); setBonusNote(''); }}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                      + Bonus
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ background: 'var(--pn-surface-muted)', borderBottom: isLast ? 'none' : '1px solid var(--pn-border)', padding: '8px 16px 8px 52px' }}>
                    {row.techAppts.map(a => {
                      const rev = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: 12, color: 'var(--pn-text-muted)', borderBottom: '1px solid var(--pn-border)' }}>
                          <span style={{ flex: 1 }}>{a.clientName || 'Walk-in'}</span>
                          <span style={{ marginRight: 16, color: 'var(--pn-text-faint)' }}>{(a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—'}</span>
                          <span style={{ width: 72, textAlign: 'right', fontWeight: 500 }}>{fmt$(rev)}</span>
                        </div>
                      );
                    })}
                    {row.periodBonuses.map(b => (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                        <span style={{ flex: 1, color: '#22c55e' }}>Bonus{b.notes ? `: ${b.notes}` : ''}</span>
                        <span style={{ width: 72, textAlign: 'right', fontWeight: 500, color: '#22c55e' }}>{fmt$(b.amount)}</span>
                      </div>
                    ))}
                    {(row.ruleBonusLines || []).map((l, li) => (
                      <div key={`rule-${li}`} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                        <span style={{ flex: 1, color: '#2D7A5F' }}>Rule bonus: {l.name}</span>
                        <span style={{ width: 72, textAlign: 'right', fontWeight: 500, color: '#2D7A5F' }}>{fmt$(l.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Grand total */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '10px 16px', background: 'var(--pn-bg)', borderTop: '2px solid var(--pn-border)', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)' }}>Total ({rows.length} techs)</span>
            <span />
            <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: 'var(--pn-text-muted)' }}>
              {fmt$(rows.reduce((s, r) => s + r.serviceRevenue, 0))}
            </span>
            <span /><span />
            <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#22c55e' }}>
              {fmt$(rows.reduce((s, r) => s + r.bonusTotal + (r.ruleBonusTotal || 0), 0))}
            </span>
            <span style={{ textAlign: 'right', fontSize: 16, fontWeight: 800, color: 'var(--pn-text)' }}>{fmt$(grandTotal)}</span>
            <span />
          </div>
        </div>
        </div>
      )}

      {/* Add bonus modal */}
      {addBonusFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
             onClick={e => { if (e.target === e.currentTarget) setAddBonusFor(null); }}>
          <div style={{ background: 'var(--pn-surface)', borderRadius: 14, width: 320, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Add Bonus — {addBonusFor}</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Amount ($) *</label>
              <input type="number" min={0} value={bonusAmt} onChange={e => setBonusAmt(e.target.value)}
                placeholder="e.g. 50" autoFocus style={inp} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Notes (optional)</label>
              <input value={bonusNote} onChange={e => setBonusNote(e.target.value)}
                placeholder="Holiday, performance, etc." style={inp} />
            </div>
            {addBonusIs1099 && (
              <div style={{ marginBottom: 12, fontSize: 11.5, lineHeight: 1.5, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px' }}>
                ⚠️ {addBonusFor} has a Tax ID on file (treated as a <strong>1099 contractor</strong>). Recurring or discretionary bonuses can reclassify a contractor as a W-2 employee — prefer output-based amounts written into their contract. See the <strong>Bonus Rules</strong> tab for guidance.
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAddBonusFor(null)}
                style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={submitBonus} disabled={saving || !bonusAmt}
                style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: saving || !bonusAmt ? 'var(--pn-border-strong)' : '#22c55e', color: '#fff', cursor: saving || !bonusAmt ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
                {saving ? 'Saving…' : 'Add Bonus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Run Payroll modal ──────────────────────────────────
function RunPayrollModal({ rows, startDate, endDate, grandTotal, onConfirm, onClose }) {
  const [methods, setMethods] = useState(() =>
    Object.fromEntries(rows.map(r => [r.emp.name, r.emp.paymentPref || 'cash']))
  );
  const [saving, setSaving] = useState(false);

  const payableRows = rows.filter(r => r.total > 0);

  async function submit() {
    setSaving(true);
    try {
      await onConfirm(payableRows.map(r => ({ ...r, method: methods[r.emp.name] || 'cash' })));
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Run Payroll</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.75)', marginTop: 2 }}>
              {fmtDateShort(startDate)} – {fmtDateShort(endDate)} · {payableRows.length} tech{payableRows.length !== 1 ? 's' : ''}
            </div>
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {payableRows.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--pn-text-faint)', fontSize: 13 }}>
              No payable amounts in this period.
            </div>
          ) : (
            payableRows.map(row => (
              <div key={row.emp.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--pn-border)' }}>
                <EmpAvatar emp={row.emp} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{row.emp.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                    {row.techAppts.length} appts
                    {row.earned !== null && ` · ${fmt$(row.earned)} earned`}
                    {row.bonusTotal > 0 && ` · ${fmt$(row.bonusTotal)} bonus`}
                    {row.ruleBonusTotal > 0 && ` · ${fmt$(row.ruleBonusTotal)} rule bonus`}
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--pn-text)', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
                  {fmt$(row.total)}
                </div>
                <select
                  value={methods[row.emp.name] || 'cash'}
                  onChange={e => setMethods(m => ({ ...m, [row.emp.name]: e.target.value }))}
                  style={{ ...inp, width: 130, flexShrink: 0 }}
                >
                  {METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {payableRows.length > 0 && (
          <div style={{ padding: '12px 18px', borderTop: '1px solid var(--pn-border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>Total payout</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--pn-text)' }}>{fmt$(grandTotal)}</span>
            </div>
            <button onClick={submit} disabled={saving}
              style={{ width: '100%', background: saving ? 'var(--pn-text-faint)' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Recording…' : 'Record Payroll Run'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── History tab ────────────────────────────────────────
function HistoryTab({ runs, onMarkPaid }) {
  const [expanded, setExpanded] = useState({});
  const [marking,  setMarking]  = useState(null); // `${runId}-${techName}`

  async function markPaid(runId, techName) {
    const key = `${runId}-${techName}`;
    setMarking(key);
    try { await onMarkPaid(runId, techName); }
    finally { setMarking(null); }
  }

  if (!runs.length) {
    return (
      <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>
        No payroll runs recorded yet. Use the Payroll tab to run payroll.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {runs.map(run => {
        const paidCount  = run.techs.filter(t => t.paidAt).length;
        const totalCount = run.techs.length;
        const allPaid    = paidCount === totalCount;
        const isExpanded = expanded[run.id];

        return (
          <div key={run.id} style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
            {/* Run header row */}
            <div
              onClick={() => setExpanded(e => ({ ...e, [run.id]: !e[run.id] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>
                  {fmtDateShort(run.startDate)} – {fmtDateShort(run.endDate)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>
                  Recorded {fmtDateFull(run.createdAt)} · {totalCount} tech{totalCount !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: allPaid ? 'var(--pn-success-bg)' : 'var(--pn-warning-bg)', color: allPaid ? 'var(--pn-success)' : 'var(--pn-warning)', border: `1px solid ${allPaid ? '#86efac' : '#fcd34d'}` }}>
                  {allPaid ? '✓ All paid' : `${paidCount}/${totalCount} paid`}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: 'var(--pn-text)' }}>{fmt$(run.grandTotal)}</span>
                <span style={{ fontSize: 14, color: 'var(--pn-text-faint)' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded per-tech rows */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid var(--pn-border)' }}>
                {run.techs.map((t, i) => (
                  <div key={t.techName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 28px', borderBottom: i < run.techs.length - 1 ? '1px solid var(--pn-border)' : 'none', background: t.paidAt ? 'var(--pn-success-bg)' : 'var(--pn-surface)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{t.techName}</span>
                      <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginLeft: 8 }}>
                        {t.apptCount} appts
                        {t.earned != null && ` · ${fmt$(t.earned)} earned`}
                        {t.bonusTotal > 0 && ` · ${fmt$(t.bonusTotal)} bonus`}
                        {t.ruleBonusTotal > 0 && ` · ${fmt$(t.ruleBonusTotal)} rule bonus`}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flexShrink: 0 }}>
                      {METHODS.find(m => m.id === t.method)?.label || t.method}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
                      {fmt$(t.total)}
                    </span>
                    {t.paidAt ? (
                      <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600, flexShrink: 0, minWidth: 80, textAlign: 'right' }}>
                        ✓ Paid {fmtDateShort(t.paidAt)}
                      </span>
                    ) : (
                      <button
                        onClick={() => markPaid(run.id, t.techName)}
                        disabled={marking === `${run.id}-${t.techName}`}
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #86efac', background: 'var(--pn-success-bg)', color: 'var(--pn-success)', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
                        {marking === `${run.id}-${t.techName}` ? '…' : 'Mark Paid'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Bonuses tab ────────────────────────────────────────
function BonusesTab({ bonuses, employees, onAdd, onDelete }) {
  const [techName, setTechName] = useState('');
  const [amount,   setAmount]   = useState('');
  const [notes,    setNotes]    = useState('');
  const [saving,   setSaving]   = useState(false);

  async function submit() {
    if (!techName || !amount) return;
    setSaving(true);
    try { await onAdd(techName, amount, notes); setAmount(''); setNotes(''); }
    finally { setSaving(false); }
  }

  return (
    <>
      {/* Add form */}
      <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Add Bonus</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Tech</label>
            <select value={techName} onChange={e => setTechName(e.target.value)} style={inp}>
              <option value="">Select tech…</option>
              {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ width: 100 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Amount ($)</label>
            <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" style={inp} />
          </div>
          <div style={{ flex: 3, minWidth: 160 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Holiday, performance, etc." style={inp} />
          </div>
          <button onClick={submit} disabled={saving || !techName || !amount}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saving || !techName || !amount ? 'var(--pn-border-strong)' : '#22c55e', color: '#fff', cursor: saving || !techName || !amount ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, flexShrink: 0, alignSelf: 'flex-end' }}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      {bonuses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--pn-text-faint)', fontSize: 13 }}>No bonuses recorded yet.</div>
      ) : (
        <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
          {bonuses.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < bonuses.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{b.techName}</div>
                {b.notes && <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 1 }}>{b.notes}</div>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', flexShrink: 0 }}>{fmtDateFull(b.createdAt)}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>{fmt$(b.amount)}</div>
              <button onClick={() => onDelete(b.id)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                Del
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── Reviews tab ────────────────────────────────────────
const RATING_FIELDS = [
  { key: 'clientSatisfaction', label: 'Client Satisfaction' },
  { key: 'punctuality',        label: 'Punctuality' },
  { key: 'teamwork',           label: 'Teamwork & Attitude' },
  { key: 'skillQuality',       label: 'Skill & Quality' },
  { key: 'growth',             label: 'Growth & Initiative' },
];

function avgRating(ratings) {
  const vals = Object.values(ratings || {}).filter(v => v > 0);
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

function Stars({ value, size = 13 }) {
  const filled = Math.round(value);
  return (
    <span style={{ fontSize: size, letterSpacing: -1, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <span key={n} style={{ color: n <= filled ? '#f59e0b' : 'var(--pn-border)' }}>★</span>
      ))}
    </span>
  );
}

function StarPicker({ value, onChange }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: 'flex', gap: 2 }}>
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: n <= (hover || value) ? '#f59e0b' : 'var(--pn-border)', padding: '0 1px', lineHeight: 1 }}>
          ★
        </button>
      ))}
    </div>
  );
}

function ReviewsTab({ reviews, employees, onNew, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState({});

  // Group by employee name, sorted by most recent review
  const byEmp = {};
  reviews.forEach(r => {
    if (!byEmp[r.employeeName]) byEmp[r.employeeName] = [];
    byEmp[r.employeeName].push(r);
  });
  const empNames = Object.keys(byEmp).sort((a, b) => {
    const latestA = byEmp[a][0]?.createdAt || '';
    const latestB = byEmp[b][0]?.createdAt || '';
    return latestB.localeCompare(latestA);
  });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
        <button onClick={onNew}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
          + New Review
        </button>
      </div>

      {reviews.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>
          No reviews yet. Create the first one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {empNames.map(name => {
            const empReviews = byEmp[name];
            const emp = employees.find(e => e.name === name);
            const isOpen = expanded[name];
            return (
              <div key={name} style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
                {/* Tech header */}
                <div onClick={() => setExpanded(e => ({ ...e, [name]: !e[name] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
                  {emp && <EmpAvatar emp={emp} size={32} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{name}</div>
                    <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                      {empReviews.length} review{empReviews.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, color: 'var(--pn-text-faint)' }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--pn-border)' }}>
                    {empReviews.map((rev, i) => {
                      const avg = avgRating(rev.ratings);
                      return (
                        <div key={rev.id} style={{ padding: '12px 16px 12px 28px', borderBottom: i < empReviews.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>
                                  {fmtDateShort(rev.periodStart)} – {fmtDateShort(rev.periodEnd)}
                                </span>
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                                  background: rev.status === 'final' ? 'var(--pn-success-bg)' : 'var(--pn-warning-bg)',
                                  color:      rev.status === 'final' ? 'var(--pn-success)' : 'var(--pn-warning)',
                                  border: `1px solid ${rev.status === 'final' ? '#86efac' : '#fcd34d'}` }}>
                                  {rev.status === 'final' ? 'Final' : 'Draft'}
                                </span>
                                {avg > 0 && <Stars value={avg} size={12} />}
                              </div>
                              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>
                                {rev.metrics?.appointmentCount > 0 && (
                                  <span>{rev.metrics.appointmentCount} appts · {fmt$(rev.metrics.revenue)} · avg {fmt$(rev.metrics.avgTicket)}</span>
                                )}
                                <span>Reviewed {fmtDateShort(rev.reviewDate || rev.createdAt)}</span>
                              </div>
                              {rev.strengths && (
                                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 6, lineHeight: 1.5 }}>
                                  <span style={{ fontWeight: 500, color: '#2D7A5F' }}>Strengths: </span>{rev.strengths}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button onClick={() => onEdit(rev)}
                                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                                Edit
                              </button>
                              <button onClick={() => onDelete(rev.id)}
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit' }}>
                                Del
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── New/Edit Review modal ──────────────────────────────
const REVIEW_PERIODS = [
  { label: '30D',  days: 30  },
  { label: '60D',  days: 60  },
  { label: '90D',  days: 90  },
  { label: '180D', days: 180 },
];

function NewReviewModal({ existing, employees, onSave, onClose }) {
  const [empId,        setEmpId]        = useState(existing?.employeeId  || (employees[0]?.id || ''));
  const [periodDays,   setPeriodDays]   = useState(90);
  const [startDate,    setStartDate]    = useState(existing?.periodStart || startOf(90));
  const [endDate,      setEndDate]      = useState(existing?.periodEnd   || todayStr());
  const [ratings,      setRatings]      = useState(existing?.ratings     || {});
  const [strengths,    setStrengths]    = useState(existing?.strengths   || '');
  const [improvements, setImprovements] = useState(existing?.improvements || '');
  const [goals,        setGoals]        = useState(existing?.goals       || '');
  const [notes,        setNotes]        = useState(existing?.notes       || '');
  const [metrics,      setMetrics]      = useState(existing?.metrics     || null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [saving,       setSaving]       = useState(false);

  const emp = employees.find(e => e.id === empId);

  useEffect(() => {
    if (!empId || !startDate || !endDate || !emp) return;
    let cancelled = false;
    setMetricsLoading(true);
    fetchAppointmentsByRange(startDate, endDate).then(appts => {
      if (cancelled) return;
      const today = todayStr();
      const techAppts = appts.filter(a =>
        a.techName === emp.name && a.status !== 'cancelled' && a.date <= today
      );
      const revenue = techAppts.reduce((s, a) =>
        s + (a.services || []).reduce((t, sv) => t + (Number(sv.price) || 0), 0), 0);
      const uniqueClients = new Set(techAppts.filter(a => a.clientId).map(a => a.clientId)).size;
      setMetrics({ revenue, appointmentCount: techAppts.length, avgTicket: techAppts.length ? revenue / techAppts.length : 0, uniqueClients });
    }).catch(() => {}).finally(() => { if (!cancelled) setMetricsLoading(false); });
    return () => { cancelled = true; };
  }, [empId, startDate, endDate]); // eslint-disable-line

  function applyPeriodDays(days) {
    setPeriodDays(days);
    setStartDate(startOf(days));
    setEndDate(todayStr());
  }

  function setRating(key, val) {
    setRatings(r => ({ ...r, [key]: val }));
  }

  async function submit(status) {
    if (!empId) return;
    setSaving(true);
    try {
      await onSave({
        ...(existing || {}),
        employeeId:   empId,
        employeeName: emp?.name || '',
        periodStart:  startDate,
        periodEnd:    endDate,
        reviewDate:   todayStr(),
        metrics:      metrics || {},
        ratings,
        strengths,
        improvements,
        goals,
        notes,
        status,
      });
      onClose();
    } finally { setSaving(false); }
  }

  const avg = avgRating(ratings);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 300, overflowY: 'auto', padding: '20px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,.3)', marginTop: 0 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{existing?.id ? 'Edit Review' : 'New Performance Review'}</div>
            {emp && <div style={{ fontSize: 11, color: 'rgba(255,255,255,.8)', marginTop: 2 }}>{emp.name}</div>}
          </div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Employee */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Employee</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} style={inp}>
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {/* Period */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Review Period</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {REVIEW_PERIODS.map(p => (
                <PillBtn key={p.days} active={periodDays === p.days} onClick={() => applyPeriodDays(p.days)}>{p.label}</PillBtn>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPeriodDays(0); }} style={{ ...inp, flex: 1 }} />
              <span style={{ color: 'var(--pn-text-faint)', flexShrink: 0 }}>–</span>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPeriodDays(0); }} style={{ ...inp, flex: 1 }} />
            </div>
          </div>

          {/* Metrics strip */}
          <div style={{ background: 'var(--pn-bg)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--pn-border)' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
              Performance Metrics {metricsLoading && <span style={{ fontWeight: 400, color: 'var(--pn-text-faint)' }}>loading…</span>}
            </div>
            {metrics && !metricsLoading ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                {[
                  { label: 'Revenue',    value: fmt$(metrics.revenue) },
                  { label: 'Appts',      value: metrics.appointmentCount },
                  { label: 'Avg Ticket', value: fmt$(metrics.avgTicket) },
                  { label: 'Clients',    value: metrics.uniqueClients },
                ].map(m => (
                  <div key={m.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#2D7A5F' }}>{m.value}</div>
                    <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', marginTop: 1 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            ) : !metricsLoading ? (
              <div style={{ fontSize: 12, color: 'var(--pn-text-faint)' }}>Select an employee and period to load metrics.</div>
            ) : null}
          </div>

          {/* Ratings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Ratings {avg > 0 && <span style={{ fontWeight: 400, color: '#f59e0b', marginLeft: 6 }}>avg {avg.toFixed(1)} ★</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {RATING_FIELDS.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: 'var(--pn-text)' }}>{f.label}</span>
                  <StarPicker value={ratings[f.key] || 0} onChange={val => setRating(f.key, val)} />
                </div>
              ))}
            </div>
          </div>

          {/* Written sections */}
          {[
            { key: 'strengths',    label: "What's going well",        value: strengths,    set: setStrengths },
            { key: 'improvements', label: 'Areas for improvement',     value: improvements, set: setImprovements },
            { key: 'goals',        label: 'Goals for next period',     value: goals,        set: setGoals },
            { key: 'notes',        label: 'Internal notes (admin only)', value: notes,      set: setNotes },
          ].map(s => (
            <div key={s.key}>
              <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</label>
              <textarea value={s.value} onChange={e => s.set(e.target.value)}
                rows={3} placeholder="Enter notes…"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
          ))}

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={() => submit('draft')} disabled={saving || !empId}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: saving || !empId ? 'var(--pn-border-strong)' : 'var(--pn-surface-muted)', color: saving || !empId ? '#fff' : 'var(--pn-text-muted)', cursor: saving || !empId ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            Save Draft
          </button>
          <button onClick={() => submit('final')} disabled={saving || !empId}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: saving || !empId ? '#d0d0d0' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: saving || !empId ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : 'Finalize Review'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Handbook tab ──────────────────────────────────────
function HandbookTab({ employees }) {
  const { showToast, isTech, gUser } = useApp();
  const [doc,     setDoc]     = useState({ title: 'Company Policies', version: '1.0', content: '' });
  const [sigs,    setSigs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [sending, setSending] = useState(null); // techName or 'all'

  useEffect(() => {
    Promise.all([
      fetchHandbook().then(h => { if (h) setDoc(h); }),
      fetchHandbookSigs().then(setSigs),
    ]).catch(() => {}).finally(() => setLoading(false));
  }, []);

  if (!loading && isTech) {
    const mySig = gUser?.email ? sigs.find(s => s.email === gUser.email && s.version === doc.version) : null;
    return (
      <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--pn-text)' }}>{doc.title || 'Company Policies'}</div>
            <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 2 }}>Version {doc.version}{doc.publishedAt ? ` · Published ${fmtDateFull(doc.publishedAt)}` : ''}</div>
          </div>
          {mySig ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-success)', padding: '4px 12px', borderRadius: 20, background: 'var(--pn-success-bg)', border: '1px solid #86efac', flexShrink: 0 }}>
              ✓ Signed {fmtDateFull(mySig.signedAt)}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--pn-warning)', padding: '4px 12px', borderRadius: 20, background: 'var(--pn-warning-bg)', border: '1px solid #fcd34d', flexShrink: 0 }}>
              Pending signature
            </span>
          )}
        </div>
        {doc.content ? (
          <div style={{ fontSize: 14, color: 'var(--pn-text)', lineHeight: 1.75, whiteSpace: 'pre-wrap', borderTop: '1px solid var(--pn-border)', paddingTop: 16 }}>
            {doc.content}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--pn-text-faint)', fontSize: 13 }}>
            No company policies published yet.
          </div>
        )}
      </div>
    );
  }

  async function handlePublish() {
    setSaving(true);
    try {
      const updated = { ...doc, publishedAt: new Date().toISOString() };
      await saveHandbook(updated);
      setDoc(updated);
      logActivity('handbook_published', `v${doc.version}`);
      showToast('Company policies published');
    } catch (e) {
      showToast('Save failed: ' + e.message, 4000);
    } finally { setSaving(false); }
  }

  async function sendReminder(emp) {
    setSending(emp.name);
    try {
      await sendHandbookReminderNotif(emp.name, doc.title, doc.version);
      logActivity('handbook_reminder_sent', `${emp.name}`);
      showToast(`Reminder sent to ${emp.name}`);
    } catch (e) {
      showToast('Send failed: ' + e.message, 4000);
    } finally { setSending(null); }
  }

  async function sendAllReminders() {
    const unsigned = employees.filter(e => e.email && !sigs.find(s => s.version === doc.version && s.email === e.email));
    if (!unsigned.length) { showToast('All employees have signed!'); return; }
    setSending('all');
    try {
      for (const emp of unsigned) {
        await sendHandbookReminderNotif(emp.name, doc.title, doc.version);
      }
      logActivity('handbook_reminder_sent', `bulk – ${unsigned.length} recipients`);
      showToast(`Reminders sent to ${unsigned.length} employee(s)`);
    } catch (e) {
      showToast('Send failed: ' + e.message, 4000);
    } finally { setSending(null); }
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>Loading…</div>;
  }

  const sigByEmail = {};
  sigs.forEach(s => { if (s.email) sigByEmail[s.email] = s; });
  const signedCount = employees.filter(e => e.email && sigByEmail[e.email]?.version === doc.version).length;

  return (
    <>
      {/* Editor */}
      <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
            Company Policies Editor
          </div>
          <button
            onClick={() => {
              if (doc.content && !confirm('Replace the current content with the starter template? This cannot be undone until you publish.')) return;
              setDoc(d => ({ ...d, content: POLICIES_TEMPLATE }));
            }}
            style={{ fontSize: 11, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
            ＋ Insert starter template
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 3 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Title</label>
            <input value={doc.title || ''} onChange={e => setDoc(d => ({ ...d, title: e.target.value }))}
              placeholder="Company Policies" style={inp} />
          </div>
          <div style={{ width: 90 }}>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Version</label>
            <input value={doc.version || ''} onChange={e => setDoc(d => ({ ...d, version: e.target.value }))}
              placeholder="1.0" style={inp} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 3 }}>Content</label>
          <textarea
            value={doc.content || ''}
            onChange={e => setDoc(d => ({ ...d, content: e.target.value }))}
            placeholder="Write your company policies here — or insert the starter template above…"
            rows={16}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>
            {doc.publishedAt ? `Last published ${fmtDateFull(doc.publishedAt)}` : 'Not yet published'}
          </span>
          <button onClick={handlePublish} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? 'var(--pn-border-strong)' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : '⬆ Publish Policies'}
          </button>
        </div>
      </div>

      {/* Signing roster */}
      <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Signing Roster
            </div>
            <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>
              {signedCount}/{employees.length} signed v{doc.version}
            </div>
          </div>
          <button onClick={sendAllReminders} disabled={!!sending || !doc.publishedAt}
            title={!doc.publishedAt ? 'Publish policies first' : ''}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', cursor: !!sending || !doc.publishedAt ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, color: !!sending || !doc.publishedAt ? 'var(--pn-text-faint)' : 'var(--pn-text-muted)' }}>
            {sending === 'all' ? 'Sending…' : '📧 Remind All Unsigned'}
          </button>
        </div>

        {employees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--pn-text-faint)', fontSize: 13 }}>No employees on record.</div>
        ) : employees.map((emp, i) => {
          const sig    = emp.email ? sigByEmail[emp.email] : null;
          const signed = sig?.version === doc.version;
          return (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < employees.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
              <EmpAvatar emp={emp} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>{emp.name}</div>
                {signed ? (
                  <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 1 }}>
                    Signed v{sig.version} on {fmtDateFull(sig.signedAt)}
                  </div>
                ) : !emp.email ? (
                  <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 1 }}>No email on file</div>
                ) : null}
              </div>
              {signed ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-success)', padding: '3px 10px', borderRadius: 20, background: 'var(--pn-success-bg)', border: '1px solid #86efac', flexShrink: 0 }}>
                  ✓ Signed
                </span>
              ) : (
                <button
                  onClick={() => sendReminder(emp)}
                  disabled={!!sending || !emp.email || !doc.publishedAt}
                  title={!emp.email ? 'No email on file' : !doc.publishedAt ? 'Publish policies first' : ''}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #fcd34d', background: 'var(--pn-warning-bg)', color: !!sending || !emp.email || !doc.publishedAt ? 'var(--pn-text-faint)' : 'var(--pn-warning)', cursor: !!sending || !emp.email || !doc.publishedAt ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
                  {sending === emp.name ? '…' : '📧 Remind'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── 1099 PDF generator ────────────────────────────────
function download1099Pdf(form, emp, settings) {
  const year     = form.year;
  const payer    = form.payer || {};
  const einVal   = payer.ein   || settings?.ein   || '___-__-____';
  const payerName = payer.name || settings?.salonName || '';
  const payerAddr = payer.address || settings?.salonAddress || '';
  const recipName = emp?.name     || form.techName || '';
  const recipAddr = emp?.address  || form.techAddress || '';
  const recipTin  = emp?.taxId    || form.techTaxId   || '___-__-____';
  const earnings  = Number(form.totalEarnings || 0).toFixed(2);
  const withheld  = Number(form.federalWithheld || 0).toFixed(2);

  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  // Defense-in-depth: every interpolated string is HTML-escaped so admin-
  // typed employee/payer names (or imported records) can't run script in
  // this same-origin popup.
  w.document.write(`<!DOCTYPE html><html><head><title>1099-NEC ${escapeHtml(year)} — ${escapeHtml(recipName)}</title>
<style>
  @page { size: letter; margin: .5in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #000; background: #fff; padding: 16px; }
  .form-title { font-size: 18px; font-weight: 700; letter-spacing: .04em; text-align: center; margin-bottom: 2px; }
  .form-sub   { font-size: 12px; text-align: center; color: #444; margin-bottom: 16px; }
  .outer { border: 2px solid #000; border-radius: 4px; overflow: hidden; }
  .top-bar { background: #1a1a1a; color: #fff; text-align: center; padding: 6px; font-weight: 700; font-size: 13px; letter-spacing: .08em; }
  .row { display: flex; border-bottom: 1px solid #888; }
  .row:last-child { border-bottom: none; }
  .cell { padding: 7px 10px; border-right: 1px solid #888; flex: 1; }
  .cell:last-child { border-right: none; }
  .cell.wide   { flex: 3; }
  .cell.narrow { flex: 0 0 160px; }
  .cell-label { font-size: 8px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #555; margin-bottom: 3px; }
  .cell-value { font-size: 13px; font-weight: 600; min-height: 18px; }
  .box-num    { display: inline-block; background: #000; color: #fff; border-radius: 3px; font-size: 9px; font-weight: 700; padding: 1px 5px; margin-right: 4px; }
  .amount     { font-size: 16px; font-weight: 700; color: #2D7A5F; }
  .highlight  { background: #f0faf6; }
  .footer     { text-align: center; font-size: 9px; color: #888; margin-top: 12px; }
  .irs-note   { font-size: 9px; color: #555; margin-top: 8px; line-height: 1.5; border: 1px solid #ccc; border-radius: 4px; padding: 8px; }
  .btn-bar    { text-align: center; margin: 18px 0 8px; }
  button      { padding: 10px 32px; background: #2D7A5F; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; }
  @media print { .btn-bar { display: none; } }
</style></head><body>
  <div class="form-title">FORM 1099-NEC</div>
  <div class="form-sub">Nonemployee Compensation — Tax Year ${escapeHtml(year)}</div>

  <div class="outer">
    <div class="top-bar">CORRECTED (if checked) □</div>

    <div class="row">
      <div class="cell wide">
        <div class="cell-label">Payer's name, street address, city, state, ZIP</div>
        <div class="cell-value">${escapeHtml(payerName)}</div>
        <div style="font-size:11px;color:#444;margin-top:2px;">${escapeHtml(payerAddr)}</div>
      </div>
      <div class="cell narrow">
        <div class="cell-label">Payer's TIN / EIN</div>
        <div class="cell-value">${escapeHtml(einVal)}</div>
      </div>
      <div class="cell narrow">
        <div class="cell-label">Recipient's TIN / SSN</div>
        <div class="cell-value">${escapeHtml(recipTin)}</div>
      </div>
    </div>

    <div class="row">
      <div class="cell wide">
        <div class="cell-label">Recipient's name</div>
        <div class="cell-value">${escapeHtml(recipName)}</div>
      </div>
      <div class="cell">
        <div class="cell-label">Account number (optional)</div>
        <div class="cell-value" style="color:#aaa;font-size:11px;">${escapeHtml(form.id || '')}</div>
      </div>
    </div>

    <div class="row">
      <div class="cell wide">
        <div class="cell-label">Street address (including apt. no.)</div>
        <div class="cell-value">${escapeHtml(recipAddr || '—')}</div>
      </div>
      <div class="cell narrow highlight">
        <div class="cell-label"><span class="box-num">1</span>Nonemployee compensation</div>
        <div class="cell-value amount">$${earnings}</div>
      </div>
      <div class="cell narrow">
        <div class="cell-label"><span class="box-num">4</span>Federal income tax withheld</div>
        <div class="cell-value">$${withheld}</div>
      </div>
    </div>

    <div class="row">
      <div class="cell">
        <div class="cell-label"><span class="box-num">2</span>Direct sales $5,000 or more □</div>
        <div class="cell-value" style="color:#aaa;">—</div>
      </div>
      <div class="cell">
        <div class="cell-label"><span class="box-num">5</span>State tax withheld</div>
        <div class="cell-value" style="color:#aaa;">—</div>
      </div>
      <div class="cell">
        <div class="cell-label"><span class="box-num">6</span>State/Payer's state no.</div>
        <div class="cell-value" style="color:#aaa;">—</div>
      </div>
      <div class="cell">
        <div class="cell-label"><span class="box-num">7</span>State income</div>
        <div class="cell-value" style="color:#aaa;">—</div>
      </div>
    </div>
  </div>

  <div class="irs-note">
    <strong>Copy B — For Recipient.</strong> This is important tax information and is being furnished to the IRS.
    If you are required to file a return, a negligence penalty or other sanction may be imposed on you if this income
    is taxable and the IRS determines that it has not been reported. Payments of $600 or more for services performed by
    a person who is not your employee must be reported on Form 1099-NEC. Generated by Plume Nexus.
  </div>

  <div class="btn-bar">
    <button onclick="window.print()">⬇ Save / Print PDF</button>
  </div>
  <div class="footer">${payerName || 'Plume Nexus'}${payerAddr ? ' · ' + payerAddr : ''} · Generated ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
</body></html>`);
  w.document.close();
}

// ── TaxFormsTab ───────────────────────────────────────
const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i);

function TaxFormsTab({ forms, employees, isAdmin, isTech, myTechName, settings, onGenerate, onDelete }) {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR - 1);
  const [generating,   setGenerating]   = useState(false);
  const [genMsg,       setGenMsg]       = useState('');

  const empMap = {};
  employees.forEach(e => { empMap[e.name] = e; });

  // For disabled techs: only show last 3 years
  const myEmp = isTech && myTechName ? employees.find(e => e.name === myTechName) : null;
  const isDisabled = myEmp && myEmp.active === false;
  const minYear = isDisabled ? CURRENT_YEAR - 3 : 0;

  const visibleForms = forms
    .filter(f => isTech
      ? f.year >= minYear
      : f.year === selectedYear
    )
    .sort((a, b) => b.year - a.year || (a.techName || '').localeCompare(b.techName || ''));

  async function handleGenerate() {
    if (!confirm(`Generate 1099-NEC forms for all contractors for ${selectedYear}? This will overwrite any existing forms for that year.`)) return;
    setGenerating(true);
    setGenMsg('');
    try {
      const count = await onGenerate(selectedYear);
      setGenMsg(`✓ Generated ${count} form(s) for ${selectedYear}`);
    } catch (e) {
      setGenMsg('Error: ' + e.message);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {isAdmin && (
          <>
            <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))}
              style={{ fontFamily: 'inherit', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 12px', fontSize: 13, background: 'var(--pn-surface)' }}>
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={handleGenerate} disabled={generating}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: generating ? 'var(--pn-border-strong)' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: generating ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
              {generating ? 'Generating…' : `Generate ${selectedYear} 1099s`}
            </button>
            {genMsg && <span style={{ fontSize: 12, color: genMsg.startsWith('✓') ? '#16a34a' : '#ef4444' }}>{genMsg}</span>}
          </>
        )}
        {isTech && isDisabled && (
          <div style={{ fontSize: 12, color: 'var(--pn-warning)', background: 'var(--pn-warning-bg)', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 12px' }}>
            Inactive contractors may access forms from the past 3 years.
          </div>
        )}
        <div style={{ marginLeft: isAdmin ? 'auto' : 0, fontSize: 12, color: 'var(--pn-text-faint)' }}>
          {visibleForms.length} form{visibleForms.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* IRS $600 note */}
      {isAdmin && (
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', background: 'var(--pn-bg)', border: '1px solid var(--pn-border)', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>
          IRS requirement: 1099-NEC must be issued for contractors paid $600 or more in a calendar year. Deadline: January 31.
          Auto-generation runs January 30 each year.
        </div>
      )}

      {/* Forms list */}
      {visibleForms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>
          {isAdmin ? `No 1099 forms for ${selectedYear}. Click "Generate" to create them from payroll data.` : 'No 1099 forms on file.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px 120px 80px', gap: 8, padding: '0 14px', fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
            <div>Contractor</div>
            <div style={{ textAlign: 'center' }}>Year</div>
            <div style={{ textAlign: 'right' }}>Box 1 (NEC)</div>
            <div>Generated</div>
            <div></div>
          </div>
          {visibleForms.map(form => {
            const emp = empMap[form.techName];
            const isInactive = emp && emp.active === false;
            return (
              <div key={form.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px 120px 80px', gap: 8, alignItems: 'center', background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {emp && <EmpAvatar emp={emp} size={30} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isInactive ? 'var(--pn-text-faint)' : 'var(--pn-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.techName}</div>
                    {form.techEmail && <div style={{ fontSize: 10, color: 'var(--pn-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.techEmail}</div>}
                  </div>
                  {isInactive && <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', background: 'var(--pn-surface-alt)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>inactive</span>}
                </div>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: 'var(--pn-text-muted)' }}>{form.year}</div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: Number(form.totalEarnings) >= 600 ? '#2D7A5F' : '#f59e0b' }}>
                    ${Number(form.totalEarnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {Number(form.totalEarnings) < 600 && (
                    <div style={{ fontSize: 9, color: '#f59e0b' }}>below $600 threshold</div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>
                  {form.generatedAt ? new Date(form.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button onClick={() => download1099Pdf(form, emp, settings)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2D7A5F', background: 'var(--pn-success-bg)', color: 'var(--pn-success)', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    PDF
                  </button>
                  {isAdmin && (
                    <button onClick={() => { if (confirm('Delete this 1099?')) onDelete(form.id); }}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-surface)', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
                      ×
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Gusto tab ──────────────────────────────────────────
function GustoTab({ employees, payrollRuns }) {
  const { settings, showToast } = useApp();
  const gusto = settings?.gusto;
  const isConnected = !!(gusto?.accessToken);

  const [syncing,    setSyncing]    = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [syncResult, setSyncResult] = useState(null); // { matched, updated }
  const [submitting, setSubmitting] = useState(null); // runId

  async function handleConnect() {
    setConnecting(true);
    try {
      const { data } = await gustoGetAuthUrlFn();
      window.open(data.url, '_blank', 'width=600,height=700,noopener');
      showToast('Complete Gusto sign-in in the popup, then return here and refresh.');
    } catch (e) {
      showToast('Failed to get Gusto auth URL: ' + e.message, 4000);
    } finally { setConnecting(false); }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const { data } = await gustoSyncEmployeesFn();
      setSyncResult(data);
      showToast(`Synced ${data.updated} employee${data.updated !== 1 ? 's' : ''} from Gusto`);
      logActivity('gusto_sync_employees', `matched ${data.matched}, updated ${data.updated}`);
    } catch (e) {
      showToast('Sync failed: ' + e.message, 4000);
    } finally { setSyncing(false); }
  }

  async function handleSubmitPayroll(run) {
    if (!confirm(`Submit payroll run (${fmtDateShort(run.startDate)} – ${fmtDateShort(run.endDate)}) to Gusto?`)) return;
    setSubmitting(run.id);
    try {
      const { data } = await gustoSubmitPayrollFn({ payrollRunId: run.id });
      showToast(`Payroll submitted to Gusto (ID: ${data.gustoPayrollId})`);
      logActivity('gusto_submit_payroll', `run ${run.id} → Gusto ${data.gustoPayrollId}`);
    } catch (e) {
      showToast('Submission failed: ' + e.message, 4000);
    } finally { setSubmitting(null); }
  }

  const gustoMatchedEmps = employees.filter(e => e.gustoId);

  return (
    <div style={{ maxWidth: 560 }}>
      {/* Connection card */}
      <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: '20px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--pn-surface-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🦖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>Gusto Payroll</div>
            {isConnected ? (
              <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#16a34a' }} />
                Connected · {gusto.companyName || 'Company linked'}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', marginTop: 2 }}>Not connected</div>
            )}
          </div>
          {isConnected ? (
            <button onClick={handleSync} disabled={syncing}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: syncing ? 'var(--pn-surface-alt)' : 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', fontSize: 12, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {syncing ? 'Syncing…' : '↺ Sync Employees'}
            </button>
          ) : (
            <button onClick={handleConnect} disabled={connecting}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: connecting ? 'var(--pn-border-strong)' : '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700, cursor: connecting ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {connecting ? 'Opening…' : 'Connect Gusto'}
            </button>
          )}
        </div>

        {syncResult && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: 'var(--pn-success)' }}>
            Sync complete — {syncResult.matched} employees matched, {syncResult.updated} updated with Gusto IDs.
          </div>
        )}
      </div>

      {/* Synced employees */}
      {isConnected && (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)' }}>Employee sync status</span>
            <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{gustoMatchedEmps.length}/{employees.length} matched</span>
          </div>
          {employees.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: i < employees.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
              <EmpAvatar emp={e} size={28} />
              <span style={{ flex: 1, fontSize: 13, color: 'var(--pn-text)' }}>{e.name}</span>
              {e.gustoId ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-success)', background: 'var(--pn-success-bg)', border: '1px solid #bbf7d0', borderRadius: 6, padding: '2px 8px' }}>✓ Linked</span>
              ) : (
                <span style={{ fontSize: 10, color: 'var(--pn-text-faint)', background: 'var(--pn-surface-muted)', borderRadius: 6, padding: '2px 8px' }}>Not matched</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Payroll runs → submit to Gusto */}
      {isConnected && payrollRuns.length > 0 && (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--pn-border)' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--pn-text-muted)' }}>Submit payroll runs</span>
          </div>
          {payrollRuns.slice(0, 6).map((run, i) => (
            <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < Math.min(payrollRuns.length, 6) - 1 ? '1px solid var(--pn-border)' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--pn-text)' }}>
                  {fmtDateShort(run.startDate)} – {fmtDateShort(run.endDate)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{run.techs.length} techs · {fmt$(run.grandTotal)}</div>
              </div>
              {run.gustoPayrollId ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--pn-text)', background: 'var(--pn-surface-alt)', border: '1px solid #ddd6fe', borderRadius: 6, padding: '2px 8px' }}>Submitted</span>
              ) : (
                <button onClick={() => handleSubmitPayroll(run)} disabled={submitting === run.id}
                  style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: 'none', background: submitting === run.id ? 'var(--pn-border-strong)' : '#7c3aed', color: '#fff', cursor: submitting === run.id ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {submitting === run.id ? 'Submitting…' : 'Submit →'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isConnected && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--pn-text-faint)', fontSize: 13 }}>
          Connect Gusto above to sync employees and submit payroll runs automatically.
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────
function PillBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? 'var(--pn-text)' : 'var(--pn-surface)', color: active ? 'var(--pn-bg)' : 'var(--pn-text-muted)', border: `1px solid ${active ? 'var(--pn-text)' : 'var(--pn-border-strong)'}`, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

const inp = { fontFamily: 'inherit', width: '100%', border: '1px solid var(--pn-border-strong)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: 'var(--pn-text)', outline: 'none', background: 'var(--pn-surface-muted)', boxSizing: 'border-box' };

// ── Continuing Education tab ──────────────────────────
function CEStatusBadge({ status }) {
  const done = status === 'completed';
  return (
    <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
      background: done ? 'var(--pn-success-bg)' : 'var(--pn-warning-bg)',
      color:      done ? 'var(--pn-success)' : 'var(--pn-warning)',
      border: `1px solid ${done ? '#86efac' : '#fcd34d'}` }}>
      {done ? 'Completed' : 'Planned'}
    </span>
  );
}

function ContinuingEducationTab({ records, employees, isTech, onNew, onEdit, onDelete }) {
  const [showIdeas, setShowIdeas] = useState(false);

  const totalHours   = records.reduce((s, r) => s + (Number(r.hours) || 0), 0);
  const totalCredits = records.reduce((s, r) => s + (Number(r.credits) || 0), 0);

  // Admin: group by employee. Tech: flat list (already scoped to self).
  const byEmp = {};
  records.forEach(r => {
    const k = r.employeeName || '—';
    (byEmp[k] = byEmp[k] || []).push(r);
  });
  const empNames = Object.keys(byEmp).sort();

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
          {records.length} record{records.length !== 1 ? 's' : ''}
          {(totalHours > 0 || totalCredits > 0) && ` · ${totalHours} hrs${totalCredits > 0 ? ` · ${totalCredits} credits` : ''}`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowIdeas(s => !s)}
            style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            💡 {showIdeas ? 'Hide ideas' : 'Browse ideas'}
          </button>
          <button onClick={() => onNew({ status: 'planned' })}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            + Log Education
          </button>
        </div>
      </div>

      {showIdeas && (
        <div style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--pn-text-faint)', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 10 }}>Class ideas — tap to log</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {CE_IDEAS.map(idea => (
              <button key={idea.title} onClick={() => onNew({ status: 'planned', title: idea.title, category: idea.category, provider: idea.provider, hours: idea.hours, credits: idea.credits, notes: idea.blurb })}
                style={{ textAlign: 'left', padding: '10px 12px', borderRadius: 10, border: '1px solid var(--pn-border)', background: 'var(--pn-surface-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{idea.title}</div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{idea.category} · {idea.hours} hrs</div>
                <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 4, lineHeight: 1.4 }}>{idea.blurb}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {records.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>
          No education logged yet. {isTech ? 'Log your first class or certification.' : 'Browse ideas or log a class.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {empNames.map(name => {
            const recs = byEmp[name].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
            const emp  = employees.find(e => e.name === name);
            return (
              <div key={name} style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', overflow: 'hidden' }}>
                {!isTech && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: '1px solid var(--pn-border)' }}>
                    {emp && <EmpAvatar emp={emp} size={28} />}
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{name}</div>
                    <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{recs.length} · {recs.reduce((s, r) => s + (Number(r.hours) || 0), 0)} hrs</div>
                  </div>
                )}
                {recs.map((rec, i) => (
                  <div key={rec.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 16px', borderBottom: i < recs.length - 1 ? '1px solid var(--pn-border)' : 'none' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{rec.title}</span>
                        <CEStatusBadge status={rec.status} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 3 }}>
                        {[rec.category, rec.provider, rec.date && fmtDateFull(rec.date),
                          (Number(rec.hours) || 0) > 0 && `${rec.hours} hrs`,
                          (Number(rec.credits) || 0) > 0 && `${rec.credits} credits`,
                          (Number(rec.cost) || 0) > 0 && fmt$(rec.cost)].filter(Boolean).join(' · ')}
                      </div>
                      {rec.notes && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 5, lineHeight: 1.5 }}>{rec.notes}</div>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={() => onEdit(rec)}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Edit
                      </button>
                      <button onClick={() => onDelete(rec.id)}
                        style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit' }}>
                        Del
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── Log / Edit Continuing Education modal ─────────────
function EditCEModal({ seed, employees, isTech, myTechName, myUid, onSave, onClose }) {
  const isEdit = !!seed?.id;
  // Techs log only for themselves; lock the employee to the signed-in tech.
  const selfEmp = isTech ? employees.find(e => e.name === myTechName) : null;
  const [empId,    setEmpId]    = useState(seed?.employeeId || selfEmp?.id || employees[0]?.id || '');
  const [title,    setTitle]    = useState(seed?.title    || '');
  const [category, setCategory] = useState(seed?.category || CE_CATEGORIES[0]);
  const [provider, setProvider] = useState(seed?.provider || '');
  const [date,     setDate]     = useState(seed?.date     || todayStr());
  const [status,   setStatus]   = useState(seed?.status   || 'planned');
  const [hours,    setHours]    = useState(seed?.hours    ?? '');
  const [credits,  setCredits]  = useState(seed?.credits  ?? '');
  const [cost,     setCost]     = useState(seed?.cost     ?? '');
  const [notes,    setNotes]    = useState(seed?.notes    || '');
  const [saving,   setSaving]   = useState(false);

  const emp = employees.find(e => e.id === empId);

  async function submit() {
    if (!emp || !title.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...(isEdit ? seed : {}),
        employeeId:   emp.id,
        employeeName: emp.name,
        title:        title.trim(),
        category, provider, date, status,
        hours:   Number(hours)   || 0,
        credits: Number(credits) || 0,
        cost:    Number(cost)    || 0,
        notes,
        createdBy: seed?.createdBy || myUid || null,
      });
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 300, overflowY: 'auto', padding: '20px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{isEdit ? 'Edit Education' : 'Log Continuing Education'}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isTech && (
            <Field label="Employee">
              <select value={empId} onChange={e => setEmpId(e.target.value)} style={inp}>
                <option value="">Select employee…</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Course / certification">
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Gel-X Extension Mastery" style={inp} />
          </Field>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Category" style={{ flex: 1 }}>
              <select value={category} onChange={e => setCategory(e.target.value)} style={inp}>
                {CE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Status" style={{ width: 140 }}>
              <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
                <option value="planned">Planned</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Provider" style={{ flex: 1 }}>
              <input value={provider} onChange={e => setProvider(e.target.value)} placeholder="Academy, school…" style={inp} />
            </Field>
            <Field label="Date" style={{ width: 150 }}>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <Field label="Hours" style={{ flex: 1 }}>
              <input type="number" min={0} value={hours} onChange={e => setHours(e.target.value)} placeholder="0" style={inp} />
            </Field>
            <Field label="Credits" style={{ flex: 1 }}>
              <input type="number" min={0} value={credits} onChange={e => setCredits(e.target.value)} placeholder="0" style={inp} />
            </Field>
            <Field label="Cost ($)" style={{ flex: 1 }}>
              <input type="number" min={0} value={cost} onChange={e => setCost(e.target.value)} placeholder="0" style={inp} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Takeaways, certificate #, etc." style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
          </Field>
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving || !title.trim() || !empId}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: saving || !title.trim() || !empId ? '#d0d0d0' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: saving || !title.trim() || !empId ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : isEdit ? 'Save' : 'Log Education'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, style }) {
  return (
    <div style={style}>
      <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>
      {children}
    </div>
  );
}

// ── Bonus Rules tab ───────────────────────────────────
const metricMeta = (key) => BONUS_METRICS.find(m => m.key === key) || { label: key, unit: '' };

function describeRule(rule) {
  const crit = (rule.criteria || []).map(c => {
    const m = metricMeta(c.metric);
    return `${m.label} ≥ ${m.unit === '$' ? fmt$(c.value) : c.value}${m.unit === '%' ? '%' : m.unit === '★' ? '★' : ''}`;
  }).join(' AND ');
  const pt = PAYOUT_TYPES.find(p => p.key === rule.payoutType);
  let pay = '';
  if (rule.payoutType === 'fixed')      pay = fmt$(rule.payoutValue);
  else if (rule.payoutType === 'pctRevenue') pay = `${rule.payoutValue}% of revenue`;
  else if (rule.payoutType === 'perAppt')    pay = `${fmt$(rule.payoutValue)}/appt`;
  if (Number(rule.payoutMax) > 0) pay += ` (max ${fmt$(rule.payoutMax)})`;
  return { crit: crit || 'No criteria', pay, ptLabel: pt?.label || '' };
}

// Collapsible guidance: how to give bonuses to 1099 contractors without
// accidentally making them look like W-2 employees. (Not tax advice.)
function ContractorBonusGuidance() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '11px 14px', textAlign: 'left' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--pn-text)' }}>⚠️ Bonuses to 1099 contractors — keep them contractors, not employees</span>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flexShrink: 0, marginLeft: 8 }}>{open ? '▲ hide' : '▼ read'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', fontSize: 12.5, color: 'var(--pn-text)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px', color: 'var(--pn-text-muted)' }}>
            The IRS weighs the whole relationship, but <strong>how you pay is a big signal</strong>: employees get a guaranteed regular wage; contractors get a flat fee for the job. Recurring, discretionary “good-worker” bonuses look like wages or benefits and can reclassify a 1099 as a W-2.
          </p>
          <div style={{ marginBottom: 5 }}><strong style={{ color: '#16a34a' }}>✓ Safer for a 1099</strong> — write it into their contract, tie it to output, keep real profit/loss:</div>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>Completion bonus per agreed project/scope</li>
            <li>Volume incentive defined in the contract (“$X after N services this period”)</li>
            <li>Referral fee for new clients they bring in</li>
          </ul>
          <div style={{ marginBottom: 5 }}><strong style={{ color: '#b45309' }}>⚠ Signals “employee” — avoid for 1099s:</strong></div>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li>Recurring monthly/quarterly “performance” bonuses</li>
            <li>Holiday / year-end / longevity / tenure / anniversary / loyalty bonuses</li>
            <li>Attendance- or hours-based bonuses</li>
            <li>Salon-paid continuing education / license CE — that's employer training + an employee benefit. A true 1099 funds their own CE (and deducts it); if you want to help, build it into their rate rather than gifting it.</li>
            <li>The <strong>Rule engine’s metrics</strong> (rebooking %, ratings, tenure) are great for W-2 staff but are exactly the discretionary, performance-control signals that make a 1099 look like an employee — for contractors prefer fixed, contract-defined payouts.</li>
          </ul>
          <p style={{ margin: '0 0 8px', color: 'var(--pn-text-muted)' }}>
            Bonus dollars to a contractor still roll into their 1099-NEC total (no withholding, no benefits). <strong>State law may be stricter</strong> (the ABC test, e.g. California AB5) — a nail tech doing nail services is usually a W-2 there regardless of the IRS test. Confirm your state.
          </p>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--pn-text-faint)' }}>
            Not tax or legal advice — confirm with a CPA/attorney; for a binding federal answer file IRS Form SS-8.{' '}
            <a href="https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee" target="_blank" rel="noopener noreferrer" style={{ color: '#3D95CE', fontWeight: 600 }}>IRS: contractor vs employee ↗</a>
          </p>
        </div>
      )}
    </div>
  );
}

// Quick reference: how nail salons typically pay + bonus techs. Numbers are
// typical ranges (vary by metro/tier/book) — not rules.
function TypicalBonusStructures() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', boxSizing: 'border-box', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', padding: '11px 14px', textAlign: 'left' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--pn-text)' }}>💡 Typical nail-salon pay &amp; bonus structures</span>
        <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', flexShrink: 0, marginLeft: 8 }}>{open ? '▲ hide' : '▼ read'}</span>
      </button>
      {open && (
        <div style={{ padding: '0 14px 14px', fontSize: 12.5, color: 'var(--pn-text)', lineHeight: 1.6 }}>
          <div style={{ marginBottom: 5 }}><strong>Base pay models</strong> (typical ranges — vary by market):</div>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li><strong>Commission</strong> — 40–60% of service revenue to the tech (~50% is most common). The standard model.</li>
            <li><strong>Tiered / sliding commission</strong> — the % steps up as monthly revenue grows (e.g. 40% → 45% → 50%), often gated on a rebooking-rate target.</li>
            <li><strong>Hourly</strong> or <strong>hourly + commission</strong> — a base wage (minimum-wage floor) plus a smaller commission; common for newer techs + wage compliance.</li>
            <li><strong>Whichever is greater</strong> — pay the higher of an hourly guarantee vs. commission earned that period.</li>
            <li><strong>Booth / chair rental</strong> — the tech keeps their service revenue and pays rent (~$200–600/week); the one model that fits a true 1099.</li>
          </ul>
          <div style={{ marginBottom: 5 }}><strong>Common bonuses / incentives</strong>:</div>
          <ul style={{ margin: '0 0 10px', paddingLeft: 18 }}>
            <li><strong>Retail commission</strong> — 10–20% on product they sell (keep ~10–15% to protect margin); nearly universal.</li>
            <li><strong>Service-revenue milestones</strong> — flat bonus or % bump when they clear a monthly target.</li>
            <li><strong>Rebooking / retention</strong>, <strong>add-on / upsell</strong>, and <strong>new-client</strong> incentives.</li>
            <li><strong>Team / salon-goal profit share</strong> — a pooled bonus when the whole salon hits a target.</li>
            <li>Occasional: per-appointment / productivity, 5-star-review, attendance, referral (client + staff), anniversary / holiday, sign-on — dollar amounts here are salon-specific, no real benchmark.</li>
          </ul>
          <p style={{ margin: '0 0 8px', color: 'var(--pn-text-muted)' }}>
            Sanity check: total service payroll typically lands around <strong>30–35% of revenue</strong> whatever model you pick.
          </p>
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--pn-text-faint)' }}>
            ⚠️ Most of these (commission, hourly, milestones, retail, attendance, tenure) assume <strong>W-2 employees</strong>. For a <strong>1099</strong>, only booth rental + output/contract-based incentives fit — and commission pay alone does NOT make someone a 1099. See the panel above.
          </p>
        </div>
      )}
    </div>
  );
}

function BonusRulesTab({ rules, rows, loading, onNew, onEdit, onToggle, onDelete }) {
  // Live "would pay this period" preview, from the current payroll rows.
  const previewByRule = {};
  rows.forEach(r => (r.ruleBonusLines || []).forEach(l => {
    previewByRule[l.name] = (previewByRule[l.name] || 0) + l.amount;
  }));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)' }}>
          Bonuses are previewed on the Payroll tab and recorded when you run payroll. Programs are evaluated per tech, per pay period.
        </div>
        <button onClick={onNew}
          style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>
          + New Rule
        </button>
      </div>

      <ContractorBonusGuidance />
      <TypicalBonusStructures />

      {rules.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--pn-text-faint)', fontSize: 13 }}>No bonus rules yet. Create one to start rewarding performance.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rules.map(rule => {
            const d = describeRule(rule);
            const preview = previewByRule[rule.name] || 0;
            return (
              <div key={rule.id} style={{ background: 'var(--pn-surface)', borderRadius: 12, border: '1px solid var(--pn-border)', padding: '14px 16px', opacity: rule.enabled ? 1 : 0.6 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--pn-text)' }}>{rule.name}</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                        background: rule.enabled ? 'var(--pn-success-bg)' : 'var(--pn-surface-muted)',
                        color: rule.enabled ? 'var(--pn-success)' : 'var(--pn-text-faint)',
                        border: `1px solid ${rule.enabled ? '#86efac' : 'var(--pn-border-strong)'}` }}>
                        {rule.enabled ? 'Active' : 'Off'}
                      </span>
                      {(rule.scopeTechNames || []).length > 0 && (
                        <span style={{ fontSize: 10, color: 'var(--pn-text-faint)' }}>· {rule.scopeTechNames.length} tech{rule.scopeTechNames.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 5, lineHeight: 1.5 }}>
                      <span style={{ color: 'var(--pn-text-faint)' }}>When </span>{d.crit}
                      <span style={{ color: 'var(--pn-text-faint)' }}> → pay </span><span style={{ fontWeight: 600, color: '#2D7A5F' }}>{d.pay}</span>
                    </div>
                    {rule.enabled && (
                      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 4 }}>
                        This period{loading ? '…' : `: ${preview > 0 ? fmt$(preview) : 'no payouts yet'}`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button onClick={() => onToggle(rule)}
                      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => onEdit(rule)}
                      style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface-muted)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Edit
                    </button>
                    <button onClick={() => onDelete(rule.id)}
                      style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: 'var(--pn-danger-bg)', color: 'var(--pn-danger)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      Del
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ── New / Edit Bonus Rule modal ───────────────────────
function EditRuleModal({ existing, employees, onSave, onClose }) {
  const [name,     setName]     = useState(existing?.name     || '');
  const [enabled,  setEnabled]  = useState(existing?.enabled  ?? true);
  const [criteria, setCriteria] = useState(existing?.criteria?.length ? existing.criteria : [{ metric: 'serviceRevenue', value: '' }]);
  const [payoutType,  setPayoutType]  = useState(existing?.payoutType  || 'fixed');
  const [payoutValue, setPayoutValue] = useState(existing?.payoutValue ?? '');
  const [payoutMax,   setPayoutMax]   = useState(existing?.payoutMax   ?? '');
  const [scope,       setScope]       = useState(existing?.scopeTechNames?.length ? 'some' : 'all');
  const [scopeTechNames, setScopeTechNames] = useState(existing?.scopeTechNames || []);
  const [saving,   setSaving]   = useState(false);

  function setCrit(i, patch) { setCriteria(cs => cs.map((c, idx) => idx === i ? { ...c, ...patch } : c)); }
  function addCrit()  { setCriteria(cs => [...cs, { metric: 'apptCount', value: '' }]); }
  function delCrit(i) { setCriteria(cs => cs.filter((_, idx) => idx !== i)); }
  function toggleTech(name) {
    setScopeTechNames(ns => ns.includes(name) ? ns.filter(n => n !== name) : [...ns, name]);
  }

  async function submit() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        ...(existing || {}),
        name: name.trim(),
        enabled,
        criteria: criteria
          .filter(c => c.metric && c.value !== '' && c.value != null)
          .map(c => ({ metric: c.metric, value: Number(c.value) || 0 })),
        payoutType,
        payoutValue: Number(payoutValue) || 0,
        payoutMax:   Number(payoutMax)   || 0,
        scopeTechNames: scope === 'some' ? scopeTechNames : [],
      });
      onClose();
    } finally { setSaving(false); }
  }

  const payoutUnit = PAYOUT_TYPES.find(p => p.key === payoutType)?.unit || '';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 300, overflowY: 'auto', padding: '20px 0' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }} onClick={e => e.stopPropagation()}>
        <div style={{ padding: '14px 18px', borderRadius: '16px 16px 0 0', background: 'linear-gradient(135deg,#2D7A5F,#3D95CE)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{existing?.id ? 'Edit Bonus Rule' : 'New Bonus Rule'}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,.4)', background: 'rgba(255,255,255,.15)', cursor: 'pointer', fontSize: 16, color: '#fff' }}>×</button>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Field label="Rule name">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Revenue milestone" style={inp} />
          </Field>

          {/* Criteria */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Criteria — all must be met (AND)
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {criteria.map((c, i) => {
                const m = metricMeta(c.metric);
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <select value={c.metric} onChange={e => setCrit(i, { metric: e.target.value })} style={{ ...inp, flex: 1 }}>
                      {BONUS_METRICS.map(bm => <option key={bm.key} value={bm.key}>{bm.label}</option>)}
                    </select>
                    <span style={{ fontSize: 12, color: 'var(--pn-text-faint)', flexShrink: 0 }}>≥</span>
                    <input type="number" min={0} value={c.value} onChange={e => setCrit(i, { value: e.target.value })} placeholder="0" style={{ ...inp, width: 100 }} />
                    <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', width: 44, flexShrink: 0 }}>{m.unit}</span>
                    <button onClick={() => delCrit(i)} disabled={criteria.length === 1}
                      style={{ border: 'none', background: 'none', color: criteria.length === 1 ? 'var(--pn-border-strong)' : 'var(--pn-danger)', cursor: criteria.length === 1 ? 'default' : 'pointer', fontSize: 18, lineHeight: 1, flexShrink: 0 }}>×</button>
                  </div>
                );
              })}
            </div>
            <button onClick={addCrit} style={{ marginTop: 8, fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px dashed var(--pn-border-strong)', background: 'none', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' }}>+ Add criterion</button>
          </div>

          {/* Payout */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Payout</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={payoutType} onChange={e => setPayoutType(e.target.value)} style={{ ...inp, flex: 1 }}>
                {PAYOUT_TYPES.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
              </select>
              <input type="number" min={0} value={payoutValue} onChange={e => setPayoutValue(e.target.value)} placeholder="0" style={{ ...inp, width: 110 }} />
              <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', width: 70, flexShrink: 0 }}>{payoutUnit}</span>
            </div>
            {payoutType !== 'fixed' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--pn-text-muted)', flex: 1 }}>Cap payout at (optional)</span>
                <input type="number" min={0} value={payoutMax} onChange={e => setPayoutMax(e.target.value)} placeholder="no cap" style={{ ...inp, width: 110 }} />
                <span style={{ fontSize: 11, color: 'var(--pn-text-faint)', width: 70, flexShrink: 0 }}>$ max</span>
              </div>
            )}
          </div>

          {/* Scope */}
          <div>
            <label style={{ fontSize: 11, color: 'var(--pn-text-muted)', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Applies to</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: scope === 'some' ? 10 : 0 }}>
              <PillBtn active={scope === 'all'}  onClick={() => setScope('all')}>All techs</PillBtn>
              <PillBtn active={scope === 'some'} onClick={() => setScope('some')}>Specific techs</PillBtn>
            </div>
            {scope === 'some' && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {employees.map(e => (
                  <button key={e.id} onClick={() => toggleTech(e.name)}
                    style={{ fontSize: 12, padding: '5px 12px', borderRadius: 16, fontFamily: 'inherit', cursor: 'pointer',
                      border: `1px solid ${scopeTechNames.includes(e.name) ? '#2D7A5F' : 'var(--pn-border-strong)'}`,
                      background: scopeTechNames.includes(e.name) ? 'var(--pn-success-bg)' : 'var(--pn-surface-muted)',
                      color: scopeTechNames.includes(e.name) ? '#2D7A5F' : 'var(--pn-text-muted)' }}>
                    {e.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--pn-text)', cursor: 'pointer' }}>
            <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
            Rule is active (counts toward payroll)
          </label>
        </div>

        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid var(--pn-border)', display: 'flex', gap: 8 }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>Cancel</button>
          <button onClick={submit} disabled={saving || !name.trim()}
            style={{ flex: 2, padding: '10px', borderRadius: 8, border: 'none', background: saving || !name.trim() ? '#d0d0d0' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: saving || !name.trim() ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : existing?.id ? 'Save Rule' : 'Create Rule'}
          </button>
        </div>
      </div>
    </div>
  );
}
