import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { createClient, saveClient, createAppointment, createReceipt, fetchClients, fetchExistingGgTransactionIds, fetchExistingApptKeys, apptDedupKey } from '../lib/firestore';
import { logActivity } from '../lib/logger';
import {
  parseCsv, detectType,
  mapClientRow, mapAppointmentRow,
  buildReceiptsFromGg, clientKey,
} from '../lib/csvImport';

const TYPE_LABELS = {
  clients:      'Clients',
  appointments: 'Appointments',
  ggPayments:   'Payment Details',
  ggLineItems:  'Checkout Line Items',
  unknown:      'Unknown',
};

const MAX_INLINE_SKIPPED = 50;

// Three-step GG import wizard:
//   Step 1 — Contacts (Clients CSV): imports first so receipts can link to
//            newly-created clients in step 3.
//   Step 2 — Payment Details: file is parsed and staged in-memory only —
//            no DB write here. Stays staged until step 3 joins it.
//   Step 3 — Checkout Line Items: joins with staged payments on Charge ID
//            and writes the resulting receipts in one pass.
// Each step is gated on the previous. Closing the tab mid-flow loses the
// in-memory staged Payment Details; user restarts from step 1. Step 1 is
// idempotent (dedup by name) so re-running it is safe.
export default function CsvImportSection() {
  const { showToast } = useApp();

  // Step 1: Contacts
  const clientsFileRef = useRef(null);
  const [clientsFile,     setClientsFile]     = useState(null); // { fileName, records, mapped, type, headers }
  const [clientsResult,   setClientsResult]   = useState(null); // { imported, skipped, updated }

  // Step 2: Payment Details (staged only, no import action)
  const paymentsFileRef = useRef(null);
  const [paymentsFile,    setPaymentsFile]    = useState(null);

  // Step 3: Checkout Line Items + receipts import
  const lineItemsFileRef = useRef(null);
  const [lineItemsFile,   setLineItemsFile]   = useState(null);
  const [receiptsResult,  setReceiptsResult]  = useState(null);

  // Common
  const [running,  setRunning]  = useState(null); // 'clients' | 'receipts' | null
  const [progress, setProgress] = useState('');
  const [skipped,  setSkipped]  = useState(null);

  async function readAndParse(f) {
    const text = await f.text();
    const { headers, records } = parseCsv(text);
    return { headers, records, fileName: f.name, type: detectType(headers) };
  }

  // ── Step 1: Contacts ─────────────────────────────────────────
  async function onPickClients(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress('Reading Contacts file…');
    try {
      const result = await readAndParse(f);
      if (result.type !== 'clients') {
        showToast(`This file looks like ${TYPE_LABELS[result.type]}, not Clients. Re-upload the GG Clients CSV.`, 5000);
        if (clientsFileRef.current) clientsFileRef.current.value = '';
        setProgress('');
        return;
      }
      const mapped = result.records.map(r => mapClientRow(r)).filter(Boolean);
      setClientsFile({ ...result, mapped });
      setProgress('');
    } catch (e) {
      showToast('Could not parse CSV: ' + e.message, 4000);
      setProgress('');
    }
  }

  async function runImportClients() {
    if (!clientsFile) return;
    if (!window.confirm(`Import ${clientsFile.mapped.length} contacts from ${clientsFile.fileName}?\n\nDuplicates already in the DB (by name) will be detected and skipped. Tagged as imported from GlossGenius.`)) return;

    setRunning('clients');
    setSkipped(null);
    let count = 0;
    let updated = 0;
    const skippedRows = [];
    try {
      setProgress('Loading dedup index…');
      const existingDocs = await fetchClients().catch(() => []);
      const byKey = {};
      existingDocs.forEach(d => { if (d.name) byKey[clientKey(d.name)] = d; });
      for (const c of clientsFile.mapped) {
        const key = clientKey(c.name);
        const ex = key ? byKey[key] : null;
        if (ex) {
          if (c.banned && !ex.banned) {
            await saveClient(ex.id, { banned: true }).catch(() => {});
            updated++;
          }
          skippedRows.push({
            name: c.name, email: c.email || '', phone: c.phone || '',
            reason: c.banned && !ex.banned ? 'Existed → banned flag applied' : 'Client name already in DB',
          });
          continue;
        }
        await createClient(c).catch(() => {});
        if (key) byKey[key] = c;
        count++;
        if ((count + skippedRows.length) % 20 === 0) setProgress(`Contacts: ${count} imported, ${updated} banned-updated, ${skippedRows.length} skipped / ${clientsFile.mapped.length}`);
      }
      logActivity('gg_import', `clients: ${count} new, ${updated} updated, ${skippedRows.length} skipped from ${clientsFile.fileName}`);
      setProgress('');
      setClientsResult({ imported: count, updated, skipped: skippedRows.length });
      showToast(`✓ Step 1: ${count} contacts imported · ${skippedRows.length} duplicates skipped`, 3500);
      if (skippedRows.length > 0) setSkipped({ type: 'clients', rows: skippedRows, fileName: clientsFile.fileName });
    } catch (e) {
      console.error('[CSV] clients import failed:', e);
      showToast('Import failed: ' + e.message, 4000);
      setProgress(`Error after ${count + skippedRows.length} records: ${e.message}`);
    } finally {
      setRunning(null);
    }
  }

  // ── Step 2: Payment Details (stage only) ─────────────────────
  async function onPickPayments(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress('Reading Payment Details file…');
    try {
      const result = await readAndParse(f);
      if (result.type !== 'ggPayments') {
        showToast(`This file looks like ${TYPE_LABELS[result.type]}, not Payment Details. Re-upload the GG Payment Details CSV.`, 5000);
        if (paymentsFileRef.current) paymentsFileRef.current.value = '';
        setProgress('');
        return;
      }
      setPaymentsFile(result);
      setProgress('');
    } catch (e) {
      showToast('Could not parse CSV: ' + e.message, 4000);
      setProgress('');
    }
  }

  // ── Step 3: Checkout Line Items + receipts import ────────────
  async function onPickLineItems(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress('Reading Checkout Line Items file…');
    try {
      const result = await readAndParse(f);
      if (result.type !== 'ggLineItems') {
        showToast(`This file looks like ${TYPE_LABELS[result.type]}, not Checkout Line Items. Re-upload the GG Checkout Line Items CSV.`, 5000);
        if (lineItemsFileRef.current) lineItemsFileRef.current.value = '';
        setProgress('');
        return;
      }
      setLineItemsFile(result);
      setProgress('');
    } catch (e) {
      showToast('Could not parse CSV: ' + e.message, 4000);
      setProgress('');
    }
  }

  // Live join preview when steps 2+3 both have files.
  const joinedReceipts = (() => {
    if (!paymentsFile || !lineItemsFile) return null;
    // Use whatever client lookup we can build (synced after step 1's
    // import); the real import below rebuilds it again to capture
    // freshly-created clients.
    return buildReceiptsFromGg(paymentsFile.records, lineItemsFile.records, {});
  })();

  async function runImportReceipts() {
    if (!paymentsFile || !lineItemsFile) return;
    const preview = buildReceiptsFromGg(paymentsFile.records, lineItemsFile.records, {});
    if (!window.confirm(`Import ${preview.length} receipts joined from ${paymentsFile.fileName} + ${lineItemsFile.fileName}?\n\nReceipts include services, products, tip, tax, payment method, and processing fee. Duplicates (same Payment Transaction ID already in the DB) will be skipped automatically. Tagged as imported from GlossGenius.`)) return;

    setRunning('receipts');
    setSkipped(null);
    let count = 0;
    const skippedRows = [];
    try {
      setProgress('Loading client lookup + dedup index…');
      const [fresh, existingTxIds] = await Promise.all([
        fetchClients().catch(() => []),
        fetchExistingGgTransactionIds().catch(() => new Set()),
      ]);
      const lookup = {};
      fresh.forEach(c => { if (c.name) lookup[clientKey(c.name)] = c.id; });
      const finalReceipts = buildReceiptsFromGg(paymentsFile.records, lineItemsFile.records, lookup);
      for (const r of finalReceipts) {
        if (r._glossgeniusTransactionId && existingTxIds.has(r._glossgeniusTransactionId)) {
          skippedRows.push({
            date: r.date, client: r.clientName, total: r.payment?.total || 0,
            method: r.payment?.method || '', services: (r.services || []).map(s => s.name).join(' + '),
            chargeId: r._glossgeniusChargeId, reason: 'Payment Transaction ID already in DB',
          });
          continue;
        }
        await createReceipt(r).catch(() => {});
        if (r._glossgeniusTransactionId) existingTxIds.add(r._glossgeniusTransactionId);
        count++;
        if ((count + skippedRows.length) % 20 === 0) setProgress(`Receipts: ${count} imported, ${skippedRows.length} skipped (already in DB) / ${finalReceipts.length}`);
      }
      logActivity('gg_import', `joined sales: ${count} new, ${skippedRows.length} skipped`);
      setProgress('');
      const linkedCount = finalReceipts.filter(r => r.clientId).length;
      setReceiptsResult({ imported: count, skipped: skippedRows.length, linked: linkedCount, total: finalReceipts.length });
      showToast(`✓ Step 3: ${count} receipts imported · ${skippedRows.length} duplicates skipped`, 3500);
      if (skippedRows.length > 0) setSkipped({ type: 'receipt', rows: skippedRows, fileName: lineItemsFile.fileName });
    } catch (e) {
      console.error('[CSV] receipts import failed:', e);
      showToast('Import failed: ' + e.message, 4000);
      setProgress(`Error after ${count + skippedRows.length} records: ${e.message}`);
    } finally {
      setRunning(null);
    }
  }

  function resetAll() {
    if (!window.confirm('Reset the wizard? Any unsaved staged files will be cleared. Clients already imported stay in the DB.')) return;
    setClientsFile(null);   setClientsResult(null);
    setPaymentsFile(null);
    setLineItemsFile(null); setReceiptsResult(null);
    setProgress(''); setSkipped(null);
    if (clientsFileRef.current)   clientsFileRef.current.value = '';
    if (paymentsFileRef.current)  paymentsFileRef.current.value = '';
    if (lineItemsFileRef.current) lineItemsFileRef.current.value = '';
  }

  // Step gating
  const step1Done   = !!clientsResult;
  const step2Ready  = step1Done && !!paymentsFile;
  const step3Ready  = step2Ready && !!lineItemsFile;
  const step3Done   = !!receiptsResult;
  const busyClients  = running === 'clients';
  const busyReceipts = running === 'receipts';

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', fontSize: 13, fontWeight: 700, color: '#1a1a1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📥 Import from GlossGenius</span>
        {(clientsFile || paymentsFile || lineItemsFile) && (
          <button onClick={resetAll}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
            Reset wizard
          </button>
        )}
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.55, marginBottom: 14 }}>
          Three sequential imports — each unlocks the next. Export from <strong>GlossGenius → Insights → Reports</strong>. Records get tagged <code style={{ background: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>_importedFrom: glossgenius</code>.
        </div>

        <Step
          num={1}
          title="Contacts"
          description="Import your client list first so receipts in step 3 can link to them."
          state={step1Done ? 'done' : (busyClients ? 'running' : 'active')}
          locked={false}
        >
          <FilePickerRow
            ref_={clientsFileRef}
            onChange={onPickClients}
            disabled={busyClients || step1Done}
            file={clientsFile}
            expectedLabel="GG Clients CSV"
          />
          {clientsFile && !step1Done && (
            <PreviewBlock file={clientsFile} type="clients" rows={clientsFile.mapped} />
          )}
          {clientsFile && !step1Done && (
            <button onClick={runImportClients} disabled={busyClients}
              style={primaryBtn(busyClients || step1Done)}>
              {busyClients ? 'Importing…' : `Import ${clientsFile.mapped.length} contacts`}
            </button>
          )}
          {clientsResult && (
            <Result>✓ {clientsResult.imported.toLocaleString()} new · {clientsResult.updated} updated · {clientsResult.skipped} duplicates skipped</Result>
          )}
        </Step>

        <Step
          num={2}
          title="Payment Details"
          description="Upload your Payment Details CSV. It will be staged in-browser — no DB write yet. Step 3 joins it with Checkout Line Items."
          state={paymentsFile ? 'done' : 'active'}
          locked={!step1Done}
        >
          {!step1Done ? (
            <Locked>Complete step 1 first</Locked>
          ) : (
            <>
              <FilePickerRow
                ref_={paymentsFileRef}
                onChange={onPickPayments}
                disabled={!!paymentsFile}
                file={paymentsFile}
                expectedLabel="GG Payment Details CSV"
              />
              {paymentsFile && (
                <Result>✓ Loaded {paymentsFile.records.length.toLocaleString()} payment rows · awaiting Checkout Line Items in step 3</Result>
              )}
            </>
          )}
        </Step>

        <Step
          num={3}
          title="Checkout Line Items + import receipts"
          description="Upload Checkout Line Items. Joined with Payment Details on Charge ID → receipts."
          state={step3Done ? 'done' : (busyReceipts ? 'running' : 'active')}
          locked={!step2Ready}
        >
          {!step2Ready ? (
            <Locked>Complete steps 1 and 2 first</Locked>
          ) : (
            <>
              <FilePickerRow
                ref_={lineItemsFileRef}
                onChange={onPickLineItems}
                disabled={busyReceipts || step3Done}
                file={lineItemsFile}
                expectedLabel="GG Checkout Line Items CSV"
              />
              {joinedReceipts && !step3Done && (
                <PreviewBlock
                  file={lineItemsFile}
                  type="sales"
                  rows={joinedReceipts}
                  joinedSummary={{
                    total: joinedReceipts.length,
                    linked: joinedReceipts.filter(r => r.clientId).length,
                  }}
                />
              )}
              {joinedReceipts && !step3Done && (
                <button onClick={runImportReceipts} disabled={busyReceipts}
                  style={primaryBtn(busyReceipts)}>
                  {busyReceipts ? 'Importing…' : `Import ${joinedReceipts.length} receipts`}
                </button>
              )}
              {receiptsResult && (
                <Result>✓ {receiptsResult.imported.toLocaleString()} imported · {receiptsResult.linked}/{receiptsResult.total} linked to clients · {receiptsResult.skipped} duplicates skipped</Result>
              )}
            </>
          )}
        </Step>

        {progress && (
          <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginTop: 10 }}>{progress}</div>
        )}

        {skipped && <SkippedPanel skipped={skipped} onClose={() => setSkipped(null)} />}

        <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#78350f', lineHeight: 1.5 }}>
          <strong>How to export from GlossGenius:</strong> Open <strong>Insights → Reports</strong>, download <strong>Clients</strong>, <strong>Payment Details</strong>, and <strong>Checkout Line Items</strong> (choose your date range for the last two).
        </div>

      </div>
    </div>
  );
}

