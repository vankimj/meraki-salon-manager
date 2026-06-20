import { useState, useEffect, useMemo, useRef } from 'react';
import { subscribeClientProgress, addProgressEntry, deleteProgressEntry } from '../../lib/firestore';
import { resizeImg } from '../../utils/helpers';
import { logActivity } from '../../lib/logger';
import { useApp } from '../../context/AppContext';
import TrendChart from '../../components/TrendChart';

const MEASURE_FIELDS = [
  { key: 'weight',  label: 'Weight',   unit: 'lb', color: '#6a4fa0' },
  { key: 'bodyFat', label: 'Body fat', unit: '%',  color: '#3D95CE' },
  { key: 'waist',   label: 'Waist',    unit: 'in', color: '#2a9d8f' },
  { key: 'chest',   label: 'Chest',    unit: 'in', color: '#c19a4a' },
];

function blankEntry() {
  return { date: new Date().toISOString().slice(0, 10), weight: '', bodyFat: '', waist: '', chest: '', hips: '', arms: '', thighs: '', prExercise: '', prValue: '', notes: '', photo: '' };
}
const num = (v) => (v === '' || v == null ? null : Number(v));

export default function ProgressTab({ clientId, isView }) {
  const { showToast } = useApp();
  const [entries, setEntries] = useState([]);
  const [adding, setAdding]   = useState(false);
  const [form, setForm]       = useState(blankEntry());
  const [saving, setSaving]   = useState(false);
  const fileRef = useRef(null);

  useEffect(() => subscribeClientProgress(clientId, setEntries), [clientId]);

  const charts = useMemo(() => MEASURE_FIELDS.map(f => ({
    ...f,
    points: entries.map(e => ({ x: (e.date || '').slice(5), y: num(e[f.key]) })).filter(p => p.y != null),
  })), [entries]);

  async function pickPhoto(file) {
    if (!file) return;
    try {
      const dataUrl = await resizeImg(file, 600, 600, 0.8);
      setForm(f => ({ ...f, photo: dataUrl }));
    } catch { showToast('Could not load photo'); }
  }

  async function save() {
    if (!form.date) { showToast('Pick a date'); return; }
    setSaving(true);
    try {
      const prs = (form.prExercise && form.prValue) ? [{ exercise: form.prExercise.trim(), value: form.prValue.trim() }] : [];
      await addProgressEntry(clientId, {
        date: form.date,
        weight: num(form.weight), bodyFat: num(form.bodyFat),
        waist: num(form.waist), chest: num(form.chest), hips: num(form.hips), arms: num(form.arms), thighs: num(form.thighs),
        prs, notes: form.notes.trim(), photo: form.photo || '',
      });
      logActivity('progress_entry_added', `client ${clientId} — ${form.date}`);
      showToast('Progress logged');
      setForm(blankEntry()); setAdding(false);
    } catch (e) { showToast(`Save failed: ${e.message}`, 4000); }
    finally { setSaving(false); }
  }

  return (
    <div>
      {/* Charts */}
      {entries.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 18 }}>
          {charts.map(c => c.points.length > 0 && (
            <div key={c.key} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: 12 }}>
              <TrendChart points={c.points} color={c.color} unit={c.unit} label={c.label} />
            </div>
          ))}
        </div>
      )}

      {!isView && (
        adding ? (
          <div style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <L label="Date"><input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} style={inp} /></L>
              <L label="Weight (lb)"><input type="number" value={form.weight} onChange={e => setForm(f => ({ ...f, weight: e.target.value }))} style={inp} /></L>
              <L label="Body fat (%)"><input type="number" value={form.bodyFat} onChange={e => setForm(f => ({ ...f, bodyFat: e.target.value }))} style={inp} /></L>
              <L label="Waist (in)"><input type="number" value={form.waist} onChange={e => setForm(f => ({ ...f, waist: e.target.value }))} style={inp} /></L>
              <L label="Chest (in)"><input type="number" value={form.chest} onChange={e => setForm(f => ({ ...f, chest: e.target.value }))} style={inp} /></L>
              <L label="Hips (in)"><input type="number" value={form.hips} onChange={e => setForm(f => ({ ...f, hips: e.target.value }))} style={inp} /></L>
              <L label="Arms (in)"><input type="number" value={form.arms} onChange={e => setForm(f => ({ ...f, arms: e.target.value }))} style={inp} /></L>
              <L label="Thighs (in)"><input type="number" value={form.thighs} onChange={e => setForm(f => ({ ...f, thighs: e.target.value }))} style={inp} /></L>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <L label="PR — exercise"><input value={form.prExercise} onChange={e => setForm(f => ({ ...f, prExercise: e.target.value }))} placeholder="e.g. Back Squat" style={inp} /></L>
              <L label="PR — value"><input value={form.prValue} onChange={e => setForm(f => ({ ...f, prValue: e.target.value }))} placeholder="e.g. 225 lb × 5" style={inp} /></L>
            </div>
            <L label="Notes"><textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} style={{ ...inp, resize: 'vertical' }} /></L>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <button onClick={() => fileRef.current?.click()} style={secondaryBtn}>{form.photo ? 'Change photo' : '+ Photo'}</button>
              {form.photo && <img src={form.photo} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)' }} />}
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => pickPhoto(e.target.files?.[0])} />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={save} disabled={saving} style={{ ...primaryBtn, flex: 2 }}>{saving ? 'Saving…' : 'Log entry'}</button>
              <button onClick={() => { setAdding(false); setForm(blankEntry()); }} disabled={saving} style={{ ...secondaryBtn, flex: 1 }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} style={{ ...primaryBtn, marginBottom: 16 }}>+ Log progress</button>
        )
      )}

      {/* History */}
      {entries.length === 0 ? (
        <div style={{ background: 'var(--pn-bg)', border: '1px dashed var(--pn-border-strong)', borderRadius: 12, padding: '30px 20px', textAlign: 'center', color: 'var(--pn-text-muted)', fontSize: 13 }}>
          No progress logged yet. {!isView && 'Add the first measurement, photo, or PR above.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[...entries].reverse().map(e => (
            <div key={e.id} style={{ background: 'var(--pn-surface)', border: '1px solid var(--pn-border)', borderRadius: 10, padding: 12, display: 'flex', gap: 12 }}>
              {e.photo && <img src={e.photo} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--pn-border)', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{e.date}</span>
                  {!isView && <button onClick={async () => { if (confirm('Delete this entry?')) { await deleteProgressEntry(clientId, e.id); showToast('Deleted'); } }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}>×</button>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 2 }}>
                  {[e.weight != null && `${e.weight} lb`, e.bodyFat != null && `${e.bodyFat}% bf`, e.waist != null && `waist ${e.waist}"`, e.chest != null && `chest ${e.chest}"`].filter(Boolean).join(' · ') || '—'}
                </div>
                {Array.isArray(e.prs) && e.prs.length > 0 && (
                  <div style={{ fontSize: 12, color: '#6a4fa0', marginTop: 3, fontWeight: 600 }}>🏆 {e.prs.map(p => `${p.exercise}: ${p.value}`).join(', ')}</div>
                )}
                {e.notes && <div style={{ fontSize: 12, color: 'var(--pn-text-muted)', marginTop: 3, whiteSpace: 'pre-wrap' }}>{e.notes}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function L({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--pn-text-muted)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      {children}
    </div>
  );
}
const inp = { width: '100%', fontFamily: 'inherit', fontSize: 13, padding: '7px 9px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-bg)', outline: 'none', boxSizing: 'border-box' };
const primaryBtn = { padding: '9px 16px', borderRadius: 10, border: 'none', background: '#6a4fa0', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
const secondaryBtn = { padding: '8px 14px', borderRadius: 8, border: '1px solid var(--pn-border-strong)', background: 'var(--pn-surface)', color: 'var(--pn-text-muted)', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' };
