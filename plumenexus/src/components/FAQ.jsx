import { useState } from 'react';
import { C, FONT, radius } from '../theme.js';
import Section from './Section.jsx';

const ITEMS = [
  {
    q: 'What is "Founders\' Year" and how does it work?',
    a: 'Sign up for the Solo plan before June 30, 2027 and you join our Founders\' cohort — Solo is free for life on your account, no expiration, no surprise charge later. After the Founders\' Year window closes, the Solo plan becomes paid for new signups. Founders\' Members keep their lifetime free Solo regardless. Plus a small badge in the app, early access to new features, and a vote on our roadmap.',
  },
  {
    q: 'Can I migrate from my current platform?',
    a: 'Yes — and we make it painless. Export your client list and transaction history from your current platform as CSV; we run a one-time import that brings over clients, services, employees, and historical receipts. Most salons are fully migrated within a single business day. The migration tool dedupes refunds and split payments correctly — no duplicate charges in your books.',
  },
  {
    q: 'Are there hidden fees or add-on charges?',
    a: 'No. Loyalty, marketing campaigns, gift cards, AI reporting, two-way messaging, voice commands, IRS-ready tax export — all built in. Your monthly price is your monthly price. The only third-party costs you might see are SMS overages on Solo plans (we include generous monthly allotments) and any optional integrations you enable like payroll. No "$45/mo loyalty add-on", no "marketing pack upgrade", no surprises on your invoice.',
  },
  {
    q: 'Do you take a cut of my appointments or transactions?',
    a: 'Never. We don\'t charge per-appointment fees, per-transaction surcharges, or commissions on your bookings. We don\'t sit between you and your clients in a marketplace. Your Stripe account processes payments and your bank receives them directly — Plume Nexus is just the software layer.',
  },
  {
    q: 'Do I need to install anything?',
    a: 'No. Plume Nexus runs in any modern browser — your front desk Mac, the back-office iPad, your phone — and is also a Progressive Web App (installable to your home screen with offline-tolerant POS). A native iOS + Android app with Tap-to-Pay is in active development.',
  },
  {
    q: 'Do I need to set up Stripe, Twilio, or any other accounts on my own?',
    a: 'No. The only platform you ever sign into is Plume Nexus. We handle every third-party service under the hood — payment processing, SMS, email, AI, payroll, bank verification, all of it. You never see a Stripe login, never get a Twilio bill, never configure email DNS records. You enter your bank info and tax ID once during signup, and we set up everything else in the background. The only exception is if you want to bring your own existing Stripe or Gusto account — that takes a single one-click sign-in from inside Plume Nexus, never sending you to another website.',
  },
  {
    q: 'How long does setup actually take?',
    a: 'Live by lunch — that\'s the promise. With our AI auto-import (paste your existing website URL and we pull in your services, hours, and brand details automatically), most salons are operational within 30 minutes. Starting completely fresh with no existing site? About an hour. Migrating from another platform with full historical data? Same business day, with white-glove migration on us during Founders\' Year. If you can\'t get set up in time, we\'ll concierge it for you for free.',
  },
  {
    q: 'How does AI fit in? Is my client data private?',
    a: 'AI runs in read-only mode for reporting questions. Voice command booking proposes an action and waits for your confirmation before writing anything. We never train models on your data, and we never share it. All AI calls are processed server-side through your own Plume Nexus backend.',
  },
  {
    q: 'Can the Plume Nexus team see my client data?',
    a: 'No, not by default — and we mean that literally. Our platform admin dashboard shows us only metadata about your account (plan, billing, last activity, total counts). We cannot read your client list, your appointments, your receipts, or your messages. If you ever want our help with something specific, you invite our team as an admin via your own salon\'s users settings — exactly the same Google sign-in flow you\'d use to add any of your own staff. You see who has access, you can revoke it any time. Most SaaS companies quietly keep god-mode access for "support" purposes. We architected the platform so we can\'t. The only exception is Meraki Nail Studio, where the founder is the actual salon owner — and even there, his access flows through the normal tenant-admin role, not via any platform backdoor.',
  },
  {
    q: 'Will the AI replace my staff?',
    a: 'No — it removes the work nobody enjoys. AI doesn\'t answer your phone, greet your clients, or do nails. It drafts the texts when a tech calls in sick, surfaces the lapsed clients you forgot to follow up with, answers "how did Saturday go?" with real numbers in seconds. Your front desk gets back the hours they were burning on busywork. Same headcount, more time on the floor.',
  },
  {
    q: 'What payment processors do you support?',
    a: 'Stripe is built in, with multi-tech credit splits, tip-per-service, gift cards, refunds, and Tap-to-Pay (iOS coming Q3). Each tenant connects their own Stripe account, so funds settle directly to your bank — we never sit between you and your money.',
  },
  {
    q: 'How does the two-way SMS work?',
    a: 'You get a dedicated phone number (or port your existing one). Inbound texts route to the right client thread automatically. Outbound is unlimited within your plan. Marketing SMS uses a separate number from transactional, so STOP keywords don\'t accidentally opt clients out of appointment confirmations.',
  },
  {
    q: 'What kind of support do I get?',
    a: 'Founder-direct email on every plan. Not a tiered help-desk where the good support hides behind the most expensive subscription. If something breaks, the person who built it answers your email — usually within hours. Studio plans add chat priority; Salon Pro adds a dedicated onboarding session and direct phone access.',
  },
  {
    q: 'Can I move back if it doesn\'t work out?',
    a: 'Anytime, instantly, no questions asked. One click in Settings exports every client, every appointment, every receipt, every photo as a clean CSV + JSON bundle you can re-import elsewhere or keep for your records. No vendor lock-in. No exit fees. No "fill out this form and we\'ll get back to you in 30 days." If our service sucks for you, the last thing we\'ll do is hold your data hostage.',
  },
  {
    q: 'Is data export really free? On every plan?',
    a: 'Yes — including the Free Solo plan. Including Founders\' Members. Including paused accounts. Including accounts in their 90-day post-cancellation grace period. Forever. Your data is yours, and your ability to walk out the door with it is not a feature we\'ll ever paywall. We\'d rather you leave with everything intact and recommend us anyway than feel trapped here.',
  },
  {
    q: 'Who built this?',
    a: 'Plume Nexus was built by Jonathan VanKim, a software engineer turned nail salon owner. The original codebase is the operating system for his own 10-tech salon in Columbus, Ohio. It was built to scratch his own itch — and is now ready for the next salon, spa, or studio that wants something better than the duct-taped patchwork the industry has settled for.',
  },
  {
    q: 'What about HIPAA / med spas?',
    a: 'We\'re HIPAA-aware: PIN locks on sensitive modules, role-based access, audited activity logs, allergy/health flags on client profiles. Full HIPAA-certified hosting is on the roadmap — talk to us if compliance is a hard requirement.',
  },
  {
    q: 'Is there a contract?',
    a: 'Month-to-month. Cancel any time. Annual billing saves 14% if you want to lock in.',
  },
];

