import { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import {
  subscribeMembershipPlans, createMembershipPlan, saveMembershipPlan, deleteMembershipPlan,
  subscribeMemberships, createMembership, saveMembership, deleteMembership,
  fetchClients,
} from '../../lib/firestore';
import { logActivity } from '../../lib/logger';
import TrashButton from '../../components/TrashButton';

const TABS = [
  { id: 'plans',   label: 'Plans' },
  { id: 'members', label: 'Members' },
];

export default function MembershipsAdmin() {
  const { isAdmin, showToast } = useApp();
  const [tab,        setTab]        = useState('plans');
  const [plans,      setPlans]      = useState([]);
  const [members,    setMembers]    = useState([]);
  const [clients,    setClients]    = useState([]);
  const [editPlan,   setEditPlan]   = useState(null);   // plan obj or 'new'
  const [editMember, setEditMember] = useState(null);   // member obj or 'new'

  if (!isAdmin) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--pn-text-muted)' }}>Memberships are managed by the salon owner.</div>;
  }

  useEffect(() => subscribeMembershipPlans(setPlans), []);
  useEffect(() => subscribeMemberships(setMembers), []);
  useEffect(() => { fetchClients().then(setClients).catch(() => {}); }, []);

  const stats = useMemo(() => {
    const active = members.filter(m => m.status === 'active');
    const mrr    = active.reduce((s, m) => s + (Number(m.price) || 0) * (m.billingPeriod === 'yearly' ? 1/12 : 1), 0);
    return {
      activeCount: active.length,
      planCount:   plans.filter(p => p.active !== false).length,
      mrr,
      arr:         mrr * 12,
    };
  }, [members, plans]);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', paddingBottom: 32 }}>
      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}>
        <Stat label="Active members" value={stats.activeCount} accent="#6a4fa0" />
        <Stat label="MRR" value={`$${Math.round(stats.mrr).toLocaleString()}`} sub="monthly recurring revenue" accent="#22c55e" />
        <Stat label="ARR" value={`$${Math.round(stats.arr).toLocaleString()}`} sub="annualized" accent="#3D95CE" />
        <Stat label="Plans available" value={stats.planCount} accent="#f59e0b" />
      </div>

      {/* Tabs */}
      <div className="scroll-x" style={{ display: 'flex', gap: 4, marginBottom: 18, borderBottom: '1px solid var(--pn-border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 18px', fontFamily: 'inherit', fontSize: 13, fontWeight: tab === t.id ? 600 : 400, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.id ? 'var(--pn-text)' : 'var(--pn-text-muted)', borderBottom: tab === t.id ? '2px solid #6a4fa0' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {t.label}{t.id === 'members' && members.length > 0 && <span style={{ marginLeft: 6, color: 'var(--pn-text-faint)' }}>({members.length})</span>}
          </button>
        ))}
      </div>

      {tab === 'plans' && (
        <PlansTab plans={plans} onNew={() => setEditPlan('new')} onEdit={setEditPlan} onDelete={async (p) => {
          if (!confirm(`Delete the "${p.name}" plan? This won't affect existing members.`)) return;
          await deleteMembershipPlan(p.id);
          logActivity('membership_plan_deleted', `${p.name}`);
          showToast('Plan deleted');
        }} />
      )}

      {tab === 'members' && (
        <MembersTab members={members} clients={clients} plans={plans} onNew={() => setEditMember('new')} onEdit={setEditMember} onDelete={async (m) => {
          if (!confirm(`Remove ${m.clientName}'s membership? This won't refund any payments.`)) return;
          await deleteMembership(m.id);
          logActivity('membership_deleted', `${m.clientName} — ${m.planName}`);
          showToast('Membership removed');
        }} />
      )}

      {editPlan && (
        <PlanEditor
          plan={editPlan === 'new' ? null : editPlan}
          onSave={async (data) => {
            try {
              if (editPlan === 'new') {
                await createMembershipPlan(data);
                logActivity('membership_plan_created', `${data.name} — $${data.price}/${data.billingPeriod}`);
                showToast('Plan created');
              } else {
                await saveMembershipPlan(editPlan.id, data);
                logActivity('membership_plan_updated', `${data.name}`);
                showToast('Plan updated');
              }
              setEditPlan(null);
            } catch (e) {
              showToast(`Save failed: ${e.message}`, 4000);
            }
          }}
          onClose={() => setEditPlan(null)}
        />
      )}

      {editMember && (
        <MemberEditor
          member={editMember === 'new' ? null : editMember}
          plans={plans}
          clients={clients}
          existingMembers={members}
          onSave={async (data) => {
            try {
              if (editMember === 'new') {
                await createMembership(data);
                logActivity('membership_created', `${data.clientName} → ${data.planName}`);
                showToast('Member added');
              } else {
                await saveMembership(editMember.id, data);
                logActivity('membership_updated', `${data.clientName} — ${data.status}`);
                showToast('Member updated');
              }
              setEditMember(null);
            } catch (e) {
              showToast(`Save failed: ${e.message}`, 4000);
            }
          }}
          onClose={() => setEditMember(null)}
        />
      )}
    </div>
  );
}

