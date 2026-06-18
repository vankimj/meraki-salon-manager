// Per-vertical tenant template: the terminology nouns, the service-menu template
// id to seed, and the recurring membership-plan templates. Resolved from
// settings.vertical (written by the onboarding "welcome" phase). Default 'nails'
// so every EXISTING tenant (Meraki) is unchanged — resolveVertical / resolveTerms
// fall back to the nail defaults when settings.vertical is absent.
//
// The server keeps a hand-synced mirror of the membership-plan templates in
// functions/lib/verticals.js (CommonJS can't import this ESM module).

export const DEFAULT_TERMS = {
  business:      'salon',     // "our salon"
  staff:         'stylist',   // singular, customer-facing
  staffPlural:   'stylists',
  staffNoun:     'tech',      // internal / staff-facing ("nail tech", turn rotation)
  client:        'client',
  clientPlural:  'clients',
  service:       'service',
  servicePlural: 'services',
  visit:         'visit',     // "how was your visit?"
  appointment:   'appointment',
  bookCta:       'Book',
  emoji:         '💅',
};

export const VERTICALS = {
  nails: {
    key: 'nails',
    label: 'Nail Salon',
    serviceTemplateId: 'nail-salon',
    terms: DEFAULT_TERMS,
    membershipPlans: [],           // existing tenants seed membership plans by hand
  },

  personalTraining: {
    key: 'personalTraining',
    label: 'Personal Training',
    serviceTemplateId: 'personal-training',
    terms: {
      business:      'studio',
      staff:         'trainer',
      staffPlural:   'trainers',
      staffNoun:     'trainer',
      client:        'client',
      clientPlural:  'clients',
      service:       'session',
      servicePlural: 'sessions',
      visit:         'session',
      appointment:   'session',
      bookCta:        'Book a session',
      emoji:         '🏋️',
    },
    // Recurring membership-plan templates (shape = firestore.js createMembershipPlan).
    // billingPeriod must be a recurring interval — the Stripe Price is created
    // lazily as recurring. PREPAID session packs ("5-Session Pack") ship as
    // priceFrom SERVICES in the service template, NOT here, because there is no
    // session-credit ledger yet (deferred — see MULTI_VERTICAL_MARKET_MAP.md).
    membershipPlans: [
      { name: 'Unlimited Monthly',   price: 199, billingPeriod: 'monthly', description: 'Unlimited 1-on-1 sessions, billed monthly', active: true },
      { name: '4 Sessions / Month',  price: 240, billingPeriod: 'monthly', description: 'Four 1-on-1 sessions each month',           active: true },
      { name: 'Small-Group Monthly', price: 99,  billingPeriod: 'monthly', description: '8 small-group sessions per month',          active: true },
    ],
  },

  makeupArtist: {
    key: 'makeupArtist',
    label: 'Make-up Artist',
    serviceTemplateId: 'makeup-artist',
    terms: {
      business:      'studio',
      staff:         'makeup artist',
      staffPlural:   'makeup artists',
      staffNoun:     'artist',
      client:        'client',
      clientPlural:  'clients',
      service:       'service',
      servicePlural: 'services',
      visit:         'appointment',
      appointment:   'appointment',
      bookCta:       'Book',
      emoji:         '💄',
    },
    // Make-up work is event / package-based (bridal, special occasion), not
    // subscription-based — no recurring membership templates seeded by default.
    // The Memberships module still works if the artist wants to add one.
    membershipPlans: [],
  },
};

export function resolveVertical(verticalKey) {
  return VERTICALS[verticalKey] || VERTICALS.nails;
}

export function resolveTerms(verticalKey) {
  return resolveVertical(verticalKey).terms;
}
