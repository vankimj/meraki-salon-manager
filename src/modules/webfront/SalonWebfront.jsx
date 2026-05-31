import { useState, useEffect, useRef } from 'react';
import { fetchServices, fetchEmployees, fetchWebfrontConfig, fetchBookingConfig, fetchGoogleReviews, subscribeWebfrontConfig } from '../../lib/firestore';
import { getTheme, detectAutoTheme } from '../../lib/themes';
import { TENANT_ID } from '../../lib/tenant';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../../lib/firebase';
import HeroMerakiSite from '../../components/HeroMerakiSite';

// Tenant-neutral defaults — values are blanks/generic placeholders so a new
// tenant's empty webfront doesn't bleed Meraki content. Salon owners fill
// these in via Admin → Webfront. Anything Meraki-specific (street address,
// Instagram handle, hours) is intentionally empty so the corresponding
// section either hides or shows a "not set yet" state.
const DEFAULT_CFG = {
  salonName: '',
  tagline:   '',
  about:     '',
  policy:    '',
  phone:     '',
  address:   '',
  city:      '',
  mapsUrl:   '',
  googleReviewUrl: '',
  instagram: '',
  facebook:  '',
  tiktok:    '',
  hours: {
    mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '',
  },
  showBookingCta: true, showServices: true, showTeam: true, showReviews: true,
  hiddenEmployeeIds: [], testimonials: [],
  layout: 'classic', themeId: 'meraki', autoTheme: false,
};

// Salon-name splits for the hero's script + small-caps lockup ("Meraki"
// big script over "NAIL STUDIO" caps). Falls back to "Your" / "Salon"
// when no name set so the page doesn't render an empty string.
function splitSalonName(name) {
  const n = String(name || '').trim();
  if (!n) return ['Your', 'Salon'];
  const words = n.split(/\s+/);
  if (words.length === 1) return [words[0], ''];
  return [words[0], words.slice(1).join(' ')];
}

// Pull "City, State" out of cfg.city if explicit, else parse from address
// (line 2 typically reads "City, STATE 12345"). Returns empty string when
// nothing parseable — caller hides the location badge.
function getCityLine(cfg) {
  if (cfg?.city) return String(cfg.city);
  const addr = String(cfg?.address || '');
  const m = addr.match(/\n([^\n]+,\s*[A-Za-z]{2})\b/);
  return m ? m[1] : '';
}

const DAY_LABELS = [
  ['mon','Monday'],['tue','Tuesday'],['wed','Wednesday'],
  ['thu','Thursday'],['fri','Friday'],['sat','Saturday'],['sun','Sunday'],
];

const FALLBACK_SERVICES = [
  { id:'gel-x',      category:'Gel Services',     name:'Gel-X',                   description:'Fully 100% soft gel tip in your choice of shape and length.',                            price:70, duration:60 },
  { id:'struct-gel', category:'Gel Services',     name:'Structured Gel Manicure', description:'Thicker gel application designed to reinforce natural nails.',                           price:50, duration:60 },
  { id:'gel-mani',   category:'Gel Services',     name:'Gel Manicure',            description:'Includes trimming, shaping, buffing, cuticle care, and massage.',                       price:40, duration:35 },
  { id:'dip',        category:'Powder & Polish',  name:'Dip',                     description:'Pigmented powders used to create a long-lasting, durable finish.',                      price:15, duration:10 },
  { id:'nail-art',   category:'Powder & Polish',  name:'Nail Art',                description:'Custom nail art designs.',                                                              price:5,  duration:10 },
  { id:'gel-change', category:'Powder & Polish',  name:'Gel Polish Change',       description:'',                                                                                       price:32, duration:30 },
  { id:'toe-change', category:'Powder & Polish',  name:'Toe Polish Change',       description:'',                                                                                       price:20, duration:20 },
  { id:'spa-mani',   category:'Manicures',        name:'Spa Manicure',            description:'Classic spa manicure.',                                                                  price:25, duration:30 },
  { id:'sig-mani',   category:'Manicures',        name:'Signature Manicure',      description:'Includes steam and exfoliation.',                                                        price:32, duration:35 },
  { id:'dlx-mani',   category:'Manicures',        name:'Deluxe Manicure',         description:'Includes mud mask and paraffin wax.',                                                    price:40, duration:40 },
  { id:'spa-pedi',   category:'Pedicures',        name:'Spa Pedicure',            description:'Classic relaxing pedicure.',                                                             price:40, duration:35 },
  { id:'sig-pedi',   category:'Pedicures',        name:'Signature Pedicure',      description:'Includes sugar scrub and mud mask.',                                                     price:52, duration:45 },
  { id:'dlx-pedi',   category:'Pedicures',        name:'Deluxe Pedicure',         description:'Includes hot stones.',                                                                   price:65, duration:60 },
  { id:'repair',     category:'Add-ons & Extras', name:'Nail Repair',             description:'',                                                                                       price:5,  duration:15 },
  { id:'removal',    category:'Add-ons & Extras', name:'Removal',                 description:'',                                                                                       price:10, duration:20 },
  { id:'paraffin',   category:'Add-ons & Extras', name:'Luxury Paraffin Treatment',description:'',                                                                                      price:15, duration:15 },
];

export const LAYOUTS = [
  { id: 'classic',    name: 'Classic',    icon: '🌑', desc: 'Dark hero, bold & dramatic' },
  { id: 'boutique',   name: 'Boutique',   icon: '🌸', desc: 'Light & airy, soft tones' },
  { id: 'minimal',    name: 'Minimal',    icon: '◻',  desc: 'Clean, wide-open, editorial' },
  { id: 'merakiSite', name: 'Editorial',  icon: '✦',  desc: 'Full editorial homepage with portfolio, reviews, IG' },
];

