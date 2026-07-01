import { useState, useEffect } from 'react';
import { fetchServices, fetchEmployees, subscribeGoogleReviews } from '../lib/firestore';

const INK         = '#302c29';
const INK_SOFT    = '#5a534d';
const INK_FAINT   = '#8a827a';
const CREAM       = '#faf6ef';
const CREAM_DEEP  = '#f3ebdc';
const IVORY       = '#fbfaf8';
const GOLD        = '#c19a4a';
const GOLD_TINT   = 'rgba(193,154,74,.08)';
const RULE        = 'rgba(48,44,41,.10)';
const RULE_GOLD   = 'rgba(193,154,74,.32)';

const FONT_SERIF   = '"Cormorant Garamond", Georgia, serif';
const FONT_DISPLAY = '"Cinzel", Georgia, serif';
const FONT_BODY    = '"Inter", sans-serif';

const BRAND = '/brand/meraki';

const DEFAULT_REVIEWS = [
  { body: "Every nail tech I've had has been incredible. The studio is calm, clean, and the work is always exactly what I asked for — and somehow better.", name: 'Marisol G.' },
  { body: "I've been going to Meraki for two years and won't go anywhere else. Sammy's nail art is on another level — I show her a Pinterest and she makes it better than the photo.", name: 'Aisha W.' },
  { body: "The best gel‑x I've gotten in Columbus, full stop. They take their time, they care about your natural nails, and it always lasts the full four weeks.", name: 'Becca P.' },
];

const DEFAULT_INSTAGRAM = [4, 12, 17, 22, 28, 33].map(n => `${BRAND}/portfolio/grid/photo-${String(n).padStart(2,'0')}.jpg`);

const DEFAULT_PORTFOLIO = [
  { src: `${BRAND}/portfolio/hero/photo-01.jpg`, cls: 't-wide' },
  { src: `${BRAND}/portfolio/hero/photo-15.jpg`, cls: 't-tall' },
  { src: `${BRAND}/portfolio/hero/photo-30.jpg`, cls: 't-sq'   },
  { src: `${BRAND}/portfolio/hero/photo-05.jpg`, cls: 't-mid'  },
  { src: `${BRAND}/portfolio/hero/photo-20.jpg`, cls: 't-md2'  },
  { src: `${BRAND}/portfolio/hero/photo-38.jpg`, cls: 't-sq'   },
  { src: `${BRAND}/portfolio/hero/photo-25.jpg`, cls: 't-mid'  },
  { src: `${BRAND}/portfolio/hero/photo-03.jpg`, cls: 't-sq'   },
  { src: `${BRAND}/portfolio/hero/photo-10.jpg`, cls: 't-mid'  },
  { src: `${BRAND}/portfolio/hero/photo-12.jpg`, cls: 't-tall' },
  { src: `${BRAND}/portfolio/hero/photo-17.jpg`, cls: 't-sq'   },
  { src: `${BRAND}/portfolio/hero/photo-33.jpg`, cls: 't-md2'  },
  { src: `${BRAND}/portfolio/hero/photo-07.jpg`, cls: 't-sq'   },
  { src: `${BRAND}/portfolio/hero/photo-43.jpg`, cls: 't-wide' },
  { src: `${BRAND}/portfolio/hero/photo-28.jpg`, cls: 't-mid'  },
  { src: `${BRAND}/portfolio/hero/photo-40.jpg`, cls: 't-sq'   },
];

const DEFAULT_TEAM = [
  { name: 'Yasmin D.',    handle: '' },
  { name: 'Audriana L.',  handle: '' },
  { name: 'Samantha T.',  handle: '@gelxbysammy' },
  { name: 'Tess D.',      handle: '' },
  { name: 'Elizabeth L.', handle: '' },
  { name: 'Yan W.',       handle: '' },
  { name: 'Jen T.',       handle: '@kidcozynails' },
  { name: 'Marisela I.',  handle: '@licenced2polish' },
  { name: 'Ana P.',       handle: '' },
  { name: 'Jenesis B.',   handle: '' },
];

const DEFAULT_SERVICES_FALLBACK = [
  { name: 'Gel‑X',              priceFrom: 70, durationMin: 60, meta: 'Soft gel tips', desc: 'Lightweight soft‑gel extensions in any length or shape, sculpted around the natural nail. Our most requested set for nail art.' },
  { name: 'Signature Manicure', priceFrom: 32, durationMin: 35, meta: 'Spa ritual',    desc: 'Steam, soak, exfoliation, cuticle care, hydrating hand massage. A weekly ritual that leaves your hands rested.' },
  { name: 'Structured Gel',     priceFrom: 50, durationMin: 60, meta: 'Builder gel',   desc: 'Reinforces the natural nail with a builder‑gel base. For short to medium lengths that want strength without extensions.' },
  { name: 'Signature Pedicure', priceFrom: 52, durationMin: 45, meta: 'Spa ritual',    desc: 'Steam, callus removal, sugar scrub, mud mask, and hot towels. Our most asked‑for pedicure, year‑round.' },
  { name: 'Deluxe Pedicure',    priceFrom: 65, durationMin: 60, meta: 'Hot stone',     desc: 'A longer ritual with hot stone massage and full lower‑leg treatment. A small luxury after a long week.' },
  { name: 'Custom Nail Art',    priceFrom: 15, durationMin: 10, meta: 'Per nail',      desc: 'Free‑hand chrome, florals, French variations, and custom requests. Bring a reference or trust the artist.' },
];

