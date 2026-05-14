import { StrictMode, Component, useEffect, useState, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TenantNotFound from './components/TenantNotFound.jsx'
import { resolveTenant, getTenantResolveState, TENANT_ID } from './lib/tenant'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './lib/firebase'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  componentDidCatch(err, info) { console.error('[ErrorBoundary]', err, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: 'monospace', color: '#c00', background: '#fff', maxWidth: 700 }}>
          <strong>React render error</strong>
          <pre style={{ marginTop: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}>{this.state.error?.stack || this.state.error?.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// App.jsx + all its transitive imports (notably src/lib/firestore.js) evaluate
// when first imported. firestore.js captures TENANT_ID into module-level
// DocumentReference constants at that moment. If we statically import App
// here, those refs get the boot-guess TENANT_ID (the URL subdomain) — which
// is wrong for SaaS tenants whose opaque tenantId differs from their slug
// (e.g. acme.plumenexus.com → tabc123def456...). Writes would then target
// `tenants/acme/...` instead of `tenants/tabc123.../...`, hitting permission
// denied because the rules check membership against the wrong tenant.
//
// Fix: dynamic import after resolveTenant() has set the real TENANT_ID.
const App = lazy(() => import('./App.jsx'));

// One-shot tenant-aware tab title. Reads tenants/{tid}/data/webfront
// (publicly readable, no sign-in required) and sets document.title +
// theme-color from the salon's branding. Static title in index.html is
// the generic "Plume Nexus" — this hydrates it with the actual salon
// name as soon as we know the tenant. Failures are silent: tab keeps
// the platform default which is acceptable.
async function hydrateTabTitleFromWebfront() {
  try {
    // ES live-binding: TENANT_ID always reflects the value set by
    // resolveTenant(), which has run by the time this is called.
    const snap = await getDoc(doc(db, 'tenants', TENANT_ID, 'data', 'webfront'));
    if (!snap.exists()) return;
    const wf = snap.data() || {};
    const name = wf.salonName || wf.brandName;
    if (name) document.title = name;
    if (wf.brandColor) {
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', wf.brandColor);
    }
  } catch (_) { /* keep platform default */ }
}

// Legacy hostname → permanent new URL. Has to live OUTSIDE the Firebase
// Hosting redirect rule because the Cloudflare Worker proxies all
// *.plumenexus.com tenant traffic to meraki-salon-manager.web.app, so a
// hosting-level redirect on that target would 301 every tenant. JS-side
// redirect runs only when the user's actual browser hostname matches.
function redirectLegacyHostnameIfNeeded() {
  if (typeof window === 'undefined') return false;
  if (window.location.hostname !== 'meraki-salon-manager.web.app') return false;
  const target = 'https://merakinailstudio.plumenexus.com'
    + window.location.pathname
    + window.location.search
    + window.location.hash;
  window.location.replace(target);
  return true;
}

function Boot() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    if (redirectLegacyHostnameIfNeeded()) return; // navigation in flight; never resolve
    resolveTenant().then(() => {
      setState(getTenantResolveState());
      hydrateTabTitleFromWebfront();
    });
  }, []);

  if (state.status === 'loading') return null;
  if (state.status === 'notFound') {
    return <TenantNotFound slug={state.slug} reason={state.reason} />;
  }
  return (
    <Suspense fallback={null}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Boot />
    </ErrorBoundary>
  </StrictMode>,
)