// Adapt a SalonWebfront cfg shape into the prop shape HeroMerakiSite expects.
// SalonWebfront stores address as one multi-line string + hours as a {mon:'',
// tue:'', …} dict; HeroMerakiSite wants address1/address2 + hours[][2]. Map
// here so the editorial layout reads the same cfg without forcing duplicate
// fields onto every tenant.
function mapCfgForMerakiSite(cfg, employees) {
  // Accept either newline-separated ("Street\nCity, ST ZIP") or the more
  // common comma-separated form ("Street, City, ST ZIP"). For comma form,
  // split on the FIRST comma so "City, ST ZIP" stays on line 2.
  const addr = String(cfg.address || '').trim();
  let address1, address2;
  if (addr.includes('\n')) {
    const lines = addr.split('\n').map(s => s.trim()).filter(Boolean);
    address1 = lines[0] || '';
    address2 = lines.slice(1).join(', ') || cfg.city || '';
  } else if (addr.includes(',')) {
    const i = addr.indexOf(',');
    address1 = addr.slice(0, i).trim();
    address2 = addr.slice(i + 1).trim();
  } else {
    address1 = addr;
    address2 = cfg.city || '';
  }
  if (!address1) address1 = '5029 Olentangy River Rd';
  if (!address2) address2 = 'Columbus, OH 43214';
  const DAY_LABELS_MAP = {
    mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday',
    thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
  };
  const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const hoursDict = cfg.hours || {};
  const hoursArr = DAY_ORDER
    .filter(k => String(hoursDict[k] || '').trim())
    .map(k => [DAY_LABELS_MAP[k], String(hoursDict[k]).trim()]);

  // Pass the full cfg through so every editorial field (teamPhotoShape,
  // heroCopy, meaningDef, intros, etc.) reaches HeroMerakiSite. Then
  // override the ones that need shape adaptation (address split, hours
  // dict→array, instagram handle prefix).
  return {
    ...cfg,
    publicEmail:      cfg.publicEmail || cfg.contactEmail,
    address1, address2,
    hours:            hoursArr.length ? hoursArr : undefined,
    instagramHandle:  cfg.instagram ? (cfg.instagram.startsWith('@') ? cfg.instagram : `@${cfg.instagram}`) : undefined,
    facebookHandle:   cfg.facebook,
    reviews:          cfg.reviews || cfg.testimonials,
    employees,
  };
}

function groupByCategory(services) {
  const map = {};
  services.forEach(s => { const c = s.category || 'Services'; if (!map[c]) map[c] = []; map[c].push(s); });
  return Object.entries(map);
}

function applyThemeVars(theme) {
  const r = document.documentElement;
  r.style.setProperty('--tm-primary',   theme.primary);
  r.style.setProperty('--tm-accent',    theme.accent);
  r.style.setProperty('--tm-grad',      `linear-gradient(135deg,${theme.gradStart},${theme.gradEnd})`);
  r.style.setProperty('--tm-grad-dark', `linear-gradient(135deg,${theme.dark},${theme.gradStart})`);
  r.style.setProperty('--tm-dark',      theme.dark);
  r.style.setProperty('--tm-bg',        theme.bg);
  r.style.setProperty('--tm-card',      theme.cardBg);
  r.style.setProperty('--tm-border',    theme.border);
  r.style.setProperty('--tm-text',      theme.text);
  r.style.setProperty('--tm-muted',     theme.muted);
}

function SeasonalDecoration({ emoji, dir }) {
  const pts = [
    { left:'5%', delay:'0s', dur:'6s' }, { left:'15%', delay:'1.2s', dur:'5.5s' },
    { left:'28%', delay:'0.5s', dur:'7s' }, { left:'42%', delay:'2s', dur:'6.5s' },
    { left:'58%', delay:'0.8s', dur:'5.8s' }, { left:'71%', delay:'1.7s', dur:'6.2s' },
    { left:'84%', delay:'0.3s', dur:'7.5s' }, { left:'93%', delay:'2.5s', dur:'5.2s' },
  ];
  const kf = dir === 'down'
    ? `@keyframes wfFloat{0%{transform:translateY(-30px);opacity:0}10%{opacity:.6}90%{opacity:.6}100%{transform:translateY(110vh);opacity:0}}`
    : `@keyframes wfFloat{0%{transform:translateY(110vh);opacity:0}10%{opacity:.6}90%{opacity:.6}100%{transform:translateY(-30px);opacity:0}}`;
  return (
    <>
      <style>{kf}</style>
      {pts.map((p, i) => (
        <div key={i} style={{ position:'fixed', left:p.left, [dir==='down'?'top':'bottom']:0, fontSize:16+(i%3)*5, pointerEvents:'none', zIndex:1, animation:`wfFloat ${p.dur} ${p.delay} linear infinite`, userSelect:'none', opacity:0 }}>{emoji}</div>
      ))}
    </>
  );
}