// ── Step shell ─────────────────────────────────────────────────
function Step({ num, title, description, state, locked, children }) {
  const accent = locked ? '#cbd5e1'
               : state === 'done'    ? '#16a34a'
               : state === 'running' ? '#3D95CE'
               : '#2D7A5F';
  return (
    <div style={{ marginBottom: 14, padding: 14, background: locked ? '#fafafa' : '#fff', border: `1px solid ${locked ? '#e8e8e8' : '#e0e0e0'}`, borderRadius: 10, opacity: locked ? 0.65 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flexShrink: 0, width: 28, height: 28, borderRadius: '50%', background: accent, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700 }}>
          {state === 'done' ? '✓' : num}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>Step {num} · {title}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 2, lineHeight: 1.5 }}>{description}</div>
          <div style={{ marginTop: 10 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

function Locked({ children }) {
  return <div style={{ fontSize: 11, color: '#999', padding: '8px 0', fontStyle: 'italic' }}>🔒 {children}</div>;
}

function Result({ children }) {
  return <div style={{ fontSize: 12, color: '#166534', background: '#f0fdf4', padding: '8px 10px', borderRadius: 6, marginTop: 8 }}>{children}</div>;
}

const FilePickerRow = ({ ref_, onChange, disabled, file, expectedLabel }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
    <input
      ref={ref_}
      type="file"
      accept=".csv,text/csv"
      onChange={onChange}
      disabled={disabled}
      style={{ fontSize: 12, fontFamily: 'inherit' }}
    />
    {!file && <span style={{ fontSize: 11, color: '#999' }}>Pick the {expectedLabel}</span>}
    {file && (
      <span style={{ fontSize: 11, color: '#166534', background: '#f0fdf4', padding: '3px 10px', borderRadius: 12, fontWeight: 600 }}>
        ✓ {file.fileName} ({file.records.length.toLocaleString()} rows)
      </span>
    )}
  </div>
);

function PreviewBlock({ file, type, rows, joinedSummary }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ marginTop: 10, padding: 12, fontSize: 11, color: '#ef4444', textAlign: 'center', background: '#fef2f2', borderRadius: 6 }}>
        No mappable rows. Check that the CSV has the expected columns.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 10 }}>
      {joinedSummary && (
        <div style={{ fontSize: 11, fontWeight: 700, color: '#2D7A5F', marginBottom: 6, letterSpacing: '.04em' }}>
          ✓ Joined {joinedSummary.total} receipts
          <span style={{ fontWeight: 500, color: joinedSummary.linked === joinedSummary.total ? '#2D7A5F' : '#b45309', marginLeft: 8 }}>
            · {joinedSummary.linked} / {joinedSummary.total} linked to clients
          </span>
        </div>
      )}
      <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 6, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
        <PreviewTable type={type} rows={rows.slice(0, 8)} />
        {rows.length > 8 && (
          <div style={{ padding: '6px 10px', fontSize: 10, color: '#aaa', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
            + {rows.length - 8} more rows…
          </div>
        )}
      </div>
    </div>
  );
}

