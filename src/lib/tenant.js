function detectTenantId() {
  // Build-time override wins — set by .env.production or .env.staging via VITE_TENANT_ID
  if (import.meta.env.VITE_TENANT_ID) return import.meta.env.VITE_TENANT_ID;
  if (typeof window === 'undefined') return 'meraki';
  const { hostname } = window.location;
  if (hostname === 'localhost' || hostname.startsWith('127.')) return 'meraki';
  // SaaS subdomain routing: {tenant}.tipflow.app
  if (hostname.endsWith('.tipflow.app')) return hostname.slice(0, hostname.length - '.tipflow.app'.length);
  return 'meraki';
}

export const TENANT_ID = detectTenantId();
