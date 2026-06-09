// Lightweight booking-abuse helpers: disposable-email detection. Curated, not
// exhaustive — covers the common temp-mail providers used for fake/bot signups.
// Matching is on the registrable domain (and any subdomain of it),
// case-insensitive. Extend the set as new throwaway providers show up.

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.net',
  'grr.la', 'sharklasers.com', 'spam4.me',
  '10minutemail.com', '10minutemail.net', 'tempmail.com', 'temp-mail.org', 'tempmailo.com',
  'tempmail.dev', 'tempmailaddress.com', 'tempinbox.com', 'tempr.email', 'tmpmail.org', 'tmpmail.net',
  'yopmail.com', 'yopmail.fr', 'yopmail.net',
  'throwawaymail.com', 'getnada.com', 'nada.email', 'dispostable.com', 'discard.email',
  'maildrop.cc', 'mailnesia.com', 'mailcatch.com', 'mailsac.com', 'moakt.com', 'mohmal.com',
  'trashmail.com', 'trashmail.de', 'trash-mail.com', 'mytemp.email', 'fakeinbox.com',
  'inboxbear.com', 'emailondeck.com', 'spamgourmet.com', 'luxusmail.org',
  'burnermail.io', '33mail.com', 'mintemail.com', 'fakemailgenerator.com', 'wegwerfmail.de',
]);

function emailDomain(email) {
  const e = String(email || '').toLowerCase().trim();
  const at = e.lastIndexOf('@');
  return at >= 0 ? e.slice(at + 1) : '';
}

// True if the email's domain is a known disposable provider (or a subdomain of
// one, e.g. foo.mailinator.com).
function isDisposableEmail(email) {
  const d = emailDomain(email);
  if (!d) return false;
  for (const bad of DISPOSABLE_EMAIL_DOMAINS) {
    if (d === bad || d.endsWith('.' + bad)) return true;
  }
  return false;
}

module.exports = { DISPOSABLE_EMAIL_DOMAINS, emailDomain, isDisposableEmail };
