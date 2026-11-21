import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from './lib/activity';
import { getBotById } from './lib/bot-store';
import { getSelfOrigin, isOriginAllowed } from './lib/origin';

/**
 * Runs in the Node.js runtime (stable since Next.js 15.5) so it can read data/bots.json
 * directly. Edits made in the admin UI take effect on the very next request.
 *
 *  /embed/:botId        -> Content-Security-Policy: frame-ancestors <bot.allowedDomains>
 *  /api/bots/:botId     -> CORS for the widget's cross-origin config fetch
 *  /api/chat            -> CORS for direct cross-origin callers (?botId=... required for preflight)
 *  /, /activity, /api/bots, /api/activity, /api/admin/* -> optional HTTP Basic auth for the control plane (ADMIN_PASSWORD)
 */
export const config = {
  matcher: ['/', '/activity', '/api/activity', '/api/admin/:path*', '/embed/:path*', '/api/bots', '/api/bots/:path*', '/api/chat'],
  runtime: 'nodejs',
};

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/' || pathname === '/api/bots' || pathname === '/activity' || pathname === '/api/activity' || pathname.startsWith('/api/admin/')) {
    return adminGuard(req);
  }
  if (pathname.startsWith('/embed/')) return embedHeaders(req, pathname.split('/')[2]);
  if (pathname.startsWith('/api/bots/')) return cors(req, pathname.split('/')[3], ['GET']);
  if (pathname === '/api/chat') return cors(req, req.nextUrl.searchParams.get('botId'), ['POST']);
  return NextResponse.next();
}

async function embedHeaders(req: NextRequest, rawId: string | undefined) {
  const bot = rawId ? await getBotById(safeDecode(rawId)) : null;
  const res = NextResponse.next();
  res.headers.delete('X-Frame-Options');

  const ancestors = bot ? [...bot.security.allowedDomains] : [];
  // The admin's live preview frames the bot from the gateway's own origin. 'self' is only added
  // for that preview, so removing http://localhost:3000 from allowedDomains really does block
  // the same-origin test-host pages, as the verification steps expect.
  if (req.nextUrl.searchParams.get('preview') === '1') ancestors.unshift("'self'");

  res.headers.set('Content-Security-Policy', `frame-ancestors ${ancestors.length ? ancestors.join(' ') : "'none'"};`);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

async function cors(req: NextRequest, rawId: string | null | undefined, methods: string[]) {
  const origin = req.headers.get('origin');
  const selfOrigin = getSelfOrigin(req.headers, req.nextUrl.origin);

  // Same-origin (the embed iframe, the admin UI) and non-browser callers: nothing to add here.
  // The route handlers still do their own Origin checks.
  if (!origin || origin === selfOrigin) return NextResponse.next();

  const bot = rawId ? await getBotById(safeDecode(rawId)) : null;
  const allowed = !!bot && isOriginAllowed(origin, bot.security.allowedDomains);

  if (!allowed) {
    if (bot) {
      logActivity({
        botId: bot.id,
        type: 'blocked',
        origin,
        httpStatus: 403,
        error: `Origin ${origin} not in allowedDomains (${req.method} ${req.nextUrl.pathname})`,
      });
    }
    if (req.method === 'OPTIONS') return new NextResponse(null, { status: 403, headers: { Vary: 'Origin' } });
    return NextResponse.json({ error: 'Origin not allowed for this bot' }, { status: 403, headers: { Vary: 'Origin' } });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (req.method === 'OPTIONS') return new NextResponse(null, { status: 204, headers: corsHeaders });

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(corsHeaders)) res.headers.set(k, v);
  return res;
}

function adminGuard(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next(); // Auth disabled (local dev). Set ADMIN_PASSWORD in production.

  const user = process.env.ADMIN_USER || 'admin';
  const header = req.headers.get('authorization') ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep !== -1 && safeEqual(decoded.slice(0, sep), user) && safeEqual(decoded.slice(sep + 1), password)) return NextResponse.next();
  }
  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Bot Control Plane", charset="UTF-8"' },
  });
}

function safeEqual(a: string, b: string): boolean {
  const hash = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(hash(a), hash(b));
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
