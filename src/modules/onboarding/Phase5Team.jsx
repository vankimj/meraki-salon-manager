import { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { fetchEmployees, createEmployee } from '../../lib/firestore';
import { DEFAULT_LOCATION_ID } from '../../lib/locations';
import { logActivity, logError } from '../../lib/logger';

// Phase 5 (UI step 6 of 8) — Your team.
//
// Lists existing employees (already imported or already added), lets the
// owner add more inline, and sends invite emails to anyone without one.
// Each tech becomes a user the next time they sign in with the matching
// Google account or magic-link email.
//
// Sprint 1 keeps it single-location: every new tech defaults to
// locationIds: [DEFAULT_LOCATION_ID]. Multi-location picker lands in
// Sprint 6 alongside the rest of the location switcher UX.

export default function Phase5Team({ onboarding, onAdvance, saving }) {
  const { showToast } = useApp();
  const [employees, setEmployees] = useState([]);
  const [loading,   setLoading]   = useState(true);

  // Inline-add form
  const [newName,  setNewName]   = useState('');
  const [newEmail, setNewEmail]  = useState('');
  const [newPhone, setNewPhone]  = useState('');
  const [adding,   setAdding]    = useState(false);

  // Invite-sending state
  const [selected,    setSelected]    = useState(new Set());
  const [sendingAll,  setSendingAll]  = useState(false);
  const [sendCount,   setSendCount]   = useState(0);
  const [err,         setErr]         = useState('');

  async function refresh() {
    try {
      const list = await fetchEmployees();
      setEmployees(list);
      // Pre-select anyone with an email but no invite sent
      const ready = new Set(
        list.filter(e => e.email && !e.inviteSentAt && e.active !== false).map(e => e.id)
      );
      setSelected(ready);
    } catch (e) {
      logError('onboarding_team_fetch', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function addTech(e) {
    e?.preventDefault?.();
    const name  = newName.trim();
    const email = newEmail.trim();
    const phone = newPhone.trim();
    if (!name) { setErr('Name required'); return; }
    setErr('');
    setAdding(true);
    try {
      await createEmployee({
        name, email, phone,
        active: true,
        locationIds:       [DEFAULT_LOCATION_ID],
        primaryLocationId: DEFAULT_LOCATION_ID,
        sortOrder: employees.length,
      });
      logActivity('onboarding_team_added', `${name}${email ? ` <${email}>` : ''}`);
      setNewName(''); setNewEmail(''); setNewPhone('');
      await refresh();
    } catch (ex) {
      setErr(ex?.message || String(ex));
      logError('onboarding_team_add', ex);
    } finally {
      setAdding(false);
    }
  }

  async function sendInvites() {
    setErr('');
    const targets = employees.filter(e => selected.has(e.id) && e.email && !e.inviteSentAt);
    if (targets.length === 0) {
      showToast('Nothing to send — pick at least one tech with an email', 3500);
      return;
    }
    if (!confirm(`Send invite emails to ${targets.length} tech${targets.length === 1 ? '' : 's'}? Each will get a sign-in link.`)) return;

    setSendingAll(true);
    setSendCount(0);
    let succeeded = 0;
    try {
      const { httpsCallable } = await import('firebase/functions');
      const { functions }     = await import('../../lib/firebase');
      const { TENANT_ID }     = await import('../../lib/tenant');
      const invite = httpsCallable(functions, 'emailEmployeeInvite');
      for (const t of targets) {
        try {
          await invite({ tenantId: TENANT_ID, employeeId: t.id });
          succeeded++;
          setSendCount(succeeded);
        } catch (ex) {
          // Continue on per-tech failure (bad email, transient send error)
          logError('onboarding_team_invite', ex, { empId: t.id, email: t.email });
        }
      }
      logActivity('onboarding_team_invites_sent', `${succeeded}/${targets.length} invites`);
      showToast(`Sent ${succeeded} of ${targets.length} invites`);
      await refresh();
    } finally {
      setSendingAll(false);
    }
  }

  function complete({ skip } = {}) {
    if (skip) { onAdvance({ skip: true }); return; }
    const invitedCount = employees.filter(e => e.inviteSentAt).length;
    onAdvance({ phaseData: { techCount: employees.length, invitesSent: invitedCount } });
  }

  if (loading) {
    return <div style={{ padding: 24, color: 'var(--pn-text-muted)', fontSize: 13, textAlign: 'center' }}>Loading team…</div>;
  }

  return (
    <div>
      <div style={{ fontSize: 14, color: 'var(--pn-text-muted)', lineHeight: 1.55, marginBottom: 18 }}>
        Your team accesses Plume Nexus with their own account. Add each tech below, then
        send invites — they'll receive a sign-in email with a link to their schedule.
      </div>

      <Section title={`Your team (${employees.length})`}>
        {employees.length === 0 ? (
          <div style={{ padding: 14, borderRadius: 8, background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>
            No techs yet. Add your first one below — you can always invite more later.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto', border: '1px solid var(--pn-border)', borderRadius: 8 }}>
            {employees.map(e => (
              <TechRow
                key={e.id}
                emp={e}
                checked={selected.has(e.id)}
                onToggle={() => toggleSelect(e.id)}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Add a tech">
        <form onSubmit={addTech} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.5fr 1fr auto', gap: 6 }}>
          <input value={newName}  onChange={e => setNewName(e.target.value)}  placeholder="Name *"           style={inp} />
          <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="Email (for invite)" style={inp} />
          <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="Phone (optional)"   style={inp} />
          <button type="submit" disabled={adding || !newName.trim()} style={btnPrimary}>
            {adding ? 'Adding…' : '+ Add'}
          </button>
        </form>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)', marginTop: 6 }}>
          Photos, services, schedule, and compensation can be set later from Admin → Employees.
        </div>
      </Section>

      <Section title="Send invites">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={sendInvites} disabled={sendingAll || selected.size === 0} style={btnPrimary}>
            {sendingAll ? `Sending ${sendCount}/${selected.size}…` : `Send invites (${selected.size} selected)`}
          </button>
          <span style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
            Already-invited techs are unselected by default.
          </span>
        </div>
      </Section>

      {err && (
        <div style={{ padding: 10, background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, color: '#7f1d1d', fontSize: 12, marginBottom: 12 }}>{err}</div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button onClick={() => complete({ skip: true })} disabled={saving} style={btnSecondary}>Skip for now</button>
        <button onClick={() => complete()} disabled={saving} style={btnPrimary}>
          {saving ? 'Saving…' : 'Save & continue →'}
        </button>
      </div>
    </div>
  );
}

function TechRow({ emp, checked, onToggle }) {
  const invited = Boolean(emp.inviteSentAt);
  const hasEmail = Boolean(emp.email);
  return (
    <label style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px',
      borderBottom: '1px solid var(--pn-border)',
      cursor: hasEmail ? 'pointer' : 'default',
      background: 'var(--pn-surface)',
      opacity: hasEmail ? 1 : 0.6,
    }}>
      <input type="checkbox" checked={checked} disabled={!hasEmail || invited}
        onChange={onToggle} style={{ accentColor: '#5b3b8c' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pn-text)' }}>{emp.name}</div>
        <div style={{ fontSize: 11, color: 'var(--pn-text-muted)' }}>
          {emp.email || <em style={{ color: '#b91c1c' }}>no email — can't invite</em>}
        </div>
      </div>
      {invited && (
        <span style={{ fontSize: 10, fontWeight: 700, color: '#065f46', background: '#d1fae5', padding: '3px 8px', borderRadius: 10, letterSpacing: '.04em' }}>
          ✓ Invited
        </span>
      )}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#5b3b8c', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      <div>{children}</div>
    </div>
  );
}

const inp = { boxSizing: 'border-box', width: '100%', padding: '7px 10px', fontSize: 13, border: '1px solid var(--pn-border-strong)', borderRadius: 8, fontFamily: 'inherit', outline: 'none', background: 'var(--pn-surface)' };
const btnPrimary   = { padding: '9px 16px', fontSize: 13, fontWeight: 700, borderRadius: 8, border: 'none', background: '#5b3b8c', color: '#fff', cursor: 'pointer', fontFamily: 'inherit' };
const btnSecondary = { padding: '9px 14px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', cursor: 'pointer', fontFamily: 'inherit' };