export default function SalonWebfront() {
  const [cfg,        setCfg]        = useState(null);
  const [services,   setServices]   = useState([]);
  const [employees,  setEmployees]  = useState([]);
  const [bookCfg,    setBookCfg]    = useState(null);
  const [googleData, setGoogleData] = useState(null);
  const [menuOpen,   setMenuOpen]   = useState(false);
  const [navSolid,   setNavSolid]   = useState(false);
  const [tm,         setTm]         = useState(getTheme('meraki'));
  const heroRef = useRef(null);

  useEffect(() => {
    Promise.all([
      fetchWebfrontConfig(), fetchServices(), fetchEmployees(), fetchBookingConfig(), fetchGoogleReviews(),
    ]).then(([wf, svcs, emps, bk, gr]) => {
      // Tenant hasn't finished the onboarding wizard yet → don't show
      // the public webfront (it'd be half-built, no real content). Send
      // them straight to /manage where the wizard auto-opens. Pristine
      // flag is set by markOnboardingPhase once all 8 phases are done
      // or skipped. Legacy tenants without the flag fall through to the
      // public webfront — they wouldn't be hitting their bare URL if
      // they hadn't already set up the webfront content manually.
      if (wf && wf.onboardingComplete !== true && !wf.tagline && !wf.about) {
        window.location.replace('/manage');
        return;
      }
      const merged = { ...DEFAULT_CFG, ...wf };
      setCfg(merged);
      const active = svcs.filter(s => s.active !== false);
      setServices(active.length ? active : FALLBACK_SERVICES);
      setEmployees(emps.filter(e => e.active !== false));
      setBookCfg(bk);
      setGoogleData(gr);
      const theme = merged.autoTheme
        ? (detectAutoTheme() || getTheme(merged.themeId || 'meraki'))
        : getTheme(merged.themeId || 'meraki');
      setTm(theme);
      applyThemeVars(theme);
    }).catch(() => { setCfg(DEFAULT_CFG); setServices(FALLBACK_SERVICES); });
  }, []);

  // Live updates — Admin edits land on the open public page without a
  // refresh. One-shot fetch above seeds the initial render; this listener
  // overrides cfg on every subsequent webfront write. Re-applies theme so
  // brand-color changes take effect live too.
  useEffect(() => {
    const unsub = subscribeWebfrontConfig(wf => {
      setCfg(prev => {
        const merged = { ...DEFAULT_CFG, ...wf };
        const theme = merged.autoTheme
          ? (detectAutoTheme() || getTheme(merged.themeId || 'meraki'))
          : getTheme(merged.themeId || 'meraki');
        setTm(theme);
        applyThemeVars(theme);
        return merged;
      });
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    function onScroll() { setNavSolid(window.scrollY > 60); }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  if (!cfg) {
    return (
      <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background: tm.dark }}>
        <div style={{ width:40, height:40, borderRadius:'50%', border:`3px solid ${tm.primary}`, borderTopColor:'transparent', animation:'spin .8s linear infinite' }} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  const layout   = cfg.layout || 'classic';
  const hidden   = new Set(cfg.hiddenEmployeeIds || []);
  const visTeam  = employees.filter(e => !hidden.has(e.id));

  // Editorial layout — full takeover, ignores SalonWebfront chrome. Reads
  // tenant cfg for everything; fall-back content + brand SVGs + portfolio
  // photos all bundled in /public/brand/meraki/. Lives at /, not /manage.
  if (layout === 'merakiSite') {
    return <HeroMerakiSite webCfg={mapCfgForMerakiSite(cfg, visTeam)} />;
  }
  const showBook = cfg.showBookingCta && bookCfg?.enabled;
  const bookUrl  = `${window.location.origin}/book`;
  // Per-tenant display values — never hardcode Meraki strings below.
  // primaryName = the first word (script lockup); restName = remainder
  // (small-caps lockup). cityLine = explicit cfg.city or parsed from address.
  const salonName       = cfg.salonName || 'Your Salon';
  const [primaryName, restName] = splitSalonName(salonName);
  const cityLine        = getCityLine(cfg);

  function scrollTo(id) {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 68, behavior: 'smooth' });
  }

  const navLinks = [
    { label:'About', id:'about' },
    cfg.showTeam     && { label:'Team',     id:'team'     },
    cfg.showServices && { label:'Services', id:'services' },
    { label:'Contact', id:'contact' },
  ].filter(Boolean);

  const isClassic  = layout === 'classic';
  const isBoutique = layout === 'boutique';
  const isMinimal  = layout === 'minimal';

  // Section background colors by layout
  const bgs = isClassic
    ? { about:'#fff', team:'#f7faf8', svcs:'#fff', revs:'#f7faf8' }
    : isBoutique
    ? { about:'#fff', team:tm.bg,     svcs:'#fff', revs:tm.bg }
    : { about:'#fff', team:'#f8f8f8', svcs:'#fff', revs:'#f8f8f8' };

  // Nav colors — classic sits on dark hero, others sit on light
  const navLinkColor = isClassic ? 'rgba(255,255,255,.8)' : tm.primary;
  const navBgSolid   = isClassic
    ? `${tm.dark}f7`
    : 'rgba(255,255,255,.97)';
  const navBorderSolid = isClassic
    ? '1px solid rgba(255,255,255,.08)'
    : `1px solid ${tm.primary}22`;

  return (
    <div style={{ fontFamily:"'Inter','Helvetica Neue',Arial,sans-serif", color:'#1a1a1a', background:'#fff', overflowX:'hidden' }}>
      {tm.seasonal && <SeasonalDecoration emoji={tm.seasonal.emoji} dir={tm.seasonal.dir} />}

      {/* ── Nav ── */}
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:100, height:68,
        background: navSolid ? navBgSolid : 'transparent',
        backdropFilter: navSolid ? 'blur(12px)' : 'none',
        borderBottom: navSolid ? navBorderSolid : 'none',
        transition:'background .25s, border-color .25s',
        padding:'0 clamp(16px,5vw,56px)',
        display:'flex', alignItems:'center', justifyContent:'space-between',
      }}>
        <button onClick={() => window.scrollTo({ top:0, behavior:'smooth' })}
          style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:0 }}>
          <div style={{ width:34, height:34, borderRadius:9, background:`linear-gradient(135deg,${tm.primary},${tm.accent})`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <svg viewBox="0 0 60 60" fill="none" width={19} height={19}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <span style={{ fontFamily:'Cinzel,serif', fontSize:14, fontWeight:700, color: isClassic ? '#fff' : tm.dark, letterSpacing:'.06em' }}>{salonName}</span>
        </button>

        <div style={{ display:'flex', alignItems:'center', gap:28 }} className="wf-nav-desktop">
          {navLinks.map(l => (
            <button key={l.id} onClick={() => scrollTo(l.id)}
              style={{ background:'none', border:'none', fontSize:13, fontWeight:500, color: navSolid && !isClassic ? tm.dark : navLinkColor, cursor:'pointer', fontFamily:'inherit', letterSpacing:'.02em', padding:0, transition:'color .15s' }}
              onMouseEnter={e => e.currentTarget.style.color = isClassic ? '#fff' : tm.primary}
              onMouseLeave={e => e.currentTarget.style.color = navSolid && !isClassic ? tm.dark : navLinkColor}>
              {l.label}
            </button>
          ))}
          {showBook && (
            <a href={bookUrl}
              style={{ height:38, borderRadius:19, background:tm.primary, color:'#fff', fontSize:13, fontWeight:700, padding:'0 22px', display:'flex', alignItems:'center', textDecoration:'none', boxShadow:`0 2px 12px ${tm.primary}66`, letterSpacing:'.02em' }}
              onMouseEnter={e => e.currentTarget.style.opacity='.85'}
              onMouseLeave={e => e.currentTarget.style.opacity='1'}>
              Book Now
            </a>
          )}
        </div>

        <button onClick={() => setMenuOpen(o => !o)} className="wf-nav-mobile"
          style={{ background:'none', border:'none', cursor:'pointer', padding:6, display:'none' }}>
          {menuOpen
            ? <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={isClassic?'#fff':tm.dark} strokeWidth="2" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            : <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={isClassic?'#fff':tm.dark} strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          }
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div style={{ position:'fixed', top:68, left:0, right:0, zIndex:99, background: isClassic ? `${tm.dark}fa` : 'rgba(255,255,255,.98)', borderBottom:`1px solid ${tm.primary}33`, padding:'8px 0 20px' }}>
          {navLinks.map(l => (
            <button key={l.id} onClick={() => scrollTo(l.id)}
              style={{ display:'block', width:'100%', textAlign:'left', background:'none', border:'none', fontSize:16, fontWeight:500, color: isClassic ? 'rgba(255,255,255,.9)' : tm.dark, cursor:'pointer', fontFamily:'inherit', padding:'13px clamp(16px,5vw,40px)' }}>
              {l.label}
            </button>
          ))}
          {showBook && (
            <div style={{ padding:'8px clamp(16px,5vw,40px) 0' }}>
              <a href={bookUrl} style={{ display:'block', textAlign:'center', background:tm.primary, color:'#fff', fontSize:14, fontWeight:700, padding:'13px', borderRadius:12, textDecoration:'none' }}>
                Book an Appointment
              </a>
            </div>
          )}
        </div>
      )}

      {/* ── Hero — varies by layout ── */}
      {isClassic && (
        <section ref={heroRef} style={{ position:'relative', minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', background:tm.dark, overflow:'hidden', padding:'100px clamp(20px,6vw,80px) 80px' }}>
          <div style={{ position:'absolute', inset:0, background:`radial-gradient(ellipse 80% 60% at 50% 40%, ${tm.primary}18 0%, transparent 70%)`, pointerEvents:'none' }} />
          <div style={{ position:'absolute', top:'15%', right:'-5%', width:'45vw', maxWidth:500, aspectRatio:'1', borderRadius:'50%', background:`${tm.primary}0a`, border:`1px solid ${tm.primary}15`, pointerEvents:'none' }} />
          <div style={{ position:'absolute', bottom:'10%', left:'-8%', width:'35vw', maxWidth:400, aspectRatio:'1', borderRadius:'50%', background:`${tm.accent}08`, border:`1px solid ${tm.accent}12`, pointerEvents:'none' }} />
          <div style={{ textAlign:'center', position:'relative', zIndex:1, maxWidth:700 }}>
            {cityLine && (
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:`${tm.primary}22`, border:`1px solid ${tm.primary}44`, borderRadius:20, padding:'5px 14px', marginBottom:28 }}>
                <span style={{ width:6, height:6, borderRadius:'50%', background:tm.primary, flexShrink:0, boxShadow:`0 0 6px ${tm.primary}` }} />
                <span style={{ fontSize:11, fontWeight:600, color:tm.accent, letterSpacing:'.1em', textTransform:'uppercase' }}>{cityLine}</span>
              </div>
            )}
            <div style={{ fontFamily:"'Great Vibes',cursive", fontSize:'clamp(64px,14vw,108px)', color:'#fff', lineHeight:1.0, marginBottom:6 }}>{primaryName}</div>
            {restName && <div style={{ fontFamily:'Cinzel,serif', fontSize:'clamp(13px,2.5vw,18px)', color:'rgba(255,255,255,.5)', letterSpacing:'.32em', textTransform:'uppercase', marginBottom:36 }}>{restName}</div>}
            <p style={{ fontSize:'clamp(15px,2vw,17px)', color:'rgba(255,255,255,.65)', lineHeight:1.75, marginBottom:48, maxWidth:540, marginLeft:'auto', marginRight:'auto' }}>{cfg.tagline}</p>
            <div style={{ display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap' }}>
              {showBook && (
                <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', gap:8, height:54, borderRadius:27, background:tm.primary, color:'#fff', fontSize:15, fontWeight:700, padding:'0 36px', textDecoration:'none', boxShadow:`0 4px 24px ${tm.primary}55`, letterSpacing:'.02em' }}>
                  Book an Appointment
                </a>
              )}
              <button onClick={() => scrollTo('services')}
                style={{ height:54, borderRadius:27, background:'transparent', color:'rgba(255,255,255,.85)', fontSize:15, fontWeight:600, padding:'0 36px', border:'1.5px solid rgba(255,255,255,.22)', cursor:'pointer', fontFamily:'inherit', letterSpacing:'.02em', backdropFilter:'blur(4px)' }}>
                View Services
              </button>
            </div>
          </div>
          <div onClick={() => scrollTo('about')} style={{ position:'absolute', bottom:36, left:'50%', transform:'translateX(-50%)', cursor:'pointer', color:'rgba(255,255,255,.3)', fontSize:11, letterSpacing:'.1em', textTransform:'uppercase', display:'flex', flexDirection:'column', alignItems:'center', gap:6, animation:'float 2.5s ease-in-out infinite' }}>
            <span>Scroll</span>
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </div>
        </section>
      )}

      {isBoutique && (
        <section ref={heroRef} style={{ position:'relative', minHeight:'85dvh', display:'flex', alignItems:'center', justifyContent:'center', background:tm.bg, overflow:'hidden', padding:'100px clamp(20px,6vw,80px) 72px' }}>
          {/* Soft gradient orbs */}
          <div style={{ position:'absolute', top:'-10%', right:'-5%', width:'55vw', maxWidth:600, aspectRatio:'1', borderRadius:'50%', background:`linear-gradient(135deg,${tm.primary}12,${tm.accent}08)`, pointerEvents:'none' }} />
          <div style={{ position:'absolute', bottom:'-5%', left:'-8%', width:'40vw', maxWidth:450, aspectRatio:'1', borderRadius:'50%', background:`linear-gradient(135deg,${tm.accent}0a,${tm.primary}08)`, pointerEvents:'none' }} />
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', position:'relative', zIndex:1, maxWidth:680 }}>
            {/* Brand circle */}
            <div style={{ width:'clamp(100px,16vw,140px)', height:'clamp(100px,16vw,140px)', borderRadius:'50%', background:`linear-gradient(145deg,${tm.primary}20,${tm.accent}14)`, border:`2px solid ${tm.primary}30`, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:32 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontFamily:"'Great Vibes',cursive", fontSize:'clamp(24px,5vw,36px)', color:tm.primary, lineHeight:1 }}>{primaryName}</div>
                {restName && <div style={{ fontFamily:'Cinzel,serif', fontSize:8, color:tm.accent, letterSpacing:'.18em', textTransform:'uppercase', marginTop:2 }}>{restName}</div>}
              </div>
            </div>
            {cityLine && (
              <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:`${tm.primary}14`, border:`1px solid ${tm.primary}30`, borderRadius:20, padding:'5px 14px', marginBottom:22 }}>
                <span style={{ width:5, height:5, borderRadius:'50%', background:tm.primary, flexShrink:0 }} />
                <span style={{ fontSize:11, fontWeight:600, color:tm.primary, letterSpacing:'.1em', textTransform:'uppercase' }}>{cityLine}</span>
              </div>
            )}
            <h1 style={{ fontSize:'clamp(36px,7vw,64px)', fontWeight:800, color:tm.dark, lineHeight:1.1, marginBottom:8, letterSpacing:'-.02em' }}>
              Where nails become <span style={{ color:tm.primary, fontStyle:'italic', fontFamily:"'Great Vibes',cursive", fontSize:'1.3em', fontWeight:400 }}>art.</span>
            </h1>
            <p style={{ fontSize:'clamp(15px,2vw,17px)', color:'#555', lineHeight:1.75, marginBottom:40, maxWidth:520 }}>{cfg.tagline}</p>
            <div style={{ display:'flex', gap:14, justifyContent:'center', flexWrap:'wrap' }}>
              {showBook && (
                <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', gap:8, height:52, borderRadius:26, background:tm.primary, color:'#fff', fontSize:15, fontWeight:700, padding:'0 34px', textDecoration:'none', boxShadow:`0 4px 20px ${tm.primary}44`, letterSpacing:'.02em' }}>
                  Book an Appointment
                </a>
              )}
              <button onClick={() => scrollTo('services')}
                style={{ height:52, borderRadius:26, background:'#fff', color:tm.primary, fontSize:15, fontWeight:600, padding:'0 34px', border:`1.5px solid ${tm.primary}40`, cursor:'pointer', fontFamily:'inherit', letterSpacing:'.02em' }}>
                View Services
              </button>
            </div>
          </div>
        </section>
      )}

      {isMinimal && (
        <section ref={heroRef} style={{ minHeight:'60dvh', display:'flex', alignItems:'center', justifyContent:'center', background:'#fff', padding:'120px clamp(20px,6vw,80px) 80px' }}>
          <div style={{ textAlign:'center', maxWidth:600 }}>
            <div style={{ fontFamily:'Cinzel,serif', fontSize:'clamp(10px,1.8vw,13px)', color:tm.primary, letterSpacing:'.3em', textTransform:'uppercase', marginBottom:20 }}>{salonName}{cityLine && ` · ${cityLine}`}</div>
            <div style={{ fontFamily:"'Great Vibes',cursive", fontSize:'clamp(56px,12vw,96px)', color:tm.dark, lineHeight:1.0, marginBottom:4 }}>{primaryName}</div>
            <div style={{ width:48, height:2, background:`linear-gradient(90deg,${tm.primary},${tm.accent})`, margin:'0 auto 32px', borderRadius:1 }} />
            <p style={{ fontSize:'clamp(15px,2vw,18px)', color:'#666', lineHeight:1.8, marginBottom:44 }}>{cfg.tagline}</p>
            <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
              {showBook && (
                <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', height:50, borderRadius:6, background:tm.primary, color:'#fff', fontSize:14, fontWeight:600, padding:'0 32px', textDecoration:'none', letterSpacing:'.04em' }}>
                  Book an Appointment
                </a>
              )}
              <button onClick={() => scrollTo('about')}
                style={{ height:50, borderRadius:6, background:'transparent', color:'#666', fontSize:14, padding:'0 32px', border:'1px solid #ddd', cursor:'pointer', fontFamily:'inherit' }}>
                Learn More
              </button>
            </div>
          </div>
        </section>
      )}

      {/* ── About ── */}
      <section id="about" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background: bgs.about }}>
        <div style={{ maxWidth: isMinimal ? 700 : 900, margin:'0 auto', display:'grid', gridTemplateColumns: isMinimal ? '1fr' : 'repeat(auto-fit,minmax(280px,1fr))', gap:'clamp(40px,6vw,72px)', alignItems:'center' }}>
          {!isMinimal && (
            <div style={{ display:'flex', justifyContent:'center' }}>
              <div style={{ position:'relative', width:'clamp(200px,30vw,280px)', aspectRatio:'1' }}>
                <div style={{ position:'absolute', inset:0, borderRadius:'50%', background:`linear-gradient(145deg,${tm.primary}18,${tm.accent}10)`, border:`1px solid ${tm.primary}22` }} />
                <div style={{ position:'absolute', inset:'12%', borderRadius:'50%', background:`linear-gradient(145deg,${tm.primary}28,${tm.accent}18)`, display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <div style={{ textAlign:'center' }}>
                    <div style={{ fontFamily:"'Great Vibes',cursive", fontSize:'clamp(36px,8vw,52px)', color:tm.primary, lineHeight:1 }}>{primaryName}</div>
                    {restName && <div style={{ fontFamily:'Cinzel,serif', fontSize:'clamp(8px,1.5vw,10px)', color:tm.accent, letterSpacing:'.2em', textTransform:'uppercase', marginTop:4 }}>{restName}</div>}
                  </div>
                </div>
              </div>
            </div>
          )}
          <div>
            <EyebrowLabel tm={tm}>About Us</EyebrowLabel>
            <h2 style={{ fontSize:'clamp(26px,4vw,36px)', fontWeight:800, color:tm.dark, lineHeight:1.2, margin:'10px 0 20px' }}>
              {isMinimal ? 'Our Story' : <>Where nails<br />become <span style={{ color:tm.primary }}>art.</span></>}
            </h2>
            <p style={{ fontSize:15, color:'#4a5568', lineHeight:1.8, marginBottom:20 }}>{cfg.about}</p>
            {cfg.policy && (
              <div style={{ background: tm.bg, border:`1px solid ${tm.primary}22`, borderLeft:`3px solid ${tm.primary}`, borderRadius:'0 8px 8px 0', padding:'12px 16px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:tm.primary, letterSpacing:'.08em', textTransform:'uppercase', marginBottom:5 }}>Cancellation Policy</div>
                <p style={{ fontSize:13, color:'#555', lineHeight:1.65, margin:0 }}>{cfg.policy}</p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Team ── */}
      {cfg.showTeam && visTeam.length > 0 && (
        <section id="team" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background: bgs.team }}>
          <div style={{ maxWidth: isMinimal ? 700 : 1080, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:56 }}>
              <EyebrowLabel tm={tm}>The Crew</EyebrowLabel>
              <h2 style={{ fontSize:'clamp(28px,4vw,38px)', fontWeight:800, color:tm.dark, marginTop:10 }}>Our Team</h2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns: isMinimal ? 'repeat(auto-fill,minmax(120px,1fr))' : 'repeat(auto-fill,minmax(150px,1fr))', gap:'clamp(16px,3vw,28px)' }}>
              {visTeam.map(emp => <TeamCard key={emp.id} emp={emp} tm={tm} />)}
            </div>
            {showBook && (
              <div style={{ textAlign:'center', marginTop:48 }}>
                <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', height:48, borderRadius: isMinimal ? 6 : 24, background:tm.primary, color:'#fff', fontSize:14, fontWeight:700, padding:'0 30px', textDecoration:'none' }}>
                  Book with a Technician
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Services ── */}
      {cfg.showServices && (
        <section id="services" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background: bgs.svcs }}>
          <div style={{ maxWidth: isMinimal ? 700 : 1080, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:56 }}>
              <EyebrowLabel tm={tm}>What We Offer</EyebrowLabel>
              <h2 style={{ fontSize:'clamp(28px,4vw,38px)', fontWeight:800, color:tm.dark, marginTop:10 }}>Services</h2>
            </div>
            {groupByCategory(services).map(([cat, items]) => (
              <div key={cat} style={{ marginBottom:48 }}>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
                  <div style={{ height:1, flex:1, background:`${tm.primary}22` }} />
                  <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:tm.primary, flexShrink:0 }}>{cat}</span>
                  <div style={{ height:1, flex:1, background:`${tm.primary}22` }} />
                </div>
                <div style={{ display:'grid', gridTemplateColumns: isMinimal ? '1fr' : 'repeat(auto-fill,minmax(260px,1fr))', gap: isMinimal ? 8 : 12 }}>
                  {items.map(svc => <ServiceCard key={svc.id} svc={svc} tm={tm} minimal={isMinimal} />)}
                </div>
              </div>
            ))}
            {showBook && (
              <div style={{ textAlign:'center', marginTop:16 }}>
                <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', height:50, borderRadius: isMinimal ? 6 : 25, background:tm.primary, color:'#fff', fontSize:14, fontWeight:700, padding:'0 32px', textDecoration:'none' }}>
                  Book Now
                </a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Reviews ── */}
      {cfg.showReviews && (() => {
        const gReviews   = googleData?.reviews?.filter(r => r.text) || [];
        const manualRevs = cfg.testimonials || [];
        const displayRevs = gReviews.length ? gReviews : manualRevs;
        const isGoogle   = gReviews.length > 0;
        if (!displayRevs.length) return null;
        return (
          <section id="reviews" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background: bgs.revs }}>
            <div style={{ maxWidth: isMinimal ? 700 : 1080, margin:'0 auto' }}>
              <div style={{ textAlign:'center', marginBottom:48 }}>
                <EyebrowLabel tm={tm}>Happy Clients</EyebrowLabel>
                <h2 style={{ fontSize:'clamp(28px,4vw,38px)', fontWeight:800, color:tm.dark, marginTop:10 }}>What People Are Saying</h2>
                {isGoogle && googleData.rating && (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginTop:16 }}>
                    <div style={{ display:'flex', gap:3 }}>
                      {[1,2,3,4,5].map(n => (
                        <svg key={n} width={22} height={22} viewBox="0 0 24 24" fill={n <= Math.round(googleData.rating) ? '#f59e0b' : '#e0e0e0'}><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
                      ))}
                    </div>
                    <span style={{ fontSize:22, fontWeight:800, color:tm.dark }}>{Number(googleData.rating).toFixed(1)}</span>
                    {googleData.userRatingCount && <span style={{ fontSize:14, color:'#718096' }}>({googleData.userRatingCount.toLocaleString()} reviews)</span>}
                    <div style={{ display:'flex', alignItems:'center', gap:5, background:'#fff', border:'1px solid #e0e0e0', borderRadius:20, padding:'4px 12px' }}>
                      <GoogleGLogo size={16} />
                      <span style={{ fontSize:12, fontWeight:600, color:'#555' }}>Google</span>
                    </div>
                  </div>
                )}
              </div>
              <div style={{ display:'grid', gridTemplateColumns: isMinimal ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap:20 }}>
                {displayRevs.map((r, i) => <ReviewCard key={i} review={r} isGoogle={isGoogle} googleReviewUrl={cfg.googleReviewUrl} tm={tm} />)}
              </div>
              {cfg.googleReviewUrl && (
                <div style={{ textAlign:'center', marginTop:40 }}>
                  <a href={cfg.googleReviewUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:8, height:48, borderRadius:24, background:'#fff', color:'#333', fontSize:14, fontWeight:600, padding:'0 28px', textDecoration:'none', border:'1.5px solid #e0e0e0', boxShadow:'0 2px 8px rgba(0,0,0,.07)' }}>
                    <GoogleGLogo size={18} /> See all Google reviews ↗
                  </a>
                </div>
              )}
            </div>
          </section>
        );
      })()}

      {/* ── Hours & Contact ── */}
      {isClassic ? (
        <section id="contact" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background:tm.dark }}>
          <div style={{ maxWidth:1000, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:56 }}>
              <EyebrowLabel tm={tm} light>Visit Us</EyebrowLabel>
              <h2 style={{ fontSize:'clamp(28px,4vw,38px)', fontWeight:800, color:'#fff', marginTop:10 }}>Hours & Contact</h2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:40 }}>
              <HoursCard cfg={cfg} tm={tm} dark />
              <ContactInfo cfg={cfg} tm={tm} showBook={showBook} bookUrl={bookUrl} dark />
            </div>
          </div>
        </section>
      ) : (
        <section id="contact" style={{ padding:'clamp(64px,10vw,96px) clamp(20px,6vw,80px)', background: isBoutique ? tm.bg : '#f4f4f4' }}>
          <div style={{ maxWidth: isMinimal ? 700 : 1000, margin:'0 auto' }}>
            <div style={{ textAlign:'center', marginBottom:56 }}>
              <EyebrowLabel tm={tm}>Visit Us</EyebrowLabel>
              <h2 style={{ fontSize:'clamp(28px,4vw,38px)', fontWeight:800, color:tm.dark, marginTop:10 }}>Hours & Contact</h2>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))', gap:40 }}>
              <HoursCard cfg={cfg} tm={tm} dark={false} />
              <ContactInfo cfg={cfg} tm={tm} showBook={showBook} bookUrl={bookUrl} dark={false} />
            </div>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <footer style={{ background: isClassic ? '#071009' : tm.dark, color:'rgba(255,255,255,.35)', padding:'28px clamp(20px,6vw,80px)', display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:12 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ width:24, height:24, borderRadius:6, background:`linear-gradient(135deg,${tm.primary},${tm.accent})`, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg viewBox="0 0 60 60" fill="none" width={13} height={13}><circle cx="30" cy="22" r="7" fill="white"/><path d="M14 50c0-8.8 7.2-16 16-16s16 7.2 16 16" stroke="white" strokeWidth="3.5" strokeLinecap="round"/></svg>
          </div>
          <span style={{ fontFamily:'Cinzel,serif', fontSize:11, color:'rgba(255,255,255,.5)', letterSpacing:'.08em' }}>{salonName}</span>
        </div>
        <div style={{ fontSize:11 }}>© {new Date().getFullYear()} {salonName}{cityLine && ` · ${cityLine}`}</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11 }}>
          <a href="/terms"   style={{ color:'rgba(255,255,255,.5)', textDecoration:'none' }}>Terms</a>
          <a href="/privacy" style={{ color:'rgba(255,255,255,.5)', textDecoration:'none' }}>Privacy</a>
          <a href={`${window.location.origin}/`} style={{ color:'rgba(255,255,255,.2)', textDecoration:'none' }}>Staff Login</a>
        </div>
      </footer>

      <SalonChatbot tm={tm} salonName={salonName} />

      <style>{`
        @media (max-width: 660px) {
          .wf-nav-desktop { display: none !important; }
          .wf-nav-mobile  { display: flex !important; }
        }
        @keyframes float {
          0%,100% { transform: translateX(-50%) translateY(0); }
          50%      { transform: translateX(-50%) translateY(7px); }
        }
      `}</style>
    </div>
  );
}

