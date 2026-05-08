// Public-facing legal pages: Terms of Service + Privacy Policy. Rendered
// at /?terms=1 and /?privacy=1 — linked from the booking screen, salon
// webfront, and email/SMS footers (where reasonable).
//
// IMPORTANT: this content is a reasonable starting template, NOT vetted
// legal text. Have an attorney review before relying on either policy in
// any dispute. Salon-specific terms (cancellation policy, late fees) are
// in here as placeholders the salon owner should adjust.

import { useEffect, useState } from 'react';

const SALON = {
  name:    'Meraki Nail Studio',
  address: '5029 Olentangy River Rd, Columbus, OH 43214',
  email:   'merakinailstudiocolumbus@gmail.com',
  state:   'Ohio',
};

const SHELL = {
  display: 'flex', justifyContent: 'center', minHeight: '100dvh',
  background: '#fff', padding: '40px 20px', fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  color: '#222', lineHeight: 1.7,
};
const CARD = { maxWidth: 760, width: '100%', fontSize: 14 };
const H1   = { fontSize: 26, fontWeight: 700, margin: '0 0 6px', color: '#1a1a1a' };
const H2   = { fontSize: 16, fontWeight: 700, margin: '28px 0 8px', color: '#2D7A5F' };
const SUB  = { fontSize: 12, color: '#888', margin: '0 0 28px' };
const NOTE = { background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '10px 14px', fontSize: 12, margin: '20px 0' };
const BTN  = { display: 'inline-block', background: '#2D7A5F', color: '#fff', padding: '10px 20px', borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 600, marginTop: 32 };

export function TermsScreen() {
  useEffect(() => { document.title = `Terms of Service · ${SALON.name}`; }, []);
  const lastUpdated = '2026-05-08';
  return (
    <div style={SHELL}>
      <div style={CARD}>
        <h1 style={H1}>Terms of Service</h1>
        <div style={SUB}>{SALON.name} · Last updated {lastUpdated}</div>

        <p>These Terms govern your use of {SALON.name}'s online booking, services, and communications. By booking an appointment, providing your contact information, or visiting the salon, you agree to these Terms.</p>

        <h2 style={H2}>1. Services</h2>
        <p>{SALON.name} provides professional nail care services at our location: {SALON.address}. Service descriptions, durations, and prices shown in our online booking are accurate at the time of publication but may be adjusted at the salon based on the condition of your nails or the complexity of the requested service.</p>

        <h2 style={H2}>2. Booking, Cancellation & No-Show Policy</h2>
        <p>Appointments may be booked online, by phone, or in person. To respect our techs' time, we ask that you:</p>
        <ul>
          <li>Cancel or reschedule at least <strong>24 hours</strong> in advance.</li>
          <li>Arrive at your appointment time. Late arrivals greater than 15 minutes may need to be rescheduled.</li>
          <li>Provide a valid phone number and email so we can reach you for confirmations and reminders.</li>
        </ul>
        <p>Repeated no-shows or last-minute cancellations may result in a deposit being required for future bookings, or in our refusal to schedule further appointments.</p>

        <h2 style={H2}>3. Payment</h2>
        <p>Services are paid for at the time of completion via cash, credit card, or other accepted methods. Card payments are processed securely by Stripe; we do not store full card numbers on our servers. Tips are appreciated and are paid directly to your service provider.</p>

        <h2 style={H2}>4. Refunds</h2>
        <p>If you are unsatisfied with a service, please tell us before leaving the salon and we will make it right at no additional charge. Refunds are issued at our discretion and are not guaranteed for services already performed; remedy generally takes the form of a corrective service rather than a cash refund.</p>

        <h2 style={H2}>5. Communications</h2>
        <p>By providing your phone number or email address, you consent to receive transactional messages (appointment confirmations, reminders, receipts). With your separate consent, you may also receive marketing messages from us. You can opt out of marketing at any time by:</p>
        <ul>
          <li><strong>Email:</strong> clicking the "Unsubscribe" link in any marketing email, or replying with the word "unsubscribe."</li>
          <li><strong>SMS:</strong> replying <strong>STOP</strong> to any marketing text. Standard message and data rates may apply.</li>
        </ul>
        <p>Opting out of marketing does not stop transactional messages, which we send to ensure your appointments run smoothly.</p>

        <h2 style={H2}>6. Acceptable Use</h2>
        <p>You agree not to use our online booking system to harass, defraud, or interfere with our operations. We reserve the right to refuse service, cancel bookings, and remove accounts that violate these Terms or our salon policies.</p>

        <h2 style={H2}>7. Promo Codes & Gift Cards</h2>
        <p>Promotional codes are subject to the terms shown at issuance: expiration date, single-use vs. multi-use, and any service or client restrictions. Personalized codes are bound to a specific client and may not be transferred. Gift cards are non-refundable and non-replaceable if lost.</p>

        <h2 style={H2}>8. Liability</h2>
        <p>If you have allergies, sensitivities, or medical conditions affecting your nails or skin, please tell your tech before service begins. {SALON.name} is not liable for adverse reactions caused by undisclosed conditions or for damage to personal items left in the salon.</p>

        <h2 style={H2}>9. Changes to These Terms</h2>
        <p>We may update these Terms from time to time. The "Last updated" date at the top of this page indicates when the most recent change was made. Continued use of our booking system after changes constitutes acceptance of the updated Terms.</p>

        <h2 style={H2}>10. Governing Law</h2>
        <p>These Terms are governed by the laws of the State of {SALON.state}, without regard to its conflict-of-laws provisions. Any disputes arising from these Terms or your use of our services shall be resolved in the state or federal courts located in {SALON.state}.</p>

        <h2 style={H2}>11. Contact</h2>
        <p>Questions about these Terms? Contact us at <a href={`mailto:${SALON.email}`} style={{ color: '#2D7A5F' }}>{SALON.email}</a> or {SALON.address}.</p>

        <div style={NOTE}>
          ⚖ This is a template. {SALON.name} should have legal counsel review before launch.
        </div>

        <a href="/?web" style={BTN}>← Back to {SALON.name}</a>
      </div>
    </div>
  );
}

