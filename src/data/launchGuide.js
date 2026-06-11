// Launch & Grow — static content + pure helpers (Phase 2).
//
// CONTENT (groups + items, the guide itself) is versioned here in code.
// Per-tenant PROGRESS lives in Firestore at tenants/{tid}/data/launchChecklist
// as { items: { [id]: { status, completedAt?, notes? } }, mode?, updatedAt }.
// This file has NO React and NO Firestore imports — just data + pure functions
// (unit-tested in launchGuide.test.js).
//
// Each item has one of three flavors:
//   external — instructions + external links + manual check-off
//   deeplink — jumps into an existing app surface (wizard phase / admin tab)
//   capture  — collects data that bootstraps the software; auto-completes from
//              the live config it writes (see deriveAutoStatus)
//
// Items also carry an optional `risk` ('high' | 'med') so Audit mode can surface
// the dangerous/commonly-missed ones (BOI, worker classification, sales tax,
// malpractice insurance, music licensing) first.

export const FLAVORS = { EXTERNAL: 'external', DEEPLINK: 'deeplink', CAPTURE: 'capture' };

// ── Stable national links (re-verify quarterly) ───────────────────────────
const L = {
  irsEin:        'https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online',
  fincenBoi:     'https://www.fincen.gov/boi',
  uspto:         'https://www.uspto.gov/trademarks/search',
  sbaRegister:   'https://www.sba.gov/business-guide/launch-your-business/register-your-business',
  sbaPlan:       'https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan',
  sbaFunding:    'https://www.sba.gov/funding-programs',
  sbaLicenses:   'https://www.sba.gov/business-guide/launch-your-business/apply-licenses-permits',
  score:         'https://www.score.org/find-mentor',
  irsEstTax:     'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes',
  irsScorp:      'https://www.irs.gov/businesses/small-businesses-self-employed/s-corporations',
  dolClassify:   'https://www.dol.gov/agencies/whd/flsa/misclassification',
  irsContractor: 'https://www.irs.gov/businesses/small-businesses-self-employed/independent-contractor-self-employed-or-employee',
  oshaSalon:     'https://www.osha.gov/nail-salons',
  ascap:         'https://www.ascap.com/music-users',
  bmi:           'https://www.bmi.com/licensing',
  sesac:         'https://www.sesac.com/license/',
  googleBiz:     'https://www.google.com/business/',
  yelpBiz:       'https://biz.yelp.com/',
  appleBiz:      'https://businessconnect.apple.com/',
  bingPlaces:    'https://www.bingplaces.com/',
  nextdoorBiz:   'https://business.nextdoor.com/en-us/small-business',
  googleAds:     'https://ads.google.com/',
  googleWorkspace:'https://workspace.google.com/',
  adaGuide:      'https://www.ada.gov/resources/small-entity-compliance-guide/',
  laborPosters:  'https://www.dol.gov/general/topics/posters',
};

