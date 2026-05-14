// Rendered when resolveTenant() returns a notFound state — either the URL
// subdomain doesn't map to any tenant (`reason: 'unknown'`), is reserved
// for the platform (`reason: 'reserved'`), or had a malformed slugs doc
// (`reason: 'malformed'` — likely a partial provisioning failure that
// platform-admin should see).
//
// Cannot be a silent 404 — that's an enumeration oracle for attackers
// trying to find unclaimed slugs. Surface a styled "this salon doesn't
// exist" page with a clear path back to plumenexus.com.

export default function TenantNotFound({ slug, reason }) {
  const headline =
    reason === 'reserved' ? 'This URL is reserved'
    : reason === 'malformed' ? 'Something went wrong'
    : 'This salon doesn\'t exist';

  const body =
    reason === 'reserved'
      ? <>The URL <code>{slug}.plumenexus.com</code> is reserved for the Plume Nexus platform and can't be claimed by a salon.</>
    : reason === 'malformed'
      ? <>We hit an error looking up <code>{slug}.plumenexus.com</code>. The Plume Nexus team has been notified.</>
      : <>No salon is registered at <code>{slug}.plumenexus.com</code>. Double-check the URL — or sign up to claim this name for your salon.</>;

  return (
    <div style={page}>
      <div style={card}>
        <div style={mark}>
          {/* Plume Nexus Camellia mark — abbreviated inline SVG */}
          <svg width="56" height="56" viewBox="0 0 100 100" aria-hidden>
            <g transform="translate(50 50)">
              {[0,1,2,3,4].map(i => (
                <ellipse key={i} cx="0" cy="-20" rx="14" ry="22"
                  fill="#a288c9" opacity="0.85"
                  transform={`rotate(${i * 72})`} />
              ))}
              <circle r="7" fill="#c19a4a" />
            </g>
          </svg>
        </div>
        <div style={title}>{headline}</div>
        <div style={text}>{body}</div>
        <div style={actions}>
          <a href="https://plumenexus.com" style={btnPrimary}>Plume Nexus home</a>
          <a href="https://plumenexus.com/signup" style={btnSecondary}>Start a salon →</a>
        </div>
      </div>
      <div style={footer}>Plume Nexus · plumenexus.com</div>
    </div>
  );
}

const page = {
  minHeight: '100vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'linear-gradient(180deg, #fbf7f1 0%, #f3ece0 100%)',
  fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
  color: '#2a2a2a',
  padding: '32px 20px',
};
const card = {
  maxWidth: 460,
  width: '100%',
  background: '#fff',
  border: '1px solid #ead8b5',
  borderRadius: 16,
  padding: '40px 36px 32px',
  textAlign: 'center',
  boxShadow: '0 6px 26px rgba(91,59,140,.08)',
};
const mark = { marginBottom: 18 };
const title = {
  fontFamily: '"Cinzel", "Times New Roman", serif',
  fontSize: 22,
  fontWeight: 700,
  letterSpacing: '.04em',
  color: '#5b3b8c',
  marginBottom: 14,
};
const text = {
  fontSize: 14,
  lineHeight: 1.6,
  color: '#3c3c3c',
  marginBottom: 26,
};
const actions = { display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' };
const btnPrimary = {
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 700,
  background: '#5b3b8c',
  color: '#fff',
  borderRadius: 999,
  border: 'none',
  textDecoration: 'none',
  fontFamily: 'inherit',
};
const btnSecondary = {
  padding: '10px 18px',
  fontSize: 13,
  fontWeight: 600,
  background: '#fff',
  color: '#5b3b8c',
  borderRadius: 999,
  border: '1px solid #c19a4a',
  textDecoration: 'none',
  fontFamily: 'inherit',
};
const footer = {
  marginTop: 32,
  fontSize: 11,
  letterSpacing: '.12em',
  color: '#967f4a',
  textTransform: 'uppercase',
};
