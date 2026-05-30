import LegalShell from './LegalShell.jsx';

// PLACEHOLDER LEGAL COPY — drafted for layout + plain-English clarity, NOT
// reviewed by an attorney. Replace with counsel-vetted terms before relying
// on this for actual disputes. Last update reflects the placeholder state.
export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" lastUpdated="May 8, 2026 — placeholder draft">

      <p style={{ padding: '12px 16px', background: '#fff8eb', border: '1px solid #fcd34d', borderRadius: 10, fontSize: 13 }}>
        <strong>Note:</strong> This is a plain-English placeholder draft.
        Final terms will be reviewed by counsel before launch. Questions?{' '}
        <a href="/#contact">Contact us</a>.
      </p>

      <h2>1. Who we are</h2>
      <p>
        Plume Nexus is a salon management software platform operated by JVK Consulting LLC,
        an Ohio limited liability company ("Plume Nexus", "we", "us", "our"). Our principal
        place of business is in Columbus, Ohio.
      </p>

      <h2>2. Accepting these terms</h2>
      <p>
        By creating an account, accessing, or using the Plume Nexus platform (the "Service"),
        you agree to these Terms of Service ("Terms"). If you don't agree, don't use the Service.
        If you're using the Service on behalf of a business, you represent that you have
        authority to bind that business to these Terms.
      </p>

      <h2>3. Your account</h2>
      <p>
        You're responsible for keeping your account credentials secure, for all activity that
        happens under your account, and for the accuracy of information you provide. Notify us
        promptly if you suspect unauthorized access.
      </p>

      <h2>4. Subscription, billing, and cancellation</h2>
      <ul>
        <li>The Service is offered on a monthly or annual subscription basis. Pricing is published
          at <a href="/#pricing">plumenexus.com/#pricing</a> and may change with at least 30 days' notice.</li>
        <li>You may cancel anytime. Monthly plans stop at the end of the current billing period;
          annual plans end at the end of the current annual term and are not pro-rated.</li>
        <li>We do not sell your data to anyone, ever.</li>
        <li>Past-due accounts may be suspended after a 14-day grace period.</li>
      </ul>

      <h2>5. Your data</h2>
      <p>
        You own the data you upload to the Service — your client list, appointments, employees,
        receipts, messaging history. We process that data only to operate the Service for you.
        At any time, you may export a complete copy of your data as CSV or JSON. If you cancel,
        we'll retain a backup copy for 90 days in case you change your mind, then permanently
        delete it.
      </p>

      <h2>6. AI features</h2>
      <p>
        Plume Nexus integrates Claude (by Anthropic) for reporting, voice commands, and
        marketing copy assistance. AI calls are processed server-side. We do not train AI
        models on your data, and our AI provider (Anthropic) does not retain prompts for
        training under our agreement. AI suggestions are advisory — review before acting on
        them, especially for financial or messaging actions.
      </p>

      <h2>7. Acceptable use</h2>
      <p>
        Don't use the Service to: (a) violate laws (including TCPA, CAN-SPAM, or wiretapping
        statutes); (b) send unsolicited marketing messages without consent; (c) attempt to
        reverse engineer, probe, or attack the platform; (d) impersonate someone else;
        (e) upload illegal, harmful, or infringing content. We reserve the right to suspend
        accounts violating these rules.
      </p>

      <h2>8. Third-party integrations</h2>
      <p>
        Stripe (payments), Twilio (SMS), AWS SES (email), and Gusto (payroll) operate under
        their own terms, which apply when you use those features. You are responsible for
        maintaining your own accounts with these providers and for any fees they charge.
      </p>

      <h2>9. Service availability</h2>
      <p>
        We aim for 99.9% uptime but don't guarantee uninterrupted service. Scheduled
        maintenance is announced in advance. We are not liable for damages from temporary
        outages or third-party failures (e.g., a Stripe outage, a Twilio carrier issue).
      </p>

      <h2>10. Limitation of liability</h2>
      <p>
        To the maximum extent allowed by law, Plume Nexus's total liability for any claim
        related to the Service is limited to the fees you paid in the 12 months before the
        claim arose. We are not liable for indirect, incidental, or consequential damages
        (lost profits, lost data, business interruption).
      </p>

      <h2>11. Changes to these terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be announced with
        at least 30 days' notice via email and a banner in the app. Continued use after the
        effective date means you accept the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of the State of Ohio, without regard to its
        conflict-of-laws rules. Disputes will be resolved in the state or federal courts
        located in Franklin County, Ohio.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Reach out at <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> or
        via the <a href="/#contact">contact form</a>.
      </p>
    </LegalShell>
  );
}