// ── State business-formation (Secretary of State) links ───────────────────
// Populated from a verified 50-state research pass. sosLinkForState() falls
// back to the SBA "register your business" directory for any state not yet
// mapped, so the LLC link is never broken even before the map is complete.
export const SOS_FALLBACK = L.sbaRegister;
// Verified 50-state + DC business-formation landing pages (all official
// state/.gov domains; re-verify quarterly — links rot). DC has no Secretary of
// State, so it points at the DLCP Corporations Division.
export const SOS_LINKS = {
  AL: 'https://www.sos.alabama.gov/business-entities',
  AK: 'https://www.commerce.alaska.gov/web/cbpl/corporations',
  AZ: 'https://azcc.gov/corporations',
  AR: 'https://www.sos.arkansas.gov/business-commercial-services-bcs',
  CA: 'https://www.sos.ca.gov/business-programs/business-entities',
  CO: 'https://coloradosos.gov/pubs/business/businessHome.html',
  CT: 'https://business.ct.gov/',
  DE: 'https://corp.delaware.gov/',
  FL: 'https://dos.fl.gov/sunbiz/',
  GA: 'https://sos.ga.gov/corporations-division-georgia-secretary-states-office',
  HI: 'https://cca.hawaii.gov/breg/',
  ID: 'https://sos.idaho.gov/business-services/',
  IL: 'https://www.ilsos.gov/departments/business-services.html',
  IN: 'https://www.in.gov/sos/business/',
  IA: 'https://sos.iowa.gov/business-services',
  KS: 'https://sos.ks.gov/businesses/businesses.html',
  KY: 'https://www.sos.ky.gov/bus/Pages/default.aspx',
  LA: 'https://www.sos.la.gov/BusinessServices/Pages/default.aspx',
  ME: 'https://www.maine.gov/sos/corporations-commissions/corporations-business-services',
  MD: 'https://businessexpress.maryland.gov/',
  MA: 'https://www.sec.state.ma.us/divisions/corporations/corporations.htm',
  MI: 'https://www.michigan.gov/lara/bureau-list/cscl/corps/michigan-business-roadmap/start-a-business',
  MN: 'https://www.sos.mn.gov/business-liens/',
  MS: 'https://www.sos.ms.gov/business-services',
  MO: 'https://www.sos.mo.gov/business',
  MT: 'https://sosmt.gov/business/',
  NE: 'https://sos.nebraska.gov/business-services',
  NV: 'https://www.nvsos.gov/businesses',
  NH: 'https://www.sos.nh.gov/corporations-0',
  NJ: 'https://www.nj.gov/treasury/revenue/gettingregistered.shtml',
  NM: 'https://www.sos.nm.gov/business-services/',
  NY: 'https://dos.ny.gov/division-corporations-state-records-and-uniform-commercial-code',
  NC: 'https://www.sosnc.gov/divisions/business_registration',
  ND: 'https://sos.nd.gov/business/',
  OH: 'https://www.ohiosos.gov/business',
  OK: 'https://www.sos.ok.gov/business/default.aspx',
  OR: 'https://sos.oregon.gov/business/Pages/default.aspx',
  PA: 'https://www.pa.gov/agencies/dos/programs/business',
  RI: 'https://www.sos.ri.gov/divisions/business-services',
  SC: 'https://sos.sc.gov/online-filings/business-entities',
  SD: 'https://sosenterprise.sd.gov/businessservices/',
  TN: 'https://sos.tn.gov/businesses',
  TX: 'https://www.sos.state.tx.us/corp/index.shtml',
  UT: 'https://commerce.utah.gov/corporations/',
  VT: 'https://sos.vermont.gov/business-services',
  VA: 'https://www.scc.virginia.gov/businesses/',
  WA: 'https://www.sos.wa.gov/corporations-charities',
  WV: 'https://sos.wv.gov/business',
  WI: 'https://www.wdfi.org/corporations/default.htm',
  WY: 'https://sos.wyo.gov/Business/Default.aspx',
  DC: 'https://dlcp.dc.gov/page/corporations-division-business-registration-faqs',
};

export function sosLinkForState(state) {
  const k = String(state || '').trim().toUpperCase();
  return SOS_LINKS[k] || SOS_FALLBACK;
}

// Resolve an item link to a concrete href given tenant context (state-aware
// links point at the tenant's Secretary of State).
export function resolveHref(link, ctx = {}) {
  if (link?.stateAware) return sosLinkForState(ctx.state);
  return link?.href || '#';
}

