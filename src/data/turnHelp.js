// Content + a single worked "day" that drives the animated turn-system
// explainer (TurnHelpModal on web, a twin in mobile/src/lib/turnHelp.js).
// Written for someone who has never worked in a salon. The component derives
// running totals, revenue, and client counts from `clients` + each system's
// `assigned` array, so the numbers can't drift between the two platforms.

export const TURN_HELP = {
  title: 'How the fair-turn system works',

  // Plain-language primer — assume zero salon knowledge.
  basics: [
    { term: 'Walk-in', def: 'A customer who shows up with no appointment. The salon decides which nail tech takes them.' },
    { term: 'Appointment', def: 'A customer who booked ahead for a set time (and sometimes asked for a specific tech).' },
    { term: 'Turn', def: 'Whose “turn” it is to get the next walk-in. The system tracks this so the same tech doesn’t scoop up everybody.' },
  ],

  bigQuestion: {
    q: 'Does a tech who has lots of appointments get punished?',
    a: 'No — and this is the part people get wrong.',
    why: [
      'A tech with a full appointment book is already busy and already earning. The system simply stops piling walk-ins on top of someone who’s slammed and sends them to a teammate who would otherwise be standing around.',
      'Her appointments still count as her share of the work — so by the end of the day she has earned about the same as everyone else. She didn’t lose anything: she was never free to take those walk-ins anyway.',
      'If she finishes her appointments early and is suddenly free, her count stops growing and she rises right back to the top to get walk-ins again. It balances itself — it never punishes.',
    ],
  },

  // The idea, in one line, then the menu the examples use.
  idea:
    'Instead of counting how many customers each tech served, the fair system counts the VALUE of the work they did. Whoever has done the least valuable work so far is next in line. That keeps everyone’s pay even — not just their customer count.',

  menu: [
    { name: 'Polish change', value: 0.5, price: 25 },
    { name: 'Manicure',      value: 1.0, price: 40 },
    { name: 'Fill',          value: 1.0, price: 45 },
    { name: 'Gel manicure',  value: 1.5, price: 60 },
    { name: 'Pedicure',      value: 1.5, price: 65 },
    { name: 'Full set',      value: 2.0, price: 100 },
  ],

  techs: ['Anna', 'Bao', 'Chi'],

  // When clock in determines who joins the rotation and breaks ties.
  clockIns: { Anna: '8:55a', Bao: '9:05a', Chi: '9:20a' },
  tieNote:
    'A tech joins the rotation the moment they clock in. When two techs are tied, the one who clocked in earliest goes next — so clock-in time is the tiebreaker. (Here all three are in before the first walk-in; Anna clocked in first, so she wins ties.)',

  // One day, nine walk-ins, in the order they arrive.
  clients: [
    { n: 1, service: 'Full set',      value: 2.0, price: 100 },
    { n: 2, service: 'Polish change', value: 0.5, price: 25 },
    { n: 3, service: 'Polish change', value: 0.5, price: 25 },
    { n: 4, service: 'Full set',      value: 2.0, price: 100 },
    { n: 5, service: 'Polish change', value: 0.5, price: 25 },
    { n: 6, service: 'Polish change', value: 0.5, price: 25 },
    { n: 7, service: 'Pedicure',      value: 1.5, price: 65 },
    { n: 8, service: 'Polish change', value: 0.5, price: 25 },
    { n: 9, service: 'Gel manicure',  value: 1.5, price: 60 },
  ],

  // How each system hands those same nine walk-ins out.
  systems: {
    leastBusy: {
      key: 'leastBusy',
      label: 'Least-busy (by customer count)',
      blurb: 'Gives the next walk-in to whoever has served the fewest customers. Sounds fair… until you look at the money.',
      // Round-robin: client i → tech (i mod 3).
      assigned: ['Anna', 'Bao', 'Chi', 'Anna', 'Bao', 'Chi', 'Anna', 'Bao', 'Chi'],
    },
    mango: {
      key: 'mango',
      label: 'Fair turns (by value of work)',
      blurb: 'Gives the next walk-in to whoever has done the least valuable work so far. Customer counts may differ — but the pay comes out even.',
      // Each client goes to the tech with the lowest accumulated value.
      assigned: ['Anna', 'Bao', 'Chi', 'Bao', 'Chi', 'Chi', 'Chi', 'Anna', 'Anna'],
    },
  },

  // Why "least busy" feels fair but isn't.
  whyNotFair: [
    'Counting customers treats a $25 polish change and a $100 full set as the same “one turn.” They are not.',
    'So a tech can serve the exact same number of customers as a teammate and take home three times the money — purely by luck of which customers walked in on their turn. That’s a lottery, not fairness.',
    'The value system fixes it: a full set is “worth” about four polish changes, so after one full set you wait while teammates catch up. Everyone’s drawer ends up close to even.',
  ],

  footer:
    'The goal is simple: nobody goes home having earned three times what the person next to them earned for the same day’s work.',
};
