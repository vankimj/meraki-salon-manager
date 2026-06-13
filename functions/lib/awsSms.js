// AWS End User Messaging SMS sender (pinpoint-sms-voice-v2).
//
// The AWS half of the provider swap behind sendSms() in index.js: when a
// tenant resolves to provider 'aws', the dispatch branches here instead of
// Twilio. Everything ABOVE the dispatch (opt-in/out, quota, salon-name
// prefix, STOP footer, clientSalonIndex write, usage logging) stays in
// sendSms() and is provider-agnostic — this module only turns a final
// (to, body, originationNumber) into one AWS SendTextMessage.
//
// Mirrors the conventions of getSesClient()/sendViaSES() in index.js:
//   - lazy client cache (warm-container reuse, no cold-start cost for
//     Functions that never send SMS)
//   - lazy `require` of the AWS SDK inside the client builder (same pattern
//     as the lazy `require('twilio')` in the Twilio path)
//   - never throws: returns a tagged result the caller maps to its shape.

let _smsClientCache = null;

function getAwsSmsClient({ region, accessKeyId, secretAccessKey } = {}) {
  if (_smsClientCache) return _smsClientCache;
  const { PinpointSMSVoiceV2Client } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
  _smsClientCache = new PinpointSMSVoiceV2Client({
    region: region || 'us-west-2',
    credentials: { accessKeyId, secretAccessKey },
  });
  return _smsClientCache;
}

// Send one SMS via AWS End User Messaging.
//   to:                E.164 destination (already normalized by sendSms)
//   body:              final message text (prefix + STOP footer already applied)
//   originationNumber: shared platform number to send FROM — a phone number
//                      string (E.164), a phoneNumberId, or a pool ARN. AWS
//                      accepts any of these as OriginationIdentity.
//   messageType:       'TRANSACTIONAL' (default) | 'PROMOTIONAL'
//   config:            { region, accessKeyId, secretAccessKey } — reuses the
//                      SES IAM creds.
//   client:            optional injected client (unit tests).
// Returns { ok:true, messageId } | { ok:false, error }.
async function sendViaAwsSms({ to, body, originationNumber, messageType = 'TRANSACTIONAL', config, client }) {
  if (!to || !body)         return { ok: false, error: 'missing_to_or_body' };
  if (!originationNumber)   return { ok: false, error: 'aws_sms_no_origination' };
  const cfg = config || {};
  if (!client && (!cfg.accessKeyId || !cfg.secretAccessKey)) {
    return { ok: false, error: 'aws_sms_not_configured' };
  }
  try {
    const { SendTextMessageCommand } = require('@aws-sdk/client-pinpoint-sms-voice-v2');
    const sms = client || getAwsSmsClient(cfg);
    const res = await sms.send(new SendTextMessageCommand({
      DestinationPhoneNumber: to,
      OriginationIdentity:    originationNumber,
      MessageBody:            body,
      MessageType:            messageType === 'PROMOTIONAL' ? 'PROMOTIONAL' : 'TRANSACTIONAL',
    }));
    return { ok: true, messageId: res && res.MessageId ? res.MessageId : null };
  } catch (e) {
    return { ok: false, error: (e && e.message) || 'aws_send_failed' };
  }
}

module.exports = { getAwsSmsClient, sendViaAwsSms };
