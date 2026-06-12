// Plain-data explainer for the walk-in TURN ROTATION system, rendered on-page by
// TurnHelpModal (web) and a twin in mobile/src/lib/turnHelp.js (keep in sync).
// Accurate to the real behavior — note the web-vs-mobile difference in what
// auto-counts a turn (see "What counts as a turn").

export const TURN_HELP = {
  title: 'How the turn system works',
  intro:
    "The rotation keeps walk-ins fair. The tech who has taken the fewest turns today is “next up” (⭐). Each walk-in you seat advances that tech, so the line cycles evenly through everyone who's working.",
  sections: [
    {
      h: "Who's in the rotation",
      p: [
        'Techs join automatically the moment they clock in at the Clock Kiosk, starting at 0 turns. You can also add one by hand. Marking a tech Away (💤) drops them to the bottom until they tap Back.',
      ],
    },
    {
      h: 'Who is “next up”',
      p: ['The order, from the top down, is decided by:'],
      bullets: [
        'Fewest turns today comes first.',
        'Ties break by seniority — but only if “Seniority order” is turned on in settings.',
        'Otherwise ties break by whoever clocked in earliest.',
        'Away techs always sink to the bottom and never hold the ⭐.',
      ],
    },
    {
      h: 'What counts as a turn',
      p: ['A “turn” is one customer served, for fairness purposes. Turns get counted three ways:'],
      bullets: [
        'Seating a walk-in with the Seat button adds a turn to the tech you pick — this is the main way turns are counted.',
        'On the web schedule, marking a booked appointment “done” also adds a turn automatically.',
        'The +1 button adds a turn by hand for anything the app didn’t see — a tech who grabbed the next person without anyone tapping Seat, or (on the phone/tablet app) a booked client. Use it to keep the order honest.',
      ],
    },
    {
      h: 'Turn weight (optional settings)',
      bullets: [
        'Partial turns: a seating can count as a full, a half, or no turn — handy for a quick polish change vs. a full set.',
        'Requested-tech-no-turn: if a client specifically asks for a tech, seating them adds 0 turns, so honoring a request never costs that tech their place for the next unassigned walk-in.',
      ],
    },
    {
      h: 'Fixing mistakes',
      bullets: [
        'Right after seating, an Undo banner returns the client to the waitlist and removes the turn (mobile).',
        'Use +1 to bump a tech who took someone off-book.',
        'Remove (✕) takes a tech off today’s rotation entirely.',
      ],
    },
  ],
  examples: [
    {
      title: 'A normal morning',
      lines: [
        'Aaliyah, Ben, and Cara all clock in → everyone at 0 turns. Aaliyah clocked in first, so she’s ⭐.',
        'A walk-in arrives with no preference → you Seat → Aaliyah. Aaliyah = 1 turn.',
        'Now Ben is ⭐ (0 turns, clocked in before Cara). Seat the next walk-in → Ben = 1.',
        'Cara is ⭐ next. The line keeps cycling evenly.',
      ],
    },
    {
      title: 'A client requests a specific tech',
      lines: [
        'Aaliyah 2 · Ben 1 · Cara 1 → Ben is ⭐.',
        'A client asks for Aaliyah by name. You Seat → Aaliyah and mark “requested.”',
        'With Requested-tech-no-turn on, Aaliyah stays at 2 turns — Ben is still ⭐ for the next walk-in who has no preference.',
      ],
    },
    {
      title: 'A tech grabbed someone you didn’t seat',
      lines: [
        'Ben walks a waiting client back himself, and nobody tapped Seat.',
        'The app didn’t see it, so Ben still looks low in the rotation and would unfairly be ⭐ again.',
        'Tap +1 on Ben so he advances and the order stays fair. (On the phone/tablet app, do the same for a booked appointment — only the web schedule counts those automatically.)',
      ],
    },
    {
      title: 'Someone steps out',
      lines: [
        'Cara goes to lunch → tap Away. Cara (💤) drops to the bottom and won’t be ⭐.',
        'Walk-ins flow to Aaliyah and Ben. When Cara returns → tap Back.',
        'Cara rejoins with the turns she already had, so she’s likely ⭐ now — she missed turns while she was out.',
      ],
    },
    {
      title: 'Wrong tech — undo it',
      lines: [
        'You meant Cara but tapped Seat → Ben.',
        'Tap Undo on the banner: the client goes back to the waitlist and Ben’s turn is removed.',
        'Seat again → Cara. No harm done.',
      ],
    },
  ],
  footer:
    'Goal: nobody serves two walk-ins while a teammate serves none. When in doubt, glance at the turn counts — lowest is always next.',
};
