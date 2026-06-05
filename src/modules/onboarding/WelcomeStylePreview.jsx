// Scaled-down preview of the pre-login welcome screen for the onboarding
// wizard's Branding phase. Mirrors the five WelcomeHero variants in
// HomeScreen.jsx (centered / hairlineSplit / stacked / photo / photoSplit)
// closely enough that a salon owner can pick confidently, without
// extracting the real component (which has too many context dependencies
// to render outside the live app).
//
// Refreshes live as the user edits brandName, taglines, color, logo URL,
// and style — so the dropdown change reflects in the preview frame in
// real time. Time-aware greeting matches the real surface.

function timeAware() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function splitBrandName(name) {
  if (!name) return ['Your Salon', ''];
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return [words[0], ''];
  return [words[0], words.slice(1).join(' ')];
}

export default function WelcomeStylePreview({
  style       = 'centered',
  brandName   = '',
  brandTagline,
  brandTaglineTop,
  brandColor  = '#2D7A5F',
  brandLogoUrl,
}) {
  const greet = timeAware();
  const [primary, script] = splitBrandName(brandName);

  const props = {
    greet,
    primary,
    script: script || brandTagline || '',
    above:  brandTaglineTop || '',
    brandColor,
    brandLogoUrl,
  };

  return (
    <div style={frameWrap}>
      <div style={frameLabel}>Preview · pre-login welcome screen</div>
      <div style={frame}>
        {style === 'hairlineSplit' && <HairlineSplit {...props} />}
        {style === 'stacked'       && <Stacked {...props} />}
        {style === 'photo'         && <Photo {...props} />}
        {style === 'photoSplit'    && <PhotoSplit {...props} />}
        {(!style || style === 'centered') && <Centered {...props} />}
      </div>
    </div>
  );
}

function PrimaryName({ primary, light, big }) {
  return (
    <h1 style={{
      fontFamily: '"Cinzel", Georgia, serif',
      fontWeight: 600,
      fontSize: big ? 28 : 22,
      color: light ? '#fff' : 'var(--pn-text)',
      margin: '8px 0 0',
      letterSpacing: '-.005em',
      lineHeight: 1,
      textShadow: light ? '0 2px 24px rgba(0,0,0,.35)' : 'none',
    }}>
      {primary}
    </h1>
  );
}

function ScriptName({ script, light }) {
  if (!script) return null;
  return (
    <div style={{
      fontFamily: '"Great Vibes", cursive',
      fontWeight: 400,
      fontSize: 32,
      color: light ? '#c19a4a' : '#5b3b8c',
      lineHeight: .8,
      marginTop: 4,
      textShadow: light ? '0 2px 18px rgba(193,154,74,.3)' : 'none',
    }}>
      {script}
    </div>
  );
}

function Greeting({ greet, light }) {
  return (
    <div style={{
      fontFamily: '"Cinzel", Georgia, serif',
      fontSize: 9,
      fontWeight: 600,
      color: light ? 'rgba(255,255,255,.78)' : '#5b3b8c',
      letterSpacing: '.22em',
      textTransform: 'uppercase',
      opacity: .9,
    }}>
      {greet}
    </div>
  );
}

function Above({ above, light }) {
  if (!above) return null;
  return (
    <div style={{
      fontFamily: '"Cinzel", Georgia, serif',
      fontSize: 9,
      fontWeight: 500,
      color: light ? 'rgba(255,255,255,.7)' : 'var(--pn-text-muted)',
      letterSpacing: '.18em',
      textTransform: 'uppercase',
      marginBottom: 4,
    }}>
      {above}
    </div>
  );
}

function SignInPill({ brandColor, label = 'Sign in' }) {
  return (
    <div style={{
      marginTop: 16,
      padding: '8px 22px',
      background: brandColor,
      color: '#fff',
      fontFamily: '"Cinzel", Georgia, serif',
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '.18em',
      textTransform: 'uppercase',
      borderRadius: 999,
      boxShadow: '0 4px 14px rgba(0,0,0,.18)',
    }}>
      {label}
    </div>
  );
}

function LogoOrMark({ brandLogoUrl, size = 40 }) {
  if (brandLogoUrl) {
    return <img src={brandLogoUrl} alt="" style={{ width: size, height: size, objectFit: 'contain', borderRadius: 6 }} />;
  }
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <g transform="translate(50 50)">
        {[0, 1, 2, 3, 4].map(i => (
          <ellipse key={i} cx="0" cy="-20" rx="14" ry="22" fill="#a288c9" opacity="0.85" transform={`rotate(${i * 72})`} />
        ))}
        <circle r="7" fill="#c19a4a" />
      </g>
    </svg>
  );
}

