import LegalShell from './LegalShell.jsx';

// Plain-English Terms of Service for Plume Nexus LLC. Drafted to be accurate to
// how the platform actually works (SaaS subscription + Stripe Connect
// destination charges, salon owns its data, free export, no AI training).
// Recommended: a final review by counsel licensed in Ohio before relying on
// this in a dispute.
export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" lastUpdated="June 15, 2026">

      <p>
        These Terms of Service ("Terms") are a binding agreement between you and Plume Nexus LLC.
        Please read them carefully. By creating an account or using the Service you agree to them.
      </p>

      <h2>1. Who we are</h2>
      <p>
        Plume Nexus is a multi-tenant salon-management software platform operated by{' '}
        <strong>Plume Nexus LLC</strong>, an Ohio limited liability company ("Plume Nexus",
        "we", "us", "our"). We provide salon-management software — scheduling, client records,
        point-of-sale, marketing, messaging, and AI-powered reporting — on a subscription basis,
        and we operate a Stripe Connect platform that lets each salon accept card payments from
        its own clients. We do not hold funds on behalf of merchants (see Section 5).
      </p>

      <h2>2. Accepting these Terms</h2>
      <p>
        By creating an account, accessing, or using the Plume Nexus platform (the "Service"),
        you agree to these Terms. If you don't agree, don't use the Service. If you're using the
        Service on behalf of a business, you represent that you have authority to bind that
        business to these Terms, and "you" refers to that business.
      </p>

      <h2>3. Eligibility and your account</h2>
      <p>
        You must be at least 18 and able to form a binding contract. You're responsible for
        keeping your account credentials secure, for all activity that happens under your account,
        and for the accuracy of the information you provide. You're responsible for your staff's
        and authorized users' use of the Service. Notify us promptly at{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> if you suspect
        unauthorized access.
      </p>

      <h2>4. Subscription, billing, and cancellation</h2>
      <ul>
        <li>The Service is offered on a monthly or annual subscription basis. Current pricing is
          published at <a href="/#pricing">plumenexus.com/#pricing</a> and may change with at
          least 30 days' notice for your next renewal.</li>
        <li>Paid plans renew automatically until cancelled. You may cancel anytime. Monthly plans
          end at the close of the current billing period; annual plans end at the close of the
          current annual term and are not pro-rated or refunded for partial periods.</li>
        <li>Optional Power Packs and add-ons are billed alongside your base plan and follow the
          same terms.</li>
        <li>Founders'-Year and promotional pricing is honored as described at signup; lifetime
          "free for life" eligibility applies to Founders' Members who join during the stated
          window and is subject to continued good standing.</li>
        <li>Fees are exclusive of any applicable taxes, which are your responsibility.</li>
        <li>Past-due accounts may be suspended after a 14-day grace period. Suspension does not
          delete your data (see Section 6).</li>
      </ul>

      <h2>5. Payments and Stripe Connect</h2>
      <p>
        Card payments your salon accepts from its own clients are processed through Stripe using
        Stripe Connect. You connect your own Stripe account, and funds for your transactions
        settle <strong>directly to your connected account</strong> via destination charges.
        <strong> Plume Nexus does not take possession of or hold those funds.</strong>
      </p>
      <ul>
        <li>You are the merchant of record for payments you accept from your clients, and you are
          responsible for refunds, chargebacks, disputes, and any sales or service taxes on those
          transactions.</li>
        <li>Your use of Stripe is governed by the{' '}
          <a href="https://stripe.com/legal/connect-account" target="_blank" rel="noopener noreferrer">Stripe Connected Account Agreement</a>{' '}
          and Stripe's terms, which you accept when you connect your account.</li>
        <li>Card processing fees are set and charged by Stripe. Your Plume Nexus subscription fee
          is separate from, and in addition to, those processing fees.</li>
      </ul>

      <h2>6. Your data — ownership and portability</h2>
      <p>
        You own the data you put into the Service — your client list, appointments, employees,
        services, receipts, and messaging history ("Your Data"). We process Your Data only to
        provide and support the Service for you, as described in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <ul>
        <li><strong>Export is free, on every plan, forever.</strong> You may export a complete
          copy of Your Data at any time, including after you cancel. We will never hold your data
          behind a paywall.</li>
        <li>If you cancel or delete your account, we retain a backup copy for 90 days in case you
          change your mind, then permanently delete it (subject to legal retention obligations and
          routine backup cycles).</li>
        <li>We never sell Your Data, and we never share your client lists outside your account.</li>
      </ul>

      <h2>7. Your clients' data — your responsibilities</h2>
      <p>
        With respect to the personal information of your clients that you upload or collect through
        the Service, <strong>you are the data controller and Plume Nexus is your data processor</strong>.
        You represent that you have the legal right and any necessary consent to collect that
        information and to use the Service to process it.
      </p>
      <ul>
        <li><strong>Messaging consent:</strong> You are responsible for obtaining the consent
          required to send SMS and email to your clients and for complying with the TCPA, CAN-SPAM,
          and similar laws. The Service provides opt-out tools (STOP for SMS, unsubscribe links for
          email); you must honor opt-outs and not message clients who have opted out.</li>
        <li>You must provide your clients with a privacy notice consistent with applicable law for
          the data you collect about them.</li>
      </ul>

      <h2>8. AI features</h2>
      <p>
        Plume Nexus integrates Claude (by Anthropic) for reporting, voice commands, and
        marketing-copy assistance. AI calls are processed server-side. We do not train AI models on
        Your Data, and our AI provider does not retain prompts for training under our agreement.
        AI outputs are <strong>advisory</strong> — review them before acting, especially for
        financial actions or client messaging. You are responsible for content you send after
        using an AI suggestion.
      </p>

      <h2>9. Acceptable use</h2>
      <p>Don't use the Service to:</p>
      <ul>
        <li>violate any law, including the TCPA, CAN-SPAM, or wiretapping/consent statutes;</li>
        <li>send unsolicited marketing without the required consent;</li>
        <li>reverse engineer, probe, scrape, overload, or attempt to gain unauthorized access to
          the platform or other tenants' data;</li>
        <li>impersonate another person or misrepresent your affiliation;</li>
        <li>upload unlawful, infringing, malicious, or harmful content.</li>
      </ul>
      <p>We may suspend or terminate accounts that violate these rules (see Section 14).</p>

      <h2>10. Third-party integrations</h2>
      <p>
        Stripe (payments), Twilio and/or AWS End User Messaging (SMS), Amazon SES (email), Google
        Cloud / Firebase (hosting), Anthropic (AI), and Gusto (payroll, if enabled) operate under
        their own terms, which apply when you use those features. You are responsible for
        maintaining any of your own accounts with these providers and for fees they charge.
      </p>

      <h2>11. Service availability and support</h2>
      <p>
        We work hard to keep the Service available and aim for high uptime, but we do not guarantee
        uninterrupted or error-free service. Scheduled maintenance is announced in advance where
        practical. We are not responsible for outages or failures of third-party providers (for
        example, a Stripe outage or a carrier SMS delay). Support is provided at the level described
        for your plan.
      </p>

      <h2>12. Disclaimer of warranties</h2>
      <p>
        Except where prohibited by law, the Service is provided <strong>"as is" and "as available"</strong>
        without warranties of any kind, whether express or implied, including implied warranties of
        merchantability, fitness for a particular purpose, and non-infringement. You are responsible
        for your business and financial decisions; the Service and its reports are tools, not
        professional, legal, tax, or accounting advice.
      </p>

      <h2>13. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Plume Nexus's total liability for any claim relating
        to the Service is limited to the fees you paid to Plume Nexus in the 12 months before the
        claim arose. We are not liable for indirect, incidental, special, or consequential damages
        (including lost profits, lost data, or business interruption), even if advised of the
        possibility.
      </p>

      <h2>14. Suspension and termination</h2>
      <p>
        You may stop using the Service and cancel at any time. We may suspend or terminate your
        access if you materially breach these Terms, fail to pay, or use the Service in a way that
        risks harm to other users or to the platform — with notice where practical, and immediately
        where necessary to prevent harm. On termination, your right to use the Service ends, and the
        data provisions in Section 6 apply.
      </p>

      <h2>15. Indemnification</h2>
      <p>
        You agree to defend and indemnify Plume Nexus against third-party claims arising from your
        use of the Service in violation of these Terms or applicable law, including claims by your
        clients relating to data you collected or messages you sent through the Service without the
        required consent.
      </p>

      <h2>16. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be announced with at
        least 30 days' notice via email and a banner in the app. Continued use after the effective
        date means you accept the updated Terms.
      </p>

      <h2>17. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the State of Ohio, without regard to its
        conflict-of-laws rules. You and Plume Nexus agree to the exclusive jurisdiction of the
        state and federal courts located in Franklin County, Ohio for any dispute not subject to a
        separate written agreement.
      </p>

      <h2>18. Contact</h2>
      <p>
        Questions or legal notices regarding these Terms can be sent to{' '}
        <a href="mailto:hello@plumenexus.com">hello@plumenexus.com</a> or via the{' '}
        <a href="/#contact">contact form</a>. Plume Nexus LLC is organized in the State of Ohio,
        USA.
      </p>
    </LegalShell>
  );
}
