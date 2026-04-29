import { addLog } from './firestore';
import { APP_VERSION, BUILD_DATE } from './version';

let currentUser = null;

export function setLoggerUser(user) {
  currentUser = user;
}

const buildInfo = { _version: APP_VERSION, _build: BUILD_DATE };

export async function logActivity(action, details = '', actorEmail = null) {
  const entry = {
    timestamp:  new Date().toISOString(),
    email:      actorEmail || (currentUser?.email ?? null),
    name:       currentUser?.displayName || currentUser?.email || actorEmail || null,
    action,
    details:    details || '',
    ...buildInfo,
  };
  try { await addLog(entry); } catch (_) {}
}

export async function logError(context, err, extra = {}) {
  const message = err?.message || String(err) || 'unknown';
  const entry = {
    timestamp:  new Date().toISOString(),
    email:      currentUser?.email ?? null,
    name:       currentUser?.displayName || currentUser?.email || null,
    action:     'error',
    details:    `[${context}] ${message}`,
    _error:     true,
    _context:   context,
    _message:   message,
    _stack:     (err?.stack || '').slice(0, 500) || null,
    _ua:        navigator?.userAgent?.slice(0, 200) || null,
    ...buildInfo,
    ...extra,
  };
  try { await addLog(entry); } catch (_) {}
}
