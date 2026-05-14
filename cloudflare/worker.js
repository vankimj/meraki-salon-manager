// tenant-router — Cloudflare Worker for *.plumenexus.com routing.
//
// Wildcard CNAME *.plumenexus.com → meraki-salon-manager.web.app is
// proxied through Cloudflare (orange cloud). Cloudflare forwards the
// Host header verbatim, but Firebase Hosting rejects requests whose
// Host it doesn't recognize as a registered custom domain. This Worker
// rewrites Host so Firebase accepts any tenant subdomain, while the
// browser still sees the original subdomain.plumenexus.com URL — which
// the React app reads via window.location.hostname (src/lib/tenant.js)
// to resolve the tenant.
//
// Why a Worker at all: Firebase Hosting has a hard 20-subdomain-per-apex
// cap on customDomain registrations (SSL minting limit) and rejects
// wildcards in the customDomain API. For SaaS scale we need a single
// proxy that handles all subdomains. Cloudflare Universal SSL covers
// *.plumenexus.com for free, so the cert layer is solved without
// per-tenant work.
//
// Specific subdomains with their own Firebase customDomain registration
// (admin.plumenexus.com → plumenexus-admin site, demo.plumenexus.com,
// www.plumenexus.com → marketing) have proxy=OFF on their DNS entry, so
// Cloudflare doesn't see those requests at all — this Worker never runs
// for them, and the more-specific DNS records win over the wildcard.
//
// Deploy via Cloudflare API or `npx wrangler deploy` (uses wrangler.toml).
// Currently deployed via API; the script id at Cloudflare is `tenant-router`.

const FIREBASE_HOST = 'meraki-salon-manager.web.app';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const originalHost = url.hostname;
    const upstreamUrl = `https://${FIREBASE_HOST}${url.pathname}${url.search}`;
    const upstreamHeaders = new Headers(request.headers);
    upstreamHeaders.set('host', FIREBASE_HOST);
    upstreamHeaders.set('x-forwarded-host', originalHost);
    const upstreamReq = new Request(upstreamUrl, {
      method:  request.method,
      headers: upstreamHeaders,
      body:    ['GET', 'HEAD'].includes(request.method) ? null : request.body,
      redirect: 'follow',
    });
    const response = await fetch(upstreamReq);
    // Strip X-Frame-Options so platform-admin tenant preview iframe can render.
    const headers = new Headers(response.headers);
    headers.delete('x-frame-options');
    return new Response(response.body, {
      status:     response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