const DEFAULT_HOURS = [
  ['Monday',          'Closed'],
  ['Tuesday – Friday','10am – 8pm'],
  ['Saturday',        '9am – 7pm'],
  ['Sunday',          '11am – 5pm'],
];

// Display US phone numbers in (xxx) xxx-xxxx form regardless of whether the
// stored value is E.164 (+16145822703), 10-digit (6145822703), or already
// pretty. Unknown lengths return the raw value (foreign numbers, extensions).
function formatPhoneDisplay(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7,11)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6,10)}`;
  }
  return s;
}

function useIsNarrow(threshold = 960) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.innerWidth < threshold);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < threshold);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [threshold]);
  return narrow;
}

export default function HeroMerakiSite({ webCfg, onSignIn }) {
  const narrow = useIsNarrow(960);
  const veryNarrow = useIsNarrow(680);

  const reviews    = (webCfg?.reviews        && webCfg.reviews.length        ? webCfg.reviews        : DEFAULT_REVIEWS).slice(0, 3);
  const igGrid     = (webCfg?.instagramGrid  && webCfg.instagramGrid.length  ? webCfg.instagramGrid  : DEFAULT_INSTAGRAM).slice(0, 6);
  const heroPhoto  = webCfg?.heroPhoto       || `${BRAND}/portfolio/hero/photo-02.jpg`;
  // ?? (not ||) so an explicit empty-string from Admin hides the caption.
  // Other intro fields use || because they always need content.
  const heroCredit = webCfg?.heroCredit ?? 'Nail art by Samantha · @gelxbysammy';
  const salonName  = webCfg?.salonName       || 'Meraki Nail Studio';
  const rawPhone   = webCfg?.phone           || '(614) 000‑0000';
  const phone      = formatPhoneDisplay(rawPhone);
  const phoneHref  = rawPhone.replace(/[^\d+]/g, '');
  const email      = webCfg?.publicEmail     || 'hello@merakinailstudio.com';
  const address1   = webCfg?.address1        || '5029 Olentangy River Rd';
  const address2   = webCfg?.address2        || 'Columbus, OH 43214';
  const established= webCfg?.established     || '';
  const igHandle   = webCfg?.instagramHandle || '@meraki_cbus';

  // Rating + review count are pulled live from the googleReviews cache
  // (populated by the refreshGoogleReviews Cloud Function). Manual webCfg
  // overrides remain as a fallback when the Place ID isn't configured yet.
  const [gReviews, setGReviews] = useState(null);
  useEffect(() => subscribeGoogleReviews(setGReviews), []);
  const rating = gReviews?.rating != null
    ? (Math.round(Number(gReviews.rating) * 10) / 10).toFixed(1)
    : (webCfg?.rating || '4.9');
  const reviewCount = gReviews?.userRatingCount != null
    ? String(gReviews.userRatingCount)
    : (webCfg?.reviewCount || '240+');

  // Editorial copy — every prose-y string the editorial layout displays
  // can be overridden per-tenant via webfront fields. Defaults below are
  // tenant-neutral fallbacks; tenants override via Admin (or the patch
  // script at scripts/set-meraki-webfront-values.cjs) without redeploys.
  const heroCopy = webCfg?.heroCopy
    || 'A quiet studio for considered nail work — meraki is the Greek soul of doing something with all of yourself. We bring that to every set.';
  const servicesIntro = webCfg?.servicesIntro
    || 'A curated set of signature treatments. Considered work, quiet rooms, no rush.';
  const portfolioIntro = webCfg?.portfolioIntro
    || 'A small sample. The full feed lives on Instagram.';
  const teamIntro = webCfg?.teamIntro
    || 'Each of our techs brings their own hand and their own specialty. Browse the team and book the one whose work you love.';
  const visitIntro = webCfg?.visitIntro
    || 'Two blocks north of the Olentangy Trail. Parking out front and around back.';
  const fbHandle   = webCfg?.facebookHandle  || 'merakicolumbus';
  const hours      = webCfg?.hours           || DEFAULT_HOURS;
  const portfolio  = (webCfg?.portfolio      && webCfg.portfolio.length      ? webCfg.portfolio      : DEFAULT_PORTFOLIO);

  // Live services from Firestore, fall back to brand defaults if the pre-login
  // session can't read them. We grab top 6 to keep the homepage tight.
  const [services, setServices] = useState(DEFAULT_SERVICES_FALLBACK);
  const [team,     setTeam]     = useState(DEFAULT_TEAM);
  useEffect(() => {
    fetchServices().then(svc => {
      if (!svc || !svc.length) return;
      const sorted = [...svc]
        .filter(s => s.active !== false)
        .sort((a, b) => (b.priceFrom || b.price || 0) - (a.priceFrom || a.price || 0))
        .slice(0, 6)
        .map(s => ({
          name: s.name,
          priceFrom: s.priceFrom || s.price || 0,
          durationMin: s.duration || s.durationMin || 30,
          meta: s.category || '',
          desc: s.description || '',
        }));
      if (sorted.length) setServices(sorted);
    }).catch(() => { /* keep defaults */ });
    fetchEmployees().then(emps => {
      if (!emps || !emps.length) return;
      const active = emps.filter(e => e.active !== false).slice(0, 10).map(e => ({
        name:   e.name,
        handle: e.social?.instagram ? `@${e.social.instagram.replace(/^@/, '')}` : '',
        photo:  e.photo || '',
      }));
      if (active.length) setTeam(active);
    }).catch(() => { /* keep defaults */ });
  }, []);

  return (
    <div style={{ background: IVORY, color: INK, fontFamily: FONT_BODY, fontWeight: 300, lineHeight: 1.55, minHeight: '100vh', width: '100%', WebkitFontSmoothing: 'antialiased' }}>

      <Nav narrow={narrow} onSignIn={onSignIn} salonName={salonName} />

      <Hero
        narrow={narrow}
        salonName={salonName}
        heroPhoto={heroPhoto}
        heroCredit={heroCredit}
        established={established}
        rating={rating}
        reviewCount={reviewCount}
        teamCount={team.length}
        heroCopy={heroCopy}
        walkInLine={webCfg?.walkInLine || 'Walk‑ins every day'}
      />

      <Services narrow={narrow} veryNarrow={veryNarrow} services={services} intro={servicesIntro} />

      <Portfolio narrow={narrow} portfolio={portfolio} intro={portfolioIntro} />

      <Reviews narrow={narrow} reviews={reviews} rating={rating} reviewCount={reviewCount} />

      <Team narrow={narrow} veryNarrow={veryNarrow} team={team} intro={teamIntro} webCfg={webCfg} />

      <Instagram narrow={narrow} veryNarrow={veryNarrow} igGrid={igGrid} handle={igHandle} />

      <Visit narrow={narrow} address1={address1} address2={address2} hours={hours} phone={phone} phoneHref={phoneHref} email={email} intro={visitIntro} mapsUrl={webCfg?.mapsUrl || ''} />

      <Footer narrow={narrow} onSignIn={onSignIn} igHandle={igHandle} fbHandle={fbHandle} />
    </div>
  );
}

/* ─────────────────────── primitives ─────────────────────────────── */

function Container({ children, style }) {
  return <div style={{ maxWidth: 1240, margin: '0 auto', padding: '0 32px', ...style }}>{children}</div>;
}

function Eyebrow({ children, light, style }) {
  return (
    <div style={{
      fontFamily: FONT_DISPLAY,
      fontSize: 10,
      fontWeight: 500,
      letterSpacing: '.36em',
      textTransform: 'uppercase',
      color: light ? 'rgba(255,255,255,.55)' : INK_FAINT,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionHead({ eyebrow, title, sub, light }) {
  return (
    <div style={{ textAlign: 'center', marginBottom: 52 }}>
      <Eyebrow light={light} style={{ display: 'block', marginBottom: 18 }}>{eyebrow}</Eyebrow>
      <h2 style={{
        fontFamily: FONT_SERIF,
        fontWeight: 300,
        fontSize: 'clamp(40px,5vw,64px)',
        lineHeight: 1.05,
        letterSpacing: '-.005em',
        marginBottom: 18,
        color: light ? IVORY : INK,
      }}>
        {title}
      </h2>
      {sub && (
        <div style={{
          fontFamily: FONT_SERIF,
          fontStyle: 'italic',
          fontSize: 19,
          color: light ? 'rgba(255,255,255,.7)' : INK_SOFT,
          maxWidth: 560, margin: '0 auto',
        }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Pill({ children, href, variant = 'outline', onClick, target }) {
  const [hover, setHover] = useState(false);
  const variants = {
    outline: {
      bg:    hover ? GOLD : GOLD_TINT,
      color: hover ? '#fff' : INK,
      border: `1.5px solid ${GOLD}`,
    },
    solid: {
      bg:    hover ? '#a8853c' : GOLD,
      color: '#fff',
      border: `1.5px solid ${hover ? '#a8853c' : GOLD}`,
    },
    ghost: {
      bg:    hover ? INK : 'transparent',
      color: hover ? '#fff' : INK,
      border: `1.5px solid ${INK}`,
    },
    white: {
      bg:    hover ? GOLD : '#fff',
      color: hover ? '#fff' : INK,
      border: `1.5px solid ${hover ? GOLD : '#fff'}`,
    },
  };
  const v = variants[variant] || variants.outline;
  const Tag = href ? 'a' : 'button';
  return (
    <Tag href={href} target={target} rel={target === '_blank' ? 'noopener noreferrer' : undefined}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '.28em',
        textTransform: 'uppercase',
        background: v.bg,
        color: v.color,
        border: v.border,
        borderRadius: 30,
        padding: '11px 26px',
        cursor: 'pointer',
        transition: 'all .22s ease',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        textDecoration: 'none',
        boxShadow: hover && variant === 'outline' ? '0 12px 28px rgba(193,154,74,.32)' : 'none',
        transform: hover ? 'translateY(-1px)' : 'translateY(0)',
      }}>
      {children}
    </Tag>
  );
}

/* ─────────────────────── nav ────────────────────────────────────── */

function Nav({ narrow, onSignIn, salonName }) {
  return (
    <nav style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
      backdropFilter: 'saturate(1.4) blur(14px)',
      WebkitBackdropFilter: 'saturate(1.4) blur(14px)',
      background: 'rgba(251,250,248,.78)',
      borderBottom: `1px solid ${RULE}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 32px' }}>
        <a href="#top" aria-label={salonName} style={{ display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          <img src={`${BRAND}/circle-badge.svg`} alt={salonName} style={{ width: 56, height: 56 }} />
        </a>
        {!narrow && (
          <div style={{ display: 'flex', gap: 36, alignItems: 'center' }}>
            <NavLink href="#services">Services</NavLink>
            <NavLink href="#team">The Team</NavLink>
            <NavLink href="#portfolio">Portfolio</NavLink>
            <NavLink href="#visit">Visit</NavLink>
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {!narrow && (
            <a onClick={onSignIn} style={{
              fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase',
              color: INK_FAINT, cursor: 'pointer', textDecoration: 'none',
            }}>Sign in</a>
          )}
          <Pill href="/book" variant="outline">Book now <span>→</span></Pill>
        </div>
      </div>
    </nav>
  );
}

function NavLink({ href, children }) {
  const [hover, setHover] = useState(false);
  return (
    <a href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase',
        color: hover ? INK : INK_SOFT, transition: 'color .2s ease', textDecoration: 'none',
      }}>
      {children}
    </a>
  );
}

