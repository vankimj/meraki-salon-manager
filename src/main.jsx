import { StrictMode, Component, useEffect, useState, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import TenantNotFound from './components/TenantNotFound.jsx'
import { resolveTenant, getTenantResolveState } from './lib/tenant'

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

function Boot() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    resolveTenant().then(() => setState(getTenantResolveState()));
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