// ── Shared section helpers ───────────────────────────────

function HoursCard({ cfg, tm, dark }) {
  return (
    <div style={{ background: dark ? 'rgba(255,255,255,.05)' : '#fff', border: dark ? '1px solid rgba(255,255,255,.1)' : `1px solid ${tm.primary}22`, borderRadius:16, padding:'28px 24px' }}>
      <div style={{ fontSize:12, fontWeight:700, color: dark ? tm.accent : tm.primary, letterSpacing:'.1em', textTransform:'uppercase', marginBottom:20 }}>Business Hours</div>
      {DAY_LABELS.map(([key, label]) => {
        const h = cfg.hours?.[key] || 'Closed';
        const closed  = h.toLowerCase() === 'closed';
        const today   = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
        const isToday = key === today;
        return (
          <div key={key} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'9px 0', borderBottom:`1px solid ${dark ? 'rgba(255,255,255,.07)' : tm.primary + '14'}` }}>
            <span style={{ fontSize:13, color: dark ? (isToday ? tm.accent : 'rgba(255,255,255,.65)') : (isToday ? tm.primary : '#555'), fontWeight: isToday ? 700 : 400 }}>{label}</span>
            <span style={{ fontSize:13, color: dark ? (closed ? 'rgba(255,255,255,.25)' : isToday ? '#fff' : 'rgba(255,255,255,.8)') : (closed ? '#bbb' : isToday ? tm.dark : '#333'), fontWeight: isToday ? 700 : 400 }}>{h}</span>
          </div>
        );
      })}
    </div>
  );
}