export function PrivacyScreen() {
  useEffect(() => { document.title = `Privacy Policy · ${SALON.name}`; }, []);
  const lastUpdated = '2026-05-08';
  return (
    <div style={SHELL}>
      <div style={CARD}>
        <h1 style={H1}>Privacy Policy</h1>
        <div style={SUB}>{SALON.name} · Last updated {lastUpdated}</div>

        <p>This Privacy Policy explains what information {SALON.name} collects, how we use it, and the choices you have regarding it.</p>

        <h2 style={H2}>1. Information We Collect</h2>
        <p>When you book an appointment or use our services, we may collect:</p>
        <ul>
          <li><strong>Identity & contact:</strong> name, email, phone number, address, birthday (optional).</li>
          <li><strong>Appointment & visit history:</strong> services received, dates, the tech who served you, notes from your visit (e.g., color choice, allergies you've shared).</li>
          <li><strong>Photos:</strong> if you choose, we may save photos of your nails to your client profile so we can recreate or build on past looks.</li>
          <li><strong>Payment information:</strong> card details are entered directly into Stripe's secure payment fields and are not stored on our servers. We retain only a record of the transaction (amount, date, last four digits, payment method).</li>
          <li><strong>Communications preferences:</strong> whether you've opted into marketing messages, when, and through which channel.</li>
          <li><strong>Sign-in information:</strong> if you sign in with Google, we receive your email and name from Google.</li>
        </ul>

        <h2 style={H2}>2. How We Use Your Information</h2>
        <ul>
          <li>To schedule and provide your services.</li>
          <li>To send transactional messages: appointment confirmations, reminders, receipts, and changes to bookings.</li>
          <li>To send marketing messages, only if you've opted in.</li>
          <li>To process payments via Stripe.</li>
          <li>To remember your preferences and visit history so service is better the next time you come in.</li>
          <li>To improve our services and salon operations (analytics, capacity planning).</li>
          <li>To comply with our legal obligations (tax records, dispute resolution).</li>
        </ul>

        <h2 style={H2}>3. Third-Party Services We Use</h2>
        <p>We share only the minimum information necessary with these processors, and only for the purposes described:</p>
        <ul>
          <li><strong>Google Firebase</strong> — secure storage of your client record, appointments, and visit history.</li>
          <li><strong>Stripe</strong> — payment processing.</li>
          <li><strong>Resend</strong> — sending transactional and marketing emails.</li>
          <li><strong>Twilio</strong> — sending transactional and marketing text messages.</li>
          <li><strong>Google Sign-In</strong> — authenticating you when you choose to log in with Google.</li>
        </ul>
        <p>Each of these services has its own privacy policy governing its handling of your data. We do not sell your information to anyone.</p>

        <h2 style={H2}>4. Cookies & Tracking</h2>
        <p>Our online booking site uses cookies and browser storage to keep you signed in, remember your booking session, and load faster on return visits. We do not use third-party advertising trackers.</p>

        <h2 style={H2}>5. Data Retention</h2>
        <p>We retain your client record and visit history for as long as you remain an active client and for up to <strong>7 years</strong> after your last visit, to comply with tax and accounting obligations. You may request earlier deletion (see Your Rights below); we will honor such requests except where law requires us to keep specific records.</p>

        <h2 style={H2}>6. Your Rights</h2>
        <p>You may at any time:</p>
        <ul>
          <li><strong>Access</strong> the information we hold about you — contact us and we'll provide a copy.</li>
          <li><strong>Correct</strong> inaccurate information by asking your tech at your next visit or contacting us.</li>
          <li><strong>Delete</strong> your client record, subject to legal retention requirements.</li>
          <li><strong>Opt out of marketing</strong> messages at any time (email Unsubscribe link, or SMS reply STOP).</li>
        </ul>

        <h2 style={H2}>7. California Residents (CCPA)</h2>
        <p>If you are a California resident, you have additional rights under the California Consumer Privacy Act, including the right to know what personal information we collect and the right to deletion. We do not sell personal information.</p>

        <h2 style={H2}>8. Children</h2>
        <p>Our services are not directed at children under 13, and we do not knowingly collect personal information from them. Minors may receive services with parental consent and presence.</p>

        <h2 style={H2}>9. Security</h2>
        <p>We use industry-standard practices (encryption in transit, access control on our database, secure payment processing via Stripe) to protect your information. No system is completely secure; we encourage you to also protect yourself by choosing a strong password if you create an account.</p>

        <h2 style={H2}>10. Changes to This Policy</h2>
        <p>We may update this Privacy Policy from time to time. The "Last updated" date at the top reflects when changes were made. For significant changes, we will notify you by email or in-app notice.</p>

        <h2 style={H2}>11. Contact</h2>
        <p>Privacy questions? Contact us at <a href={`mailto:${SALON.email}`} style={{ color: '#2D7A5F' }}>{SALON.email}</a> or {SALON.address}.</p>

        <div style={NOTE}>
          ⚖ This is a template. {SALON.name} should have legal counsel review before launch — especially for the CCPA/GDPR sections if any clients reside outside Ohio.
        </div>

        <a href="/?web" style={BTN}>← Back to {SALON.name}</a>
      </div>
    </div>
  );
}
