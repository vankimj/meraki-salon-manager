import { StrictMode, Component, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
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

// Boot wrapper: awaits resolveTenant() before mounting <App />. On notFound
// renders the TenantNotFound page instead. resolveTenant runs once at boot;
// the result is captured into state and the appropriate tree mounts.
function Boot() {
  const [state, setState] = useState({ status: 'loading' });

  useEffect(() => {
    resolveTenant().then(() => setState(getTenantResolveState()));
  }, []);

  if (state.status === 'loading') {
    // Brief flash — usually <100ms once the Firestore cache is warm.
    // Intentionally chrome-less; the splash inside <App/> takes over once
    // tenant is resolved.
    return null;
  }
  if (state.status === 'notFound') {
    return <TenantNotFound slug={state.slug} reason={state.reason} />;
  }
  return <App />;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Boot />
    </ErrorBoundary>
  </StrictMode>,
)