function PlansTab({ plans, onNew, onEdit, onDelete }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 14, color: 'var(--pn-text-muted)' }}>Define recurring subscription plans your clients can sign up for.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <TrashButton collections={['memberships', 'membershipPlans']} scope="Memberships" />
          <button onClick={onNew} style={primaryBtn}>+ New plan</button>
        </div>
      </div>

      {plans.length === 0 ? (
        <Empty>No plans yet. Create your first one — e.g. "Manicure Club $80/month".</Empty>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
          {plans.map(p => (
            <div key={p.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 14, padding: 18, position: 'relative', opacity: p.active === false ? .5 : 1 }}>
              {p.active === false && <div style={{ position: 'absolute', top: 10, right: 10, fontSize: 10, fontWeight: 700, color: 'var(--pn-text-muted)', background: 'var(--pn-surface-alt)', padding: '2px 8px', borderRadius: 4 }}>INACTIVE</div>}
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)', marginBottom: 4 }}>{p.name}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#6a4fa0', lineHeight: 1.2, marginBottom: 8 }}>
                ${p.price}<span style={{ fontSize: 13, color: 'var(--pn-text-muted)', fontWeight: 500 }}>/{p.billingPeriod === 'yearly' ? 'yr' : 'mo'}</span>
              </div>
              {p.discountPct > 0 && (
                <div style={{ fontSize: 12, color: '#22c55e', marginBottom: 6, fontWeight: 600 }}>
                  {p.discountPct}% off all services
                </div>
              )}
              {p.description && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 8 }}>{p.description}</div>}
              {Array.isArray(p.perks) && p.perks.length > 0 && (
                <ul style={{ fontSize: 12, color: 'var(--pn-text-muted)', paddingLeft: 18, margin: '8px 0' }}>
                  {p.perks.map((perk, i) => <li key={i} style={{ marginBottom: 3 }}>{perk}</li>)}
                </ul>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                <button onClick={() => onEdit(p)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12 }}>Edit</button>
                <button onClick={() => onDelete(p)} style={{ ...secondaryBtn, padding: '6px 12px', fontSize: 12, color: '#ef4444', borderColor: '#fca5a5' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MembersTab({ members, clients, plans, onNew, onEdit, onDelete }) {
  const { showToast } = useApp();
  const [filter, setFilter] = useState('active');
  const [busyMember, setBusyMember] = useState(null); // { id, action }
  const filtered = filter === 'all' ? members : members.filter(m => m.status === filter);

  async function sendPaymentLink(m) {
    setBusyMember({ id: m.id, action: 'sendLink' });
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const create = await httpsCallable(functions, 'createMembershipCheckout')({ membershipId: m.id });
      const url = create?.data?.url;
      if (!url) throw new Error('No URL returned');
      const client = clients.find(c => c.id === m.clientId);
      if (client?.email) {
        // emailMembershipPaymentLink reads the URL from the membership doc
        // (stamped by createMembershipCheckout above) — caller no longer
        // passes the URL, so an attacker can't substitute a phishing link.
        await httpsCallable(functions, 'emailMembershipPaymentLink')({ membershipId: m.id });
        showToast(`Payment link emailed to ${client.email}`);
      } else {
        // No email on file — copy URL to clipboard for manual share. Fall
        // back to a prompt() if clipboard API is blocked (Safari with
        // permissions disabled, http context, etc).
        let copied = false;
        try {
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url);
            copied = true;
          }
        } catch {}
        if (copied) {
          showToast('No email on file — link copied to clipboard', 4000);
        } else {
          // Visible prompt the user can manually copy from
          window.prompt('Copy this payment link and share it with the client:', url);
        }
      }
    } catch (e) {
      showToast(`Could not send link: ${e.message || 'unknown'}`, 4500);
    } finally {
      setBusyMember(null);
    }
  }

  async function openBillingPortal(m) {
    setBusyMember({ id: m.id, action: 'portal' });
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      const res = await httpsCallable(functions, 'createMembershipPortal')({ membershipId: m.id });
      const url = res?.data?.url;
      if (!url) throw new Error('No portal URL');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      showToast(`Portal failed: ${e.message || 'unknown'}`, 4500);
    } finally {
      setBusyMember(null);
    }
  }

  // Actually cancel the client's Stripe subscription (stops recurring billing).
  // Distinct from Edit→Cancelled, which only changed the local status and left
  // Stripe charging. The onSnapshot listener reflects the status flip live.
  async function cancelSub(m) {
    if (!window.confirm(`Cancel ${m.clientName}'s ${m.planName} subscription?\n\nThis stops their recurring Stripe charge immediately.`)) return;
    setBusyMember({ id: m.id, action: 'cancelSub' });
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions } = await import('../../lib/firebase');
      await httpsCallable(functions, 'cancelMembership')({ membershipId: m.id });
      showToast('Subscription cancelled');
    } catch (e) {
      showToast(`Cancel failed: ${e.message || 'unknown'}`, 4500);
    } finally {
      setBusyMember(null);
    }
  }
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {['active', 'paused', 'cancelled', 'all'].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ padding: '5px 12px', fontFamily: 'inherit', fontSize: 12, borderRadius: 8, border: filter === f ? '1px solid #6a4fa0' : '1px solid var(--pn-border-strong)', background: filter === f ? '#f3eafc' : 'var(--pn-surface)', color: filter === f ? '#6a4fa0' : 'var(--pn-text-muted)', cursor: 'pointer', fontWeight: filter === f ? 600 : 400 }}>
              {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({filter === f ? filtered.length : members.filter(m => f === 'all' || m.status === f).length})
            </button>
          ))}
        </div>
        <button onClick={onNew} disabled={plans.length === 0} style={{ ...primaryBtn, opacity: plans.length === 0 ? .5 : 1 }}>
          + Add member
        </button>
      </div>

      {plans.length === 0 ? (
        <Empty>Create a plan first before adding members.</Empty>
      ) : filtered.length === 0 ? (
        <Empty>No {filter === 'all' ? '' : filter} members yet.</Empty>
      ) : (
        <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--pn-bg)', borderBottom: '1px solid var(--pn-border)' }}>
                <th style={th}>Client</th>
                <th style={th}>Plan</th>
                <th style={th}>Price</th>
                <th style={th}>Status</th>
                <th style={th}>Started</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const statusColor = m.status === 'active' ? 'var(--pn-success)' : m.status === 'paused' ? 'var(--pn-warning)' : 'var(--pn-text-muted)';
                const statusBg    = m.status === 'active' ? 'var(--pn-success-bg)' : m.status === 'paused' ? 'var(--pn-warning-bg)' : 'var(--pn-surface-alt)';
                const hasStripe = !!m.stripeSubscriptionId;
                const linkSent  = !!m.paymentLinkSentAt;
                const busyAction = busyMember?.id === m.id ? busyMember.action : null;
                return (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--pn-border)' }}>
                    <td style={td}>
                      <div style={{ fontWeight: 600 }}>
                        {m.clientName}
                        {hasStripe && <span title="Stripe subscription active" style={{ marginLeft: 6, fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#635bff', color: '#fff', fontWeight: 700, letterSpacing: '.04em', verticalAlign: 'middle' }}>STRIPE</span>}
                        {!hasStripe && linkSent && <span title="Payment link sent — awaiting checkout" style={{ marginLeft: 6, fontSize: 9, padding: '2px 5px', borderRadius: 3, background: '#fde68a', color: '#92400e', fontWeight: 700, letterSpacing: '.04em', verticalAlign: 'middle' }}>SENT</span>}
                      </div>
                    </td>
                    <td style={td}>{m.planName}</td>
                    <td style={td}>${m.price}/{m.billingPeriod === 'yearly' ? 'yr' : 'mo'}</td>
                    <td style={td}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: statusBg, color: statusColor, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                        {m.status}
                      </span>
                    </td>
                    <td style={td}>{m.startedAt ? new Date(m.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {hasStripe ? (
                        <>
                          <button onClick={() => openBillingPortal(m)} disabled={busyAction === 'portal'}
                            title="Open Stripe Customer Portal in new tab"
                            style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginRight: 4 }}>
                            {busyAction === 'portal' ? '…' : '💳 Portal'}
                          </button>
                          {m.status !== 'cancelled' && (
                            <button onClick={() => cancelSub(m)} disabled={busyAction === 'cancelSub'}
                              title="Cancel this client's Stripe subscription (stops recurring billing)"
                              style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginRight: 4, color: '#ef4444', borderColor: '#fca5a5' }}>
                              {busyAction === 'cancelSub' ? '…' : 'Cancel sub'}
                            </button>
                          )}
                        </>
                      ) : (
                        <button onClick={() => sendPaymentLink(m)} disabled={busyAction === 'sendLink'}
                          title="Generate a Stripe Checkout link and email it to the client"
                          style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginRight: 4, color: '#6a4fa0', borderColor: '#d8d0e8', background: '#f3eafc' }}>
                          {busyAction === 'sendLink' ? '…' : (linkSent ? '↻ Resend' : '💳 Send link')}
                        </button>
                      )}
                      <button onClick={() => onEdit(m)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11 }}>Edit</button>
                      <button onClick={() => onDelete(m)} style={{ ...secondaryBtn, padding: '4px 10px', fontSize: 11, marginLeft: 4, color: '#ef4444', borderColor: '#fca5a5' }}>×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PlanEditor({ plan, onSave, onClose }) {
  const isNew = !plan;
  const [name, setName]                 = useState(plan?.name || '');
  const [description, setDescription]   = useState(plan?.description || '');
  const [price, setPrice]               = useState(plan?.price ?? 80);
  const [billingPeriod, setBillingPeriod] = useState(plan?.billingPeriod || 'monthly');
  const [discountPct, setDiscountPct]   = useState(plan?.discountPct ?? 10);
  const [perksText, setPerksText]       = useState((plan?.perks || []).join('\n'));
  const [active, setActive]             = useState(plan?.active !== false);
  const [saving, setSaving]             = useState(false);
  const [err, setErr]                   = useState('');

  async function submit() {
    setErr('');
    if (!name.trim()) { setErr('Name required'); return; }
    if (Number(price) < 0) { setErr('Price must be ≥ 0'); return; }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim(),
        price: Number(price),
        billingPeriod,
        discountPct: Number(discountPct) || 0,
        perks: perksText.split('\n').map(s => s.trim()).filter(Boolean),
        active,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? 'New plan' : 'Edit plan'} onClose={onClose}>
      <Field label="Plan name">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Manicure Club" style={inp} />
      </Field>
      <Field label="Description (optional)">
        <input value={description} onChange={e => setDescription(e.target.value)} placeholder="One-line tagline" style={inp} />
      </Field>
      <div style={{ display: 'flex', gap: 10 }}>
        <Field label="Price" style={{ flex: 1 }}>
          <input type="number" min={0} step={1} value={price} onChange={e => setPrice(e.target.value)} style={inp} />
        </Field>
        <Field label="Billed" style={{ flex: 1 }}>
          <select value={billingPeriod} onChange={e => setBillingPeriod(e.target.value)} style={inp}>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        <Field label="Discount %" style={{ flex: 1 }}>
          <input type="number" min={0} max={100} step={1} value={discountPct} onChange={e => setDiscountPct(e.target.value)} style={inp} />
        </Field>
      </div>
      <Field label="Perks (one per line)">
        <textarea rows={4} value={perksText} onChange={e => setPerksText(e.target.value)}
          placeholder="1 gel manicure per month&#10;Priority booking&#10;10% off retail"
          style={{ ...inp, resize: 'vertical' }} />
      </Field>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '8px 0', cursor: 'pointer' }}>
        <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} />
        <span>Active <span style={{ color: 'var(--pn-text-muted)', fontSize: 11 }}>(uncheck to retire without deleting)</span></span>
      </label>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <ModalFooter onCancel={onClose} onSave={submit} saving={saving} />
    </Modal>
  );
}

