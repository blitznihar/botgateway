import { NextRequest, NextResponse } from 'next/server';
import { getBotById, getBots, saveBot, toAdminConfig } from '@/lib/bot-store';
import { validateBot } from '@/lib/validate-bot';

export const dynamic = 'force-dynamic';

/** Admin: list every bot (API keys masked). Protected by ADMIN_PASSWORD when set (see middleware). */
export async function GET() {
  return NextResponse.json((await getBots()).map(toAdminConfig), { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * Admin: create or update a bot (upsert by id).
 * agentBackend.apiKey: a new key, or omitted/empty to keep the stored one. agentBackend.clearApiKey: true removes it.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ errors: ['Request body must be JSON.'] }, { status: 400 });
  }
  const result = validateBot(body);
  if (!result.ok) {
    const id = (body as { id?: unknown })?.id;
    console.warn(`[bots] rejected save of "${typeof id === 'string' ? id : '?'}": ${result.errors.join(' | ')}`);
    return NextResponse.json({ errors: result.errors }, { status: 400 });
  }

  const bot = result.bot;
  if (!bot.agentBackend.apiKey && !result.clearApiKey) {
    const existingKey = (await getBotById(bot.id))?.agentBackend.apiKey;
    if (existingKey) bot.agentBackend.apiKey = existingKey;
  }
  return NextResponse.json(toAdminConfig(await saveBot(bot)));
}