/* ─────────────────────── hero ───────────────────────────────────── */

function Hero({ narrow, salonName, heroPhoto, heroCredit, established, rating, reviewCount, teamCount, heroCopy, walkInLine }) {
  return (
    <section id="top" style={{ position: 'relative', padding: narrow ? '108px 0 48px' : '140px 0 56px', overflow: 'hidden', background: CREAM }}>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 70% 50% at 50% 20%, rgba(193,154,74,.12), transparent 60%)', pointerEvents: 'none' }} />
      <Container style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.05fr 1fr', gap: narrow ? 48 : 64, alignItems: 'center', position: 'relative' }}>
        <div style={{ position: 'relative', zIndex: 1, order: narrow ? 1 : 0 }}>
          <Eyebrow style={{ marginBottom: 32 }}>
            Columbus · Ohio{established ? ` · Since ${established}` : ''}
          </Eyebrow>
          <div style={{ margin: '24px 0 0', maxWidth: 520, width: '100%' }}>
            <img src={`${BRAND}/wordmark.svg`} alt={salonName} style={{ width: '100%', height: 'auto' }} />
          </div>
          <div style={{ margin: '30px 0 0', maxWidth: 380, width: '100%', opacity: .85 }}>
            <img src={`${BRAND}/script-tagline.svg`} alt="soul · creativity · love" style={{ width: '100%', height: 'auto' }} />
          </div>
          <p style={{
            maxWidth: 460, margin: '42px 0 0',
            fontFamily: FONT_SERIF, fontSize: 21, fontWeight: 300, fontStyle: 'italic',
            lineHeight: 1.55, color: INK_SOFT,
          }}>
            {heroCopy}
          </p>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginTop: 38, flexWrap: 'wrap' }}>
            <Pill href="/book" variant="solid">Book an appointment <span>→</span></Pill>
            <HeroSecondary href="#services">View the menu</HeroSecondary>
          </div>
        </div>
        <div style={{
          position: 'relative', height: narrow ? 520 : 640, borderRadius: 6, overflow: 'hidden',
          boxShadow: '0 30px 80px rgba(48,44,41,.18), 0 6px 18px rgba(48,44,41,.06)',
          order: narrow ? 0 : 1,
        }}>
          <img src={heroPhoto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(48,44,41,0) 60%, rgba(48,44,41,.15))', pointerEvents: 'none' }} />
          {heroCredit && (
            <div style={{ position: 'absolute', bottom: 24, left: 24, color: '#fff', fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', opacity: .85 }}>
              {heroCredit}
            </div>
          )}
        </div>
      </Container>
      <Container style={{ marginTop: 56 }}>
        <div style={{
          padding: '18px 0', borderTop: `1px solid ${RULE}`, borderBottom: `1px solid ${RULE}`,
          display: 'flex', justifyContent: 'space-between', gap: narrow ? 24 : 48,
          fontFamily: FONT_DISPLAY, fontSize: narrow ? 9 : 10, letterSpacing: '.32em', textTransform: 'uppercase',
          color: INK_FAINT, flexWrap: 'wrap',
        }}>
          <span style={{ whiteSpace: 'nowrap' }}><strong style={{ color: INK, fontWeight: 500 }}>{teamCount || 10}</strong> licensed nail artists</span>
          <span style={{ whiteSpace: 'nowrap' }}><strong style={{ color: INK, fontWeight: 500 }}>{rating}★</strong> on Google · {reviewCount} reviews</span>
          <span style={{ whiteSpace: 'nowrap' }}>Olentangy River Rd · Columbus</span>
          <span style={{ whiteSpace: 'nowrap' }}>{walkInLine}</span>
        </div>
      </Container>
    </section>
  );
}

