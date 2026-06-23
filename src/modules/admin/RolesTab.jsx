import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  ROLES, ROLE_LABELS, ROLE_DESCRIPTIONS, CAP_GROUPS, OWNER_ONLY,
  resolveRoleCaps, normalizeRole,
} from '../../lib/rbac';
import { saveCustomRoles } from '../../lib/customRoles';

// Owner-facing Roles & Permissions manager. Built-in roles can have their
// permissions tweaked (stored as an override); custom roles are full CRUD.
// Owner + Kiosk are locked. Everything the owner toggles is a plain-language
// capability; the server (saveCustomRoles) validates + protects Owner.

const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
const ROLE_ICON = { owner: '👑', manager: '🧑‍💼', staff: '💅', scheduler: '🗒️', kiosk: '🖥️', readonly: '👁️' };

export default function RolesTab() {
  const { customRoles, users, showToast, grantAccess } = useApp();
  const [roles, setRoles]         = useState([]);    // custom roles draft
  const [overrides, setOverrides] = useState({});    // built-in overrides draft
  const [editing, setEditing]     = useState(null);  // null | { key, mode, label, description, caps:[], baseLabel? }
  const [confirmDelete, setConfirmDelete] = useState(null); // null | { key, label, reassignTo }
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Hydrate the draft from the live overlay (unless mid-edit).
  useEffect(() => {
    if (!customRoles || editing || confirmDelete) return;
    setRoles(customRoles.roles || []);
    setOverrides(customRoles.overrides || {});
  }, [customRoles]); // eslint-disable-line

  const overlay = useMemo(() => ({ roles, overrides }), [roles, overrides]);
  const capLabel = useMemo(() => {
    const m = {};
    CAP_GROUPS.forEach(g => g.caps.forEach(c => { m[c.cap] = c.label; }));
    return m;
  }, []);

  // How many people currently hold a role (built-in: alias-aware; custom: by key).
  function roleCount(key, builtIn) {
    return (users || []).filter(u => {
      if (!u || !u.email) return false;
      return builtIn ? normalizeRole(u.role) === key : u.role === key;
    }).length;
  }
  function effectiveCaps(key) { return resolveRoleCaps(key, overlay); }

  async function persist(nextRoles, nextOverrides, okMsg) {
    setSaving(true); setMsg('');
    try {
      const res = await saveCustomRoles({ roles: nextRoles, overrides: nextOverrides });
      setRoles((res && res.roles) || nextRoles);
      setOverrides((res && res.overrides) || nextOverrides);
      setMsg(okMsg || 'Saved ✓');
      setTimeout(() => setMsg(''), 2500);
      return true;
    } catch (e) {
      setMsg(e?.message || 'Save failed.');
      return false;
    } finally { setSaving(false); }
  }

  // ── editor open helpers ──
  function editBuiltIn(key) {
    setEditing({ key, mode: 'builtin', label: ROLE_LABELS[key], description: ROLE_DESCRIPTIONS[key], caps: effectiveCaps(key).slice() });
  }
  function editCustom(r) {
    setEditing({ key: r.key, mode: 'custom', label: r.label, description: r.description || '', caps: (r.caps || []).slice() });
  }
  function newRole(fromKey) {
    const seed = fromKey ? effectiveCaps(fromKey).slice() : [];
    setEditing({ key: '', mode: 'new', label: '', description: '', caps: seed, baseLabel: fromKey ? ROLE_LABELS[fromKey] : null });
  }
  function duplicateCustom(r) {
    setEditing({ key: '', mode: 'new', label: `${r.label} copy`, description: r.description || '', caps: (r.caps || []).slice() });
  }
  function toggleCap(cap) {
    setEditing(e => {
      const has = e.caps.includes(cap);
      return { ...e, caps: has ? e.caps.filter(c => c !== cap) : [...e.caps, cap] };
    });
  }

  async function saveEditor() {
    const e = editing;
    // A role with no permissions would lock its holders out of the app.
    if (e.caps.length === 0) { setMsg('Turn on at least one permission — a role with none can’t sign in.'); return; }
    if (e.mode === 'builtin') {
      const next = { ...overrides, [e.key]: { caps: e.caps } };
      if (await persist(roles, next, `${e.label} permissions saved`)) setEditing(null);
      return;
    }
    const label = e.label.trim();
    if (!label) { setMsg('Give the role a name.'); return; }
    const key = e.key || ('custom_' + slugify(label));
    let nextRoles;
    if (e.mode === 'custom') {
      nextRoles = roles.map(r => r.key === e.key ? { ...r, label, description: e.description.trim(), caps: e.caps } : r);
    } else {
      if (roles.some(r => r.key === key)) { setMsg('A role with that name already exists.'); return; }
      nextRoles = [...roles, { key, label, description: e.description.trim(), caps: e.caps }];
    }
    if (await persist(nextRoles, overrides, `${label} saved`)) setEditing(null);
  }

  async function resetBuiltIn(key) {
    const next = { ...overrides };
    delete next[key];
    await persist(roles, next, `${ROLE_LABELS[key]} reset to default`);
  }

  function startDelete(r) {
    const count = roleCount(r.key, false);
    setConfirmDelete({ key: r.key, label: r.label, count, reassignTo: 'staff' });
  }
  async function doDelete() {
    const { key, count, reassignTo } = confirmDelete;
    // Reassign anyone holding this role first, so nobody is orphaned.
    if (count > 0) {
      const holders = (users || []).filter(u => u && u.email && u.role === key);
      for (const u of holders) {
        try { await grantAccess(u.email, reassignTo, u.techName || null); } catch { /* surfaced below */ }
      }
    }
    const nextRoles = roles.filter(r => r.key !== key);
    if (await persist(nextRoles, overrides, 'Role deleted')) setConfirmDelete(null);
  }

  if (customRoles === null) return <div style={{ padding: 20, color: 'var(--pn-text-muted)' }}>Loading roles…</div>;

  // assignable targets for reassign-on-delete (built-ins + other customs)
  const reassignOptions = [
    ...ROLES.filter(k => k !== 'owner' && k !== 'kiosk').map(k => ({ value: k, label: ROLE_LABELS[k] })),
    ...roles.filter(r => r.key !== confirmDelete?.key).map(r => ({ value: r.key, label: r.label })),
  ];

  return (
    <div data-anchor="roles" style={{ padding: '4px 2px' }}>
      <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', lineHeight: 1.5, marginBottom: 16 }}>
        Roles decide what each team member can see and do. <strong>Owner</strong> always has full access and can't be changed.
        Tweak a built-in role, or create your own — assign roles to people under <strong>Users</strong>.
      </div>

      {/* Built-in roles */}
      <div style={sectionLabel}>Built-in roles</div>
      {ROLES.map(key => {
        const locked = key === 'owner' || key === 'kiosk';
        const overridden = !!overrides[key];
        const count = roleCount(key, true);
        return (
          <RoleCard key={key} icon={ROLE_ICON[key]} title={ROLE_LABELS[key]} desc={ROLE_DESCRIPTIONS[key]}
            count={count} badge={key === 'owner' ? 'Full access' : key === 'kiosk' ? 'Locked' : (overridden ? 'Customized' : null)}>
            {!locked && (
              <>
                <CardBtn onClick={() => editBuiltIn(key)}>Edit permissions</CardBtn>
                {overridden && <CardBtn subtle onClick={() => resetBuiltIn(key)}>Reset to default</CardBtn>}
              </>
            )}
          </RoleCard>
        );
      })}

      {/* Custom roles */}
      <div style={{ ...sectionLabel, marginTop: 18, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Your custom roles</span>
        <button onClick={() => newRole(null)} style={addBtn}>+ New role</button>
      </div>
      {roles.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--pn-text-faint)', padding: '10px 4px 4px' }}>
          No custom roles yet. Create one for a specific job — e.g. a “Senior Stylist” who can also see reports, or a
          “Shift Lead” who can run checkout and refunds. Tip: start from a built-in role to save time.
        </div>
      ) : roles.map(r => (
        <RoleCard key={r.key} icon="⭐" title={r.label} desc={r.description || capsSummary(r.caps, capLabel)}
          count={roleCount(r.key, false)}>
          <CardBtn onClick={() => editCustom(r)}>Edit</CardBtn>
          <CardBtn subtle onClick={() => duplicateCustom(r)}>Duplicate</CardBtn>
          <CardBtn danger onClick={() => startDelete(r)}>Delete</CardBtn>
        </RoleCard>
      ))}

      {!!msg && <div style={{ marginTop: 12, fontSize: 13, color: msg.includes('✓') || msg.includes('saved') || msg.includes('deleted') || msg.includes('reset') ? '#16a34a' : 'var(--pn-danger, #dc2626)' }}>{msg}</div>}

      {/* Editor */}
      {editing && (
        <Editor editing={editing} setEditing={setEditing} toggleCap={toggleCap} onSave={saveEditor}
          saving={saving} capLabel={capLabel} onNewFrom={newRole} />
      )}

      {/* Delete confirm / reassign */}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} title={`Delete “${confirmDelete.label}”?`}>
          {confirmDelete.count > 0 ? (
            <>
              <p style={modalText}><strong>{confirmDelete.count}</strong> {confirmDelete.count === 1 ? 'person has' : 'people have'} this role. Move them to another role first:</p>
              <select value={confirmDelete.reassignTo} onChange={e => setConfirmDelete(c => ({ ...c, reassignTo: e.target.value }))} style={selStyle}>
                {reassignOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </>
          ) : (
            <p style={modalText}>No one has this role. This can't be undone.</p>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
            <button onClick={() => setConfirmDelete(null)} style={btnGhost}>Cancel</button>
            <button onClick={doDelete} disabled={saving} style={{ ...btnSolid, background: 'var(--pn-danger, #dc2626)' }}>
              {saving ? 'Working…' : (confirmDelete.count > 0 ? 'Reassign & delete' : 'Delete role')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function capsSummary(caps, capLabel) {
  const names = (caps || []).map(c => capLabel[c]).filter(Boolean);
  if (!names.length) return 'No access yet — add permissions.';
  return 'Can: ' + names.slice(0, 4).join(', ') + (names.length > 4 ? `, +${names.length - 4} more` : '');
}

function RoleCard({ icon, title, desc, count, badge, children }) {
  return (
    <div style={{ border: '1px solid var(--pn-border)', borderRadius: 12, padding: '12px 14px', marginBottom: 8, background: 'var(--pn-surface)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontSize: 22, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--pn-text)' }}>{title}</span>
          {badge && <span style={{ fontSize: 10, fontWeight: 700, color: '#3D95CE', background: 'var(--pn-info-bg)', border: '1px solid #bfdbfe', borderRadius: 20, padding: '1px 8px' }}>{badge}</span>}
          <span style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>{count} {count === 1 ? 'person' : 'people'}</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{children}</div>
    </div>
  );
}

function CardBtn({ children, onClick, subtle, danger }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 8, padding: '6px 10px',
      border: `1px solid ${danger ? '#fca5a5' : subtle ? 'var(--pn-border)' : 'var(--pn-border-strong)'}`,
      background: danger ? 'var(--pn-danger-bg)' : 'var(--pn-bg)',
      color: danger ? 'var(--pn-danger, #dc2626)' : subtle ? 'var(--pn-text-muted)' : 'var(--pn-text)',
    }}>{children}</button>
  );
}

function Editor({ editing, setEditing, toggleCap, onSave, saving, capLabel, onNewFrom }) {
  const isBuiltIn = editing.mode === 'builtin';
  const capSet = new Set(editing.caps);
  return (
    <Modal onClose={() => setEditing(null)} title={editing.mode === 'new' ? 'New role' : `Edit ${editing.label || 'role'}`} wide>
      {isBuiltIn ? (
        <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginBottom: 12 }}>
          Choose what the built-in <strong>{editing.label}</strong> role can do. This only changes this salon.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          <input value={editing.label} onChange={e => setEditing(s => ({ ...s, label: e.target.value }))}
            placeholder="Role name (e.g. Senior Stylist)" autoFocus
            style={{ ...inpStyle, fontSize: 14, fontWeight: 600 }} />
          <input value={editing.description} onChange={e => setEditing(s => ({ ...s, description: e.target.value }))}
            placeholder="Short description (optional)" style={inpStyle} />
          {editing.mode === 'new' && (
            <div style={{ fontSize: 11, color: 'var(--pn-text-faint)' }}>
              Start from a built-in role:&nbsp;
              {['manager', 'scheduler', 'staff'].map(k => (
                <button key={k} onClick={() => onNewFrom(k)} style={{ fontSize: 11, color: '#3D95CE', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', padding: '0 4px' }}>
                  {ROLE_LABELS[k]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {CAP_GROUPS.filter(g => !g.danger).map(group => (
        <div key={group.title} style={{ marginBottom: 12, border: '1px solid var(--pn-border)', borderRadius: 10, padding: '8px 12px', background: 'var(--pn-bg)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--pn-text-muted)', marginBottom: 6 }}>
            {group.title}
          </div>
          {group.caps.map(({ cap, label }) => (
            <label key={cap} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0', cursor: 'pointer', fontSize: 13, color: 'var(--pn-text)' }}>
              <Switch on={capSet.has(cap)} onClick={() => toggleCap(cap)} />
              <span>{label}</span>
            </label>
          ))}
        </div>
      ))}
      {/* Owner-only caps (payroll, settings, users, billing) are NOT delegatable
          — they stay with the Owner role. Shown locked for clarity. */}
      <div style={{ marginBottom: 12, border: '1px dashed var(--pn-border)', borderRadius: 10, padding: '8px 12px', background: 'var(--pn-bg)', opacity: .75 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--pn-text-faint)', marginBottom: 4 }}>
          🔒 Owner-only — payroll, settings, users & billing
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--pn-text-muted)', lineHeight: 1.45 }}>
          These always stay with the <strong>Owner</strong> role and can't be given to other roles. To give someone full
          access, set their role to <strong>Owner</strong> on the Users tab.
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--pn-text-faint)', marginBottom: 12, lineHeight: 1.5 }}>
        {capsSummary(editing.caps, capLabel)}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button onClick={() => setEditing(null)} style={btnGhost}>Cancel</button>
        <button onClick={onSave} disabled={saving} style={btnSolid}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </Modal>
  );
}

function Switch({ on, onClick, danger }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      width: 40, height: 23, borderRadius: 12, border: 'none', flexShrink: 0, cursor: 'pointer', position: 'relative',
      background: on ? (danger ? 'var(--pn-danger, #dc2626)' : '#2D7A5F') : 'var(--pn-border-strong)', transition: 'background .15s',
    }}>
      <span style={{ position: 'absolute', top: 2, left: on ? 19 : 2, width: 19, height: 19, borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
    </button>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'var(--pn-surface)', borderRadius: 16, width: '94%', maxWidth: wide ? 560 : 420, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.3)', padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--pn-text)' }}>{title}</span>
          <button onClick={onClose} style={{ width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const sectionLabel = { fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--pn-text-faint)', margin: '4px 0 8px' };
const addBtn   = { fontSize: 12, fontWeight: 700, color: '#fff', background: '#2D7A5F', border: 'none', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit' };
const inpStyle = { fontFamily: 'inherit', fontSize: 13, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--pn-border)', background: 'var(--pn-bg)', color: 'var(--pn-text)', width: '100%', boxSizing: 'border-box' };
const selStyle = { ...inpStyle, marginTop: 8 };
const modalText = { fontSize: 13, color: 'var(--pn-text)', lineHeight: 1.5, margin: 0 };
const btnGhost = { fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 9, padding: '9px 16px', border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)' };
const btnSolid = { fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 9, padding: '9px 18px', border: 'none', background: '#2D7A5F', color: '#fff' };
