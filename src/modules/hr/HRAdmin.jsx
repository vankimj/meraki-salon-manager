import { useState, useEffect, useMemo } from 'react';
import {
  fetchEmployees, fetchAppointmentsByRange,
  fetchBonuses, createBonus, deleteBonus,
  fetchPayrollRuns, createPayrollRun, savePayrollRun,
} from '../../lib/firestore';
import { EmpAvatar } from '../employees/EmployeesAdmin';

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
  const [tab,          setTab]          = useState('payroll');
  const [periodDays,   setPeriodDays]   = useState(14);
  const [employees,    setEmployees]    = useState([]);
  const [appts,        setAppts]        = useState(null);
  const [bonuses,      setBonuses]      = useState([]);
  const [payrollRuns,  setPayrollRuns]  = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [showRunModal, setShowRunModal] = useState(false);

  const endDate   = todayStr();
  const startDate = startOf(periodDays);

  useEffect(() => {
    fetchEmployees().then(setEmployees).catch(() => {});
    loadBonuses();
    loadPayrollRuns();
  }, []);

  useEffect(() => { loadAppts(); }, [periodDays]); // eslint-disable-line

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

  async function handleAddBonus(techName, amount, notes) {
    await createBonus({ techName, amount: Number(amount), notes: notes || '' });
    await loadBonuses();
  }

  async function handleDeleteBonus(id) {
    if (!confirm('Delete this bonus?')) return;
    await deleteBonus(id);
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
    setPayrollRuns(runs => runs.map(r => r.id === runId ? { ...r, techs: updatedTechs } : r));
  }

  const payrollRows = useMemo(() => {
    if (!appts) return [];
    const doneAppts = appts.filter(a => a.status === 'done');
    return employees
      .filter(e => e.active !== false)
      .map(emp => {
        const techAppts = doneAppts.filter(a => a.techName === emp.name);
        const serviceRevenue = techAppts.reduce((s, a) =>
          s + (a.services || []).reduce((t, sv) => t + (Number(sv.price) || 0), 0), 0);
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

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', paddingBottom: 24 }}>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e8e8e8', marginBottom: 20, flexShrink: 0 }}>
        {['payroll', 'history', 'bonuses'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '8px 20px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t ? 600 : 400, color: tab === t ? '#1a1a1a' : '#aaa', background: 'none', border: 'none', borderBottom: tab === t ? '2px solid #1a1a1a' : '2px solid transparent', cursor: 'pointer', textTransform: 'capitalize' }}>
            {t}
            {t === 'history' && payrollRuns.length > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, background: '#e8e8e8', color: '#555', borderRadius: 10, padding: '1px 6px', fontWeight: 600 }}>
                {payrollRuns.length}
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

// ── Shared primitives ──────────────────────────────────
function PillBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{ padding: '6px 14px', borderRadius: 8, fontFamily: 'inherit', fontSize: 12, fontWeight: active ? 600 : 400, background: active ? '#1a1a1a' : '#fff', color: active ? '#fff' : '#555', border: `1px solid ${active ? '#1a1a1a' : '#d8d8d8'}`, cursor: 'pointer' }}>
      {children}
    </button>
  );
}

const inp = { fontFamily: 'inherit', width: '100%', border: '1px solid #d8d8d8', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#333', outline: 'none', background: '#fafafa', boxSizing: 'border-box' };
