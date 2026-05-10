import { useState, useEffect, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import {
  fetchEmployeesWithComp, fetchAppointmentsByRange,
  fetchBonuses, createBonus, deleteBonus,
  fetchPayrollRuns, createPayrollRun, savePayrollRun,
  fetchReviews, saveReview, deleteReview,
  fetchHandbook, saveHandbook, fetchHandbookSigs, sendHandbookReminderNotif,
  fetchTaxForms, fetchTaxFormsByEmail, upsertTaxForm, deleteTaxForm,
  fetchPayrollRunsForYear,
} from '../../lib/firestore';
import { EmpAvatar } from '../employees/EmployeesAdmin';
import { logActivity } from '../../lib/logger';
import { useApp } from '../../context/AppContext';
import { escapeHtml } from '../../utils/helpers';

const gustoGetAuthUrlFn    = httpsCallable(functions, 'gustoGetAuthUrl');
const gustoSyncEmployeesFn = httpsCallable(functions, 'gustoSyncEmployees');
const gustoSubmitPayrollFn = httpsCallable(functions, 'gustoSubmitPayroll');

function todayStr() { return new Date().toISOString().slice(0, 10); }

function startOf(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
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
  const [bonuses,      setBonuses]      = useState([]);
  const [payrollRuns,  setPayrollRuns]  = useState([]);
  const [reviews,      setReviews]      = useState([]);
  const [taxForms,     setTaxForms]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showRunModal, setShowRunModal] = useState(false);
  const [editReview,   setEditReview]   = useState(null); // null = closed, {} = new, {id,...} = edit

  const endDate   = todayStr();
  const startDate = startOf(periodDays);

  useEffect(() => {
    fetchEmployeesWithComp().then(setEmployees).catch(() => {});
    loadTaxForms();
    if (!isTech) {
      loadBonuses();
      loadPayrollRuns();
      loadReviews();
    }
  }, []); // eslint-disable-line

  useEffect(() => { if (!isTech) loadAppts(); else setLoading(false); }, [periodDays, isTech]); // eslint-disable-line

  async function loadAppts() {
    setLoading(true);
    try { setAppts(await fetchAppointmentsByRange(startDate, endDate)); }
    catch { setAppts([]); }
    finally { setLoading(false); }
  }

  async function loadBonuses() {
    try { setBonuses(await fetchBonuses()); }
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
        const serviceRevenue = techAppts.reduce((s, a) => {
          if (a.payment?.techSplit) {
            const split = a.payment.techSplit.find(t => t.techName === emp.name);
            return s + (split?.revenue || 0);
          }
          return s + (a.services || []).reduce((t, sv) => t + (Number(sv.price) || 0), 0);
        }, 0);
        const commissionPct = Number(emp.commissionPct) || 0;
        const commissionAmt = commissionPct
          ? Math.round(serviceRevenue * commissionPct / 100 * 100) / 100
          : 0;
        const periodBonuses = bonuses.filter(b =>
          b.techName === emp.name && (b.createdAt || '').slice(0, 10) >= startDate);
        const bonusTotal = periodBonuses.reduce((s, b) => s + (Number(b.amount) || 0), 0);
        const isHourly   = emp.rateType === 'hourly';
        const earned     = isHourly ? null : commissionAmt;
        const total      = (earned || 0) + bonusTotal;
        return { emp, techAppts, serviceRevenue, commissionPct, commissionAmt, periodBonuses, bonusTotal, earned, isHourly, total };
      });
  }, [employees, appts, bonuses, startDate]);

  const grandTotal = payrollRows.reduce((s, r) => s + r.total, 0);

  if (isScheduler) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 20px', color: '#aaa', fontSize: 14 }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
        <div style={{ fontWeight: 600, color: '#555', marginBottom: 8 }}>Access Restricted</div>
        <div>HR is available to admin staff only.</div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 24 }}>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e8', marginBottom: 20, flexShrink: 0, overflowX: 'auto' }}>
        {(isTech ? [
          { id: 'handbook', label: 'Handbook' },
          { id: '1099s',    label: '1099s'    },
        ] : [
          { id: 'payroll',  label: 'Payroll' },
          { id: 'history',  label: 'History', badge: payrollRuns.length || null },
          { id: 'bonuses',  label: 'Bonuses' },
          { id: 'reviews',  label: 'Reviews', badge: reviews.length || null },
          { id: 'handbook', label: 'Handbook' },
          { id: '1099s',    label: '1099s', badge: taxForms.length || null },
          { id: 'gusto',    label: 'Gusto' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, color: tab === t.id ? '#1a1a1a' : '#aaa', background: 'none', border: 'none', borderBottom: tab === t.id ? '2px solid #1a1a1a' : '2px solid transparent', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}
            {t.badge > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: '#e8e8e8', color: '#555', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

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
          <span style={{ fontSize: 11, color: '#bbb' }}>
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
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>Loading…</div>
      ) : (
        <div className="scroll-x" style={{ borderRadius: 12, border: '1px solid #e8e8e8' }}>
        <div style={{ background: '#fff', borderRadius: 12, minWidth: 560, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '8px 16px', background: '#fafafa', borderBottom: '1px solid #e8e8e8', fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.06em' }}>
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
                <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '10px 16px', borderBottom: isLast && !isExpanded ? 'none' : '1px solid #f5f5f5', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <EmpAvatar emp={row.emp} size={28} />
                    <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{row.emp.name}</span>
                    {row.techAppts.length > 0 && (
                      <button onClick={() => setExpanded(e => ({ ...e, [row.emp.name]: !e[row.emp.name] }))}
                        style={{ fontSize: 10, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', fontFamily: 'inherit' }}>
                        {isExpanded ? '▲' : '▼'}
                      </button>
                    )}
                  </div>
                  <span style={{ textAlign: 'right', fontSize: 13, color: '#555' }}>{row.techAppts.length}</span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: '#555' }}>{fmt$(row.serviceRevenue)}</span>
                  <span style={{ textAlign: 'right', fontSize: 12, color: '#888' }}>
                    {row.commissionPct ? `${row.commissionPct}%` : row.isHourly ? `$${row.emp.hourlyRate}/hr` : '—'}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: '#333' }}>
                    {row.earned !== null
                      ? fmt$(row.earned)
                      : <span style={{ color: '#bbb', fontSize: 11 }}>hourly</span>}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 13, color: row.bonusTotal > 0 ? '#22c55e' : '#bbb' }}>
                    {row.bonusTotal > 0 ? fmt$(row.bonusTotal) : '—'}
                  </span>
                  <span style={{ textAlign: 'right', fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>{fmt$(row.total)}</span>
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => { setAddBonusFor(row.emp.name); setBonusAmt(''); setBonusNote(''); }}
                      style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', color: '#555', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                      + Bonus
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div style={{ background: '#fafafa', borderBottom: isLast ? 'none' : '1px solid #f0f0f0', padding: '8px 16px 8px 52px' }}>
                    {row.techAppts.map(a => {
                      const rev = (a.services || []).reduce((s, sv) => s + (Number(sv.price) || 0), 0);
                      return (
                        <div key={a.id} style={{ display: 'flex', alignItems: 'center', padding: '4px 0', fontSize: 12, color: '#555', borderBottom: '1px solid #f0f0f0' }}>
                          <span style={{ flex: 1 }}>{a.clientName || 'Walk-in'}</span>
                          <span style={{ marginRight: 16, color: '#aaa' }}>{(a.services || []).map(s => s.name).filter(Boolean).join(', ') || '—'}</span>
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
                  </div>
                )}
              </div>
            );
          })}

          {/* Grand total */}
          <div style={{ display: 'grid', gridTemplateColumns: COL, padding: '10px 16px', background: '#f8f9fa', borderTop: '2px solid #e8e8e8', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Total ({rows.length} techs)</span>
            <span />
            <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#555' }}>
              {fmt$(rows.reduce((s, r) => s + r.serviceRevenue, 0))}
            </span>
            <span /><span />
            <span style={{ textAlign: 'right', fontSize: 13, fontWeight: 600, color: '#22c55e' }}>
              {fmt$(rows.reduce((s, r) => s + r.bonusTotal, 0))}
            </span>
            <span style={{ textAlign: 'right', fontSize: 16, fontWeight: 800, color: '#1a1a1a' }}>{fmt$(grandTotal)}</span>
            <span />
          </div>
        </div>
        </div>
      )}

      {/* Add bonus modal */}
      {addBonusFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300 }}
             onClick={e => { if (e.target === e.currentTarget) setAddBonusFor(null); }}>
          <div style={{ background: '#fff', borderRadius: 14, width: 320, padding: 20, boxShadow: '0 20px 60px rgba(0,0,0,.25)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>Add Bonus — {addBonusFor}</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Amount ($) *</label>
              <input type="number" min={0} value={bonusAmt} onChange={e => setBonusAmt(e.target.value)}
                placeholder="e.g. 50" autoFocus style={inp} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Notes (optional)</label>
              <input value={bonusNote} onChange={e => setBonusNote(e.target.value)}
                placeholder="Holiday, performance, etc." style={inp} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setAddBonusFor(null)}
                style={{ flex: 1, padding: '9px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
                Cancel
              </button>
              <button onClick={submitBonus} disabled={saving || !bonusAmt}
                style={{ flex: 2, padding: '9px', borderRadius: 8, border: 'none', background: saving || !bonusAmt ? '#d0d0d0' : '#22c55e', color: '#fff', cursor: saving || !bonusAmt ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
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
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 560, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>

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
            <div style={{ textAlign: 'center', padding: 40, color: '#bbb', fontSize: 13 }}>
              No payable amounts in this period.
            </div>
          ) : (
            payableRows.map(row => (
              <div key={row.emp.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                <EmpAvatar emp={row.emp} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{row.emp.name}</div>
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                    {row.techAppts.length} appts
                    {row.earned !== null && ` · ${fmt$(row.earned)} earned`}
                    {row.bonusTotal > 0 && ` · ${fmt$(row.bonusTotal)} bonus`}
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#1a1a1a', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
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
          <div style={{ padding: '12px 18px', borderTop: '1px solid #f0f0f0', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontSize: 12, color: '#888' }}>Total payout</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#1a1a1a' }}>{fmt$(grandTotal)}</span>
            </div>
            <button onClick={submit} disabled={saving}
              style={{ width: '100%', background: saving ? '#aaa' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', border: 'none', borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 700, cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit' }}>
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
      <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>
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
          <div key={run.id} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
            {/* Run header row */}
            <div
              onClick={() => setExpanded(e => ({ ...e, [run.id]: !e[run.id] }))}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#1a1a1a' }}>
                  {fmtDateShort(run.startDate)} – {fmtDateShort(run.endDate)}
                </div>
                <div style={{ fontSize: 11, color: '#aaa', marginTop: 2 }}>
                  Recorded {fmtDateFull(run.createdAt)} · {totalCount} tech{totalCount !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: allPaid ? '#EDFAF3' : '#FEF9EC', color: allPaid ? '#166534' : '#92400e', border: `1px solid ${allPaid ? '#86efac' : '#fcd34d'}` }}>
                  {allPaid ? '✓ All paid' : `${paidCount}/${totalCount} paid`}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a' }}>{fmt$(run.grandTotal)}</span>
                <span style={{ fontSize: 14, color: '#bbb' }}>{isExpanded ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded per-tech rows */}
            {isExpanded && (
              <div style={{ borderTop: '1px solid #f0f0f0' }}>
                {run.techs.map((t, i) => (
                  <div key={t.techName} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 28px', borderBottom: i < run.techs.length - 1 ? '1px solid #f8f8f8' : 'none', background: t.paidAt ? '#fafffe' : '#fff' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{t.techName}</span>
                      <span style={{ fontSize: 11, color: '#bbb', marginLeft: 8 }}>
                        {t.apptCount} appts
                        {t.earned != null && ` · ${fmt$(t.earned)} earned`}
                        {t.bonusTotal > 0 && ` · ${fmt$(t.bonusTotal)} bonus`}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: '#aaa', flexShrink: 0 }}>
                      {METHODS.find(m => m.id === t.method)?.label || t.method}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
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
                        style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #86efac', background: '#EDFAF3', color: '#166534', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, flexShrink: 0 }}>
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
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Add Bonus</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2, minWidth: 140 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Tech</label>
            <select value={techName} onChange={e => setTechName(e.target.value)} style={inp}>
              <option value="">Select tech…</option>
              {employees.map(e => <option key={e.id} value={e.name}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ width: 100 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Amount ($)</label>
            <input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" style={inp} />
          </div>
          <div style={{ flex: 3, minWidth: 160 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Holiday, performance, etc." style={inp} />
          </div>
          <button onClick={submit} disabled={saving || !techName || !amount}
            style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: saving || !techName || !amount ? '#d0d0d0' : '#22c55e', color: '#fff', cursor: saving || !techName || !amount ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600, flexShrink: 0, alignSelf: 'flex-end' }}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      {bonuses.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#bbb', fontSize: 13 }}>No bonuses recorded yet.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
          {bonuses.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < bonuses.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{b.techName}</div>
                {b.notes && <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>{b.notes}</div>}
              </div>
              <div style={{ fontSize: 11, color: '#bbb', flexShrink: 0 }}>{fmtDateFull(b.createdAt)}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#22c55e', flexShrink: 0, minWidth: 70, textAlign: 'right' }}>{fmt$(b.amount)}</div>
              <button onClick={() => onDelete(b.id)}
                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
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
        <span key={n} style={{ color: n <= filled ? '#f59e0b' : '#e0e0e0' }}>★</span>
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
          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: n <= (hover || value) ? '#f59e0b' : '#e0e0e0', padding: '0 1px', lineHeight: 1 }}>
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
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>
          No reviews yet. Create the first one.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {empNames.map(name => {
            const empReviews = byEmp[name];
            const emp = employees.find(e => e.name === name);
            const isOpen = expanded[name];
            return (
              <div key={name} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', overflow: 'hidden' }}>
                {/* Tech header */}
                <div onClick={() => setExpanded(e => ({ ...e, [name]: !e[name] }))}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', cursor: 'pointer' }}>
                  {emp && <EmpAvatar emp={emp} size={32} />}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#1a1a1a' }}>{name}</div>
                    <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                      {empReviews.length} review{empReviews.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span style={{ fontSize: 13, color: '#bbb' }}>{isOpen ? '▲' : '▼'}</span>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid #f0f0f0' }}>
                    {empReviews.map((rev, i) => {
                      const avg = avgRating(rev.ratings);
                      return (
                        <div key={rev.id} style={{ padding: '12px 16px 12px 28px', borderBottom: i < empReviews.length - 1 ? '1px solid #f8f8f8' : 'none' }}>
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
                                  {fmtDateShort(rev.periodStart)} – {fmtDateShort(rev.periodEnd)}
                                </span>
                                <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                                  background: rev.status === 'final' ? '#EDFAF3' : '#FEF9EC',
                                  color:      rev.status === 'final' ? '#166534' : '#92400e',
                                  border: `1px solid ${rev.status === 'final' ? '#86efac' : '#fcd34d'}` }}>
                                  {rev.status === 'final' ? 'Final' : 'Draft'}
                                </span>
                                {avg > 0 && <Stars value={avg} size={12} />}
                              </div>
                              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#aaa', marginTop: 4 }}>
                                {rev.metrics?.appointmentCount > 0 && (
                                  <span>{rev.metrics.appointmentCount} appts · {fmt$(rev.metrics.revenue)} · avg {fmt$(rev.metrics.avgTicket)}</span>
                                )}
                                <span>Reviewed {fmtDateShort(rev.reviewDate || rev.createdAt)}</span>
                              </div>
                              {rev.strengths && (
                                <div style={{ fontSize: 12, color: '#555', marginTop: 6, lineHeight: 1.5 }}>
                                  <span style={{ fontWeight: 500, color: '#2D7A5F' }}>Strengths: </span>{rev.strengths}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                              <button onClick={() => onEdit(rev)}
                                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', color: '#555', cursor: 'pointer', fontFamily: 'inherit' }}>
                                Edit
                              </button>
                              <button onClick={() => onDelete(rev.id)}
                                style={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fef2f2', color: '#ef4444', cursor: 'pointer', fontFamily: 'inherit' }}>
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
      <div style={{ background: '#fff', borderRadius: 16, width: '94%', maxWidth: 560, boxShadow: '0 20px 60px rgba(0,0,0,.3)', marginTop: 0 }} onClick={e => e.stopPropagation()}>

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
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Employee</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} style={inp}>
              <option value="">Select employee…</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {/* Period */}
          <div>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>Review Period</label>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {REVIEW_PERIODS.map(p => (
                <PillBtn key={p.days} active={periodDays === p.days} onClick={() => applyPeriodDays(p.days)}>{p.label}</PillBtn>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPeriodDays(0); }} style={{ ...inp, flex: 1 }} />
              <span style={{ color: '#bbb', flexShrink: 0 }}>–</span>
              <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPeriodDays(0); }} style={{ ...inp, flex: 1 }} />
            </div>
          </div>

          {/* Metrics strip */}
          <div style={{ background: '#f8f9fa', borderRadius: 10, padding: '10px 14px', border: '1px solid #e8e8e8' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 8 }}>
              Performance Metrics {metricsLoading && <span style={{ fontWeight: 400, color: '#bbb' }}>loading…</span>}
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
                    <div style={{ fontSize: 10, color: '#aaa', marginTop: 1 }}>{m.label}</div>
                  </div>
                ))}
              </div>
            ) : !metricsLoading ? (
              <div style={{ fontSize: 12, color: '#bbb' }}>Select an employee and period to load metrics.</div>
            ) : null}
          </div>

          {/* Ratings */}
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
              Ratings {avg > 0 && <span style={{ fontWeight: 400, color: '#f59e0b', marginLeft: 6 }}>avg {avg.toFixed(1)} ★</span>}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {RATING_FIELDS.map(f => (
                <div key={f.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, color: '#333' }}>{f.label}</span>
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
              <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.label}</label>
              <textarea value={s.value} onChange={e => s.set(e.target.value)}
                rows={3} placeholder="Enter notes…"
                style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }} />
            </div>
          ))}

        </div>

        {/* Footer */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #f0f0f0', display: 'flex', gap: 8 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
            Cancel
          </button>
          <button onClick={() => submit('draft')} disabled={saving || !empId}
            style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #d0d0d0', background: saving || !empId ? '#d0d0d0' : '#fafafa', color: saving || !empId ? '#fff' : '#555', cursor: saving || !empId ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
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
  const [doc,     setDoc]     = useState({ title: 'Employee Handbook', version: '1.0', content: '' });
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
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '20px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1a1a1a' }}>{doc.title || 'Employee Handbook'}</div>
            <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>Version {doc.version}{doc.publishedAt ? ` · Published ${fmtDateFull(doc.publishedAt)}` : ''}</div>
          </div>
          {mySig ? (
            <span style={{ fontSize: 12, fontWeight: 600, color: '#16a34a', padding: '4px 12px', borderRadius: 20, background: '#EDFAF3', border: '1px solid #86efac', flexShrink: 0 }}>
              ✓ Signed {fmtDateFull(mySig.signedAt)}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: '#f59e0b', padding: '4px 12px', borderRadius: 20, background: '#FEF9EC', border: '1px solid #fcd34d', flexShrink: 0 }}>
              Pending signature
            </span>
          )}
        </div>
        {doc.content ? (
          <div style={{ fontSize: 14, color: '#333', lineHeight: 1.75, whiteSpace: 'pre-wrap', borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
            {doc.content}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '40px 0', color: '#bbb', fontSize: 13 }}>
            No handbook content published yet.
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
      showToast('Handbook published');
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
    return <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>Loading…</div>;
  }

  const sigByEmail = {};
  sigs.forEach(s => { if (s.email) sigByEmail[s.email] = s; });
  const signedCount = employees.filter(e => e.email && sigByEmail[e.email]?.version === doc.version).length;

  return (
    <>
      {/* Editor */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 14 }}>
          Handbook Editor
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 3 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Title</label>
            <input value={doc.title || ''} onChange={e => setDoc(d => ({ ...d, title: e.target.value }))}
              placeholder="Employee Handbook" style={inp} />
          </div>
          <div style={{ width: 90 }}>
            <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Version</label>
            <input value={doc.version || ''} onChange={e => setDoc(d => ({ ...d, version: e.target.value }))}
              placeholder="1.0" style={inp} />
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 3 }}>Content</label>
          <textarea
            value={doc.content || ''}
            onChange={e => setDoc(d => ({ ...d, content: e.target.value }))}
            placeholder="Write your employee handbook content here…"
            rows={16}
            style={{ ...inp, resize: 'vertical', lineHeight: 1.7 }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#bbb' }}>
            {doc.publishedAt ? `Last published ${fmtDateFull(doc.publishedAt)}` : 'Not yet published'}
          </span>
          <button onClick={handlePublish} disabled={saving}
            style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: saving ? '#d0d0d0' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
            {saving ? 'Saving…' : '⬆ Publish Handbook'}
          </button>
        </div>
      </div>

      {/* Signing roster */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e8e8e8', padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.08em' }}>
              Signing Roster
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {signedCount}/{employees.length} signed v{doc.version}
            </div>
          </div>
          <button onClick={sendAllReminders} disabled={!!sending || !doc.publishedAt}
            title={!doc.publishedAt ? 'Publish handbook first' : ''}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d8d8d8', background: '#fafafa', cursor: !!sending || !doc.publishedAt ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 12, color: !!sending || !doc.publishedAt ? '#bbb' : '#555' }}>
            {sending === 'all' ? 'Sending…' : '📧 Remind All Unsigned'}
          </button>
        </div>

        {employees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: '#bbb', fontSize: 13 }}>No employees on record.</div>
        ) : employees.map((emp, i) => {
          const sig    = emp.email ? sigByEmail[emp.email] : null;
          const signed = sig?.version === doc.version;
          return (
            <div key={emp.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < employees.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
              <EmpAvatar emp={emp} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>{emp.name}</div>
                {signed ? (
                  <div style={{ fontSize: 11, color: '#aaa', marginTop: 1 }}>
                    Signed v{sig.version} on {fmtDateFull(sig.signedAt)}
                  </div>
                ) : !emp.email ? (
                  <div style={{ fontSize: 11, color: '#fca5a5', marginTop: 1 }}>No email on file</div>
                ) : null}
              </div>
              {signed ? (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', padding: '3px 10px', borderRadius: 20, background: '#EDFAF3', border: '1px solid #86efac', flexShrink: 0 }}>
                  ✓ Signed
                </span>
              ) : (
                <button
                  onClick={() => sendReminder(emp)}
                  disabled={!!sending || !emp.email || !doc.publishedAt}
                  title={!emp.email ? 'No email on file' : !doc.publishedAt ? 'Publish handbook first' : ''}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: '1px solid #fcd34d', background: '#FEF9EC', color: !!sending || !emp.email || !doc.publishedAt ? '#bbb' : '#92400e', cursor: !!sending || !emp.email || !doc.publishedAt ? 'default' : 'pointer', fontFamily: 'inherit', flexShrink: 0 }}>
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
              style={{ fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 12px', fontSize: 13, background: '#fff' }}>
              {YEAR_OPTIONS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <button onClick={handleGenerate} disabled={generating}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: generating ? '#d0d0d0' : 'linear-gradient(135deg,#2D7A5F,#3D95CE)', color: '#fff', cursor: generating ? 'default' : 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 600 }}>
              {generating ? 'Generating…' : `Generate ${selectedYear} 1099s`}
            </button>
            {genMsg && <span style={{ fontSize: 12, color: genMsg.startsWith('✓') ? '#16a34a' : '#ef4444' }}>{genMsg}</span>}
          </>
        )}
        {isTech && isDisabled && (
          <div style={{ fontSize: 12, color: '#f59e0b', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 12px' }}>
            Inactive contractors may access forms from the past 3 years.
          </div>
        )}
        <div style={{ marginLeft: isAdmin ? 'auto' : 0, fontSize: 12, color: '#aaa' }}>
          {visibleForms.length} form{visibleForms.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* IRS $600 note */}
      {isAdmin && (
        <div style={{ fontSize: 11, color: '#888', background: '#f8f9fa', border: '1px solid #e8e8e8', borderRadius: 8, padding: '8px 12px', marginBottom: 16 }}>
          IRS requirement: 1099-NEC must be issued for contractors paid $600 or more in a calendar year. Deadline: January 31.
          Auto-generation runs January 30 each year.
        </div>
      )}

      {/* Forms list */}
      {visibleForms.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#bbb', fontSize: 13 }}>
          {isAdmin ? `No 1099 forms for ${selectedYear}. Click "Generate" to create them from payroll data.` : 'No 1099 forms on file.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Column headers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px 120px 80px', gap: 8, padding: '0 14px', fontSize: 11, fontWeight: 600, color: '#aaa', textTransform: 'uppercase', letterSpacing: '.05em' }}>
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
              <div key={form.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 140px 120px 80px', gap: 8, alignItems: 'center', background: '#fff', border: '1px solid #e8e8e8', borderRadius: 10, padding: '10px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  {emp && <EmpAvatar emp={emp} size={30} />}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: isInactive ? '#aaa' : '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.techName}</div>
                    {form.techEmail && <div style={{ fontSize: 10, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{form.techEmail}</div>}
                  </div>
                  {isInactive && <span style={{ fontSize: 10, color: '#bbb', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 10, padding: '1px 7px', flexShrink: 0 }}>inactive</span>}
                </div>
                <div style={{ textAlign: 'center', fontSize: 13, fontWeight: 600, color: '#555' }}>{form.year}</div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontSize: 15, fontWeight: 700, color: Number(form.totalEarnings) >= 600 ? '#2D7A5F' : '#f59e0b' }}>
                    ${Number(form.totalEarnings || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {Number(form.totalEarnings) < 600 && (
                    <div style={{ fontSize: 9, color: '#f59e0b' }}>below $600 threshold</div>
                  )}
                </div>
                <div style={{ fontSize: 10, color: '#aaa' }}>
                  {form.generatedAt ? new Date(form.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                  <button onClick={() => download1099Pdf(form, emp, settings)}
                    style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #2D7A5F', background: '#f0faf6', color: '#2D7A5F', fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>
                    PDF
                  </button>
                  {isAdmin && (
                    <button onClick={() => { if (confirm('Delete this 1099?')) onDelete(form.id); }}
                      style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #fca5a5', background: '#fff', color: '#ef4444', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>
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
      <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, padding: '20px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: '#f9f4ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>🦖</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1a1a1a' }}>Gusto Payroll</div>
            {isConnected ? (
              <div style={{ fontSize: 12, color: '#16a34a', marginTop: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: '#16a34a' }} />
                Connected · {gusto.companyName || 'Company linked'}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>Not connected</div>
            )}
          </div>
          {isConnected ? (
            <button onClick={handleSync} disabled={syncing}
              style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #d0d0d0', background: syncing ? '#f0f0f0' : '#fafafa', color: '#555', fontSize: 12, fontWeight: 600, cursor: syncing ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {syncing ? 'Syncing…' : '↺ Sync Employees'}
            </button>
          ) : (
            <button onClick={handleConnect} disabled={connecting}
              style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: connecting ? '#ccc' : '#7c3aed', color: '#fff', fontSize: 12, fontWeight: 700, cursor: connecting ? 'default' : 'pointer', fontFamily: 'inherit' }}>
              {connecting ? 'Opening…' : 'Connect Gusto'}
            </button>
          )}
        </div>

        {syncResult && (
          <div style={{ marginTop: 14, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 12, color: '#166534' }}>
            Sync complete — {syncResult.matched} employees matched, {syncResult.updated} updated with Gusto IDs.
          </div>
        )}
      </div>

      {/* Synced employees */}
      {isConnected && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Employee sync status</span>
            <span style={{ fontSize: 11, color: '#aaa' }}>{gustoMatchedEmps.length}/{employees.length} matched</span>
          </div>
          {employees.map((e, i) => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: i < employees.length - 1 ? '1px solid #f8f8f8' : 'none' }}>
              <EmpAvatar emp={e} size={28} />
              <span style={{ flex: 1, fontSize: 13, color: '#1a1a1a' }}>{e.name}</span>
              {e.gustoId ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#16a34a', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '2px 8px' }}>✓ Linked</span>
              ) : (
                <span style={{ fontSize: 10, color: '#bbb', background: '#f8f8f8', borderRadius: 6, padding: '2px 8px' }}>Not matched</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Payroll runs → submit to Gusto */}
      {isConnected && payrollRuns.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#555' }}>Submit payroll runs</span>
          </div>
          {payrollRuns.slice(0, 6).map((run, i) => (
            <div key={run.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: i < Math.min(payrollRuns.length, 6) - 1 ? '1px solid #f8f8f8' : 'none' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1a1a1a' }}>
                  {fmtDateShort(run.startDate)} – {fmtDateShort(run.endDate)}
                </div>
                <div style={{ fontSize: 11, color: '#aaa' }}>{run.techs.length} techs · {fmt$(run.grandTotal)}</div>
              </div>
              {run.gustoPayrollId ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: '#7c3aed', background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 6, padding: '2px 8px' }}>Submitted</span>
              ) : (
                <button onClick={() => handleSubmitPayroll(run)} disabled={submitting === run.id}
                  style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: 'none', background: submitting === run.id ? '#ccc' : '#7c3aed', color: '#fff', cursor: submitting === run.id ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
                  {submitting === run.id ? 'Submitting…' : 'Submit →'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!isConnected && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#bbb', fontSize: 13 }}>
          Connect Gusto above to sync employees and submit payroll runs automatically.
        </div>
      )}
    </div>
  );
}

// ── Shared primitives ──────────────────────────────────
function PillBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? '#1a1a1a' : '#fff', color: active ? '#fff' : '#555', border: `1px solid ${active ? '#1a1a1a' : '#d8d8d8'}`, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

const inp = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