// ── Content: 13 groups ────────────────────────────────────────────────────
export const LAUNCH_GROUPS = [
  {
    id: 'foundation', title: 'Form your business',
    blurb: 'The legal + tax basics before you take a single dollar.',
    items: [
      { id: 'form-llc', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Form your LLC',
        why: 'An LLC separates your personal assets from the business — if the salon is ever sued, your home and savings are shielded. It also makes you look established to clients and vendors.',
        steps: ['Pick a business name and check it’s available in your state', 'File Articles of Organization with your state', 'Write a simple Operating Agreement', 'Most states approve online in 1–3 business days'],
        tip: 'Use your real legal name consistently — it must match what you give the IRS, Stripe, and the bank.',
        links: [{ label: 'File in your state', stateAware: true }, { label: 'SBA: register your business', href: L.sbaRegister }],
        keywords: 'llc entity formation articles organization operating agreement liability' },
      { id: 'trademark-name', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Check your name for trademark conflicts',
        why: 'Before you print signage and build a following, make sure no one else owns your salon’s name — a rebrand later is painful and expensive.',
        steps: ['Search the USPTO trademark database for your name', 'Search your state business registry', 'Grab the matching domain + social handles while you’re at it'],
        links: [{ label: 'USPTO trademark search', href: L.uspto }],
        keywords: 'trademark name uspto brand conflict' },
      { id: 'boi-fincen', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'File your BOI report (FinCEN)',
        why: 'Federal law requires most LLCs to file a Beneficial Ownership Information report with FinCEN. It’s free, takes ~15 minutes, and skipping it carries steep penalties — and almost no new owner knows about it.',
        steps: ['Go to fincen.gov/boi', 'File the BOI report online (free)', 'Keep the confirmation for your records'],
        tip: 'Do this right after your LLC is approved.',
        links: [{ label: 'FinCEN BOI filing', href: L.fincenBoi }],
        keywords: 'boi fincen beneficial ownership report federal compliance' },
    ],
  },
  {
    id: 'tax-id', title: 'Tax ID',
    blurb: 'Your EIN unlocks payments, texting, and payroll.',
    items: [
      { id: 'capture-ein', flavor: FLAVORS.CAPTURE, risk: 'high',
        title: 'Get your EIN and save it here',
        why: 'An EIN (Employer Identification Number) is your business’s tax ID — free from the IRS and instant. You’ll need it for Stripe, Twilio, payroll, and your bank.',
        steps: ['Apply on the IRS EIN Assistant (free, online)', 'You receive your EIN immediately', 'Save it in Settings so we can use it for payments + texting'],
        links: [{ label: 'Apply for an EIN (IRS, free)', href: L.irsEin }],
        autoStatus: 'einCaptured', capture: { kind: 'ein' }, // inline CaptureEin form (deep-link suppressed for capture items)
        keywords: 'ein tax id irs employer identification number' },
    ],
  },
  {
    id: 'licenses', title: 'Licenses & permits',
    blurb: 'The salon-specific approvals that keep you open and uncited.',
    items: [
      { id: 'establishment-license', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Salon establishment license + tech licenses',
        why: 'Your state cosmetology board licenses the salon itself, and every tech needs an active individual license. Operating or hiring without these is the fastest way to get shut down.',
        steps: ['Apply for a salon/shop establishment license with your state board', 'Confirm every tech’s individual license is active', 'Post licenses where clients can see them'],
        links: [{ label: 'State licenses & permits (SBA directory)', href: L.sbaLicenses }],
        keywords: 'cosmetology board establishment license shop nail tech individual license inspection' },
      { id: 'sales-tax', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Register for sales tax / vendor’s license',
        why: 'Most states tax retail product sales (and some tax services). You must register to collect and remit sales tax — and file on schedule — or you’ll owe back taxes plus penalties.',
        steps: ['Register for a sales-tax / vendor’s license with your state', 'Find out whether services are taxable in your state (products almost always are)', 'Set a calendar reminder for filing deadlines'],
        links: [{ label: 'Register your business (state, SBA)', href: L.sbaRegister }],
        keywords: 'sales tax vendor license retail product remit state register' },
      { id: 'music-license', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Get a music license (ASCAP / BMI / SESAC)',
        why: 'Playing Spotify, the radio, or any music in your salon legally requires a public-performance license. It’s routinely missed — and the licensing bodies do audit small businesses.',
        steps: ['Get a business music license from ASCAP, BMI, and SESAC (or a covered streaming service like Soundtrack Your Brand)', 'Keep proof on file'],
        links: [{ label: 'ASCAP', href: L.ascap }, { label: 'BMI', href: L.bmi }, { label: 'SESAC', href: L.sesac }],
        keywords: 'music license ascap bmi sesac public performance spotify radio' },
    ],
  },
  {
    id: 'buildout', title: 'Set up your space',
    blurb: 'Lease, permits, ventilation, and the gear to open the doors.',
    items: [
      { id: 'lease-co', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Lease, zoning & certificate of occupancy',
        why: 'Before you sign, confirm the space is zoned for a salon and can get a certificate of occupancy — and have the lease reviewed so you’re not stuck with surprise costs.',
        steps: ['Confirm zoning allows a salon at this address', 'Have an attorney review the lease', 'Apply for build-out permits + a certificate of occupancy'],
        keywords: 'lease zoning certificate occupancy permit build out attorney' },
      { id: 'ventilation', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Ventilation, plumbing & chemical safety (OSHA)',
        why: 'Nail product fumes are a real health hazard. OSHA expects proper ventilation, an SDS binder, and hazard communication — and your state board inspects for it.',
        steps: ['Install source-capture ventilation at stations + a fresh-air system', 'Plumb pedicure stations to code', 'Keep an SDS (Safety Data Sheet) binder for every product', 'Train staff on chemical safety'],
        links: [{ label: 'OSHA nail-salon safety', href: L.oshaSalon }],
        keywords: 'ventilation osha chemical sds plumbing pedicure fumes safety hazard' },
      { id: 'equipment', flavor: FLAVORS.EXTERNAL,
        title: 'Stations, sterilization & signage',
        why: 'Get the core gear in place: stations and chairs, sterilization (autoclave + logs), security/Wi-Fi, and permitted signage.',
        steps: ['Buy/lease stations, chairs, and a pedicure setup', 'Set up sterilization (autoclave) + a cleaning log', 'Order signage and pull a sign permit if required', 'Set up Wi-Fi, security, and utilities'],
        keywords: 'equipment stations chairs autoclave sterilization signage wifi security furniture' },
    ],
  },
  {
    id: 'money', title: 'Get paid & reach clients',
    blurb: 'Card payments and text messaging — both need your EIN.',
    items: [
      { id: 'stripe-payments', flavor: FLAVORS.DEEPLINK, risk: 'med',
        title: 'Set up card payments (Stripe)',
        why: 'Accept cards in person and online, with deposits straight to your bank. We connect Stripe right inside the app.',
        steps: ['Have your EIN and bank details ready', 'Open the setup wizard → Money & compliance', 'Finish Stripe’s quick verification'],
        deepLink: { kind: 'wizard', phase: 'money' }, autoStatus: 'paymentsReady',
        keywords: 'stripe payments card reader terminal payouts bank deposit' },
      { id: 'twilio-sms', flavor: FLAVORS.DEEPLINK, risk: 'med',
        title: 'Turn on text messaging (reminders + reviews)',
        why: 'Appointment reminders and review requests by text dramatically cut no-shows and grow your reputation. Carrier registration needs your EIN + business info.',
        steps: ['Open Admin → SMS', 'Complete the business profile + use-case', 'Pick a toll-free number and submit for carrier approval'],
        deepLink: { kind: 'admin', tab: 'sms' }, autoStatus: 'smsReady',
        keywords: 'sms text twilio reminders toll free tfn carrier registration messaging' },
    ],
  },
  {
    id: 'money-taxes', title: 'Money & taxes',
    blurb: 'Keep the business’s money — and the IRS — separate from yours.',
    items: [
      { id: 'business-bank', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Open a separate business bank account',
        why: 'This is what actually preserves your LLC’s liability shield — mixing personal and business money can let a court "pierce the veil." Open it with your EIN + formation docs.',
        steps: ['Open a business checking account (bring EIN + Articles of Organization)', 'Get a business debit/credit card', 'Run ALL salon income and expenses through it — never your personal account'],
        keywords: 'business bank account checking credit card pierce veil separate finances' },
      { id: 'bookkeeping', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Bookkeeping + quarterly taxes',
        why: 'As an owner you pay estimated taxes four times a year — miss them and April brings a painful bill plus penalties. Set up bookkeeping early and find a CPA.',
        steps: ['Set up bookkeeping (software or a bookkeeper)', 'Calendar the IRS quarterly estimated-tax dates', 'Find a CPA familiar with salons / 1099 + sales tax'],
        links: [{ label: 'IRS: estimated taxes', href: L.irsEstTax }, { label: 'IRS: S-corp election', href: L.irsScorp }],
        keywords: 'bookkeeping cpa accountant quarterly estimated tax 1040-es s-corp duns business credit' },
    ],
  },
  {
    id: 'funding', title: 'Get funded',
    blurb: 'Capital and free expert help to get off the ground.',
    items: [
      { id: 'business-plan', flavor: FLAVORS.EXTERNAL,
        title: 'Write a simple business plan',
        why: 'A one-page plan clarifies your pricing, target client, and break-even — and you’ll need it for any loan or grant. (Our AI coach can draft a first version for you.)',
        steps: ['Outline services, pricing, target client, and monthly break-even', 'Use the SBA template as a starting point'],
        links: [{ label: 'SBA: write your business plan', href: L.sbaPlan }],
        ai: { fn: 'draft', kind: 'businessPlan', label: 'Draft a business plan' },
        keywords: 'business plan projections break even pricing' },
      { id: 'funding-sources', flavor: FLAVORS.EXTERNAL,
        title: 'Explore loans, grants & free mentoring',
        why: 'SBA microloans, women-/minority-owned business grants, and SCORE’s free 1:1 mentoring are underused. They can fund build-out and de-risk your first year.',
        steps: ['Browse SBA funding programs + microloans', 'Search for grants for women-/minority-owned businesses', 'Book a free SCORE mentor', 'Join your local chamber of commerce'],
        links: [{ label: 'SBA funding programs', href: L.sbaFunding }, { label: 'Find a SCORE mentor (free)', href: L.score }],
        keywords: 'funding sba loan microloan grant women minority score mentor chamber commerce capital' },
    ],
  },
  {
    id: 'insurance', title: 'Protect your business',
    blurb: 'The coverage that keeps one bad day from ending the business.',
    items: [
      { id: 'liability-insurance', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Get general + professional liability insurance',
        why: 'A chemical burn, infection, or slip-and-fall can mean a lawsuit. Professional (malpractice) + general liability coverage protects the business — and many leases require it.',
        steps: ['Get a quote for general liability + professional/malpractice', 'Add property/BOP coverage for your equipment + build-out', 'If you have employees, workers’ comp is legally required', 'Consider cyber/PII coverage since you store client data'],
        tip: 'Ask the carrier for a salon/beauty-specific policy — it’s cheaper and fits better.',
        keywords: 'insurance liability professional malpractice property bop workers comp cyber coverage' },
    ],
  },
  {
    id: 'hiring', title: 'Hire & classify your team',
    blurb: 'Get worker classification right — it’s the #1 salon lawsuit.',
    items: [
      { id: 'worker-classification', flavor: FLAVORS.EXTERNAL, risk: 'high',
        title: 'Classify staff correctly (W-2 vs 1099 vs booth renter)',
        why: 'Misclassifying an employee as a contractor is the single most common — and most expensive — salon legal mistake. The IRS and DOL have specific tests; get it right with the correct agreements.',
        steps: ['Use the IRS/DOL tests to decide employee vs contractor vs booth renter', 'Use the right written agreement for each (our AI coach can draft a starting template — have an attorney review)', 'Put up the required labor-law posters', 'Set up payroll for W-2 staff'],
        links: [{ label: 'IRS: contractor vs employee', href: L.irsContractor }, { label: 'DOL: misclassification', href: L.dolClassify }, { label: 'Labor-law posters', href: L.laborPosters }],
        ai: { fn: 'draft', kind: 'contractorAgreement', label: 'Draft a contractor agreement' },
        keywords: 'employee contractor 1099 w2 booth renter classification payroll agreement labor poster dol irs' },
      { id: 'payroll', flavor: FLAVORS.DEEPLINK,
        title: 'Set up payroll',
        why: 'Run payroll + file payroll taxes for W-2 staff, and generate 1099s for contractors, right in the app.',
        steps: ['Open the HR module', 'Connect payroll and add your team'],
        deepLink: { kind: 'module', target: 'hr' },
        keywords: 'payroll gusto hr w2 1099 compensation taxes' },
    ],
  },
  {
    id: 'presence', title: 'Build your online presence',
    blurb: 'Be found everywhere your clients are searching.',
    items: [
      { id: 'google-business', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Create & claim your Google Business Profile',
        why: 'This is how you show up in Google Maps and local search — the #1 way new salon clients find you. It’s free.',
        steps: ['Create a Google Business Profile', 'Verify your address', 'Add hours, photos, services, and your booking link'],
        links: [{ label: 'Google Business Profile', href: L.googleBiz }],
        keywords: 'google business profile maps local search claim verify' },
      { id: 'capture-socials', flavor: FLAVORS.CAPTURE,
        title: 'Set up Instagram / Facebook / TikTok',
        why: 'Social proof sells salon services. Claim your handles and add them here so they appear on your website and receipts.',
        steps: ['Create business accounts on Instagram, Facebook, and TikTok', 'Add the handles in Admin → Webfront'],
        autoStatus: 'socialsAdded', capture: { kind: 'socials' },
        keywords: 'instagram facebook tiktok social handles webfront' },
      { id: 'directories', flavor: FLAVORS.EXTERNAL,
        title: 'List on Yelp, Apple Maps, Bing & Nextdoor',
        why: 'A handful of free listings widens how many ways locals can discover you — and feeds the maps people actually use.',
        steps: ['Claim your Yelp business page', 'Add your business to Apple Business Connect (Apple Maps)', 'Claim Bing Places', 'Set up a Nextdoor business page'],
        links: [{ label: 'Yelp for Business', href: L.yelpBiz }, { label: 'Apple Business Connect', href: L.appleBiz }, { label: 'Bing Places', href: L.bingPlaces }, { label: 'Nextdoor Business', href: L.nextdoorBiz }],
        keywords: 'yelp apple maps bing nextdoor directory listing local discovery' },
    ],
  },
  {
    id: 'photos', title: 'Show off your work',
    blurb: 'Great photos are your best salesperson.',
    items: [
      { id: 'salon-photos', flavor: FLAVORS.CAPTURE,
        title: 'Photograph your space & your work',
        why: 'Clean, well-lit photos of your salon and your nail work are what convince someone to book. Add them here and they appear on your website. (Our AI coach can review a photo and suggest fixes.)',
        steps: ['Declutter and deep-clean before shooting', 'Use soft, natural light — shoot near a window, avoid harsh overhead glare', 'Take one wide "establishing" shot of the space + close detail shots', 'Shoot before/afters of your best work on a consistent background', 'Upload your favorites in Admin → Webfront'],
        tip: 'Hold the phone steady, fill the frame, and take 3× more than you need — then keep only the sharp, bright ones.',
        autoStatus: 'portfolioAdded', capture: { kind: 'portfolio' },
        keywords: 'photos photography portfolio lighting before after gallery webfront' },
    ],
  },
  {
    id: 'legaldocs', title: 'Customer-facing legal',
    blurb: 'The forms that protect you and set client expectations.',
    items: [
      { id: 'privacy-policy', flavor: FLAVORS.EXTERNAL, risk: 'med',
        title: 'Publish a privacy policy + intake/consent forms',
        why: 'You collect client names, contact info, and health/allergy notes — a privacy policy is expected (and required for app stores, texting, and some states). Intake/consent + service waivers protect you. Our AI coach can draft these (have an attorney review).',
        steps: ['Generate a privacy policy + terms (AI coach can draft a starting version)', 'Create a client intake/consent form covering allergies + medical notes', 'Add a service waiver where appropriate'],
        tip: 'AI drafts are a starting point, not legal advice — have an attorney review before you rely on them.',
        ai: { fn: 'draft', kind: 'privacyPolicy', label: 'Draft a privacy policy' },
        keywords: 'privacy policy terms intake consent allergy waiver legal pii form' },
    ],
  },
  {
    id: 'advertising', title: 'Advertise & grow',
    blurb: 'Turn the lights on and bring people in.',
    items: [
      { id: 'grand-opening', flavor: FLAVORS.EXTERNAL,
        title: 'Run a grand-opening / launch promo',
        why: 'A first-visit offer + a launch event creates urgency and seeds your first reviews and social content. (AI coach can write the promo copy.)',
        steps: ['Pick a launch offer (e.g., % off first visit or a free add-on)', 'Announce it on Google, Instagram, and Nextdoor', 'Ask every launch client for a review + a photo'],
        ai: { fn: 'suggest', kind: 'promo', label: 'Write the launch promo' },
        keywords: 'grand opening launch promo offer event marketing' },
      { id: 'google-ads-seo', flavor: FLAVORS.EXTERNAL,
        title: 'Google Ads + local SEO',
        why: 'Once your Google Business Profile is live, a small local Search/Maps ads budget plus basic SEO puts you in front of people searching "nail salon near me" today.',
        steps: ['Optimize your Google Business Profile (categories, services, photos, posts)', 'Start a small Google Local/Search ads budget', 'Keep your name/address/phone identical across every listing'],
        links: [{ label: 'Google Ads', href: L.googleAds }],
        ai: { fn: 'suggest', kind: 'adCopy', label: 'Write an ad' },
        keywords: 'google ads seo local search marketing nap citations advertising' },
      { id: 'instagram-monitor', flavor: FLAVORS.EXTERNAL,
        title: 'Post consistently on Instagram',
        why: 'Salons that post regularly grow faster. Connect Instagram to track your cadence and get AI suggestions on what to post next.',
        steps: ['Make your Instagram a Business or Creator account (IG app → Settings → Account type) and link it to a Facebook Page — required before connecting', 'Click "Connect Instagram" below and authorize in the popup — we never see your password', 'Aim for ~3 posts/week: before/afters, reels, client features', 'Use "Get post ideas" for AI caption + content suggestions'],
        autoStatus: 'instagramConnected',
        ai: { fn: 'suggest', kind: 'postIdeas', label: 'Get post ideas' },
        keywords: 'instagram posting cadence reels content social media coach' },
    ],
  },
  {
    id: 'reviews', title: 'Reviews & reputation',
    blurb: 'Five-star proof — and a plan for the occasional bad day.',
    items: [
      { id: 'setup-reviews', flavor: FLAVORS.DEEPLINK, risk: 'med',
        title: 'Set up Google reviews + auto-requests',
        why: 'Reviews are the deciding factor for most new clients. Connect Google reviews and turn on the post-checkout star request (4★+ routes straight to Google).',
        steps: ['Connect Google reviews in Admin', 'Save your Google review link', 'Confirm the post-checkout rating request is on'],
        deepLink: { kind: 'admin', tab: 'reviews' }, autoStatus: 'googleReviewsConnected',
        keywords: 'google reviews rating request reputation star routing place id' },
      { id: 'bad-review-playbook', flavor: FLAVORS.EXTERNAL,
        title: 'Have a bad-review playbook',
        why: 'One harsh review won’t sink you — ignoring it might. A calm, professional response often wins the client back and reassures everyone reading.',
        steps: ['Respond calmly within 24–48 hours', 'Take the specifics offline (offer to make it right)', 'Acknowledge, fix the root cause, and follow up', 'Ask happy regulars for reviews to keep your average strong'],
        keywords: 'bad review negative reputation respond mitigate complaint' },
    ],
  },
];

