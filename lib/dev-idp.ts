import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { exportJWK, generateKeyPair, importJWK, JWK, SignJWT } from 'jose';
import path from 'path';
import { DEV_IDP_BASE } from './identity-defaults';

/**
 * TEST-ONLY identity provider so the Auth0 / Entra ID flows can be exercised end to end without real
 * tenants. Issues RS256 tokens shaped like each provider's access tokens and serves standard OIDC
 * discovery + JWKS. Enabled only when ENABLE_DEV_IDP=true. Anyone who can reach it can mint tokens,
 * so never point a production bot at it (the admin UI flags such bots).
 */

export const devIdpEnabled = () => process.env.ENABLE_DEV_IDP === 'true';
export type Flavor = 'entra' | 'auth0';
export const FLAVORS: Flavor[] = ['entra', 'auth0'];

const KEY_FILE = path.join(process.cwd(), 'data', 'dev-idp-key.json');
let keyPromise: Promise<{ privateKey: CryptoKey | Uint8Array; publicJwk: JWK }> | null = null;

function loadKey() {
  keyPromise ??= (async () => {
    try {
      const jwk = JSON.parse(await fs.readFile(KEY_FILE, 'utf8')) as JWK;
      const { d: _d, p: _p, q: _q, dp: _dp, dq: _dq, qi: _qi, ...publicJwk } = jwk;
      return { privateKey: await importJWK(jwk, 'RS256'), publicJwk };
    } catch {
      const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
      const kid = `dev-${randomUUID().slice(0, 8)}`;
      const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'RS256', use: 'sig' };
      await fs.mkdir(path.dirname(KEY_FILE), { recursive: true });
      await fs.writeFile(KEY_FILE, JSON.stringify(privateJwk), { mode: 0o600 });
      return { privateKey, publicJwk: { ...(await exportJWK(publicKey)), kid, alg: 'RS256', use: 'sig' } };
    }
  })();
  return keyPromise;
}

export const issuerFor = (flavor: Flavor) => (flavor === 'auth0' ? `${DEV_IDP_BASE}/auth0/` : `${DEV_IDP_BASE}/entra`);

export async function jwks() {
  return { keys: [(await loadKey()).publicJwk] };
}

export function discovery(flavor: Flavor) {
  const base = `${DEV_IDP_BASE}/${flavor}`;
  return {
    issuer: issuerFor(flavor),
    jwks_uri: `${base}/jwks`,
    token_endpoint: `${base}/token`,
    id_token_signing_alg_values_supported: ['RS256'],
    response_types_supported: ['token'],
    subject_types_supported: ['public'],
  };
}

type Persona = { key: string; name: string; email: string; roles: string[]; oid: string; auth0Id: string };

export const PERSONAS: Record<Flavor, Persona[]> = {
  entra: [
    { key: 'jane', name: 'Jane Doe', email: 'jane.doe@company.com', roles: ['Employee'], oid: '6f1c2d3e-0000-4a1b-9c2d-00000000a001', auth0Id: '' },
    { key: 'bob', name: 'Bob Smith', email: 'bob.smith@company.com', roles: ['Employee', 'HR.Admin'], oid: '6f1c2d3e-0000-4a1b-9c2d-00000000b002', auth0Id: '' },
  ],
  auth0: [
    { key: 'alice', name: 'Alice Morgan', email: 'alice.morgan@insureco.example', roles: ['call_center_agent'], oid: '', auth0Id: 'auth0|65f1a0c0d1e2f3a4b5c6d7e8' },
    { key: 'dana', name: 'Dana Whitfield', email: 'dana.whitfield@example.com', roles: ['customer'], oid: '', auth0Id: 'auth0|65f1a0c0d1e2f3a4b5c6d800' },
    { key: 'carol', name: 'Carol Reyes', email: 'carol.reyes@insureco.example', roles: ['call_center_agent', 'supervisor'], oid: '', auth0Id: 'auth0|65f1a0c0d1e2f3a4b5c6d7f9' },
  ],
};

export async function issueToken(flavor: Flavor, personaKey: string, ttlSeconds: number) {
  const persona = PERSONAS[flavor].find((p) => p.key === personaKey) ?? PERSONAS[flavor][0];
  const { privateKey, publicJwk } = await loadKey();
  const claims =
    flavor === 'entra'
      ? {
          oid: persona.oid,
          tid: '9a8b7c6d-1111-2222-3333-devtenant000',
          name: persona.name,
          preferred_username: persona.email,
          roles: persona.roles,
          scp: 'access_as_user',
          ver: '2.0',
        }
      : {
          'https://bot-gateway.dev/email': persona.email,
          'https://bot-gateway.dev/name': persona.name,
          'https://bot-gateway.dev/roles': persona.roles,
          scope: 'openid profile email',
          azp: 'devSpaClientId',
        };
  const subject = flavor === 'entra' ? `pairwise-${persona.oid.slice(-4)}` : persona.auth0Id;
  const audience = flavor === 'entra' ? 'api://bot-gateway-dev' : 'https://bot-gateway.dev/api';

  const token = await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: publicJwk.kid, typ: 'JWT' })
    .setIssuer(issuerFor(flavor))
    .setAudience(audience)
    .setSubject(subject)
    // Negative ttl = already-expired token (for testing the refresh flow).
    .setIssuedAt(Math.floor(Date.now() / 1000) - (ttlSeconds < 0 ? 600 : 0))
    .setNotBefore(Math.floor(Date.now() / 1000) - (ttlSeconds < 0 ? 600 : 0))
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .setJti(randomUUID())
    .sign(privateKey);
  return { access_token: token, token_type: 'Bearer', expires_in: ttlSeconds, persona: { key: persona.key, name: persona.name, email: persona.email } };
}
