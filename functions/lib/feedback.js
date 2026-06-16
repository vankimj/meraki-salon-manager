// Pure helpers for turning a feedback support-ticket into a GitHub issue and
// keeping ticket status ↔ issue state in sync. No I/O here so it unit-tests
// cleanly; the GitHub HTTP calls live in functions/lib/github.js and the wiring
// in index.js.

function esc(s) { return String(s == null ? '' : s); }

// GitHub issue title. The ticket subject already carries a 🐛/💡 prefix; keep it
// but cap length for a tidy issue title.
function feedbackIssueTitle({ feedbackType, subject }) {
  const s = esc(subject).trim();
  if (s) return s.slice(0, 120);
  return `${feedbackType === 'bug' ? '🐛 Bug' : '💡 Idea'} from a salon`;
}

// Labels. GitHub auto-creates any label referenced here that doesn't exist yet,
// so this is safe without pre-provisioning. 'feature' matches the board's label
// convention; 'feedback' marks the tenant-sourced origin.
function feedbackIssueLabels(feedbackType) {
  return feedbackType === 'bug' ? ['bug', 'feedback'] : ['feature', 'feedback'];
}

// Issue body — the report plus provenance + a backlink to the platform ticket
// so an admin can jump to the live thread / reply to the salon.
function feedbackIssueBody({ tenantName, tenantId, authorEmail, text, ticketUrl }) {
  const lines = [
    esc(text).trim(),
    '',
    '---',
    `**From:** ${esc(tenantName) || esc(tenantId)}${authorEmail ? ` · ${esc(authorEmail)}` : ''}`,
    `**Tenant:** \`${esc(tenantId)}\``,
  ];
  if (ticketUrl) lines.push(`**Ticket:** ${ticketUrl}`);
  lines.push('', '_Filed via the in-app “Report a bug or idea” form._');
  return lines.join('\n');
}

// Map a ticket status to the GitHub issue state we should drive it to.
// resolved → closed/completed; closed → closed/not_planned; open & pending_owner
// → reopen. Returns null when no issue change is warranted.
function issueStateForTicketStatus(status) {
  switch (status) {
    case 'resolved': return { state: 'closed', stateReason: 'completed' };
    case 'closed':   return { state: 'closed', stateReason: 'not_planned' };
    case 'open':
    case 'pending_owner': return { state: 'open', stateReason: null };
    default: return null;
  }
}

// Map a GitHub issue's state back to a ticket status, so closing/reopening the
// issue on the board reflects to the salon. Returns null when the issue state
// implies no ticket change (e.g. still open → leave the ticket alone).
function ticketStatusForIssueState({ state, stateReason }) {
  if (state === 'closed') {
    return stateReason === 'not_planned' ? 'closed' : 'resolved';
  }
  return null; // open issue: don't override whatever the ticket currently is
}

module.exports = {
  feedbackIssueTitle,
  feedbackIssueLabels,
  feedbackIssueBody,
  issueStateForTicketStatus,
  ticketStatusForIssueState,
};
