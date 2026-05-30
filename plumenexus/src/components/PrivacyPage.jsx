import LegalShell from './LegalShell.jsx';

// PLACEHOLDER LEGAL COPY — drafted for layout + plain-English clarity, NOT
// reviewed by an attorney. Replace with counsel-vetted privacy policy before
// launch (especially if collecting CA/EU resident data).
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated="May 8, 2026 — placeholder draft">

      <p style={{ padding: '12px 16px', background: '#fff8eb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: 13 }}>
        <strong>Note:</strong> This is a plain-English placeholder draft.
        Final policy will be reviewed by counsel before launch (and may add CCPA / GDPR
        sections depending on jurisdiction). Questions?{' '}
        <a href="/#contact">Contact us</a>.
      </p>

      <h2>What this covers</h2>
      <p>
        This Privacy Policy explains how Plume Nexus (operated by JVK Consulting LLC)
        collects, uses, and protects information when you use the platform or visit{' '}
        <a href="https://plumenexus.com">plumenexus.com</a>.
      </p>

      <h2>1. Information we collect</h2>

      <h3>From you, the salon owner / operator</h3>
      <ul>
        <li><strong>Account info:</strong> name, email, phone, business name, billing address, payment method (handled by Stripe — we never see your card number).</li>
        <li><strong>Operational data:</strong> the client lists, appointments, employees, services, receipts, and messages you upload to run your business through the platform.</li>
        <li><strong>Usage data:</strong> when you log in, which features you use, error logs.</li>
      </ul>

      <h3>From your clients (the people booking with your salon)</h3>
      <ul>
        <li>Contact details, appointment history, payment receipts, message history that you collect from them in the normal course of running your business.</li>
        <li>For online booking, we collect what they enter into your booking page.</li>
        <li>Per CAN-SPAM and TCPA: marketing opt-in/out preferences, unsubscribe events.</li>
      </ul>

      <h3>From visitors to plumenexus.com</h3>
      <ul>
        <li>Standard server logs (IP, user agent, referring page, requested URL).</li>
        <li>Anything you submit via the contact form or chat widget.</li>
        <li>Cookies for session state — no third-party tracking pixels at this time.</li>
      </ul>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To operate the Service, provide support, and bill your subscription.</li>
        <li>To send you transactional emails (account, billing, security).</li>
        <li>To send you product updates if you've opted in.</li>
        <li>To improve the Service (aggregated, anonymized analytics — never targeted at one customer).</li>
        <li>To comply with legal obligations.</li>
      </ul>

      <h2>3. How we DO NOT use your information</h2>
      <ul>
        <li>We do not sell your data, ever.</li>
        <li>We do not share your client lists with anyone outside your account.</li>
        <li>We do not train AI models on your data. Our AI provider (Anthropic) operates under a zero-retention agreement for our API traffic.</li>
        <li>We do not embed third-party advertising trackers on plumenexus.com.</li>
      </ul>

      <h2>4. Service providers we share data with</h2>
      <p>To operate, we use:</p>
      <ul>
        <li><strong>Google Cloud / Firebase</strong> — hosting and database.</li>
        <li><strong>Stripe</strong> — payment processing.</li>
        <li><strong>Twilio</strong> — SMS messaging.</li>
        <li><strong>Amazon Web Services (AWS SES)</strong> — email delivery.</li>
        <li><strong>Anthropic (Claude)</strong> — AI features (zero-retention).</li>
        <li><strong>Gusto</strong> — payroll, only if you enable the integration.</li>
      </ul>
      <p>Each provider is contractually bound to use your data only to perform their service for us.</p>

      <h2>5. Your rights and choices</h2>
      <ul>
        <li><strong>Export:</strong> Download a complete copy of your data anytime as CSV or JSON via the in-app backup tool.</li>
        <li><strong>Delete:</strong> Delete your account at any time. We retain a backup for 90 days, then permanently delete.</li>
        <li><strong>Correct:</strong> Edit any data via the in-app tools.</li>
        <li><strong>Opt out of marketing:</strong> Unsubscribe link in every marketing email; reply STOP to any marketing SMS.</li>
        <li><strong>Access:</strong> Email <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> for any other data request.</li>
      </ul>

      <h2>6. Security</h2>
      <ul>
        <li>All data in transit is encrypted via HTTPS / TLS.</li>
        <li>Database encrypted at rest by Google Cloud.</li>
        <li>Role-based access controls inside the app (admin / scheduler / tech / read-only).</li>
        <li>Optional PIN locks on sensitive modules (HR, Reports).</li>
        <li>2FA for admin accounts on Salon Pro plans.</li>
        <li>Verbose activity logs on every privileged action.</li>
      </ul>

      <h2>7. Data retention</h2>
      <ul>
        <li>Active account data: retained for as long as your account is active.</li>
        <li>Cancelled accounts: 90-day grace period, then permanent deletion.</li>
        <li>Marketing-site inquiries: retained 24 months.</li>
        <li>Server logs: retained 90 days.</li>
      </ul>

      <h2>8. Children's privacy</h2>
      <p>
        Plume Nexus is a B2B platform not directed at children under 13. We don't
        knowingly collect personal information from children.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        Material changes will be announced via email and a banner in the app at least
        30 days before they take effect.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions, concerns, or requests? Email{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> or use the{' '}
        <a href="/#contact">contact form</a>. We'll respond within one business day.
      </p>
    </LegalShell>
  );
}