function HeroSecondary({ href, children }) {
  const [hover, setHover] = useState(false);
  return (
    <a href={href}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase',
        color: INK, padding: '11px 0', borderBottom: `1px solid ${INK}`,
        textDecoration: 'none', opacity: hover ? .6 : 1, transition: 'opacity .2s',
      }}>
      {children}
    </a>
  );
}

/* ─────────────────────── services ───────────────────────────────── */

function Services({ veryNarrow, services, intro }) {
  return (
    <section id="services" style={{ padding: '76px 0', background: CREAM }}>
      <Container>
        <SectionHead
          eyebrow="The Menu"
          title={<>Considered care, from <em style={{ fontFamily: FONT_SERIF }}>first soak</em> to final shine.</>}
          sub={intro}
        />
        <div style={{
          display: 'grid',
          gridTemplateColumns: veryNarrow ? '1fr' : 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: veryNarrow ? 40 : '48px 56px',
        }}>
          {services.map((s, i) => <ServiceCard key={i} {...s} />)}
        </div>
        <div style={{ textAlign: 'center', marginTop: 72 }}>
          <Pill href="/book" variant="ghost">View the full menu <span>→</span></Pill>
        </div>
      </Container>
    </section>
  );
}

function ServiceCard({ name, priceFrom, durationMin, meta, desc }) {
  const [hover, setHover] = useState(false);
  return (
    <article
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        fontFamily: FONT_SERIF, fontWeight: 400, fontSize: 26, color: INK,
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 16,
        paddingBottom: 14, borderBottom: `1px solid ${RULE}`,
      }}>
        <span>{name}</span>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.2em', color: GOLD, whiteSpace: 'nowrap' }}>
          FROM ${priceFrom}
        </span>
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', color: INK_FAINT }}>
        {durationMin}+ min{meta ? ` · ${meta}` : ''}
      </div>
      <p style={{ fontFamily: FONT_BODY, fontWeight: 300, fontSize: 14, color: INK_SOFT, lineHeight: 1.65 }}>
        {desc}
      </p>
      <a href="/book" style={{
        marginTop: 'auto', fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '.3em',
        textTransform: 'uppercase', color: INK, paddingTop: 14, textDecoration: 'none',
        display: 'inline-flex', alignItems: 'center', gap: 8,
      }}>
        Book this <span style={{ transform: hover ? 'translateX(3px)' : 'translateX(0)', transition: 'transform .2s ease' }}>→</span>
      </a>
    </article>
  );
}

