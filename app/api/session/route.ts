import { NextRequest, NextResponse } from 'next/server';
import { getBotById } from '@/lib/bot-store';
import { publicUser, resolveIdentity } from '@/lib/identity';
import { checkOrigin, parseContext } from '@/lib/request-guard';

export const dynamic = 'force-dynamic';

/**
 * Called by the embed whenever the host context/token changes, so the chat can show
 * "Signed in as …" or "Please sign in" before the user types anything.
 * Body: { botId, context }  ->  { user } | { error, code }
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { botId?: unknown; context?: unknown };
  const bot = typeof body.botId === 'string' ? await getBotById(body.botId) : null;
  if (!bot) return NextResponse.json({ error: 'Unknown bot' }, { status: 404 });

  const context = parseContext(body.context);
  const { error } = checkOrigin(req, bot, context);
  if (error) return NextResponse.json({ error, code: 'forbidden' }, { status: 403 });

  const identity = await resolveIdentity(bot, context);
  if (!identity.ok) return NextResponse.json({ error: identity.error, code: identity.code }, { status: identity.status });
  return NextResponse.json({ user: publicUser(identity.user) }, { headers: { 'Cache-Control': 'no-store' } });
}