function Centered({ greet, primary, script, above, brandColor, brandLogoUrl }) {
  return (
    <div style={{
      ...stageCream,
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24,
    }}>
      <LogoOrMark brandLogoUrl={brandLogoUrl} size={36} />
      <Above above={above} />
      <PrimaryName primary={primary} big />
      <ScriptName script={script} />
      <div style={{ marginTop: 14 }}>
        <Greeting greet={greet} />
      </div>
      <SignInPill brandColor={brandColor} />
    </div>
  );
}

function HairlineSplit({ greet, primary, script, above, brandColor, brandLogoUrl }) {
  return (
    <div style={{ ...stage, flexDirection: 'row' }}>
      <div style={{
        flex: 1, background: '#faf6ee', display: 'flex',
        alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #ead8b5',
      }}>
        <LogoOrMark brandLogoUrl={brandLogoUrl} size={56} />
      </div>
      <div style={{
        flex: 1.2,
        background: `linear-gradient(135deg, ${brandColor}, ${shade(brandColor, -.18)})`,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center',
      }}>
        <Above above={above} light />
        <PrimaryName primary={primary} light big />
        <ScriptName script={script} light />
        <div style={{ marginTop: 12 }}>
          <Greeting greet={greet} light />
        </div>
        <SignInPill brandColor="rgba(0,0,0,.35)" />
      </div>
    </div>
  );
}

function Stacked({ greet, primary, script, above, brandColor, brandLogoUrl }) {
  return (
    <div style={{
      ...stageCream,
      alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div style={{
        background: 'var(--pn-surface)', borderRadius: 16, padding: '20px 26px',
        boxShadow: '0 6px 24px rgba(91,59,140,.12)', textAlign: 'center',
        border: '1px solid #ead8b5',
      }}>
        <LogoOrMark brandLogoUrl={brandLogoUrl} size={28} />
        <Above above={above} />
        <PrimaryName primary={primary} />
        <ScriptName script={script} />
        <div style={{ marginTop: 8 }}>
          <Greeting greet={greet} />
        </div>
        <div style={{
          marginTop: 12, height: 3, width: 36, background: brandColor,
          borderRadius: 2, margin: '12px auto 0',
        }} />
        <SignInPill brandColor={brandColor} />
      </div>
    </div>
  );
}

function Photo({ greet, primary, script, above, brandColor, brandLogoUrl }) {
  return (
    <div style={{
      ...stage,
      background: `linear-gradient(135deg, #1a1f2e 0%, ${shade(brandColor, -.25)} 100%)`,
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 24,
    }}>
      <LogoOrMark brandLogoUrl={brandLogoUrl} size={32} />
      <Above above={above} light />
      <PrimaryName primary={primary} light big />
      <ScriptName script={script} light />
      <div style={{ marginTop: 12 }}>
        <Greeting greet={greet} light />
      </div>
      <SignInPill brandColor={brandColor} />
    </div>
  );
}

function PhotoSplit({ greet, primary, script, above, brandColor, brandLogoUrl }) {
  return (
    <div style={{ ...stage, flexDirection: 'row' }}>
      <div style={{
        flex: 1.3,
        background: `linear-gradient(135deg, #1a1f2e, ${shade(brandColor, -.3)})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <LogoOrMark brandLogoUrl={brandLogoUrl} size={56} />
      </div>
      <div style={{
        flex: 1, background: 'var(--pn-surface)', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center',
      }}>
        <Above above={above} />
        <PrimaryName primary={primary} />
        <ScriptName script={script} />
        <div style={{ marginTop: 8 }}>
          <Greeting greet={greet} />
        </div>
        <SignInPill brandColor={brandColor} />
      </div>
    </div>
  );
}

// Darken a hex color by amount (-1..1). Used for accent gradients.
function shade(hex, amt) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex || '#000';
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? 1 + amt : 1 - amt;
  const target = amt < 0 ? 0 : 255;
  r = Math.round(r * f + target * (1 - f));
  g = Math.round(g * f + target * (1 - f));
  b = Math.round(b * f + target * (1 - f));
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

const frameWrap = {
  marginTop: 14, padding: 0,
};
const frameLabel = {
  fontSize: 10, fontWeight: 700, color: '#5b3b8c',
  letterSpacing: '.14em', textTransform: 'uppercase',
  marginBottom: 6,
};
const frame = {
  width: '100%', maxWidth: 460,
  border: '1px solid var(--pn-border-strong)',
  borderRadius: 12, overflow: 'hidden',
  boxShadow: '0 4px 14px rgba(91,59,140,.08)',
  background: 'var(--pn-surface)',
};
const stage = {
  width: '100%', height: 240, display: 'flex',
};
const stageCream = {
  ...stage,
  flexDirection: 'column',
  background: 'linear-gradient(180deg, #ffffff 0%, #faf6ee 100%)',
};