/* ─────────────────────── portfolio ──────────────────────────────── */

function Portfolio({ narrow, portfolio, intro }) {
  return (
    <section id="portfolio" style={{ padding: '76px 0', background: IVORY }}>
      <Container>
        <SectionHead
          eyebrow="Recent Work"
          title="From the studio, lately."
          sub={intro}
        />
        <div style={{
          display: 'grid',
          gridTemplateColumns: narrow ? 'repeat(6, 1fr)' : 'repeat(12, 1fr)',
          gap: 14,
          gridAutoRows: narrow ? 120 : 160,
        }}>
          {portfolio.map((p, i) => <PortfolioTile key={i} src={p.src} cls={p.cls} narrow={narrow} />)}
        </div>
      </Container>
    </section>
  );
}

function PortfolioTile({ src, cls, narrow }) {
  const [hover, setHover] = useState(false);
  const layouts = narrow
    ? { gridColumn: 'span 3', gridRow: 'span 2' }
    : {
      't-wide': { gridColumn: 'span 6', gridRow: 'span 2' },
      't-tall': { gridColumn: 'span 3', gridRow: 'span 3' },
      't-sq':   { gridColumn: 'span 3', gridRow: 'span 2' },
      't-mid':  { gridColumn: 'span 4', gridRow: 'span 2' },
      't-md2':  { gridColumn: 'span 5', gridRow: 'span 2' },
      't-lg':   { gridColumn: 'span 6', gridRow: 'span 3' },
    }[cls] || { gridColumn: 'span 3', gridRow: 'span 2' };
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative', overflow: 'hidden', borderRadius: 3,
        background: CREAM_DEEP, cursor: 'pointer', ...layouts,
      }}>
      <img src={src} alt="" loading="lazy" style={{
        width: '100%', height: '100%', objectFit: 'cover',
        transition: 'transform .6s cubic-bezier(.2,.6,.2,1)',
        transform: hover ? 'scale(1.04)' : 'scale(1)',
      }} />
    </div>
  );
}

