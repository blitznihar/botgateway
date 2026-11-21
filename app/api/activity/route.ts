import { NextRequest, NextResponse } from 'next/server';
import { ActivityType, computeStats, readActivity } from '@/lib/activity';
import { getBots } from '@/lib/bot-store';

export const dynamic = 'force-dynamic';

const TYPES: ActivityType[] = ['chat', 'widget_load', 'blocked', 'error'];

/**
 * Admin: activity feed + per-bot stats. Protected by ADMIN_PASSWORD when set (see middleware).
 *   ?botId=bot_x   only this bot's events
 *   ?type=chat     chat | widget_load | blocked | error
 *   ?q=text        substring search over message, reply, error, origin, page URL
 *   ?limit=200     max events returned (stats always cover the whole log)
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const botId = sp.get('botId');
  const type = sp.get('type') as ActivityType | null;
  const q = sp.get('q')?.toLowerCase().trim();
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 200, 1), 1000);

  const [all, bots] = await Promise.all([readActivity(), getBots()]);
  let events = all;
  if (botId) events = events.filter((e) => e.botId === botId);
  if (type && TYPES.includes(type)) events = events.filter((e) => e.type === type);
  if (q) {
    events = events.filter((e) =>
      [e.message, e.reply, e.error, e.origin, e.pageUrl, e.userId, e.userName, e.userEmail].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)),
    );
  }

  return NextResponse.json(
    {
      bots: bots.map((b) => ({ id: b.id, name: b.name, primaryColor: b.theme.primaryColor })),
      stats: computeStats(all),
      total: events.length,
      events: events.slice(0, limit),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
