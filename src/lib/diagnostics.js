// Session-scoped diagnostics collector.
//
// Salon app captures three rolling buffers in module-level state for the
// duration of a tab session, then attaches a snapshot to any support
// ticket the owner files. This lets the support engineer (and AI triage)
// see what actually happened in the browser leading up to the ticket
// without asking the owner to "send a screenshot of the console".
//
// Buffers cap themselves so memory stays bounded:
//   errors: last 50  (window.onerror + unhandledrejection)
//   nav:    last 10  (every setView call records here)
//   route:  current URL + tab title
//
// Personal data: we capture stack traces but NEVER the user's input.
// Window error events include a generic message + filename + line; no
// form values, no DOM content, no Firestore docs.
//
// Init must run exactly once, early in app boot. Call install() from
// main.jsx (or App.jsx) before React mounts.

const MAX_ERRORS = 50;
const MAX_NAV    = 10;

const _errors = [];
const _nav    = [];
let _installed = false;

function pushError(rec) {
  _errors.push(rec);
  if (_errors.length > MAX_ERRORS) _errors.shift();
}

export function install() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  // Synchronous JS errors caught by the browser. message + source +
  // lineno + colno + stack. Skip "Script error." (CORS-blocked third-
  // party scripts) since the stack is empty and they pollute the buffer.
  window.addEventListener('error', (event) => {
    const msg = String(event?.message || '');
    if (msg === 'Script error.') return;
    pushError({
      kind:     'window.error',
      message:  msg.slice(0, 500),
      source:   String(event?.filename || '').slice(0, 300),
      lineno:   Number(event?.lineno || 0),
      colno:    Number(event?.colno  || 0),
      stack:    event?.error?.stack ? String(event.error.stack).slice(0, 2000) : '',
      at:       new Date().toISOString(),
    });
  });

  // Async promise rejections — unhandled. Common pattern: a Firestore
  // permission-denied error, a fetch failure, a Stripe SDK rejection.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    const message = reason && typeof reason === 'object'
      ? (reason.message || reason.toString?.() || JSON.stringify(reason).slice(0, 300))
      : String(reason || '');
    pushError({
      kind:    'unhandledrejection',
      message: String(message).slice(0, 500),
      stack:   reason?.stack ? String(reason.stack).slice(0, 2000) : '',
      at:      new Date().toISOString(),
    });
  });

  recordNav(currentViewFromUrl(), 'initial');
}

// Called by App.jsx every time setView fires. Captures the view name +
// the reason ('user' for click, 'back' for popstate, 'ai' for AI nav,
// 'initial' for boot).
export function recordNav(view, reason = 'user') {
  _nav.push({
    view:   String(view || '').slice(0, 64),
    reason: String(reason).slice(0, 32),
    at:     new Date().toISOString(),
  });
  if (_nav.length > MAX_NAV) _nav.shift();
}

function currentViewFromUrl() {
  if (typeof window === 'undefined') return '';
  return window.history?.state?.view || 'home';
}

// Snapshot for attachment to a ticket. Doesn't drain the buffers —
// subsequent tickets can still see prior errors.
export function snapshot() {
  return {
    errors: _errors.slice(),
    nav:    _nav.slice(),
    route: typeof window === 'undefined' ? '' : (window.location?.pathname + window.location?.search),
    title: typeof document === 'undefined' ? '' : (document.title || ''),
    userAgent: typeof navigator === 'undefined' ? '' : (navigator.userAgent || ''),
    viewport: typeof window === 'undefined' ? '' : `${window.innerWidth}x${window.innerHeight}`,
    capturedAt: new Date().toISOString(),
  };
}

// Test / debug helper.
export function _resetForTests() {
  _errors.length = 0;
  _nav.length    = 0;
  _installed     = false;
}