/* ─────────────────────── reviews ────────────────────────────────── */

function Reviews({ narrow, reviews, rating, reviewCount }) {
  return (
    <section style={{ padding: '76px 0', background: INK, color: IVORY }}>
      <Container>
        <SectionHead light eyebrow="Said about us" title="What our guests carry home." />
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 18, margin: '0 auto 56px', flexWrap: 'wrap',
        }}>
          <GoogleG />
          <span style={{ fontFamily: FONT_SERIF, fontSize: 34, fontWeight: 300, color: '#fff' }}>{rating}</span>
          <span style={{ fontSize: 24, letterSpacing: 6, color: GOLD }}>★★★★★</span>
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', color: 'rgba(255,255,255,.65)' }}>
            {reviewCount} Google reviews
          </span>
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr' : 'repeat(3, 1fr)',
          gap: narrow ? 48 : 56, maxWidth: 1140, margin: '0 auto',
        }}>
          {reviews.map((r, i) => <ReviewCard key={i} {...r} />)}
        </div>
        <div style={{ textAlign: 'center', marginTop: 72 }}>
          <Pill href="https://www.google.com/search?q=Meraki+Nail+Studio+Columbus" target="_blank" variant="white">
            Read all on Google <span>→</span>
          </Pill>
        </div>
      </Container>
    </section>
  );
}

function ReviewCard({ body, name }) {
  return (
    <article style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 60, lineHeight: .6, color: GOLD, height: 24 }}>"</div>
      <div style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontWeight: 300, fontSize: 21, lineHeight: 1.6, color: 'rgba(255,255,255,.88)' }}>
        {body}
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginTop: 'auto',
        paddingTop: 24, borderTop: '1px solid rgba(255,255,255,.1)',
      }}>
        <span style={{ fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase', color: '#fff' }}>{name}</span>
        <span style={{ color: GOLD, fontSize: 11, letterSpacing: 3 }}>★★★★★</span>
      </div>
    </article>
  );
}

