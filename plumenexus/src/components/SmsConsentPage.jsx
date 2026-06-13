import LegalShell from './LegalShell.jsx';

export default function SmsConsentPage() {
  return (
    <LegalShell title="SMS Terms & Consent" lastUpdated="May 15, 2026">

      <p style={{ padding: '12px 16px', background: '#fff8eb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: 13 }}>
        <strong>Scope:</strong> This page describes the SMS messages Plume Nexus
        sends to <em>you, the salon owner</em>, about your Plume Nexus account.
        It does <strong>not</strong> cover messages your salon sends to your own
        clients through the platform — those are governed by your own SMS terms.
      </p>

      <h2>Who sends these messages</h2>
      <p>
        Plume Nexus (operated by Plume Nexus LLC, Lewis Center, Ohio) sends
        SMS to salon owners who have created an account at{' '}
        <a href="/signup">plumenexus.com/signup</a>.
      </p>

      <h2>What we send</h2>
      <p>This phone number is used <strong>exclusively for transactional account messages</strong>:</p>
      <ul>
        <li><strong>Verification codes</strong> — one-time passcodes when you sign up or sign in.</li>
        <li><strong>Billing alerts</strong> — payment failures, upcoming renewal reminders, plan changes.</li>
        <li><strong>Account security</strong> — password changes, new device sign-ins, suspicious-activity warnings.</li>
        <li><strong>Lifecycle notices</strong> — trial expiration, plan-status changes, important account updates.</li>
      </ul>
      <p>
        We do <strong>not</strong> send marketing or promotional content from this number.
        Marketing communication from Plume Nexus is handled by email only.
      </p>

      <h2>How you opted in</h2>
      <p>
        When you signed up at <a href="/signup">plumenexus.com/signup</a>, you
        entered your mobile phone number and completed a one-time passcode (OTP)
        verification. Submitting that verification constitutes your express
        consent to receive the account-related SMS messages described above.
      </p>

      <h2>Frequency</h2>
      <p>
        Message frequency varies. A typical active customer receives fewer than
        five messages per month. Verification codes are sent only when you
        actively initiate sign-in.
      </p>

      <h2>Cost</h2>
      <p>
        Plume Nexus does not charge for these messages. Standard message and
        data rates from your mobile carrier may apply.
      </p>

      <h2>Opt out — STOP</h2>
      <p>
        You can opt out of any further SMS at any time by replying{' '}
        <strong>STOP</strong> to any message we send. We'll send one final
        confirmation that you've been unsubscribed. After that, you will not
        receive further SMS from this number.
      </p>
      <p>
        <strong>Important:</strong> If you opt out of account SMS, you will lose
        access to SMS-based features including phone-based sign-in. You can
        re-enable SMS at any time by signing in to your account and re-verifying
        your phone, or by replying <strong>START</strong> to the same number.
      </p>

      <h2>Help — HELP</h2>
      <p>
        Reply <strong>HELP</strong> to any message to receive support
        information. You can also reach us anytime at{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a>.
      </p>

      <h2>Supported carriers</h2>
      <p>
        Messages are delivered via major US carriers including AT&amp;T,
        T-Mobile, Verizon, Sprint, US Cellular, and most regional and MVNO
        carriers. Carriers are not liable for delayed or undelivered messages.
      </p>

      <h2>Privacy</h2>
      <p>
        Your phone number and our message history with you are handled per our{' '}
        <a href="/privacy">Privacy Policy</a>. We do not sell, share, or rent
        your phone number to third parties for marketing purposes.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        Material changes to these SMS Terms will be announced via email or
        in-app notice at least 30 days before they take effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about SMS messages from Plume Nexus? Email{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> or call{' '}
        <a href="tel:+16145822703">(614) 582-2703</a>.
      </p>

    </LegalShell>
  );
}
