// Server-side message-template renderer. ONE render path for every automated
// tenant email + SMS: load the per-tenant override (if any) layered over the
// baked-in default, interpolate the caller's vars, and return ready-to-send
// { subject, html } (email) or { body } (sms).
//
// renderMessage() is pure (no Firestore) and is the exact function the web
// editor mirrors for live preview. renderTemplate() adds the Firestore override
// lookup with a 5-minute cache (mirrors tenantSmsFrom in index.js).

const { esc, interpolate, renderEmailBody, emailShell } = require('./emailShell');
const { DEFAULT_TEMPLATES, TEMPLATE_GROUPS, TEMPLATE_KEYS } = require('./messageTemplateDefaults');

const identity = (x) => String(x == null ? '' : x);

// Layer an override's subject/body over the default. Only subject + body are
// tenant-editable; channel, vars, htmlVars and shell config always come from
// the default so an override can never change escaping or routing.
function mergeTemplate(def, override) {
  if (!override) return def;
  const out = { ...def };
  if (typeof override.subject === 'string' && override.subject.length) out.subject = override.subject;
  if (typeof override.body === 'string' && override.body.length) out.body = override.body;
  return out;
}

// Pure render. `override` is the raw { subject?, body? } doc (or null).
function renderMessage(key, vars = {}, brand = null, override = null) {
  const def = DEFAULT_TEMPLATES[key];
  if (!def) throw new Error(`Unknown message template: ${key}`);
  const tpl = mergeTemplate(def, override);

  if (def.channel === 'sms') {
    return { channel: 'sms', body: interpolate(tpl.body, vars, { escapeFn: identity }) };
  }

  const cfg = def.email || {};
  const subject  = interpolate(tpl.subject || '', vars, { escapeFn: identity });
  const subtitle = interpolate(cfg.subtitle || '', vars, { escapeFn: esc });
  const bodyHtml = renderEmailBody(tpl.body, vars, def.htmlVars || []);
  const html = emailShell(brand, {
    subtitle,
    bodyHtml,
    gradient: cfg.gradient || '#2D7A5F,#3D95CE',
    footerNote: cfg.footerNote || '',
    footerBorder: cfg.footerBorder !== false,
    centerHeaderTitle: cfg.centerHeaderTitle || '',
  });
  return { channel: 'email', subject, html };
}

// ── Firestore override lookup, cached 5 min per (tenant,key) ──────────
const _overrideCache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function loadOverride(db, tenantId, key) {
  const cacheKey = `${tenantId}/${key}`;
  const cached = _overrideCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.override;
  let override = null;
  try {
    const snap = await db.doc(`tenants/${tenantId}/messageTemplates/${key}`).get();
    if (snap.exists) {
      const d = snap.data() || {};
      override = {
        subject: typeof d.subject === 'string' ? d.subject : undefined,
        body:    typeof d.body === 'string' ? d.body : undefined,
        phrases: (d.phrases && typeof d.phrases === 'object') ? d.phrases : undefined,
      };
    }
  } catch (e) {
    // Fall back to the default — a missing/unreadable override must never block
    // a transactional send.
    console.warn(`[messageTemplates] override read failed tenant=${tenantId} key=${key}:`, e?.message);
  }
  _overrideCache.set(cacheKey, { override, at: Date.now() });
  return override;
}

// Full server render: load override + render. `brand` is required for email
// (the send sites already compute it via tenantBranding).
async function renderTemplate(db, tenantId, key, vars = {}, brand = null) {
  const override = await loadOverride(db, tenantId, key);
  return renderMessage(key, vars, brand, override);
}

// Resolve a template's editable "phrases" — the conditional prose fragments
// (e.g. the reminder help line, the cancellation intro) that the send site
// picks between at runtime. Returns { phraseKey: text } with per-tenant
// overrides layered over the defaults. Pure.
function resolvePhrases(key, override = null) {
  const def = DEFAULT_TEMPLATES[key];
  const defs = (def && def.phrases) || {};
  const out = {};
  for (const k of Object.keys(defs)) {
    const ov = override && override.phrases && typeof override.phrases[k] === 'string' && override.phrases[k].length
      ? override.phrases[k] : null;
    out[k] = ov != null ? ov : defs[k].default;
  }
  return out;
}

// Server-side: load the (cached) override and resolve phrases. The send site
// calls this, then passes the chosen phrase into renderTemplate's vars.
async function getTemplatePhrases(db, tenantId, key) {
  const override = await loadOverride(db, tenantId, key);
  return resolvePhrases(key, override);
}

function clearTemplateCache(tenantId, key) {
  if (tenantId && key) _overrideCache.delete(`${tenantId}/${key}`);
  else _overrideCache.clear();
}

module.exports = {
  renderMessage, renderTemplate, loadOverride, clearTemplateCache,
  resolvePhrases, getTemplatePhrases,
  DEFAULT_TEMPLATES, TEMPLATE_GROUPS, TEMPLATE_KEYS,
};
