import { NextRequest, NextResponse } from 'next/server';
import { inspectToken, verifyToken } from '@/lib/identity';
import { IdentityConfig } from '@/lib/identity-defaults';

export const dynamic = 'force-dynamic';

/**
 * Admin: check a real token against the identity settings in the editor (saved or not).
 * Body: { identity, token } -> verification result, the mapped user, and the token's
 * (unverified) iss/aud so mismatches are easy to spot. Protected by ADMIN_PASSWORD.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { identity?: IdentityConfig; token?: string };
  const token = (body.token ?? '').trim().replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ ok: false, error: 'Paste a token first.' });
  if (!body.identity?.issuer) return NextResponse.json({ ok: false, error: 'Set an issuer first.' });

  const peek = inspectToken(token);
  const result = await verifyToken({ ...body.identity, mode: 'jwt' }, token);
  const payload = peek.payload;
  return NextResponse.json({
    ...(result.ok ? { ok: true, user: result.user } : { ok: false, code: result.code, error: result.error }),
    token: payload
      ? {
          iss: payload.iss,
          aud: payload.aud,
          sub: payload.sub,
          exp: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
          alg: (peek.header as { alg?: string } | undefined)?.alg,
          claimNames: Object.keys(payload),
        }
      : { error: peek.error },
  });
}