function ContactInfo({ cfg, tm, showBook, bookUrl, dark }) {
  const linkColor = dark ? tm.accent : tm.primary;
  const pillStyle = { display:'inline-flex', alignItems:'center', gap:6, fontSize:13, color: dark ? '#fff' : tm.dark, textDecoration:'none', background: dark ? 'rgba(255,255,255,.08)' : `${tm.primary}10`, border: dark ? '1px solid rgba(255,255,255,.15)' : `1px solid ${tm.primary}25`, borderRadius:20, padding:'6px 14px', fontWeight:600 };
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:28 }}>
      {cfg.address && (
        <ContactBlock icon="📍" label="Address" tm={tm} dark={dark}>
          <a href={cfg.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(cfg.address)}`} target="_blank" rel="noopener noreferrer"
            style={{ color:linkColor, textDecoration:'none', fontSize:15, lineHeight:1.6, display:'block' }}>
            {cfg.address.split('\n').map((line, i) => <span key={i} style={{ display:'block' }}>{line}</span>)}
          </a>
        </ContactBlock>
      )}
      {cfg.phone && (
        <ContactBlock icon="📞" label="Phone" tm={tm} dark={dark}>
          <a href={`tel:${cfg.phone.replace(/\D/g,'')}`} style={{ color:linkColor, textDecoration:'none', fontSize:15 }}>{cfg.phone}</a>
        </ContactBlock>
      )}
      {(cfg.instagram || cfg.facebook || cfg.tiktok) && (
        <ContactBlock icon="✦" label="Follow Us" tm={tm} dark={dark}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginTop:4 }}>
            {cfg.instagram && (
              <a href={`https://instagram.com/${cfg.instagram.replace('@','')}`} target="_blank" rel="noopener noreferrer" style={pillStyle}>
                <svg width={13} height={13} viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                @{cfg.instagram.replace('@','')}
              </a>
            )}
            {cfg.facebook && (
              <a href={`https://facebook.com/${cfg.facebook.replace('@','')}`} target="_blank" rel="noopener noreferrer" style={pillStyle}>Facebook</a>
            )}
            {cfg.tiktok && (
              <a href={`https://tiktok.com/@${cfg.tiktok.replace('@','')}`} target="_blank" rel="noopener noreferrer" style={pillStyle}>TikTok</a>
            )}
          </div>
        </ContactBlock>
      )}
      {showBook && (
        <a href={bookUrl} style={{ display:'inline-flex', alignItems:'center', height:50, borderRadius:25, background:tm.primary, color:'#fff', fontSize:14, fontWeight:700, padding:'0 32px', textDecoration:'none', alignSelf:'flex-start', marginTop:4, boxShadow:`0 4px 20px ${tm.primary}44` }}>
          Book an Appointment →
        </a>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────

function EyebrowLabel({ children, light, tm }) {
  const c = light ? tm.accent : tm.primary;
  return (
    <div style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
      <div style={{ height:1, width:24, background:c }} />
      <span style={{ fontSize:11, fontWeight:700, letterSpacing:'.12em', textTransform:'uppercase', color:c }}>{children}</span>
      <div style={{ height:1, width:24, background:c }} />
    </div>
  );
}

function ServiceCard({ svc, tm, minimal }) {
  const [hover,  setHover]  = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const hasImg = svc.image && !imgErr;
  if (minimal) {
    return (
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', padding:'14px 0', borderBottom:`1px solid ${tm.primary}14` }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600, color:'#1a1a1a', marginBottom: svc.description ? 3 : 0 }}>{svc.name}</div>
          {svc.description && <div style={{ fontSize:12, color:'#777', lineHeight:1.5 }}>{svc.description}</div>}
          {svc.duration > 0 && <div style={{ fontSize:11, color:'#bbb', marginTop:3 }}>{svc.duration}+ min</div>}
        </div>
        {svc.price > 0 && <div style={{ fontSize:14, fontWeight:700, color:tm.primary, flexShrink:0, paddingTop:2, marginLeft:16 }}>${Number(svc.price).toFixed(0)}+</div>}
      </div>
    );
  }
  return (
    <div onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ background:'#fff', border:`1px solid ${hover ? tm.primary+'55' : '#e8e8e8'}`, borderRadius:14, overflow:'hidden', transition:'border-color .15s, box-shadow .15s', boxShadow: hover ? `0 4px 20px ${tm.primary}18` : '0 1px 4px rgba(0,0,0,.05)', cursor:'default' }}>
      {hasImg && (
        <div style={{ width:'100%', aspectRatio:'16/9', overflow:'hidden', background:'#f0f0f0' }}>
          <img src={svc.image} alt={svc.name} onError={() => setImgErr(true)} style={{ width:'100%', height:'100%', objectFit:'cover', display:'block', transition:'transform .3s' }}
            onMouseEnter={e => e.currentTarget.style.transform='scale(1.04)'}
            onMouseLeave={e => e.currentTarget.style.transform='scale(1)'} />
        </div>
      )}
      <div style={{ padding:'14px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#0e1c14', marginBottom: svc.description ? 4 : 0 }}>{svc.name}</div>
            {svc.description && <div style={{ fontSize:12, color:'#718096', lineHeight:1.5 }}>{svc.description}</div>}
            {svc.duration > 0 && <div style={{ fontSize:11, color:'#a0aec0', marginTop:5 }}>{svc.duration}+ min</div>}
          </div>
          {svc.price > 0 && <div style={{ fontSize:15, fontWeight:800, color:tm.primary, flexShrink:0, paddingTop:1 }}>${Number(svc.price).toFixed(0)}+</div>}
        </div>
      </div>
    </div>
  );
}