// ── Pure helpers (status, progress, audit) ────────────────────────────────
const RANK = { pending: 0, in_progress: 1, done: 2 };

// Derive a status purely from the tenant's live config (already subscribed
// elsewhere). Returns 'done' | 'in_progress' | null. ctx = { settings, sms,
// googleAuth, instagramAuth, webfront }.
export function deriveAutoStatus(item, ctx = {}) {
  const { settings = {}, sms = null, googleAuth = null, instagramAuth = null, webfront = {} } = ctx;
  switch (item.autoStatus) {
    case 'einCaptured':            return settings.ein ? 'done' : null;
    case 'paymentsReady':          return settings?.stripeConnect?.chargesEnabled ? 'done' : null;
    case 'smsReady':               return sms?.status === 'approved' ? 'done' : (sms?.status && sms.status !== 'draft' ? 'in_progress' : null);
    case 'googleReviewsConnected': return googleAuth ? 'done' : (settings.googleReviewUrl ? 'in_progress' : null);
    case 'socialsAdded':           return (webfront?.instagram || webfront?.facebook || webfront?.tiktok) ? 'done' : null;
    case 'instagramConnected':     return instagramAuth ? 'done' : null;
    case 'portfolioAdded':         return (webfront?.portfolioUploads?.length > 0) ? 'done' : null;
    default:                       return null;
  }
}

