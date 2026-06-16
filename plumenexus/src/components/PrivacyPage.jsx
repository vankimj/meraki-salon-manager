import LegalShell from './LegalShell.jsx';

// Plain-English Privacy Policy for Plume Nexus LLC, accurate to how the platform
// handles data (Stripe never exposes card numbers, no AI training, free export,
// 30-day soft-delete purge, named subprocessors). Includes California (CCPA/CPRA) and
// EU/UK (GDPR) sections. Recommended: a final review by privacy counsel before
// launch, especially if you knowingly serve EU/UK residents.
export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" lastUpdated="June 15, 2026">

      <h2>What this covers</h2>
      <p>
        This Privacy Policy explains how <strong>Plume Nexus LLC</strong> ("Plume Nexus", "we",
        "us") collects, uses, shares, and protects information when you use the platform (the
        "Service") or visit <a href="https://plumenexus.com">plumenexus.com</a>.
      </p>
      <p>
        <strong>Our two roles.</strong> For your account information and our marketing site, Plume
        Nexus is the data <em>controller</em>. For the personal information about <em>your clients</em>{' '}
        that you upload or collect through the Service to run your business, <strong>you are the
        controller and Plume Nexus is your processor</strong> — we handle that data on your
        instructions to provide the Service.
      </p>

      <h2>1. Information we collect</h2>

      <h3>From you, the salon owner / operator</h3>
      <ul>
        <li><strong>Account info:</strong> name, email, phone, business name, and billing details.
          Card numbers are handled by Stripe — <strong>we never see or store your full card
          number.</strong></li>
        <li><strong>Operational data:</strong> the client lists, appointments, employees, services,
          receipts, and messages you upload to run your business.</li>
        <li><strong>Usage data:</strong> sign-in events, features used, device/browser info, and
          error logs.</li>
      </ul>

      <h3>From your clients (the people booking with your salon)</h3>
      <ul>
        <li>Contact details, appointment history, payment receipts, and message history that you
          collect in the normal course of running your business.</li>
        <li>For online booking, what they enter into your booking page.</li>
        <li>Marketing opt-in/opt-out preferences and unsubscribe events.</li>
      </ul>

      <h3>From visitors to plumenexus.com</h3>
      <ul>
        <li>Standard server logs (IP address, user agent, referring page, requested URL).</li>
        <li>Anything you submit via the contact form or chat widget.</li>
        <li>Cookies and local storage for session state and security — we do not use third-party
          advertising or cross-site tracking pixels.</li>
      </ul>

      <h2>2. How we use information</h2>
      <ul>
        <li>To operate, secure, and support the Service, and to bill your subscription.</li>
        <li>To send transactional messages (account, billing, security, service notices).</li>
        <li>To send product updates if you've opted in.</li>
        <li>To improve the Service using aggregated, de-identified analytics — never to profile or
          target an individual customer.</li>
        <li>To detect, prevent, and address fraud, abuse, and security incidents.</li>
        <li>To comply with legal obligations and enforce our <a href="/terms">Terms</a>.</li>
      </ul>

      <h2>3. How we do NOT use information</h2>
      <ul>
        <li><strong>We do not sell your personal information, and we do not "share" it for
          cross-context behavioral advertising</strong> as those terms are defined under California
          law.</li>
        <li>We do not share your client lists with anyone outside your account.</li>
        <li>We do not train AI models on Your Data. Our AI provider (Anthropic) operates under a
          zero-retention arrangement for our API traffic.</li>
        <li>We do not embed third-party advertising trackers on plumenexus.com.</li>
      </ul>

      <h2>4. Service providers (subprocessors)</h2>
      <p>To run the Service, we share data with vetted providers, each contractually bound to use
        it only to perform their service for us:</p>
      <ul>
        <li><strong>Google Cloud / Firebase</strong> — hosting, database, authentication.</li>
        <li><strong>Stripe</strong> — payment processing and Stripe Connect payouts.</li>
        <li><strong>Twilio</strong> and/or <strong>AWS End User Messaging</strong> — SMS delivery.</li>
        <li><strong>Amazon SES</strong> — transactional and marketing email delivery.</li>
        <li><strong>Anthropic (Claude)</strong> — AI features, under a zero-retention arrangement.</li>
        <li><strong>Gusto</strong> — payroll, only if you enable the integration.</li>
      </ul>
      <p>We may also disclose information if required by law, to protect rights and safety, or in
        connection with a merger or acquisition (with notice).</p>

      <h2>5. Your rights and choices</h2>
      <ul>
        <li><strong>Export:</strong> download a complete copy of Your Data at any time via the
          in-app backup tool — free, on every plan.</li>
        <li><strong>Delete:</strong> delete your account at any time; on request we permanently remove
          your records. Items you delete sit in an in-app recycle bin and are automatically purged
          after 30 days (subject to legal retention and routine backup cycles).</li>
        <li><strong>Correct:</strong> edit your data directly with the in-app tools.</li>
        <li><strong>Opt out of marketing:</strong> use the unsubscribe link in any marketing email,
          or reply STOP to any marketing SMS.</li>
        <li><strong>Other requests:</strong> email <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a>.</li>
      </ul>
      <p>
        If you are a client of a salon that uses Plume Nexus and want to access, correct, or delete
        your information, please contact that salon directly — they control that data. We will
        assist the salon in responding to your request.
      </p>

      <h2>6. California privacy rights (CCPA / CPRA)</h2>
      <p>
        If you are a California resident, you have the right to know what personal information we
        collect and how we use it, to request access to and deletion of your personal information,
        to correct inaccurate information, and to not be discriminated against for exercising these
        rights. The categories we collect and our purposes are described above.{' '}
        <strong>We do not sell or share your personal information</strong> as those terms are
        defined under the CCPA/CPRA, and we have not done so in the preceding 12 months. To make a
        request, email <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a>; we will
        verify your request and respond within the time the law allows. You may use an authorized
        agent.
      </p>

      <h2>7. European Economic Area / UK rights (GDPR)</h2>
      <p>
        If you are in the EEA or UK, you have rights to access, rectify, erase, restrict, and
        port your personal data, and to object to certain processing. Where we are the controller
        (your account data, the marketing site), our legal bases are: performance of our contract
        with you, our legitimate interests in operating and securing the Service, your consent
        (for optional marketing), and compliance with legal obligations. Where we process your
        clients' data, we do so as a processor on the salon's instructions. To exercise your
        rights, contact <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a>; you also
        have the right to complain to your local supervisory authority.
      </p>

      <h2>8. International data transfers</h2>
      <p>
        Plume Nexus is operated from the United States, and the Service is hosted on US-based cloud
        infrastructure. If you access the Service from outside the US, you understand your
        information will be processed in the US, where data-protection laws may differ from those in
        your country. Where required, we rely on appropriate safeguards (such as Standard
        Contractual Clauses) for international transfers.
      </p>

      <h2>9. Security</h2>
      <ul>
        <li>All data in transit is encrypted via HTTPS / TLS; data at rest is encrypted by Google
          Cloud.</li>
        <li>Role-based access controls inside the app (admin / scheduler / staff / read-only), with
          optional PIN locks on sensitive modules (HR, Reports). Admin accounts sign in through
          Google, so Google's 2-step verification protects them.</li>
        <li>Tenant data is logically isolated per salon, with security rules enforced server-side.</li>
        <li>Point-in-time recovery, redundant backups, a soft-delete recycle bin, and verbose
          activity logging on privileged actions.</li>
      </ul>
      <p>No system is perfectly secure, but we work continuously to protect your information and to
        respond promptly to any incident.</p>

      <h2>10. Data retention</h2>
      <ul>
        <li>Active account data: retained while your account is active.</li>
        <li>Deleted records: held in the in-app recycle bin, then permanently purged after 30 days.</li>
        <li>Cancelled accounts: your data stays exportable until you ask us to delete it; we then
          permanently remove it (subject to routine backup cycles).</li>
        <li>Marketing-site inquiries: retained up to 24 months.</li>
        <li>Server and security logs: retained up to 90 days.</li>
      </ul>

      <h2>11. Children's privacy</h2>
      <p>
        Plume Nexus is a B2B platform not directed at children under 13 (or under 16 in the EEA/UK),
        and we do not knowingly collect personal information from children. If you believe a child
        provided us information, contact us and we will delete it.
      </p>

      <h2>12. Changes to this policy</h2>
      <p>
        Material changes will be announced via email and a banner in the app at least 30 days before
        they take effect. The "last updated" date above always reflects the current version.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions, concerns, or privacy requests? Email{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> or use the{' '}
        <a href="/#contact">contact form</a>. Plume Nexus LLC is organized in the State of Ohio,
        USA. We aim to respond within one business day.
      </p>
    </LegalShell>
  );
}