function TeamCard({ emp, tm }) {
  const ig = emp.instagram?.replace('@','');
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ width:'clamp(80px,12vw,110px)', height:'clamp(80px,12vw,110px)', borderRadius:'50%', margin:'0 auto 12px', overflow:'hidden', background:`linear-gradient(135deg,${tm.primary}33,${tm.accent}22)`, border:`2px solid ${tm.primary}22`, flexShrink:0 }}>
        {emp.photo
          ? <img src={emp.photo} alt={emp.name} style={{ width:'100%', height:'100%', objectFit:'cover' }} />
          : <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:"'Great Vibes',cursive", fontSize:28, color:tm.primary }}>{(emp.name||'?')[0]}</div>
        }
      </div>
      <div style={{ fontSize:13, fontWeight:700, color:'#0e1c14', marginBottom:3 }}>{emp.name}</div>
      {ig
        ? <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, color:tm.primary, textDecoration:'none', fontWeight:500 }}>@{ig}</a>
        : <div style={{ fontSize:11, color:'#aaa' }}>Nail Technician</div>
      }
    </div>
  );
}

function GoogleGLogo({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function ReviewCard({ review, isGoogle, googleReviewUrl, tm }) {
  const stars = Math.max(1, Math.min(5, review.rating || 5));
  const card = (
    <div style={{ background:'#fff', border:'1px solid #e8e8e8', borderRadius:14, padding:'20px', display:'flex', flexDirection:'column', gap:12, boxShadow:'0 1px 6px rgba(0,0,0,.05)', height:'100%', boxSizing:'border-box' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div style={{ display:'flex', gap:2 }}>
          {[1,2,3,4,5].map(n => (
            <svg key={n} width={15} height={15} viewBox="0 0 24 24" fill={n <= stars ? '#f59e0b' : '#e0e0e0'}><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>
          ))}
        </div>
        {isGoogle && <GoogleGLogo size={15} />}
      </div>
      {review.text && <p style={{ fontSize:13, color:'#4a5568', lineHeight:1.75, margin:0, fontStyle:'italic', flex:1 }}>"{review.text}"</p>}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {review.photoUrl
            ? <img src={review.photoUrl} alt="" style={{ width:28, height:28, borderRadius:'50%', objectFit:'cover', flexShrink:0 }} />
            : <div style={{ width:28, height:28, borderRadius:'50%', background:`${tm.primary}22`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color:tm.primary, flexShrink:0 }}>
                {(review.name||'?')[0].toUpperCase()}
              </div>
          }
          <div>
            <div style={{ fontSize:13, fontWeight:700, color:'#0e1c14' }}>{review.name || 'Anonymous'}</div>
            {review.techName && <div style={{ fontSize:11, color:tm.primary }}>with {review.techName}</div>}
          </div>
        </div>
        {review.date && <div style={{ fontSize:11, color:'#a0aec0', flexShrink:0 }}>{review.date}</div>}
      </div>
    </div>
  );
  const href = review.authorUrl || googleReviewUrl;
  return href
    ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ textDecoration:'none', display:'block' }}>{card}</a>
    : card;
}

function ContactBlock({ icon, label, children, dark, tm }) {
  return (
    <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
      <span style={{ fontSize:18, flexShrink:0, marginTop:2, color: dark ? tm.accent : tm.primary }}>{icon}</span>
      <div>
        <div style={{ fontSize:11, fontWeight:700, color: dark ? tm.accent : '#9ca3af', letterSpacing:'.08em', textTransform:'uppercase', marginBottom:5 }}>{label}</div>
        {children}
      </div>
    </div>
  );
}

// ── AI Chat Widget ────────────────────────────────────
const chatFn = httpsCallable(functions, 'chatWithSalon');

export function SalonChatbot({ tm, salonName = 'Our' }) {
  const primary = tm?.primary || '#2D7A5F';
  const [open,     setOpen]     = useState(false);
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I\'m here to help with questions about services, pricing, hours, or booking. What can I help you with? 💅' }
  ]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg = { role: 'user', content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const { data } = await chatFn({ tenantId: TENANT_ID, messages: next.map(m => ({ role: m.role, content: m.content })) });
      setMessages(m => [...m, { role: 'assistant', content: data.reply }]);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Sorry, I had trouble connecting. Please try again or give us a call!' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Chat panel */}
      {open && (
        <div style={{ position:'fixed', bottom:88, right:20, width:'min(360px, calc(100vw - 40px))', maxHeight:'min(520px, calc(100dvh - 120px))', background:'#fff', borderRadius:18, boxShadow:'0 8px 40px rgba(0,0,0,.18)', display:'flex', flexDirection:'column', overflow:'hidden', zIndex:9999, border:'1px solid #e8e8e8' }}>
          {/* Header */}
          <div style={{ background:`linear-gradient(135deg,${primary},#3D95CE)`, padding:'14px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <div style={{ width:32, height:32, borderRadius:'50%', background:'rgba(255,255,255,.2)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16 }}>💅</div>
              <div>
                <div style={{ color:'#fff', fontSize:13, fontWeight:700, lineHeight:1.2 }}>{salonName} Assistant</div>
                <div style={{ color:'rgba(255,255,255,.75)', fontSize:10, marginTop:1 }}>Powered by AI · typically instant</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} style={{ background:'rgba(255,255,255,.15)', border:'none', borderRadius:'50%', width:28, height:28, color:'#fff', fontSize:18, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', lineHeight:1 }}>×</button>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:'auto', padding:'12px 14px', display:'flex', flexDirection:'column', gap:10 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ display:'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{
                  maxWidth:'82%', padding:'9px 13px', borderRadius: m.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: m.role === 'user' ? primary : '#f3f4f6',
                  color: m.role === 'user' ? '#fff' : '#1a1a1a',
                  fontSize:13, lineHeight:1.55, whiteSpace:'pre-wrap',
                }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display:'flex', justifyContent:'flex-start' }}>
                <div style={{ background:'#f3f4f6', borderRadius:'16px 16px 16px 4px', padding:'10px 14px', display:'flex', gap:4, alignItems:'center' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:7, height:7, borderRadius:'50%', background:'#ccc', animation:`chatDot 1.2s ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{ padding:'10px 12px', borderTop:'1px solid #f0f0f0', display:'flex', gap:8, flexShrink:0 }}>
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask about services, hours, booking…"
              disabled={loading}
              style={{ flex:1, border:'1px solid #e0e0e0', borderRadius:20, padding:'8px 14px', fontSize:13, fontFamily:'inherit', outline:'none', background: loading ? '#fafafa' : '#fff' }}
            />
            <button onClick={send} disabled={!input.trim() || loading}
              style={{ width:36, height:36, borderRadius:'50%', border:'none', background: input.trim() && !loading ? primary : '#e0e0e0', color:'#fff', cursor: input.trim() && !loading ? 'pointer' : 'default', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'background .15s' }}>
              <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{ position:'fixed', bottom:20, right:20, height:56, borderRadius:28, border:'none', background:`linear-gradient(135deg,${primary},#3D95CE)`, color:'#fff', cursor:'pointer', display:'flex', alignItems:'center', gap:10, padding:'0 20px 0 16px', boxShadow:'0 4px 20px rgba(0,0,0,.22)', zIndex:9999, fontFamily:'inherit', transition:'transform .15s', fontSize:14, fontWeight:600 }}
        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.04)'}
        onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
      >
        {open
          ? <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          : <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        }
        {open ? 'Close' : 'Chat with us'}
      </button>

      <style>{`@keyframes chatDot { 0%,80%,100%{transform:scale(1);opacity:.4} 40%{transform:scale(1.3);opacity:1} }`}</style>
    </>
  );
}
