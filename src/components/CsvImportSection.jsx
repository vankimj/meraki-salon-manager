import { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { createClient, createAppointment, createReceipt, fetchClients, backfillImportedReceiptCreatedAt, backfillImportedReceiptClientIds, diagnoseUnlinkedReceipts, sampleGgReceiptsByTech, diagnoseCashTotals, dedupeImportedReceipts, diagnoseImportFormats, deleteImportedReceiptsWithoutChargeId, previewGgImportWipe, wipeAllGgImports, fetchExistingGgChargeIds, fetchExistingGgTransactionIds, fetchExistingClientNameKeys, fetchExistingApptKeys, apptDedupKey, fetchExistingReceiptKeys, saleDedupKey, countAllAppointments, wipeAllAppointments, countAllReceipts, wipeAllReceipts, diagnoseMethodBucket, backfillReceiptCreatedAtStrong, diagnoseReceiptCreatedAt, diagnoseReceiptDate, backfillReceiptDate } from '../lib/firestore';
import { logActivity } from '../lib/logger';
import {
  parseCsv, detectType,
  mapClientRow, mapAppointmentRow, mapSaleRow,
  buildReceiptsFromGg, clientKey,
} from '../lib/csvImport';

const TYPE_LABELS = {
  clients:      'Clients',
  appointments: 'Appointments',
  sales:        'Sales / Receipts',
  ggPayments:   'GG Payment Details (1 of 2)',
  ggLineItems:  'GG Checkout Line Items (1 of 2)',
  unknown:      'Unknown',
};

export default function CsvImportSection() {
  const { showToast } = useApp();
  const fileRef = useRef(null);
  const [parsed,   setParsed]   = useState(null);   // primary file
  const [pair,     setPair]     = useState(null);   // companion (when two-file)
  const [running,  setRunning]  = useState(false);
  const [progress, setProgress] = useState('');
  const [skipped,  setSkipped]  = useState(null); // null | { type, rows: [], reason }
  const [clientLookup, setClientLookup] = useState({});

  // Load existing clients once so we can link imported receipts/appts by name.
  useEffect(() => {
    fetchClients().then(cs => {
      const lookup = {};
      cs.forEach(c => { if (c.name) lookup[clientKey(c.name)] = c.id; });
      setClientLookup(lookup);
    }).catch(() => {});
  }, []);

  function reset() {
    setParsed(null); setPair(null); setProgress('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function readAndParse(f) {
    const text = await f.text();
    const { headers, records } = parseCsv(text);
    return { headers, records, fileName: f.name, type: detectType(headers) };
  }

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setProgress('Reading file…');
    try {
      const result = await readAndParse(f);
      // If parsed already has a primary GG file and this one is the companion → set as pair
      if (parsed && (parsed.type === 'ggPayments' || parsed.type === 'ggLineItems')) {
        const want = parsed.type === 'ggPayments' ? 'ggLineItems' : 'ggPayments';
        if (result.type === want) {
          setPair(result);
          setProgress('');
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
      }
      // Otherwise treat as primary
      let mapped = [];
      if (result.type === 'clients')      mapped = result.records.map(r => mapClientRow(r)).filter(Boolean);
      if (result.type === 'appointments') mapped = result.records.map(r => mapAppointmentRow(r, null)).filter(Boolean);
      if (result.type === 'sales')        mapped = result.records.map(r => mapSaleRow(r)).filter(Boolean);
      setParsed({ ...result, mapped });
      setPair(null);
      setProgress('');
    } catch (e) {
      console.error('[CSV] parse failed:', e);
      showToast('Could not parse CSV: ' + e.message, 4000);
      setProgress('');
    }
  }

  // Joined preview when both GG files are loaded
  const joinedReceipts = (() => {
    if (!parsed || !pair) return null;
    const payments  = parsed.type === 'ggPayments'  ? parsed.records : pair.records;
    const lineItems = parsed.type === 'ggLineItems' ? parsed.records : pair.records;
    return buildReceiptsFromGg(payments, lineItems, clientLookup);
  })();
  const linkedCount = joinedReceipts ? joinedReceipts.filter(r => r.clientId).length : 0;

  async function runImport() {
    if (!parsed) return;

    // Two-file GG path
    if (joinedReceipts) {
      if (!window.confirm(`Import ${joinedReceipts.length} receipts joined from ${parsed.fileName} + ${pair.fileName}?\n\nReceipts include services, products, tip, tax, payment method, and processing fee. Duplicates (same Payment Transaction ID already in the DB) will be skipped automatically. Tagged as imported from GlossGenius.`)) return;
      setRunning(true);
      setSkipped(null);
      let count = 0;
      const skippedRows = [];
      try {
        // Rebuild lookup + dedup set fresh at import time so any clients
        // added in this session (e.g. just imported) get linked, and any
        // re-imported rows with a Payment Transaction ID we already have are
        // skipped. We dedup on Transaction ID rather than Charge ID because
        // GG re-uses the same Charge ID across payment+refund pairs and
        // split payments.
        setProgress('Loading client lookup + dedup index…');
        const [fresh, existingTxIds] = await Promise.all([
          fetchClients().catch(() => []),
          fetchExistingGgTransactionIds().catch(() => new Set()),
        ]);
        const lookup = {};
        fresh.forEach(c => { if (c.name) lookup[clientKey(c.name)] = c.id; });
        const payments  = parsed.type === 'ggPayments'  ? parsed.records : pair.records;
        const lineItems = parsed.type === 'ggLineItems' ? parsed.records : pair.records;
        const finalReceipts = buildReceiptsFromGg(payments, lineItems, lookup);
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
        setProgress(`✓ Imported ${count} new receipts. Skipped ${skippedRows.length} duplicates.`);
        showToast(`${count} imported · ${skippedRows.length} duplicates skipped`, 3500);
        if (skippedRows.length > 0) {
          setSkipped({ type: 'receipt', rows: skippedRows, fileName: parsed.fileName });
        }
        reset();
      } catch (e) {
        showToast('Import failed: ' + e.message, 4000);
        setProgress(`Error after ${count + skippedRows.length} records: ${e.message}`);
      } finally { setRunning(false); }
      return;
    }

    if (parsed.type === 'unknown' || parsed.type === 'ggPayments' || parsed.type === 'ggLineItems') {
      showToast('Need both Payment Details + Checkout Line Items files to import GG sales.', 4000);
      return;
    }

    if (!window.confirm(`Import ${parsed.mapped.length} ${TYPE_LABELS[parsed.type].toLowerCase()} records from ${parsed.fileName}?\n\nDuplicates already in the DB will be detected and skipped. Tagged as imported from GlossGenius.`)) return;

    setRunning(true);
    setSkipped(null);
    let count = 0;
    const skippedRows = [];
    try {
      if (parsed.type === 'clients') {
        setProgress('Loading dedup index…');
        const existing = await fetchExistingClientNameKeys().catch(() => new Set());
        for (const c of parsed.mapped) {
          const key = clientKey(c.name);
          if (key && existing.has(key)) {
            skippedRows.push({
              name: c.name, email: c.email || '', phone: c.phone || '',
              reason: 'Client name already in DB',
            });
            continue;
          }
          await createClient(c).catch(() => {});
          if (key) existing.add(key);
          count++;
          if ((count + skippedRows.length) % 20 === 0) setProgress(`Clients: ${count} imported, ${skippedRows.length} skipped / ${parsed.mapped.length}`);
        }
      } else if (parsed.type === 'appointments') {
        setProgress('Loading client lookup + dedup index…');
        const [allClients, existingKeys] = await Promise.all([
          fetchClients().catch(() => []),
          fetchExistingApptKeys().catch(() => new Set()),
        ]);
        const lookup = {};
        allClients.forEach(c => { if (c.name) lookup[clientKey(c.name)] = c.id; });
        for (const rec of parsed.records) {
          const a = mapAppointmentRow(rec, lookup);
          if (!a) continue;
          const key = apptDedupKey(a);
          if (existingKeys.has(key)) {
            skippedRows.push({
              date: a.date, time: a.startTime, client: a.clientName, tech: a.techName,
              service: a.services?.[0]?.name || '', status: a.status,
              reason: 'Same date+time+client+tech+service already in DB',
            });
            continue;
          }
          await createAppointment(a).catch(() => {});
          existingKeys.add(key);
          count++;
          if ((count + skippedRows.length) % 20 === 0) setProgress(`Appointments: ${count} imported, ${skippedRows.length} skipped / ${parsed.mapped.length}`);
        }
      } else if (parsed.type === 'sales') {
        setProgress('Loading dedup index…');
        const existingKeys = await fetchExistingReceiptKeys().catch(() => new Set());
        for (const r of parsed.mapped) {
          const key = saleDedupKey(r);
          if (existingKeys.has(key)) {
            skippedRows.push({
              date: r.date, client: r.clientName, total: r.payment?.total || 0,
              method: r.payment?.method || '',
              reason: 'Same date+client+total+method already in DB',
            });
            continue;
          }
          await createReceipt(r).catch(() => {});
          existingKeys.add(key);
          count++;
          if ((count + skippedRows.length) % 20 === 0) setProgress(`Sales: ${count} imported, ${skippedRows.length} skipped / ${parsed.mapped.length}`);
        }
      }
      logActivity('gg_import', `${parsed.type}: ${count} new, ${skippedRows.length} skipped from ${parsed.fileName}`);
      setProgress(`✓ Imported ${count} new records. Skipped ${skippedRows.length} duplicates.`);
      showToast(`${count} imported · ${skippedRows.length} duplicates skipped`, 3500);
      if (skippedRows.length > 0) {
        setSkipped({ type: parsed.type, rows: skippedRows, fileName: parsed.fileName });
      }
      reset();
    } catch (e) {
      console.error('[CSV] import failed:', e);
      showToast('Import failed: ' + e.message, 4000);
      setProgress(`Error after ${count + skippedRows.length} records: ${e.message}`);
    } finally {
      setRunning(false);
    }
  }

  const needsCompanion = parsed && !pair && (parsed.type === 'ggPayments' || parsed.type === 'ggLineItems');
  const companionLabel = parsed?.type === 'ggPayments' ? 'Checkout Line Items CSV' : 'Payment Details CSV';

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: 12, marginBottom: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>
        📥 Import from GlossGenius
      </div>
      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontSize: 12, color: '#666', lineHeight: 1.55, marginBottom: 12 }}>
          Upload CSVs from <strong>GlossGenius → Insights → Reports</strong>. The importer auto-detects what's in the file. For sales: upload <strong>Payment Details</strong> AND <strong>Checkout Line Items</strong> — they get joined on Charge ID for full receipts.
        </div>

        <ResetGgImportsBtn />
        <WipeAllAppointmentsBtn />
        <WipeAllReceiptsBtn />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            disabled={running}
            style={{ fontSize: 12, fontFamily: 'inherit' }}
          />
          {parsed && (
            <button onClick={reset} disabled={running}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fafafa', color: '#888', cursor: 'pointer', fontFamily: 'inherit' }}>
              Clear
            </button>
          )}
        </div>

        {parsed && (
          <div style={{ background: '#fafafa', border: '1px solid #ececec', borderRadius: 10, padding: 12, marginBottom: 12 }}>
            <FileSummary file={parsed} />
            {pair && <FileSummary file={pair} compact />}

            {needsCompanion && (
              <div style={{ marginTop: 10, padding: 10, background: '#EBF4FB', border: '1px dashed #bfdbfe', borderRadius: 8, fontSize: 12, color: '#1a5f8a' }}>
                ✓ Loaded the {parsed.type === 'ggPayments' ? 'Payment Details' : 'Checkout Line Items'} file. Now upload the <strong>{companionLabel}</strong> using the file picker above.
              </div>
            )}

            {joinedReceipts && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#2D7A5F', marginBottom: 6, letterSpacing: '.04em' }}>
                  ✓ Joined {joinedReceipts.length} receipts (preview)
                  <span style={{ fontWeight: 500, color: linkedCount === joinedReceipts.length ? '#2D7A5F' : '#b45309', marginLeft: 8 }}>
                    · {linkedCount} / {joinedReceipts.length} linked to clients
                  </span>
                </div>
                <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 6, overflow: 'hidden', maxHeight: 240, overflowY: 'auto' }}>
                  <PreviewTable type="sales" rows={joinedReceipts.slice(0, 8)} />
                  {joinedReceipts.length > 8 && (
                    <div style={{ padding: '6px 10px', fontSize: 10, color: '#aaa', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                      + {joinedReceipts.length - 8} more rows…
                    </div>
                  )}
                </div>
              </div>
            )}

            {parsed && !needsCompanion && !joinedReceipts && parsed.mapped && parsed.mapped.length > 0 && (
              <div style={{ marginTop: 10, background: '#fff', border: '1px solid #ececec', borderRadius: 6, overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
                <PreviewTable type={parsed.type} rows={parsed.mapped.slice(0, 8)} />
                {parsed.mapped.length > 8 && (
                  <div style={{ padding: '6px 10px', fontSize: 10, color: '#aaa', borderTop: '1px solid #f0f0f0', background: '#fafafa' }}>
                    + {parsed.mapped.length - 8} more rows…
                  </div>
                )}
              </div>
            )}
            {parsed && !needsCompanion && !joinedReceipts && parsed.mapped && parsed.mapped.length === 0 && (
              <div style={{ marginTop: 10, padding: 12, fontSize: 11, color: '#ef4444', textAlign: 'center', background: '#fef2f2', borderRadius: 6 }}>
                No mappable rows. Check that the CSV has the expected columns.
              </div>
            )}
          </div>
        )}

        {progress && (
          <div style={{ fontSize: 12, color: '#666', fontStyle: 'italic', marginBottom: 10 }}>{progress}</div>
        )}

        {skipped && <SkippedPanel skipped={skipped} onClose={() => setSkipped(null)} />}

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={runImport}
            disabled={running || !parsed || (parsed.type === 'unknown') ||
                      (needsCompanion) ||
                      (!joinedReceipts && parsed.mapped?.length === 0)}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700, cursor: !running && parsed && !needsCompanion ? 'pointer' : 'default', background: !running && parsed && !needsCompanion ? '#2D7A5F' : '#d0d0d0', color: '#fff', fontFamily: 'inherit' }}>
            {running ? 'Importing…'
              : joinedReceipts ? `Import ${joinedReceipts.length} joined receipts`
              : needsCompanion ? 'Waiting for companion file…'
              : `Import ${parsed?.mapped?.length || 0} records`}
          </button>
        </div>

        <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, fontSize: 11, color: '#78350f', lineHeight: 1.5 }}>
          <strong>How to export from GlossGenius:</strong> Open GlossGenius → <strong>Insights → Reports</strong> → pick <strong>Payment Details</strong> + <strong>Checkout Line Items</strong> (for sales — both required) or <strong>Clients</strong> / <strong>Appointments</strong> (single file each) → choose date range → <strong>Download Report</strong>. Records tagged <code style={{ background: '#fef3c7', padding: '0 4px', borderRadius: 3 }}>_importedFrom: glossgenius</code>.
        </div>

        <BackfillCreatedAtBtn />
        <BackfillClientIdsBtn />
        <SampleReceiptsByTechBtn />
        <CashDiagnosticBtn />
        <CreatedAtDistributionBtn />
        <ReceiptDateDistributionBtn />
        <MethodBucketDiagnosticBtn />
        <ImportFormatDiagnosticBtn />
      </div>
    </div>
  );
}

function ResetGgImportsBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [counts,  setCounts]  = useState(null);
  const [status,  setStatus]  = useState('');

  async function preview() {
    setBusy(true); setStatus('Counting…');
    try {
      const c = await previewGgImportWipe();
      setCounts(c);
      setStatus('');
    } catch (e) {
      console.error('[Wipe preview]', e);
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  async function wipe() {
    if (!counts) return;
    if (!window.confirm(
      `DELETE every GG-imported record?\n\n` +
      `• ${counts.clients.toLocaleString()} clients\n` +
      `• ${counts.appointments.toLocaleString()} appointments\n` +
      `• ${counts.receipts.toLocaleString()} receipts\n\n` +
      `Total: ${counts.total.toLocaleString()} documents will be permanently deleted. ` +
      `Local (non-GG) data is untouched. This is irreversible — you'll need to re-import from GG.`
    )) return;
    if (!window.confirm('Last chance. Continue?')) return;
    setBusy(true);
    try {
      const r = await wipeAllGgImports(msg => setStatus(msg));
      logActivity('gg_wipe_all', `clients=${r.deletedClients}, appts=${r.deletedAppointments}, receipts=${r.deletedReceipts}`);
      setStatus(`✓ Deleted ${r.total.toLocaleString()} documents — clients ${r.deletedClients}, appts ${r.deletedAppointments}, receipts ${r.deletedReceipts}`);
      showToast(`Wiped ${r.total.toLocaleString()} GG records — re-import to start fresh`, 4500);
      setCounts({ clients: 0, appointments: 0, receipts: 0, total: 0 });
    } catch (e) {
      console.error('[Wipe]', e);
      setStatus('Error: ' + e.message);
      showToast('Wipe failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#7f1d1d', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Reset all GG imports</div>
      <div style={{ marginBottom: 10 }}>
        Deletes every <code>_importedFrom: glossgenius</code> record across <strong>clients</strong>, <strong>appointments</strong>, and <strong>receipts</strong>. Use this if a previous import double-counted and you want a clean slate before re-importing the GG Clients CSV + Payment Details + Checkout Line Items. Local data (in-app appointments, demo data, manually-entered clients) is untouched.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={preview} disabled={busy}
          style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy && !counts ? 'Counting…' : 'Preview deletion counts'}
        </button>
        {counts && counts.total > 0 && (
          <button onClick={wipe} disabled={busy}
            style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #ef4444', background: busy ? '#fee2e2' : '#ef4444', color: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
            {busy ? 'Deleting…' : `Delete ${counts.total.toLocaleString()} GG records`}
          </button>
        )}
      </div>
      {counts && (
        <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 6, fontSize: 11, color: '#7f1d1d' }}>
          <strong>Will delete:</strong> {counts.clients.toLocaleString()} clients · {counts.appointments.toLocaleString()} appointments · {counts.receipts.toLocaleString()} receipts <strong>(total {counts.total.toLocaleString()})</strong>
        </div>
      )}
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
    </div>
  );
}

function WipeAllAppointmentsBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [count,   setCount]   = useState(null);
  const [status,  setStatus]  = useState('');

  async function preview() {
    setBusy(true); setStatus('Counting…');
    try {
      const n = await countAllAppointments();
      setCount(n);
      setStatus('');
    } catch (e) {
      console.error('[Wipe appts preview]', e);
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  async function wipe() {
    if (count == null) return;
    if (!window.confirm(
      `DELETE every appointment in the calendar?\n\n` +
      `${count.toLocaleString()} appointments will be permanently deleted — including demo data, ` +
      `online bookings, and any in-app entries. Receipts (sales history) are NOT affected.\n\n` +
      `This is irreversible. Use this only when you're about to re-import the GG Appointments CSV ` +
      `and want a clean calendar.`
    )) return;
    if (!window.confirm(`Last chance — delete ${count.toLocaleString()} appointments?`)) return;
    if (!window.confirm('Final confirmation. Continue?')) return;
    setBusy(true);
    try {
      const r = await wipeAllAppointments(msg => setStatus(msg));
      logActivity('wipe_all_appointments', `deleted=${r.deleted}`);
      setStatus(`✓ Deleted ${r.deleted.toLocaleString()} appointments.`);
      showToast(`Wiped ${r.deleted.toLocaleString()} appointments — calendar is now empty`, 4500);
      setCount(0);
    } catch (e) {
      console.error('[Wipe appts]', e);
      setStatus('Error: ' + e.message);
      showToast('Wipe failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#7f1d1d', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Wipe entire calendar</div>
      <div style={{ marginBottom: 10 }}>
        Deletes <strong>every appointment</strong> regardless of source — demo data, online bookings, in-app entries, and any prior GG-imported appointments. Receipts (sales history) stay intact. Use before re-importing the GG <strong>Appointments</strong> CSV when you want a guaranteed-clean calendar.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={preview} disabled={busy}
          style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy && count == null ? 'Counting…' : 'Preview count'}
        </button>
        {count != null && count > 0 && (
          <button onClick={wipe} disabled={busy}
            style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #ef4444', background: busy ? '#fee2e2' : '#ef4444', color: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
            {busy ? 'Deleting…' : `Delete ${count.toLocaleString()} appointments`}
          </button>
        )}
      </div>
      {count != null && (
        <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 6, fontSize: 11, color: '#7f1d1d' }}>
          <strong>Will delete:</strong> {count.toLocaleString()} appointment{count !== 1 ? 's' : ''}
        </div>
      )}
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
    </div>
  );
}

function WipeAllReceiptsBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [count,   setCount]   = useState(null);
  const [status,  setStatus]  = useState('');

  async function preview() {
    setBusy(true); setStatus('Counting…');
    try {
      const n = await countAllReceipts();
      setCount(n);
      setStatus('');
    } catch (e) {
      console.error('[Wipe rcpts preview]', e);
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  async function wipe() {
    if (count == null) return;
    if (!window.confirm(
      `DELETE every transaction (receipt) in the database?\n\n` +
      `${count.toLocaleString()} receipts will be permanently deleted — including in-app checkouts, ` +
      `GG-imported sales, and demo data. Appointments, clients, and gift cards are NOT affected.\n\n` +
      `This is irreversible. Use this only when you're about to re-import GG sales (Payment Details + ` +
      `Checkout Line Items) and want a clean slate.`
    )) return;
    if (!window.confirm(`Last chance — delete ${count.toLocaleString()} transactions?`)) return;
    if (!window.confirm('Final confirmation. Continue?')) return;
    setBusy(true);
    try {
      const r = await wipeAllReceipts(msg => setStatus(msg));
      logActivity('wipe_all_receipts', `deleted=${r.deleted}`);
      setStatus(`✓ Deleted ${r.deleted.toLocaleString()} receipts.`);
      showToast(`Wiped ${r.deleted.toLocaleString()} transactions — sales history is now empty`, 4500);
      setCount(0);
    } catch (e) {
      console.error('[Wipe rcpts]', e);
      setStatus('Error: ' + e.message);
      showToast('Wipe failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginBottom: 14, padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, fontSize: 12, color: '#7f1d1d', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠ Wipe all transactions</div>
      <div style={{ marginBottom: 10 }}>
        Deletes <strong>every receipt</strong> regardless of source — in-app checkouts, GG-imported sales, demo data, and any prior partial imports. Appointments and clients stay intact. Use before re-importing GG <strong>Payment Details + Checkout Line Items</strong> when you want a guaranteed-clean transaction history.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={preview} disabled={busy}
          style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy && count == null ? 'Counting…' : 'Preview count'}
        </button>
        {count != null && count > 0 && (
          <button onClick={wipe} disabled={busy}
            style={{ fontSize: 11, padding: '6px 12px', borderRadius: 6, border: '1px solid #ef4444', background: busy ? '#fee2e2' : '#ef4444', color: '#fff', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>
            {busy ? 'Deleting…' : `Delete ${count.toLocaleString()} transactions`}
          </button>
        )}
      </div>
      {count != null && (
        <div style={{ marginTop: 8, padding: 8, background: '#fff', borderRadius: 6, fontSize: 11, color: '#7f1d1d' }}>
          <strong>Will delete:</strong> {count.toLocaleString()} receipt{count !== 1 ? 's' : ''}
        </div>
      )}
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
    </div>
  );
}

function ReceiptDateDistributionBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [backfillResult, setBackfillResult] = useState(null);

  async function diagnose() {
    setBusy(true); setResult(null); setBackfillResult(null);
    try { setResult(await diagnoseReceiptDate()); }
    catch (e) { console.error('[ReceiptDateDist]', e); }
    finally { setBusy(false); }
  }

  async function backfill() {
    if (!window.confirm('Fill in missing/malformed `date` on receipts? Falls back through payment.paidAt → createdAt. Safe to run multiple times.')) return;
    setBusy(true);
    try {
      const r = await backfillReceiptDate();
      setBackfillResult(r);
      logActivity('receipt_backfill_date', `scanned ${r.scanned}, updated ${r.updated}, unfixable ${r.unfixable}`);
      showToast(`Backfilled ${r.updated} receipts · ${r.unfixable} unfixable`, 4000);
      // Re-diagnose to show the after state
      setResult(await diagnoseReceiptDate());
    } catch (e) {
      console.error('[ReceiptDateBackfill]', e);
      showToast('Backfill failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Receipt <code>date</code> distribution:</strong> the metrics filter requires a YYYY-MM-DD <code>date</code> field on every receipt. If a receipt is missing or has malformed date, it's hidden from totals. This shows the distribution and can backfill from <code>payment.paidAt</code> or <code>createdAt</code>.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={diagnose} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy && !result ? 'Scanning…' : 'Inspect receipt date'}
        </button>
        {result && (result.missing > 0 || result.malformed > 0) && (
          <button onClick={backfill} disabled={busy}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #ef4444', background: '#fee2e2', color: '#7f1d1d', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            {busy ? 'Backfilling…' : `Backfill ${result.missing + result.malformed} receipts`}
          </button>
        )}
      </div>
      {result && (
        <div style={{ marginTop: 10, background: '#fff', border: '1px solid #ececec', borderRadius: 6, padding: 10, fontSize: 11 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{result.total.toLocaleString()} receipts.</strong> Valid date: {result.valid.toLocaleString()} · Missing: {result.missing.toLocaleString()} · Malformed: {result.malformed.toLocaleString()}
          </div>
          {(result.missing > 0 || result.malformed > 0) && (
            <div style={{ padding: 8, background: '#fef2f2', borderRadius: 6, color: '#7f1d1d', marginBottom: 8 }}>
              <strong>{result.missing + result.malformed} receipts have a missing or malformed <code>date</code>.</strong> These are silently excluded from Reports totals.
              {result.sampleMissing.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 10 }}>
                  Missing sample: {result.sampleMissing.map(s => `${s.id.slice(0, 6)}... (${s.clientName || 'Walk-in'}, $${(s.total || 0).toFixed(0)})`).join(', ')}
                </div>
              )}
              {result.sampleMalformed.length > 0 && (
                <div style={{ marginTop: 4, fontSize: 10 }}>
                  Malformed sample: {result.sampleMalformed.map(s => `"${s.value}"`).join(', ')}
                </div>
              )}
            </div>
          )}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>Valid receipts by year</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>Year</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Count</th>
              </tr></thead>
              <tbody>
                {Object.entries(result.byYear)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([yr, count]) => (
                    <tr key={yr} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '5px 8px' }}>{yr}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{count.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {backfillResult && (
            <div style={{ marginTop: 8, padding: 8, background: '#f0fdf4', borderRadius: 6, color: '#166534' }}>
              ✓ Backfilled {backfillResult.updated.toLocaleString()} · already valid {backfillResult.skipped.toLocaleString()} · unfixable {backfillResult.unfixable.toLocaleString()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CreatedAtDistributionBtn() {
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);

  async function run() {
    setBusy(true); setResult(null);
    try { setResult(await diagnoseReceiptCreatedAt()); }
    catch (e) { console.error('[CreatedAtDist]', e); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>createdAt distribution:</strong> if Reports is hiding receipts, this shows you the actual <code>createdAt</code> value distribution by year + counts any receipts where <code>createdAt</code> is a non-string type (Firestore Timestamp object) or unparseable. Range queries silently drop those.
      </div>
      <button onClick={run} disabled={busy}
        style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
        {busy ? 'Scanning…' : 'Inspect createdAt values'}
      </button>
      {result && (
        <div style={{ marginTop: 10, background: '#fff', border: '1px solid #ececec', borderRadius: 6, padding: 10, fontSize: 11 }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{result.total.toLocaleString()} receipts.</strong> Valid ISO: {result.validIso.toLocaleString()} · Non-string type: {result.nonString.toLocaleString()} · Unparseable: {result.unparseable.toLocaleString()} · Missing: {result.missing.toLocaleString()}
          </div>
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>By year</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>Year</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Count</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>In 10-year range?</th>
              </tr></thead>
              <tbody>
                {Object.entries(result.byYear)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([yr, count]) => {
                    const inRange = Number(yr) >= new Date().getUTCFullYear() - 10;
                    return (
                      <tr key={yr} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '5px 8px' }}>{yr}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{count.toLocaleString()}</td>
                        <td style={{ padding: '5px 8px', color: inRange ? '#16a34a' : '#ef4444' }}>{inRange ? '✓ yes' : '✗ NO — hidden from reports'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          {result.sampleNonString.length > 0 && (
            <div style={{ marginBottom: 8, padding: 8, background: '#fef2f2', borderRadius: 6, color: '#7f1d1d' }}>
              <strong>{result.nonString} receipts have createdAt as a non-string type</strong> (likely a Firestore Timestamp object). These never match the Reports range query.
              <div style={{ marginTop: 4, fontSize: 10 }}>
                Sample: {result.sampleNonString.map(s => `${s.id.slice(0, 6)}... (${s.type})`).join(', ')}
              </div>
            </div>
          )}
          {result.sampleUnparseable.length > 0 && (
            <div style={{ padding: 8, background: '#fef2f2', borderRadius: 6, color: '#7f1d1d' }}>
              <strong>{result.unparseable} receipts have unparseable createdAt strings.</strong>
              <div style={{ marginTop: 4, fontSize: 10 }}>
                Sample: {result.sampleUnparseable.map(s => `"${s.value}"`).join(', ')}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MethodBucketDiagnosticBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [method,  setMethod]  = useState('cash');
  const [result,  setResult]  = useState(null);

  async function diagnose() {
    setBusy(true); setResult(null);
    try {
      const r = await diagnoseMethodBucket(method);
      setResult(r);
    } catch (e) {
      console.error('[MethodBucket]', e);
      showToast('Diagnostic failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Method bucket diagnostic:</strong> when the Cash (or Card) KPI shows fewer transactions than your manual count, this lists every receipt in that method bucket grouped by <code>transactionType</code> and source. Cancellations / voids are excluded from "money collected" totals on the Overview by design — this shows exactly where the missing rows went.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <select value={method} onChange={e => setMethod(e.target.value)}
          style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit', background: '#fff' }}>
          <option value="cash">cash</option>
          <option value="card">card</option>
          <option value="venmo">venmo</option>
          <option value="other">other</option>
        </select>
        <button onClick={diagnose} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy ? 'Running…' : `Diagnose ${method} bucket`}
        </button>
      </div>
      {result && (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 6, padding: 10, fontSize: 11, color: '#333' }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{result.totalReceipts.toLocaleString()} receipts</strong> with method = <code>{result.method}</code>, gross total ${result.grossTotal.toFixed(2)}.
          </div>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>By transactionType</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>Type</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Count</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Total</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>Counted on Overview?</th>
              </tr></thead>
              <tbody>
                {Object.entries(result.byType)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([t, d]) => {
                    const counted = !t || t === '(unset)' || t === 'sale' || t === 'refund';
                    return (
                      <tr key={t} style={{ borderTop: '1px solid #f5f5f5' }}>
                        <td style={{ padding: '5px 8px' }}>{t}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{d.count.toLocaleString()}</td>
                        <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>${d.total.toFixed(2)}</td>
                        <td style={{ padding: '5px 8px', color: counted ? '#16a34a' : '#ef4444' }}>{counted ? '✓ yes' : '✗ no (excluded)'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>By source</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', color: '#888' }}>Source</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Count</th>
                <th style={{ padding: '4px 8px', textAlign: 'right', color: '#888' }}>Total</th>
              </tr></thead>
              <tbody>
                {Object.entries(result.bySource)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([s, d]) => (
                    <tr key={s} style={{ borderTop: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '5px 8px' }}>{s}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{d.count.toLocaleString()}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>${d.total.toFixed(2)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function ImportFormatDiagnosticBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);

  async function diagnose() {
    setBusy(true); setResult(null);
    try {
      const r = await diagnoseImportFormats();
      setResult(r);
    } catch (e) {
      console.error('[ImportFmtDiag]', e);
      showToast('Diagnostic failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  async function deleteSingleFile() {
    if (!window.confirm(
      'Delete every GG-imported receipt without a Charge ID?\n\nThese came from the single-file "Sales" import path and are duplicates of the joined Payment Details + Checkout Line Items receipts. Irreversible — re-import is the only way to undo. Run the diagnostic first to see the count.'
    )) return;
    setBusy(true);
    try {
      const r = await deleteImportedReceiptsWithoutChargeId();
      logActivity('gg_dedup_format', `scanned=${r.scanned}, deleted=${r.deleted}`);
      showToast(`Deleted ${r.deleted} no-Charge-ID receipts`, 3500);
      const after = await diagnoseImportFormats();
      setResult(after);
    } catch (e) {
      console.error('[Delete fmt]', e);
      showToast('Delete failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Import format diagnostic:</strong> if Revenue is ~half of Card sales, you likely imported the same transactions via two different paths (joined Payment + Line Items, AND the single-file "Sales" CSV). This counts each format separately and shows whether the totals are doubled.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <button onClick={diagnose} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy ? 'Running…' : 'Diagnose import formats'}
        </button>
        {result && result.withoutChargeId.count > 0 && result.withChargeId.count > 0 && (
          <button onClick={deleteSingleFile} disabled={busy}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #ef4444', background: '#fee2e2', color: '#7f1d1d', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Delete {result.withoutChargeId.count.toLocaleString()} no-Charge-ID receipts
          </button>
        )}
      </div>
      {result && (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 6, padding: 10, fontSize: 11, color: '#333' }}>
          <div style={{ marginBottom: 8 }}><strong>Total GG receipts:</strong> {result.totalGgReceipts.toLocaleString()}</div>
          <div style={{ marginBottom: 8, paddingLeft: 12, borderLeft: '3px solid #2D7A5F' }}>
            <div><strong>With Charge ID</strong> (joined-path import — keep these):</div>
            <div style={{ paddingLeft: 12, color: '#666' }}>
              {result.withChargeId.count.toLocaleString()} receipts · ${result.withChargeId.svcRev.toFixed(2)} svc rev · ${result.withChargeId.paymentTotal.toFixed(2)} payment.total
            </div>
          </div>
          <div style={{ marginBottom: 8, paddingLeft: 12, borderLeft: '3px solid #ef4444' }}>
            <div><strong>Without Charge ID</strong> (single-file "Sales" import — usually duplicates):</div>
            <div style={{ paddingLeft: 12, color: '#666' }}>
              {result.withoutChargeId.count.toLocaleString()} receipts · ${result.withoutChargeId.svcRev.toFixed(2)} svc rev · ${result.withoutChargeId.paymentTotal.toFixed(2)} payment.total
            </div>
            {result.sampleWithoutChargeId.length > 0 && (
              <div style={{ paddingLeft: 12, marginTop: 6, fontSize: 10, color: '#9a3412' }}>
                Sample: {result.sampleWithoutChargeId.map(s => `${s.date} ${s.clientName || 'Walk-in'} $${s.total.toFixed(0)}`).join(' · ')}
              </div>
            )}
          </div>
          <div style={{ marginBottom: 4 }}>
            <strong>Money math:</strong> svcRev ${result.aggregates.svcRev.toFixed(0)} + retail ${result.aggregates.retail.toFixed(0)} + tax ${result.aggregates.tax.toFixed(0)} + tip ${result.aggregates.tip.toFixed(0)} = ${result.expectedTotal.toFixed(0)}
          </div>
          <div style={{ marginBottom: 4 }}><strong>Sum of payment.total:</strong> ${result.aggregates.paymentTotal.toFixed(0)}</div>
          <div style={{ marginTop: 6, padding: '6px 8px', borderRadius: 6, background: result.inflationRatio > 1.5 ? '#fef2f2' : '#f0fdf4', color: result.inflationRatio > 1.5 ? '#7f1d1d' : '#166534' }}>
            Inflation ratio (paymentTotal / svcRev): <strong>{result.inflationRatio?.toFixed(2)}×</strong>
            {result.inflationRatio > 1.5 && ' — looks suspiciously high. Likely cross-format duplicates.'}
          </div>
        </div>
      )}
    </div>
  );
}

function CashDiagnosticBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const today = new Date().toISOString().slice(0, 10);
  const tenYearsAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 3650);
    return d.toISOString().slice(0, 10);
  })();
  const [start, setStart] = useState(tenYearsAgo);
  const [end,   setEnd]   = useState(today);

  async function diagnose() {
    setBusy(true); setResult(null);
    try {
      const r = await diagnoseCashTotals(start, end);
      setResult(r);
    } catch (e) {
      console.error('[CashDiag]', e);
      showToast('Diagnostic failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  async function dedupe() {
    if (!window.confirm(
      'Delete duplicate GG receipts?\n\nFor each Charge ID with multiple copies, the oldest is kept and the rest are deleted. This is irreversible — re-import is the only way to undo. Run the diagnostic first to see the count.'
    )) return;
    setBusy(true);
    try {
      const r = await dedupeImportedReceipts();
      logActivity('gg_dedupe', `unique=${r.uniqueChargeIds}, deleted=${r.duplicatesDeleted}`);
      showToast(`Deleted ${r.duplicatesDeleted} duplicate receipts`, 3500);
      // Refresh diagnostic so the user can see the dedup landed.
      const after = await diagnoseCashTotals(start, end);
      setResult(after);
    } catch (e) {
      console.error('[Dedupe]', e);
      showToast('Dedupe failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  async function exportChargeIds() {
    setBusy(true);
    try {
      const set = await fetchExistingGgChargeIds();
      const ids = [...set].sort();
      const blob = new Blob([JSON.stringify(ids, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `firestore-gg-charge-ids-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(`Exported ${ids.length.toLocaleString()} Charge IDs`, 3500);
    } catch (e) {
      console.error('[ExportChargeIds]', e);
      showToast('Export failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Cash total diagnostic:</strong> when the Cash KPI is way off, this breaks the total down by source (GG-imported vs in-app) and counts duplicate Charge IDs (the usual cause). Range defaults to 10 years so it covers the whole history.
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <input type="date" value={start} onChange={e => setStart(e.target.value)}
          style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit' }} />
        <span style={{ color: '#888' }}>→</span>
        <input type="date" value={end} onChange={e => setEnd(e.target.value)}
          style={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: '1px solid #d8d8d8', fontFamily: 'inherit' }} />
        <button onClick={diagnose} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy ? 'Running…' : 'Diagnose'}
        </button>
        <button onClick={exportChargeIds} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          Export Charge IDs (JSON)
        </button>
        {result && result.duplicates.extraDuplicateRows > 0 && (
          <button onClick={dedupe} disabled={busy}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #ef4444', background: '#fee2e2', color: '#7f1d1d', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
            Delete {result.duplicates.extraDuplicateRows} duplicate{result.duplicates.extraDuplicateRows !== 1 ? 's' : ''}
          </button>
        )}
      </div>
      {result && (
        <div style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 6, padding: 10, fontSize: 11, color: '#333' }}>
          <div style={{ marginBottom: 6 }}><strong>Receipts scanned:</strong> {result.receiptsScanned.toLocaleString()}</div>
          <div style={{ marginBottom: 6 }}><strong>Sales total (svc + retail):</strong> ${result.sales.allSources.toFixed(2)}</div>
          <div style={{ marginBottom: 6 }}>
            <strong>Cash total:</strong> ${result.cash.total.toFixed(2)} across {result.cash.txnCount} transactions
            <div style={{ paddingLeft: 14, color: '#666', marginTop: 2 }}>
              ↳ from GG import: ${result.cash.ggImported.total.toFixed(2)} ({result.cash.ggImported.count} txns)
            </div>
            <div style={{ paddingLeft: 14, color: '#666' }}>
              ↳ from in-app checkout: ${result.cash.inApp.total.toFixed(2)} ({result.cash.inApp.count} txns)
            </div>
          </div>
          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, background: result.duplicates.extraDuplicateRows > 0 ? '#fef2f2' : '#f0fdf4', color: result.duplicates.extraDuplicateRows > 0 ? '#7f1d1d' : '#166534' }}>
            {result.duplicates.extraDuplicateRows > 0 ? (
              <>
                <strong>⚠ Duplicates found:</strong> {result.duplicates.uniqueChargeIdsAffected} Charge IDs have multiple copies, totaling{' '}
                {result.duplicates.extraDuplicateRows} extra rows that should be deleted.
                <div style={{ fontSize: 10, marginTop: 4, color: '#9a3412' }}>
                  Sample: {result.duplicates.sample.map(s => `${s.chargeId.slice(0, 8)}…(×${s.copies})`).join(', ')}
                </div>
              </>
            ) : (
              <strong>✓ No duplicate Charge IDs.</strong>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SampleReceiptsByTechBtn() {
  const [busy,    setBusy]    = useState(false);
  const [techName, setTechName] = useState('');
  const [rows,    setRows]    = useState(null);
  const [status,  setStatus]  = useState('');

  async function run() {
    setBusy(true); setStatus('Fetching…'); setRows(null);
    try {
      const sample = await sampleGgReceiptsByTech(techName.trim(), 10);
      setRows(sample);
      setStatus(sample.length === 0 ? 'No receipts matched.' : `Showing ${sample.length} of receipts where techName = ${techName.trim() ? `"${techName.trim()}"` : '(empty)'}`);
    } catch (e) {
      console.error('[Sample] failed:', e);
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Inspect receipts by tech:</strong> shows a sample of GG-imported receipts where the tech matches. Leave blank to see receipts with no tech assigned (the "Unassigned" leaderboard row).
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <input value={techName} onChange={e => setTechName(e.target.value)}
          placeholder="techName (or blank for empty)"
          style={{ flex: 1, minWidth: 180, fontFamily: 'inherit', border: '1px solid #d8d8d8', borderRadius: 6, padding: '5px 8px', fontSize: 11, background: '#fff' }}
        />
        <button onClick={run} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy ? 'Loading…' : 'Show sample'}
        </button>
      </div>
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
      {rows && rows.length > 0 && (
        <div style={{ marginTop: 10, background: '#fff', border: '1px solid #ececec', borderRadius: 6, overflow: 'auto', maxHeight: 360 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead><tr style={{ background: '#fafafa' }}>
              <Th>Date</Th><Th>Client</Th><Th>Services</Th><Th>Retail</Th><Th>Source</Th><Th>Method</Th><Th>Tip</Th><Th>Total</Th>
            </tr></thead>
            <tbody>{rows.map((r, i) => {
              const p = r.payment || {};
              const svcs = (r.services || []).map(s => `${s.name} ($${(s.price||0).toFixed(0)})`).join(', ');
              const retail = (r.retailProducts || []).map(x => x.name).join(', ');
              return (
                <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
                  <Td>{r.date}</Td>
                  <Td>{r.clientName || '—'}</Td>
                  <Td style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={svcs}>{svcs || <em style={{ color: '#aaa' }}>none</em>}</Td>
                  <Td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={retail}>{retail || '—'}</Td>
                  <Td>{r._glossgeniusSource || '—'}</Td>
                  <Td>{p.method || '—'}</Td>
                  <Td>${(p.tip || 0).toFixed(2)}</Td>
                  <Td>${(p.total || 0).toFixed(2)}</Td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Renders the skipped-records panel after an import completes. Up to
// MAX_INLINE rows are shown in a table; beyond that the user only sees a
// summary with a CSV download so the page doesn't drown in 10,000 rows.
const MAX_INLINE_SKIPPED = 50;

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
    <div style={{ marginBottom: 12, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 12 }}>
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

function BackfillCreatedAtBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [status,  setStatus]  = useState('');
  const [unfixSample, setUnfixSample] = useState(null);

  async function run() {
    if (!window.confirm('Backfill createdAt on every receipt that\'s missing it?\n\nFalls back through payment.paidAt → r.date so the Reports range query stops silently dropping docs. Safe to run multiple times.')) return;
    setBusy(true);
    setStatus('Scanning every receipt…');
    setUnfixSample(null);
    try {
      const res = await backfillReceiptCreatedAtStrong(msg => setStatus(msg));
      setStatus(`✓ Scanned ${res.scanned.toLocaleString()} · backfilled ${res.updated.toLocaleString()} · already had createdAt ${res.skipped.toLocaleString()} · unfixable (no date) ${res.unfixable.toLocaleString()}`);
      if (res.unfixable > 0) setUnfixSample(res.sampleUnfixable);
      logActivity('receipt_backfill_createdAt_strong', `scanned ${res.scanned}, updated ${res.updated}, unfixable ${res.unfixable}`);
      showToast(`Backfilled ${res.updated} receipts · ${res.unfixable} unfixable`, 4000);
    } catch (e) {
      console.error('[Backfill] failed:', e);
      setStatus('Error: ' + e.message);
      showToast('Backfill failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 12, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Fix missing createdAt on receipts:</strong> Reports filters receipts by <code>createdAt</code> in a date range — if any receipt is missing that field, it's silently hidden from totals. This backfill scans every receipt and fills in <code>createdAt</code> from <code>payment.paidAt</code> or <code>r.date</code>. Safe to run multiple times. Run after every GG import.
      </div>
      <button onClick={run} disabled={busy}
        style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
        {busy ? 'Running…' : 'Backfill receipt createdAt'}
      </button>
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
      {unfixSample && unfixSample.length > 0 && (
        <div style={{ marginTop: 8, padding: 8, background: '#fff', border: '1px solid #fde68a', borderRadius: 6, fontSize: 11, color: '#78350f' }}>
          <strong>Receipts with no usable date</strong> (sample):
          {unfixSample.map((s, i) => (
            <div key={i} style={{ marginTop: 3 }}>{s.id} · {s.clientName || 'Walk-in'} · ${(s.total || 0).toFixed(2)} · {s.method || '—'}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function BackfillClientIdsBtn() {
  const { showToast } = useApp();
  const [busy,    setBusy]    = useState(false);
  const [status,  setStatus]  = useState('');
  const [diag,    setDiag]    = useState(null);

  async function run() {
    if (!window.confirm('Link existing GG receipts to client records?\n\nMatches each receipt\'s clientName to a client doc and stamps clientId, so Top Clients / per-tech client counts work for imported sales. Safe to run multiple times. (Import the GG Clients CSV first if you haven\'t.)')) return;
    setBusy(true);
    setStatus('Scanning…');
    setDiag(null);
    try {
      const res = await backfillImportedReceiptClientIds(msg => setStatus(msg));
      setStatus(`✓ Scanned ${res.scanned} · linked ${res.linked} · already linked ${res.alreadyLinked} · no match ${res.noMatch}`);
      logActivity('gg_backfill_clientIds', `scanned ${res.scanned}, linked ${res.linked}, noMatch ${res.noMatch}`);
      showToast(`Linked ${res.linked} receipts to clients`, 3500);
    } catch (e) {
      console.error('[Backfill] failed:', e);
      setStatus('Error: ' + e.message);
      showToast('Backfill failed: ' + e.message, 4000);
    } finally { setBusy(false); }
  }

  async function runDiag() {
    setBusy(true);
    setStatus('Diagnosing…');
    try {
      const d = await diagnoseUnlinkedReceipts();
      setDiag(d);
      setStatus(`Diagnosis: ${d.clientCount} client records · ${d.totalUnlinked} unlinked receipts`);
    } catch (e) {
      console.error('[Diag] failed:', e);
      setStatus('Error: ' + e.message);
    } finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 8, padding: 10, background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 8, fontSize: 11, color: '#555', lineHeight: 1.5 }}>
      <div style={{ marginBottom: 8 }}>
        <strong>Link receipts to clients:</strong> stamp <code>clientId</code> on imported receipts by matching <code>clientName</code> to existing client records. Required for Top Clients and per-tech client counts to reflect imported sales.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button onClick={run} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: busy ? '#f0f0f0' : '#fff', color: '#333', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>
          {busy ? 'Running…' : 'Link GG receipts to clients'}
        </button>
        <button onClick={runDiag} disabled={busy}
          style={{ fontSize: 11, padding: '5px 12px', borderRadius: 6, border: '1px solid #d8d8d8', background: '#fff', color: '#666', cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
          Diagnose mismatches
        </button>
      </div>
      {status && <div style={{ marginTop: 8, fontSize: 11, color: '#666', fontStyle: 'italic' }}>{status}</div>}
      {diag && (
        <div style={{ marginTop: 10, background: '#fff', border: '1px solid #ececec', borderRadius: 6, overflow: 'hidden', maxHeight: 280, overflowY: 'auto' }}>
          <div style={{ padding: '6px 10px', background: '#fafafa', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid #f0f0f0' }}>
            Top {diag.topNames.length} unmatched clientNames
          </div>
          {diag.topNames.length === 0 ? (
            <div style={{ padding: 12, fontSize: 11, color: '#aaa', textAlign: 'center' }}>No unlinked receipts.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#fafafa' }}>
                <th style={{ padding: '5px 10px', textAlign: 'left', fontSize: 10, color: '#888' }}>Receipt clientName</th>
                <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 10, color: '#888' }}>Receipts</th>
                <th style={{ padding: '5px 10px', textAlign: 'right', fontSize: 10, color: '#888' }}>Match found?</th>
              </tr></thead>
              <tbody>{diag.topNames.map((row, i) => (
                <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
                  <td style={{ padding: '5px 10px', color: row.name === '(empty)' ? '#aaa' : '#333', fontStyle: row.name === '(empty)' ? 'italic' : 'normal' }}>{row.name}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right', color: '#333', fontWeight: 600 }}>{row.count}</td>
                  <td style={{ padding: '5px 10px', textAlign: 'right' }}>
                    {row.hasMatch
                      ? <span style={{ color: '#16a34a', fontWeight: 600 }}>✓ yes</span>
                      : <span style={{ color: '#ef4444' }}>✗ no</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function FileSummary({ file, compact }) {
  return (
    <div style={{ marginBottom: compact ? 4 : 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#1a1a1a' }}>{file.fileName}</span>
        <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 12, background: file.type === 'unknown' ? '#fef2f2' : '#EBF4FB', color: file.type === 'unknown' ? '#ef4444' : '#1a5f8a' }}>
          {TYPE_LABELS[file.type]}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#666', marginTop: 4 }}>
        {file.records.length} rows · columns: <span style={{ color: '#999' }}>{file.headers.slice(0, 6).join(', ')}{file.headers.length > 6 ? `, +${file.headers.length - 6} more` : ''}</span>
      </div>
    </div>
  );
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
  if (type === 'appointments') {
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ background: '#fafafa' }}>
          <Th>Date</Th><Th>Time</Th><Th>Client</Th><Th>Tech</Th><Th>Service</Th><Th>$</Th>
        </tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i} style={{ borderTop: '1px solid #f5f5f5' }}>
            <Td>{r.date}</Td><Td>{r.startTime}</Td><Td>{r.clientName}</Td>
            <Td>{r.techName}</Td><Td>{r.services?.[0]?.name || '—'}</Td>
            <Td>${(r.services?.[0]?.price || 0).toFixed(2)}</Td>
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
