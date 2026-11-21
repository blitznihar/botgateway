/**
 * Per-bot user identity configuration. Pure types/constants (safe to import client-side).
 *
 * Trust model:
 *  - Verified identity comes ONLY from a JWT the gateway verifies itself (signature via the issuer's
 *    JWKS, issuer, audience, expiry). Never from fields the host page sets.
 *  - Host context (anything passed via NextBot.setContext) is unverified and labelled as such.
 *  - Anonymous visitors get a random, per-browser correlation id, not an identity.
 */

export type IdentityMode = 'anonymous' | 'jwt';

export interface IdentityConfig {
  mode: IdentityMode;
  /** jwt mode: reject chats without a valid token. If false, those visitors chat anonymously. */
  required: boolean;
  /** UI label only: which preset the fields came from. */
  provider?: 'auth0' | 'entra' | 'oidc' | 'dev_entra' | 'dev_auth0';
  /** Exact `iss` claim (a trailing-slash difference is tolerated). JWKS is discovered from {issuer}/.well-known/openid-configuration. */
  issuer?: string;
  /** Accepted `aud` values. Required in jwt mode so tokens minted for other apps are rejected. */
  audience?: string[];
  /** Optional explicit JWKS URL (skips discovery). */
  jwksUrl?: string;
  /** Claim names to read (exact keys, so namespaced Auth0 claims like https://acme.com/roles work). */
  claims: { userId: string; email?: string; name?: string; roles?: string; extra?: string[] };
  /** Send X-User-* headers to the agent backend (for your own agents; avoid for third-party LLM APIs). */
  forwardHeaders: boolean;
}

export interface HostContextConfig {
  /** Host context keys forwarded to the model/backend. Empty = all keys. pageUrl/pageTitle/hostOrigin are always kept. */
  allowedKeys: string[];
}

/** The identity the gateway resolved for a request. */
export interface ResolvedUser {
  id: string; // "anon:<uuid>" for anonymous visitors
  anonymous: boolean;
  email?: string;
  name?: string;
  roles?: string[];
  issuer?: string;
  extra?: Record<string, unknown>;
}

export const ANONYMOUS_IDENTITY: IdentityConfig = {
  mode: 'anonymous',
  required: false,
  claims: { userId: 'sub' },
  forwardHeaders: false,
};

/** Dev IdP (test-only, see lib/dev-idp.ts) issues tokens with this base. */
export const DEV_IDP_BASE = 'http://localhost:3000/api/dev-idp';

export const IDENTITY_PRESETS: {
  key: NonNullable<IdentityConfig['provider']>;
  label: string;
  issuer: string;
  audience: string;
  claims: IdentityConfig['claims'];
  help: string;
}[] = [
  {
    key: 'auth0',
    label: 'Auth0',
    issuer: 'https://YOUR_TENANT.auth0.com/',
    audience: 'https://your-api-identifier',
    claims: { userId: 'sub', email: 'https://your-app.example/email', name: 'https://your-app.example/name', roles: 'https://your-app.example/roles', extra: [] },
    help: 'Issuer is your tenant/custom domain with trailing slash. Audience is the Auth0 API Identifier the SPA requests via getAccessTokenSilently({ authorizationParams: { audience } }). Access tokens only carry email/name/roles if a Post-Login Action adds them as namespaced claims.',
  },
  {
    key: 'entra',
    label: 'Microsoft Entra ID',
    issuer: 'https://login.microsoftonline.com/YOUR_TENANT_ID/v2.0',
    audience: 'api://YOUR_API_CLIENT_ID',
    claims: { userId: 'oid', email: 'preferred_username', name: 'name', roles: 'roles', extra: ['tid'] },
    help: 'Use an access token for your own API (App registration > Expose an API, requested via MSAL acquireTokenSilent({ scopes: ["api://…/access_as_user"] })). Set accessTokenAcceptedVersion=2 in the manifest, otherwise the issuer is https://sts.windows.net/{tid}/. Audience may be api://… or the API client id.',
  },
  {
    key: 'oidc',
    label: 'Generic OIDC (Okta, Ping, Keycloak…)',
    issuer: 'https://idp.example.com/oauth2/default',
    audience: 'api://default',
    claims: { userId: 'sub', email: 'email', name: 'name', roles: 'groups', extra: [] },
    help: 'Any OpenID Connect provider that publishes /.well-known/openid-configuration and signs tokens with RS/PS/ES keys.',
  },
  {
    key: 'dev_entra',
    label: 'Dev IdP · Entra-style (testing)',
    issuer: `${DEV_IDP_BASE}/entra`,
    audience: 'api://bot-gateway-dev',
    claims: { userId: 'oid', email: 'preferred_username', name: 'name', roles: 'roles', extra: ['tid'] },
    help: 'Test-only identity provider built into this gateway (ENABLE_DEV_IDP=true). Never use in production.',
  },
  {
    key: 'dev_auth0',
    label: 'Dev IdP · Auth0-style (testing)',
    issuer: `${DEV_IDP_BASE}/auth0/`,
    audience: 'https://bot-gateway.dev/api',
    claims: { userId: 'sub', email: 'https://bot-gateway.dev/email', name: 'https://bot-gateway.dev/name', roles: 'https://bot-gateway.dev/roles', extra: [] },
    help: 'Test-only identity provider built into this gateway (ENABLE_DEV_IDP=true). Never use in production.',
  },
];

/** Tolerates bots saved before identity existed. */
export function identityOf(bot: { identity?: IdentityConfig }): IdentityConfig {
  return bot.identity ?? ANONYMOUS_IDENTITY;
}

export const isDevIssuer = (issuer?: string) => !!issuer && issuer.startsWith(DEV_IDP_BASE);