function GoogleG() {
  return (
    <svg width={22} height={22} viewBox="0 0 48 48" aria-hidden style={{ display: 'inline-block', verticalAlign: 'middle' }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

/* ─────────────────────── team ───────────────────────────────────── */

function Team({ veryNarrow, team, intro, webCfg }) {
  const cols = veryNarrow ? 2 : team.length > 6 ? 5 : team.length;
  return (
    <section id="team" style={{ padding: '76px 0', background: CREAM }}>
      <Container>
        <SectionHead
          eyebrow="The Studio"
          title={<>Ten artists. <em style={{ fontFamily: FONT_SERIF }}>One quiet room.</em></>}
          sub={intro}
        />
        <div style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: veryNarrow ? '32px 20px' : '48px 32px',
        }}>
          {team.map((t, i) => <TechCard key={i} {...t} shape={webCfg?.teamPhotoShape || 'rectangle'} idx={i} />)}
        </div>
      </Container>
    </section>
  );
}

// Asymmetric blob border-radius variants. Each tech in the team grid gets
// a different one by index so the row feels organic instead of stamped.
// Values are hand-tuned to feel natural at the team-card aspect ratio.
const ASYMMETRIC_RADII = [
  '63% 37% 54% 46% / 55% 48% 52% 45%',
  '47% 53% 70% 30% / 41% 64% 36% 59%',
  '30% 70% 70% 30% / 36% 30% 70% 64%',
  '65% 35% 55% 45% / 35% 60% 40% 65%',
  '72% 28% 41% 59% / 58% 70% 30% 42%',
  '40% 60% 65% 35% / 60% 40% 60% 40%',
  '55% 45% 30% 70% / 48% 35% 65% 52%',
  '38% 62% 56% 44% / 70% 40% 60% 30%',
];

function techPhotoFrameStyle(shape, idx, baseAspect = '1 / 1.15') {
  // Base shared across all shapes.
  const common = { overflow: 'hidden', background: CREAM_DEEP, marginBottom: 16, position: 'relative' };
  if (shape === 'circle') {
    return { ...common, aspectRatio: '1 / 1', borderRadius: '50%' };
  }
  if (shape === 'rounded') {
    return { ...common, aspectRatio: baseAspect, borderRadius: 22 };
  }
  if (shape === 'asymmetric') {
    const radii = ASYMMETRIC_RADII[idx % ASYMMETRIC_RADII.length];
    return { ...common, aspectRatio: '1 / 1', borderRadius: radii };
  }
  // 'rectangle' (default).
  return { ...common, aspectRatio: baseAspect, borderRadius: 3 };
}

function TechCard({ name, handle, photo, shape = 'rectangle', idx = 0 }) {
  const letter = (name || '?').trim()[0]?.toUpperCase() || '?';
  const frameStyle = techPhotoFrameStyle(shape, idx);
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={frameStyle}>
        {photo ? (
          <img src={photo} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: FONT_SERIF, fontSize: 60, fontStyle: 'italic', color: GOLD,
            background: 'linear-gradient(135deg, #efe6d4, #e6d9bf)',
          }}>
            {letter}
          </div>
        )}
      </div>
      <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 400, color: INK, marginBottom: 4 }}>
        {name}
      </div>
      <div style={{ fontFamily: FONT_DISPLAY, fontSize: 9.5, letterSpacing: '.28em', textTransform: 'lowercase', color: GOLD, minHeight: 12 }}>
        {handle || ' '}
      </div>
    </div>
  );
}

/* ─────────────────────── instagram ──────────────────────────────── */

function Instagram({ veryNarrow, igGrid, handle }) {
  return (
    <section style={{ padding: '76px 0', background: IVORY }}>
      <Container>
        <div style={{ textAlign: 'center', marginBottom: 0 }}>
          <Eyebrow style={{ display: 'block', marginBottom: 18 }}>Follow us</Eyebrow>
          <h2 style={{ fontFamily: FONT_SERIF, fontWeight: 300, fontSize: 'clamp(40px,5vw,64px)', lineHeight: 1.05, marginBottom: 18 }}>
            {handle}
          </h2>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: veryNarrow ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
          gap: 10, margin: '48px 0 64px',
        }}>
          {igGrid.map((src, i) => <IgTile key={i} src={src} handle={handle} />)}
        </div>
        <div style={{ textAlign: 'center' }}>
          <Pill href={`https://instagram.com/${handle.replace(/^@/, '')}`} target="_blank" variant="ghost">
            Follow {handle} <span>↗</span>
          </Pill>
        </div>
      </Container>
    </section>
  );
}

function IgTile({ src, handle }) {
  const [hover, setHover] = useState(false);
  return (
    <a href={`https://instagram.com/${handle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 2,
        background: CREAM_DEEP, position: 'relative', display: 'block',
      }}>
      <img src={src} alt="" loading="lazy" style={{
        width: '100%', height: '100%', objectFit: 'cover',
        transition: 'transform .5s ease',
        transform: hover ? 'scale(1.06)' : 'scale(1)',
      }} />
      <div aria-hidden style={{
        position: 'absolute', inset: 0,
        background: hover ? 'rgba(48,44,41,.2)' : 'rgba(48,44,41,0)',
        transition: 'background .3s ease',
      }} />
    </a>
  );
}

/* ─────────────────────── visit ──────────────────────────────────── */

function Visit({ narrow, address1, address2, hours, phone, phoneHref, email, intro, mapsUrl }) {
  const directionsUrl = mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(`${address1} ${address2}`)}`;
  return (
    <section id="visit" style={{ padding: '76px 0', background: CREAM_DEEP }}>
      <Container style={{
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : '1fr 1fr',
        gap: narrow ? 56 : 80, alignItems: 'start',
      }}>
        <div style={{ order: narrow ? 2 : 0 }}>
          <Eyebrow>Plan a Visit</Eyebrow>
          <h2 style={{
            marginTop: 18, fontFamily: FONT_SERIF, fontWeight: 300,
            fontSize: 'clamp(40px,5vw,60px)', lineHeight: 1.05, marginBottom: 24,
          }}>
            Come by, <em style={{ fontFamily: FONT_SERIF }}>stay a while.</em>
          </h2>
          <p style={{ fontFamily: FONT_SERIF, fontStyle: 'italic', fontSize: 21, color: INK_SOFT, marginBottom: 48, maxWidth: 440 }}>
            {intro}
          </p>
          <VisitBlock title="The Studio">
            <div>{address1}<br />{address2}</div>
          </VisitBlock>
          <VisitBlock title="Hours">
            <div style={{ fontFamily: FONT_BODY, fontSize: 14, color: INK, fontWeight: 300 }}>
              {hours.map(([day, time], i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, padding: '4px 0' }}>
                  <span style={{ color: INK_SOFT }}>{day}</span>
                  <span>{time}</span>
                </div>
              ))}
            </div>
          </VisitBlock>
          <VisitBlock title="Reach Us" last>
            <div>
              <a href={`tel:${phoneHref}`} style={{ borderBottom: `1px solid ${RULE_GOLD}`, paddingBottom: 2, textDecoration: 'none', color: INK }}>{phone}</a><br />
              <a href={`mailto:${email}`} style={{ borderBottom: `1px solid ${RULE_GOLD}`, paddingBottom: 2, textDecoration: 'none', color: INK }}>{email}</a>
            </div>
          </VisitBlock>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 36 }}>
            <Pill href="/book" variant="solid">Book an appointment <span>→</span></Pill>
            <Pill href={directionsUrl} target="_blank" variant="ghost">
              Get directions <span>↗</span>
            </Pill>
          </div>
        </div>
        <div style={{
          aspectRatio: narrow ? '16 / 10' : '1 / 1.05', borderRadius: 4, overflow: 'hidden',
          background: 'linear-gradient(135deg, #e8e0cf, #d6c9ad)',
          position: 'relative',
          boxShadow: '0 20px 60px rgba(48,44,41,.12)',
          order: narrow ? 1 : 0,
        }}>
          <iframe
            title="Map to Meraki Nail Studio"
            src={`https://maps.google.com/maps?q=${encodeURIComponent(`${address1} ${address2}`)}&z=15&output=embed`}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            style={{ width: '100%', height: '100%', border: 0 }}
          />
        </div>
      </Container>
    </section>
  );
}