export default function FAQ() {
  const [open, setOpen] = useState(0);
  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Questions answered."
      subtitle="The things every salon owner asks before switching."
      alt
    >
      <div style={{ maxWidth: 820, margin: '0 auto' }}>
        {ITEMS.map((item, i) => (
          <FAQItem key={i} item={item} isOpen={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
        ))}
      </div>

      <div style={{ textAlign: 'center', marginTop: 32, fontSize: 14, color: C.muted }}>
        Still have a question?{' '}
        <span style={{ color: C.plum, fontWeight: 600 }}>Tap the chat bubble</span> in the corner — Plume's AI can answer most questions instantly, and pings the founder for anything it can't.
      </div>
    </Section>
  );
}

function FAQItem({ item, isOpen, onToggle }) {
  const id = `faq-${item.q.replace(/\s+/g, '-').slice(0, 30)}`;
  return (
    <div style={{
      borderBottom: `1px solid ${C.rule}`,
      background: '#fff',
    }}>
      <button onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`${id}-panel`}
        id={`${id}-trigger`}
        style={{
        width: '100%', textAlign: 'left',
        padding: '20px 4px',
        background: 'transparent', border: 'none',
        cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16,
        fontFamily: FONT.body,
      }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.ink, lineHeight: 1.4 }}>{item.q}</span>
        <span style={{
          flexShrink: 0,
          width: 26, height: 26, borderRadius: '50%',
          background: isOpen ? C.plum : C.ruleSoft,
          color: isOpen ? '#fff' : C.muted,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, fontWeight: 700,
          transition: 'all .15s',
        }}>{isOpen ? '−' : '+'}</span>
      </button>
      {isOpen && (
        <div
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          style={{
          padding: '0 4px 22px',
          fontSize: 15, lineHeight: 1.65, color: C.muted,
        }}>
          {item.a}
        </div>
      )}
    </div>
  );
}