const primaryBtn = (disabled) => ({
  marginTop: 10,
  padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700,
  cursor: disabled ? 'default' : 'pointer',
  background: disabled ? '#d0d0d0' : '#2D7A5F',
  color: '#fff', fontFamily: 'inherit',
});


// ── Skipped-rows table + preview helpers ──────────────────────
function SkippedPanel({ skipped, onClose }) {
  const { rows, type, fileName } = skipped;
  const tooMany = rows.length > MAX_INLINE_SKIPPED;
  const visible = tooMany ? rows.slice(0, MAX_INLINE_SKIPPED) : rows;

  function downloadCsv() {
    const headerRow = headersForType(type);
    const dataRows  = rows.map(r => headerRow.map(h => stringifyCell(r[csvKeyForHeader(type, h)])));
    const csv = [headerRow, ...dataRows]
      .map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `skipped-${type}-${stamp}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div style={{ marginTop: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#78350f' }}>
          ⚠ Skipped {rows.length.toLocaleString()} duplicate{rows.length !== 1 ? 's' : ''} from {fileName}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={downloadCsv}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #78350f', background: '#fff', color: '#78350f', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            ↓ Download CSV
          </button>
          <button onClick={onClose}
            style={{ fontSize: 11, padding: '5px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
            ✕ Dismiss
          </button>
        </div>
      </div>
      {tooMany && (
        <div style={{ fontSize: 11, color: '#92400e', marginBottom: 8, padding: '6px 8px', background: '#fef3c7', borderRadius: 6 }}>
          Showing the first {MAX_INLINE_SKIPPED.toLocaleString()} of {rows.length.toLocaleString()} skipped rows below. Use <strong>Download CSV</strong> to see all.
        </div>
      )}
      <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 6, overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ background: '#fefce8', position: 'sticky', top: 0 }}>
            {headersForType(type).map(h => (
              <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#78350f', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid #fde68a' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>{visible.map((row, i) => (
            <tr key={i} style={{ borderTop: i === 0 ? 'none' : '1px solid #fef3c7' }}>
              {headersForType(type).map(h => (
                <td key={h} style={{ padding: '5px 8px', fontSize: 11, color: '#333', whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {formatCell(type, h, row)}
                </td>
              ))}
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

function headersForType(type) {
  if (type === 'receipt') return ['Date', 'Client', 'Services', 'Method', 'Total', 'Charge ID'];
  if (type === 'sales')   return ['Date', 'Client', 'Method', 'Total'];
  if (type === 'clients') return ['Name', 'Email', 'Phone'];
  if (type === 'appointments') return ['Date', 'Time', 'Client', 'Tech', 'Service', 'Status'];
  return ['Reason'];
}
function csvKeyForHeader(type, h) {
  const map = {
    'Date': 'date', 'Time': 'time', 'Client': 'client', 'Services': 'services',
    'Service': 'service', 'Method': 'method', 'Total': 'total', 'Charge ID': 'chargeId',
    'Name': 'name', 'Email': 'email', 'Phone': 'phone', 'Tech': 'tech', 'Status': 'status',
    'Reason': 'reason',
  };
  return map[h] || h.toLowerCase();
}
function formatCell(type, h, row) {
  const k = csvKeyForHeader(type, h);
  const v = row[k];
  if (h === 'Total' && typeof v === 'number') return '$' + v.toFixed(2);
  if (v == null || v === '') return '—';
  return String(v);
}
function stringifyCell(v) {
  if (v == null) return '';
  if (typeof v === 'number') return v.toFixed(2);
  return String(v);
}

function PreviewTable({ type, rows }) {
  if (!rows.length) return null;
  if (type === 'clients') {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ background: '#fafafa' }}>
          <Th>Name</Th><Th>Email</Th><Th>Phone</Th><Th>Birthday</Th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
            <Td>{r.name}</Td><Td>{r.email || '—'}</Td><Td>{r.phone || '—'}</Td><Td>{r.birthday || '—'}</Td>
          </tr>
        ))}</tbody>
      </table>
    );
  }
  if (type === 'sales') {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ background: '#fafafa' }}>
          <Th>Date</Th><Th>Client</Th><Th>Tech</Th><Th>Items</Th><Th>Method</Th><Th>Tip</Th><Th>Tax</Th><Th>Fee</Th><Th>Total</Th>
        </tr></thead>
        <tbody>{rows.map((r, i) => {
          const p = r.payment || {};
          const itemNames = (r.services || []).map(s => s.name).concat((r.retailProducts || []).map(p => p.name)).join(', ');
          return (
            <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
              <Td>{r.date}</Td>
              <Td>{r.clientName}</Td>
              <Td>{r.techName || '—'}</Td>
              <Td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={itemNames}>{itemNames || '—'}</Td>
              <Td>{p.method}</Td>
              <Td>${(p.tip || 0).toFixed(2)}</Td>
              <Td>${(p.tax || 0).toFixed(2)}</Td>
              <Td>${(p.ccFee || 0).toFixed(2)}</Td>
              <Td>${(p.total || 0).toFixed(2)}</Td>
            </tr>
          );
        })}</tbody>
      </table>
    );
  }
  return null;
}

function Th({ children }) {
  return <th style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em' }}>{children}</th>;
}
function Td({ children, style, ...rest }) {
  return <td style={{ padding: '5px 8px', fontSize: 11, color: '#333', ...style }} {...rest}>{children}</td>;
}
