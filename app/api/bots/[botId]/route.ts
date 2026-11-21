import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { getBotById, toPublicConfig } from '@/lib/bot-store';
import { originFromUrl } from '@/lib/origin';

export const dynamic = 'force-dynamic';

/**
 * Public-safe config used by widget.js to draw the launcher.
 * Cross-origin access is restricted to the bot's allowedDomains by middleware.ts.
 * Each successful fetch is a "widget load" in the activity log.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ botId: string }> }) {
  const { botId } = await params;
  const bot = await getBotById(botId);
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 });

  const referer = req.headers.get('referer');
  logActivity({
    botId: bot.id,
    type: 'widget_load',
    httpStatus: 200,
    origin: req.headers.get('origin') ?? originFromUrl(referer),
    pageUrl: referer ?? undefined,
  });
  return NextResponse.json(toPublicConfig(bot), { headers: { 'Cache-Control': 'no-store' } });
}
