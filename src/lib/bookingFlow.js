// Booking flow configuration — Tier 0 templates + Tier 1 toggle defaults.
// Lives at tenants/{tid}/data/bookingConfig.flow as a sub-object so the
// public booking page can read it via the existing fetchBookingConfig call.
//
// Tenant config shape:
//   {
//     templateId: 'nailSalon' | 'medSpa' | 'barber' | 'spa' | 'custom',
//     ...individual overrides (any value here wins over the template)
//   }
//
// Effective flow at runtime = DEFAULTS ⊕ template values ⊕ tenant overrides.
// Use getEffectiveFlow(bookingConfig.flow) to resolve.

export const FLOW_DEFAULTS = {
  // Step 0 (flow chooser): "time-first" vs "tech-first" picker.
  showFlowChooser:        true,
  // When chooser is hidden, this is the starting flow.
  defaultFlow:            'time',           // 'time' | 'tech'

  // Identity / auth.
  requireSignIn:          false,            // gate cart behind auth
  allowGuestCheckout:     true,             // can a non-signed-in client submit?

  // Multi-lane behavior (cart with both a categoryExclusive mani + pedi).
  multiLaneShape:         'back-to-back',   // 'back-to-back' | 'simultaneous' | 'ask'

  // Group booking: let 2–6 people book together (distinct techs, ±15 min).
  allowGroupBooking:      false,

  // Removal modal cadence.
  removalPromptMode:      'always',         // 'always' | 'first-only' | 'never'

  // Time-window constraints.
  minLeadTimeMinutes:     0,                // 0 = bookable now; e.g. 120 = +2h
  maxLeadDays:            30,               // furthest day visible in calendar

  // Misc UI levers.
  showNotesField:         true,             // notes textarea on the Info step
  confirmCtaLabel:        'Confirm booking',

  // Optional per-step label overrides — keys are step ids, values rename
  // the visible heading. Falsy values fall back to the built-in label.
  stepLabels: {
    flowChooser:          '',
    cart:                 '',
    stylists:             '',
    schedule:             '',
    info:                 '',
    confirm:              '',
  },
};

export const FLOW_TEMPLATES = {
  nailSalon: {
    name:        'Nail Salon',
    icon:        '💅',
    description: 'Standard flow with stylist choice + mani+pedi multi-lane (back-to-back).',
    values: {
      showFlowChooser:    true,
      defaultFlow:        'time',
      requireSignIn:      false,
      allowGuestCheckout: true,
      multiLaneShape:     'back-to-back',
      removalPromptMode:  'always',
      showNotesField:     true,
    },
  },
  medSpa: {
    name:        'Med Spa',
    icon:        '🌿',
    description: 'Requires sign-in, auto-assigns provider (no stylist picker), no removal prompt.',
    values: {
      showFlowChooser:    false,
      defaultFlow:        'time',
      requireSignIn:      true,
      allowGuestCheckout: false,
      multiLaneShape:     'back-to-back',
      removalPromptMode:  'never',
      showNotesField:     true,
      stepLabels:         { confirm: 'Review & confirm', info: 'Your information' },
    },
  },
  barber: {
    name:        'Barber Shop',
    icon:        '✂️',
    description: 'Quick flow. No multi-lane, no removal prompts. Same-day bookings welcomed.',
    values: {
      showFlowChooser:    false,
      defaultFlow:        'time',
      requireSignIn:      false,
      allowGuestCheckout: true,
      multiLaneShape:     'back-to-back',
      removalPromptMode:  'never',
      showNotesField:     false,
      minLeadTimeMinutes: 30,
      maxLeadDays:        14,
      confirmCtaLabel:    'Book my chair',
    },
  },
  daySpa: {
    name:        'Day Spa',
    icon:        '🧖',
    description: 'Spa rituals run in parallel with multiple providers. Multi-lane = simultaneous.',
    values: {
      showFlowChooser:    true,
      defaultFlow:        'time',
      requireSignIn:      false,
      allowGuestCheckout: true,
      multiLaneShape:     'simultaneous',
      removalPromptMode:  'always',
      showNotesField:     true,
      stepLabels:         { stylists: 'Your providers', cart: 'Choose your treatments' },
    },
  },
  custom: {
    name:        'Custom',
    icon:        '⚙',
    description: 'Start from defaults and tweak each toggle individually.',
    values:      {},
  },
};

// Merge precedence: DEFAULTS → template values → tenant overrides.
// `flow` is the bookingConfig.flow doc shape stored in Firestore.
export function getEffectiveFlow(flow) {
  const tpl = flow?.templateId ? (FLOW_TEMPLATES[flow.templateId]?.values || {}) : {};
  return {
    ...FLOW_DEFAULTS,
    ...tpl,
    ...(flow || {}),
    // Step labels: deep-merge (a tenant might override one step label
    // without losing the template's other ones).
    stepLabels: {
      ...FLOW_DEFAULTS.stepLabels,
      ...(tpl.stepLabels || {}),
      ...((flow && flow.stepLabels) || {}),
    },
  };
}
