import { randomUUID } from 'crypto';
import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, errors, jwtVerify, JWTPayload } from 'jose';
import type { BotConfig } from './bot-store';
import { HostContextConfig, identityOf, IdentityConfig, ResolvedUser } from './identity-defaults';

/**
 * Server-side identity resolution. Tokens are verified against the issuer's published keys
 * (OIDC discovery -> jwks_uri), with issuer, audience, expiry and algorithm checks.
 */

const ALGORITHMS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512'];
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

const discoveryCache = new Map<string, { jwksUri: string; at: number }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const trimSlash = (s: string) => s.replace(/\/+$/, '');

async function resolveJwksUri(cfg: IdentityConfig): Promise<string> {
  if (cfg.jwksUrl) return cfg.jwksUrl;
  if (!cfg.issuer) throw new Error('No issuer configured');
  const cached = discoveryCache.get(cfg.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.jwksUri;

  const url = `${trimSlash(cfg.issuer)}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } };
    throw new Error(`Could not reach OIDC discovery at ${url} (${err.cause?.code ?? err.message})`);
  }
  if (!res.ok) throw new Error(`OIDC discovery ${url} returned ${res.status}`);
  const doc = (await res.json()) as { jwks_uri?: string };
  if (!doc.jwks_uri) throw new Error(`OIDC discovery ${url} has no jwks_uri`);
  discoveryCache.set(cfg.issuer, { jwksUri: doc.jwks_uri, at: Date.now() });
  return doc.jwks_uri;
}

function jwksFor(uri: string) {
  let set = jwksCache.get(uri);
  if (!set) {
    // jose caches keys and refetches on an unknown `kid` (key rotation), with a cooldown.
    set = createRemoteJWKSet(new URL(uri), { timeoutDuration: 5000, cooldownDuration: 30_000, cacheMaxAge: 10 * 60_000 });
    jwksCache.set(uri, set);
  }
  return set;
}

const asString = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
function asStringArray(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string' && v) return v.split(/[\s,]+/).filter(Boolean);
  return undefined;
}

export function mapClaims(cfg: IdentityConfig, payload: JWTPayload): ResolvedUser {
  const c = cfg.claims;
  const extra: Record<string, unknown> = {};
  for (const key of c.extra ?? []) if (payload[key] !== undefined) extra[key] = payload[key];
  const id = asString(payload[c.userId || 'sub']) ?? asString(payload.sub);
  if (!id) throw new Error(`Token has no "${c.userId}" claim to use as the user id`);
  return {
    id,
    anonymous: false,
    email: c.email ? asString(payload[c.email]) : undefined,
    name: c.name ? asString(payload[c.name]) : undefined,
    roles: c.roles ? asStringArray(payload[c.roles]) : undefined,
    issuer: payload.iss,
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

export type VerifyResult =
  | { ok: true; user: ResolvedUser; claims: JWTPayload }
  | { ok: false; code: 'token_expired' | 'token_invalid' | 'idp_unreachable'; error: string };

export async function verifyToken(cfg: IdentityConfig, token: string): Promise<VerifyResult> {
  if (!cfg.issuer) return { ok: false, code: 'token_invalid', error: 'Bot has no issuer configured' };
  let jwksUri: string;
  try {
    jwksUri = await resolveJwksUri(cfg);
  } catch (e) {
    return { ok: false, code: 'idp_unreachable', error: (e as Error).message };
  }
  try {
    const issuer = trimSlash(cfg.issuer);
    const { payload } = await jwtVerify(token, jwksFor(jwksUri), {
      issuer: [issuer, `${issuer}/`],
      audience: cfg.audience?.length ? cfg.audience : undefined,
      algorithms: ALGORITHMS,
      clockTolerance: 60,
    });
    return { ok: true, user: mapClaims(cfg, payload), claims: payload };
  } catch (e) {
    if (e instanceof errors.JWTExpired) return { ok: false, code: 'token_expired', error: 'Token has expired' };
    if (e instanceof errors.JWKSTimeout || (e instanceof Error && /fetch|ECONN|ENOTFOUND/i.test(e.message))) {
      return { ok: false, code: 'idp_unreachable', error: `Could not load signing keys from ${jwksUri}: ${(e as Error).message}` };
    }
    return { ok: false, code: 'token_invalid', error: (e as Error).message };
  }
}

/** Unverified peek, used by the admin "test token" tool to explain mismatches. */
export function inspectToken(token: string): { header?: unknown; payload?: JWTPayload; error?: string } {
  try {
    return { header: decodeProtectedHeader(token), payload: decodeJwt(token) };
  } catch (e) {
    return { error: `Not a JWT: ${(e as Error).message}` };
  }
}

const ANON_ID = /^[a-f0-9-]{16,64}$/i;

export type IdentityResolution =
  | { ok: true; user: ResolvedUser; warning?: string }
  | { ok: false; status: 401 | 503; code: string; error: string };

/**
 * Who is this request from? `context.authToken` is the host app's token (data-auth-token /
 * NextBot.setAuthToken / NextBot.getAuthToken); `context.anonymousId` is the embed's random visitor id.
 */
export async function resolveIdentity(bot: BotConfig, context: Record<string, unknown>): Promise<IdentityResolution> {
  const cfg = identityOf(bot);
  const anonymous: ResolvedUser = {
    id: `anon:${typeof context.anonymousId === 'string' && ANON_ID.test(context.anonymousId) ? context.anonymousId : randomUUID()}`,
    anonymous: true,
  };
  if (cfg.mode === 'anonymous') return { ok: true, user: anonymous };

  const token = typeof context.authToken === 'string' ? context.authToken.trim() : '';
  if (!token) {
    return cfg.required
      ? { ok: false, status: 401, code: 'login_required', error: 'Please sign in to use this assistant.' }
      : { ok: true, user: anonymous };
  }

  const result = await verifyToken(cfg, token);
  if (result.ok) return { ok: true, user: result.user };
  if (!cfg.required) return { ok: true, user: anonymous, warning: `${result.code}: ${result.error}` };
  if (result.code === 'idp_unreachable') return { ok: false, status: 503, code: result.code, error: 'Sign-in service is unavailable. Please try again.' };
  return {
    ok: false,
    status: 401,
    code: result.code,
    error: result.code === 'token_expired' ? 'Your session has expired. Please sign in again.' : 'Your sign-in could not be verified.',
  };
}

const ALWAYS_KEPT = ['pageUrl', 'pageTitle', 'hostOrigin'];
const NEVER_FORWARDED = ['authToken', 'anonymousId'];

/** Host context the model/backend may see: credentials removed, allowlist applied. */
export function filterHostContext(cfg: HostContextConfig | undefined, context: Record<string, unknown>): Record<string, unknown> {
  const allowed = cfg?.allowedKeys ?? [];
  return Object.fromEntries(
    Object.entries(context).filter(
      ([k]) => !NEVER_FORWARDED.includes(k) && (allowed.length === 0 || allowed.includes(k) || ALWAYS_KEPT.includes(k)),
    ),
  );
}

/** HTTP-header-safe value (non-ASCII is percent-encoded). */
const headerValue = (v: string) => (/^[\x20-\x7e]*$/.test(v) ? v : encodeURIComponent(v));

export function identityHeaders(user: ResolvedUser): Record<string, string> {
  const h: Record<string, string> = { 'X-User-Id': headerValue(user.id), 'X-User-Anonymous': String(user.anonymous) };
  if (user.email) h['X-User-Email'] = headerValue(user.email);
  if (user.name) h['X-User-Name'] = headerValue(user.name);
  if (user.roles?.length) h['X-User-Roles'] = headerValue(user.roles.join(','));
  if (user.issuer) h['X-User-Issuer'] = headerValue(user.issuer);
  return h;
}

/** What the embed may show ("Signed in as …"). */
export const publicUser = (u: ResolvedUser) => ({ anonymous: u.anonymous, name: u.name, email: u.email });

/** How the user is described to the model. */
export function describeUserForModel(user: ResolvedUser): string {
  if (user.anonymous) return 'The visitor is anonymous (not signed in). Do not assume who they are.';
  const { anonymous: _a, issuer, ...rest } = user;
  return `Signed-in user (identity verified by ${issuer ? new URL(issuer).host : 'the identity provider'}): ${JSON.stringify(rest)}`;
}
