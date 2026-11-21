import { NextRequest, NextResponse } from 'next/server';
import { devIdpEnabled, discovery, Flavor, FLAVORS, issueToken, jwks, PERSONAS } from '@/lib/dev-idp';

export const dynamic = 'force-dynamic';

/**
 * TEST-ONLY identity provider (ENABLE_DEV_IDP=true):
 *   GET /api/dev-idp/{entra|auth0}/.well-known/openid-configuration
 *   GET /api/dev-idp/{entra|auth0}/jwks
 *   GET /api/dev-idp/{entra|auth0}/token?user=jane&ttl=300   -> { access_token, ... }  (ttl<0: expired token)
 *   GET /api/dev-idp/{entra|auth0}/users                     -> available test personas
 * CORS is open so test-host pages on other origins can "sign in".
 */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

export async function GET(req: NextRequest, { params }: { params: Promise<{ flavor: string; path: string[] }> }) {
  if (!devIdpEnabled()) return NextResponse.json({ error: 'Dev IdP is disabled (set ENABLE_DEV_IDP=true)' }, { status: 404 });
  const { flavor, path } = await params;
  if (!FLAVORS.includes(flavor as Flavor)) return NextResponse.json({ error: 'Unknown flavor' }, { status: 404 });
  const f = flavor as Flavor;
  const route = path.join('/');

  if (route === '.well-known/openid-configuration') return NextResponse.json(discovery(f), { headers: CORS });
  if (route === 'jwks') return NextResponse.json(await jwks(), { headers: CORS });
  if (route === 'users') return NextResponse.json(PERSONAS[f].map(({ key, name, email, roles }) => ({ key, name, email, roles })), { headers: CORS });
  if (route === 'token') {
    const ttl = Math.min(Math.max(Number(req.nextUrl.searchParams.get('ttl')) || 300, -600), 3600); // < 0 = already expired (testing)
    return NextResponse.json(await issueToken(f, req.nextUrl.searchParams.get('user') ?? '', ttl), { headers: CORS });
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