function VisitBlock({ title, children, last }) {
  return (
    <div style={{
      padding: '24px 0',
      borderTop: `1px solid ${RULE}`,
      borderBottom: last ? `1px solid ${RULE}` : 'none',
    }}>
      <h3 style={{ fontFamily: FONT_DISPLAY, fontSize: 10, fontWeight: 500, letterSpacing: '.32em', textTransform: 'uppercase', color: INK_FAINT, marginBottom: 12 }}>
        {title}
      </h3>
      <div style={{ fontFamily: FONT_SERIF, fontSize: 22, fontWeight: 400, color: INK, lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}

/* ─────────────────────── footer ─────────────────────────────────── */

function Footer({ narrow, onSignIn, igHandle, fbHandle }) {
  return (
    <footer style={{ background: IVORY, padding: '80px 0 56px', borderTop: `1px solid ${RULE}` }}>
      <Container>
        <div style={{
          display: 'grid', gridTemplateColumns: narrow ? '1fr' : '1.2fr 1fr',
          gap: narrow ? 40 : 64, alignItems: narrow ? 'start' : 'end', marginBottom: 64,
        }}>
          <div style={{ maxWidth: 380 }}>
            <img src={`${BRAND}/script-love-meraki.svg`} alt="Love, Meraki" style={{ width: '100%', height: 'auto' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: narrow ? 'flex-start' : 'flex-end', gap: 20 }}>
            <Pill href="/book" variant="ghost">Book now <span>→</span></Pill>
            <div style={{ display: 'flex', gap: 24, fontFamily: FONT_DISPLAY, fontSize: 11, letterSpacing: '.28em', textTransform: 'uppercase', color: INK_SOFT }}>
              <a href={`https://instagram.com/${igHandle.replace(/^@/, '')}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Instagram</a>
              <a href={`https://facebook.com/${fbHandle}`} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Facebook</a>
              <a href="https://www.google.com/search?q=Meraki+Nail+Studio+Columbus" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>Google</a>
            </div>
          </div>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          paddingTop: 32, borderTop: `1px solid ${RULE}`,
          fontSize: 11, color: INK_FAINT, letterSpacing: '.04em', flexWrap: 'wrap', gap: 16,
        }}>
          <div>© {new Date().getFullYear()} Meraki Nail Studio. All rights reserved.</div>
          <div>Powered by <a href="https://plumenexus.com" target="_blank" rel="noopener noreferrer" style={{ color: INK_SOFT, borderBottom: `1px solid ${RULE_GOLD}`, paddingBottom: 1, textDecoration: 'none' }}>Plume Nexus</a></div>
          <a onClick={onSignIn} style={{ fontFamily: FONT_DISPLAY, fontSize: 10, letterSpacing: '.32em', textTransform: 'uppercase', color: INK_FAINT, cursor: 'pointer', textDecoration: 'none' }}>
            Staff sign‑in →
          </a>
        </div>
      </Container>
    </footer>
  );
}
