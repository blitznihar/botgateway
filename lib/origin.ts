/**
 * Origin / domain helpers shared by middleware, API routes and the embed UI.
 * Pure functions only (no Node APIs) so they are safe to import client-side.
 *
 * An allowed-domain entry is an origin pattern:
 *   scheme://host[:port]        e.g. http://localhost:3000, https://company.com
 *   scheme://*.host[:port]      e.g. https://*.force.com  (matches subdomains only)
 *
 * Entries are injected verbatim into the CSP `frame-ancestors` header, so the
 * pattern is deliberately strict: no paths, no spaces, no `;`.
 */

const DOMAIN_PATTERN = /^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/;

/** Returns the canonical form of a domain entry, or null if it is not a valid origin pattern. */
export function normalizeDomain(raw: string): string | null {
  const value = raw.trim().toLowerCase().replace(/\/+$/, '');
  return DOMAIN_PATTERN.test(value) ? value : null;
}

const defaultPort = (scheme: string) => (scheme === 'https' ? '443' : '80');

/** Does a concrete request origin (e.g. "https://acme.my.salesforce.com") match one pattern? */
export function originMatches(origin: string, pattern: string): boolean {
  const m = DOMAIN_PATTERN.exec(pattern.toLowerCase());
  if (!m) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const [, scheme, wildcard, host, port] = m;
  if (url.protocol !== `${scheme}:`) return false;
  if ((url.port || defaultPort(scheme)) !== (port || defaultPort(scheme))) return false;
  const hostname = url.hostname.toLowerCase();
  return wildcard ? hostname.endsWith(`.${host}`) : hostname === host;
}

export function isOriginAllowed(origin: string | null | undefined, allowedDomains: string[]): boolean {
  if (!origin) return false;
  return allowedDomains.some((pattern) => originMatches(origin, pattern));
}

/** Origin of a Referer URL, or null. */
export function originFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * The gateway's own public origin as seen by the browser.
 * PUBLIC_BASE_URL wins when set (recommended behind a reverse proxy).
 */
export function getSelfOrigin(headers: Headers, fallbackOrigin: string): string {
  const configured = process.env.PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const host = headers.get('host');
  if (!host) return fallbackOrigin;
  const proto = headers.get('x-forwarded-proto')?.split(',')[0]?.trim() || new URL(fallbackOrigin).protocol.replace(':', '');
  return `${proto}://${host}`;
}
