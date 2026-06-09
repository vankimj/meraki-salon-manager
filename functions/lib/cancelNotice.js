// Pure helpers for the customer cancellation notice (notifyCustomerOnCancel).
// Kept separate from index.js so the gating + copy are unit-testable without
// Firestore / SES / Twilio.

// Should we message the client for this cancellation?
//   - Self-service cancel (client did it themselves): only if the salon opted
//     into a confirmation (cancelConfirmSelfService === true). Default off.
//   - Staff / salon cancel: on unless explicitly disabled
//     (cancelNotifyCustomer === false). Default on.
function shouldSendCancelNotice(settings, cancelledBy) {
  const s = settings || {};
  const selfService = cancelledBy === 'client_self_service';
  return selfService
    ? s.cancelConfirmSelfService === true
    : s.cancelNotifyCustomer !== false;
}

// SMS body — deliberately no rating/review link. Includes a rebook link when
// one is available.
function buildCancelSms({ firstName, dateShort, timeShort, rebookUrl, selfService }) {
  const name = String(firstName || 'there').trim() || 'there';
  const when = [dateShort, timeShort].filter(Boolean).join(' ');
  const lead = selfService
    ? `Hi ${name}, your ${when} appointment is cancelled.`
    : `Hi ${name}, we're sorry — your ${when} appointment was cancelled.`;
  return rebookUrl ? `${lead} Rebook anytime: ${rebookUrl}` : lead;
}

module.exports = { shouldSendCancelNotice, buildCancelSms };