// The status shown to the user: whichever of manual progress vs auto-derived is
// "further along" — so a deep-link item self-completes once its config exists,
// and a manual "done" is never silently downgraded.
export function effectiveItemStatus(item, progressEntry, ctx = {}) {
  const manual = progressEntry?.status || 'pending';
  const auto = deriveAutoStatus(item, ctx) || 'pending';
  return RANK[auto] > RANK[manual] ? auto : manual;
}

// Flatten all items, stamping each with its group id.
export function allItems(groups = LAUNCH_GROUPS) {
  return groups.flatMap(g => g.items.map(it => ({ ...it, group: g.id })));
}

export function groupProgress(group, progress = {}, ctx = {}) {
  const done = group.items.filter(it => effectiveItemStatus(it, progress[it.id], ctx) === 'done').length;
  return { done, total: group.items.length };
}

export function overallProgress(groups = LAUNCH_GROUPS, progress = {}, ctx = {}) {
  let done = 0, total = 0;
  for (const g of groups) { const p = groupProgress(g, progress, ctx); done += p.done; total += p.total; }
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Audit mode: every not-yet-done item, high-risk first, then group order.
export function auditGaps(groups = LAUNCH_GROUPS, progress = {}, ctx = {}) {
  const riskRank = (r) => (r === 'high' ? 0 : r === 'med' ? 1 : 2);
  return allItems(groups)
    .map(it => ({ ...it, status: effectiveItemStatus(it, progress[it.id], ctx) }))
    .filter(it => it.status !== 'done')
    .sort((a, b) => riskRank(a.risk) - riskRank(b.risk));
}