function MemberEditor({ member, plans, clients, existingMembers, onSave, onClose }) {
  const isNew = !member;
  const [clientId, setClientId]   = useState(member?.clientId || '');
  const [planId, setPlanId]       = useState(member?.planId || '');
  const [status, setStatus]       = useState(member?.status || 'active');
  const [notes, setNotes]         = useState(member?.notes || '');
  const [saving, setSaving]       = useState(false);
  const [err, setErr]             = useState('');

  const activePlans = plans.filter(p => p.active !== false || p.id === member?.planId);
  const otherActiveMember = !isNew ? null : existingMembers.find(m => m.clientId === clientId && m.status === 'active');

  async function submit() {
    setErr('');
    if (!clientId) { setErr('Pick a client'); return; }
    if (!planId)   { setErr('Pick a plan'); return; }
    if (otherActiveMember) { setErr(`${otherActiveMember.clientName} is already on the "${otherActiveMember.planName}" plan. Cancel that first.`); return; }
    const client = clients.find(c => c.id === clientId);
    const plan   = plans.find(p => p.id === planId);
    if (!client || !plan) { setErr('Could not resolve client or plan'); return; }
    setSaving(true);
    try {
      await onSave({
        clientId,
        clientName: client.name,
        planId,
        planName: plan.name,
        price: plan.price,
        billingPeriod: plan.billingPeriod,
        discountPct: plan.discountPct,
        status,
        notes: notes.trim() || null,
        startedAt: member?.startedAt || new Date().toISOString(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={isNew ? 'Add member' : 'Edit member'} onClose={onClose}>
      <Field label="Client">
        {isNew ? (
          <select value={clientId} onChange={e => setClientId(e.target.value)} style={inp}>
            <option value="">Pick a client…</option>
            {clients.sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(c => (
              <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
            ))}
          </select>
        ) : (
          <div style={{ ...inp, background: 'var(--pn-surface-alt)' }}>{member.clientName}</div>
        )}
      </Field>
      <Field label="Plan">
        <select value={planId} onChange={e => setPlanId(e.target.value)} style={inp}>
          <option value="">Pick a plan…</option>
          {activePlans.map(p => (
            <option key={p.id} value={p.id}>{p.name} — ${p.price}/{p.billingPeriod === 'yearly' ? 'yr' : 'mo'}</option>
          ))}
        </select>
      </Field>
      {!isNew && (
        <Field label="Status">
          <select value={status} onChange={e => setStatus(e.target.value)} style={inp}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="cancelled">Cancelled</option>
            <option value="past_due">Past due</option>
          </select>
        </Field>
      )}
      <Field label="Notes (optional)">
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          placeholder="Anything to remember about this member's plan"
          style={{ ...inp, resize: 'vertical' }} />
      </Field>
      {err && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <ModalFooter onCancel={onClose} onSave={submit} saving={saving} />
    </Modal>
  );
}

// ── Reusable bits ────────────────────────────────────
function Stat({ label, value, sub, accent }) {
  return (
    <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: 14, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: accent }} />
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: accent, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Empty({ children }) {
  return <div style={{ background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12, padding: '40px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>{children}</div>;
}

function Modal({ title, children, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--pn-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <div style={{ padding: 20 }}>{children}</div>
      </div>
    </div>
  );
}
function ModalFooter({ onCancel, onSave, saving }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
      <button onClick={onSave} disabled={saving} style={{ ...primaryBtn, flex: 2, padding: '10px 14px' }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button onClick={onCancel} disabled={saving} style={{ ...secondaryBtn, flex: 1, padding: '10px 14px' }}>Cancel</button>
    </div>
  );
}
function Field({ label, children, style }) {
  return (
    <div style={{ marginBottom: 12, ...style }}>
      <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  );
}

const inp = {
  width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '8px 10px',
  borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', boxSizing: 'border-box',
};
const primaryBtn = {
  padding: '8px 16px', borderRadius: 10, border: 'none', background: '#6a4fa0',
  color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const secondaryBtn = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)',
  color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
};
const th = { textAlign: 'left', padding: '10px 14px', fontSize: 11, color: 'var(--pn-text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 };
const td = { padding: '10px 14px', fontSize: 13, color: 'var(--pn-text)' };
