// Inline SVG icon set — Lucide-style 1.5px stroke, scales via size prop, color via currentColor.
// Keeping these inline (no library dependency) matches the project's no-dependency norm.

function Svg({ size = 20, children, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      {...rest}>
      {children}
    </svg>
  );
}

export const IconCalendar = (p) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="18" rx="2" />
    <path d="M16 2v4M8 2v4M3 10h18" />
  </Svg>
);

export const IconUsers = (p) => (
  <Svg {...p}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </Svg>
);

export const IconSparkles = (p) => (
  <Svg {...p}>
    <path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9-1.9 4.6-1.9-4.6L5.5 9.5l4.6-1.9L12 3z" />
    <path d="M19 14l.95 2.3 2.3.95-2.3.95L19 20.5l-.95-2.3-2.3-.95 2.3-.95L19 14z" />
    <path d="M5 16l.7 1.7 1.7.7-1.7.7L5 20.8l-.7-1.7L2.6 18.4l1.7-.7L5 16z" />
  </Svg>
);

export const IconUserBadge = (p) => (
  <Svg {...p}>
    <path d="M16 21v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" />
    <circle cx="10" cy="8" r="4" />
    <path d="M18 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2" />
    <path d="M18 12h.01" />
  </Svg>
);

export const IconBarChart = (p) => (
  <Svg {...p}>
    <path d="M3 3v18h18" />
    <rect x="7" y="12" width="3" height="6" />
    <rect x="12" y="8" width="3" height="10" />
    <rect x="17" y="4" width="3" height="14" />
  </Svg>
);

export const IconBriefcase = (p) => (
  <Svg {...p}>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
    <path d="M2 13h20" />
  </Svg>
);

export const IconGift = (p) => (
  <Svg {...p}>
    <path d="M20 12v10H4V12" />
    <path d="M2 7h20v5H2z" />
    <path d="M12 22V7" />
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
  </Svg>
);

export const IconCalendarClock = (p) => (
  <Svg {...p}>
    <path d="M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6.5" />
    <path d="M16 2v4M8 2v4M3 10h18" />
    <circle cx="17" cy="17" r="5" />
    <path d="M17 14.5V17l1.5 1" />
  </Svg>
);

export const IconShoppingCart = (p) => (
  <Svg {...p}>
    <circle cx="9" cy="21" r="1" />
    <circle cx="20" cy="21" r="1" />
    <path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6" />
  </Svg>
);

export const IconShoppingBag = (p) => (
  <Svg {...p}>
    <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
    <path d="M3 6h18" />
    <path d="M16 10a4 4 0 0 1-8 0" />
  </Svg>
);

export const IconMegaphone = (p) => (
  <Svg {...p}>
    <path d="M3 11h2.5L20 4v16l-14.5-7H3z" />
    <path d="M5.5 11v6" />
    <path d="M9 18a3 3 0 0 1-3-3v-1" />
  </Svg>
);

export const IconMessage = (p) => (
  <Svg {...p}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </Svg>
);

export const IconLightbulb = (p) => (
  <Svg {...p}>
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8a6 6 0 0 0-12 0c0 1.5.5 2.5 1.5 3.5.76.76 1.23 1.52 1.41 2.5" />
  </Svg>
);

export const IconChair = (p) => (
  <Svg {...p}>
    <path d="M6 19v3" />
    <path d="M18 19v3" />
    <path d="M6 19h12" />
    <path d="M5 9h14a2 2 0 0 1 0 4H5a2 2 0 0 1 0-4z" />
    <path d="M7 9V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
    <path d="M7 13l-1 6M17 13l1 6" />
  </Svg>
);

export const IconHome = (p) => (
  <Svg {...p}>
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </Svg>
);

export const IconSettings = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3 1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </Svg>
);

export const IconChevronRight = (p) => (
  <Svg {...p}>
    <polyline points="9 18 15 12 9 6" />
  </Svg>
);

export const IconCheck = (p) => (
  <Svg {...p}>
    <polyline points="20 6 9 17 4 12" />
  </Svg>
);

export const IconArrowLeft = (p) => (
  <Svg {...p}>
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </Svg>
);

export const IconClock = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </Svg>
);

export const IconBell = (p) => (
  <Svg {...p}>
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </Svg>
);

export const IconArrowUpRight = (p) => (
  <Svg {...p}>
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </Svg>
);

// Lookup table for module ids → icon
export const MODULE_ICONS = {
  schedule:  IconCalendar,
  clients:   IconUsers,
  services:  IconSparkles,
  employees: IconUserBadge,
  reports:   IconBarChart,
  attendance: IconCalendarClock,
  hr:        IconBriefcase,
  giftcards: IconGift,
  meetings:  IconCalendarClock,
  products:  IconShoppingBag,
  marketing: IconMegaphone,
  chat:      IconMessage,
  tipflow:   IconLightbulb,
  queue:     IconChair,
  home:      IconHome,
  settings:  IconSettings,
};
