// Pure helpers for the auto-rebook prompt at checkout.
// Suggests a "next visit" date based on per-service rebook intervals,
// and rebuilds a booking-cart shape from the services that were just done.

// Add `weeks` to a YYYY-MM-DD date string and return a YYYY-MM-DD.
export function addWeeks(dateStr, weeks) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + weeks * 7);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Suggest the next rebook date based on the visit date and the longest
// rebook interval among the services performed (so a 4-week pedi suggested
// at 4 weeks beats a 3-week mani that piggybacks on the same visit).
// Returns 'YYYY-MM-DD' or null if no service has a rebook interval set.
export function suggestRebookDate(visitDate, serviceDocs) {
  if (!visitDate || !serviceDocs?.length) return null;
  const maxWeeks = serviceDocs.reduce(
    (m, s) => Math.max(m, Number(s?.defaultRebookWeeks) || 0),
    0,
  );
  if (maxWeeks <= 0) return null;
  return addWeeks(visitDate, maxWeeks);
}

// Build a booking cart from the services that were just performed.
// Drops removal-only line items (one-time, not regularly rebooked) and
// preserves option selection so the rebook keeps the same variant.
export function rebookCartFromVisit(visitServices, serviceDocsById) {
  if (!visitServices?.length || !serviceDocsById) return [];
  const out = [];
  visitServices.forEach((s, i) => {
    if (s.isRemoval || s.id === 'removal') return;
    const svcDoc = serviceDocsById[s.id];
    if (!svcDoc) return;
    const opt = s.optionId
      ? (svcDoc.options || []).find(o => o.id === s.optionId) || null
      : null;
    out.push({
      id: `rebook_${Date.now()}_${i}`,
      service: svcDoc,
      option: opt,
      removal: false,
    });
  });
  return out;
}

// True if `appts` contains a future scheduled appointment for `clientId`
// after `fromDate` (inclusive). Used to suppress the rebook prompt when
// the client is already on the books.
export function hasFutureAppointment(appts, clientId, fromDate) {
  if (!clientId || !appts?.length) return false;
  return appts.some(a =>
    a.clientId === clientId &&
    a.status !== 'cancelled' &&
    a.date && a.date > fromDate,
  );
}

// True if the prompt should render at all — i.e., there's a real client,
// at least one service has a rebook interval, and they're not already
// booked for a future visit.
export function shouldShowRebookPrompt({ clientId, suggestedDate, futureAppts, fromDate }) {
  if (!clientId) return false;
  if (!suggestedDate) return false;
  if (hasFutureAppointment(futureAppts, clientId, fromDate)) return false;
  return true;
}
