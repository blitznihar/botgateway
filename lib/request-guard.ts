import type { NextRequest } from 'next/server';
import type { BotConfig } from './bot-store';
import { getSelfOrigin, isOriginAllowed, originFromUrl } from './origin';

/**
 * Origin enforcement shared by /api/chat and /api/session.
 * Browser requests from the embed iframe are same-origin with the gateway; the real host page is
 * then identified by context.hostOrigin, which the iframe takes from the browser-verified
 * MessageEvent.origin. Cross-origin callers must be in allowedDomains directly.
 */
export function checkOrigin(req: NextRequest, bot: BotConfig, context: Record<string, unknown>): { requestOrigin: string | null; error?: string } {
  const selfOrigin = getSelfOrigin(req.headers, req.nextUrl.origin);
  const requestOrigin = req.headers.get('origin') ?? originFromUrl(req.headers.get('referer'));
  const allowed = bot.security.allowedDomains;
  const hostOrigin = typeof context.hostOrigin === 'string' ? context.hostOrigin : undefined;

  if (!requestOrigin) return { requestOrigin, error: 'Forbidden: missing Origin' };
  if (requestOrigin === selfOrigin) {
    if (hostOrigin && hostOrigin !== selfOrigin && !isOriginAllowed(hostOrigin, allowed)) {
      return { requestOrigin, error: `Forbidden: host ${hostOrigin} is not allowed for ${bot.id}` };
    }
  } else if (!isOriginAllowed(requestOrigin, allowed)) {
    return { requestOrigin, error: `Forbidden: origin ${requestOrigin} is not allowed for ${bot.id}` };
  }
  return { requestOrigin };
}

export function parseContext(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
