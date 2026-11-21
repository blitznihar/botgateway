import { NextRequest, NextResponse } from 'next/server';
import { BotConfig, getBots, saveBots } from '@/lib/bot-store';
import { extractBots } from '@/lib/bot-transfer';
import { validateBot } from '@/lib/validate-bot';

export const dynamic = 'force-dynamic';

type ItemResult = {
  id: string;
  name?: string;
  status: 'new' | 'exists' | 'invalid' | 'created' | 'updated' | 'skipped';
  errors?: string[];
};

/**
 * Admin: import bots from JSON.
 * Body: { file: <export file | array | single bot>, onConflict: 'skip' | 'overwrite', dryRun?: boolean }
 * dryRun returns what would happen (new / exists / invalid) without writing. Every bot goes through the
 * same validation as the editor. On overwrite, a stored API key is kept unless the file provides one.
 * Nothing is written if any bot is invalid. Protected by ADMIN_PASSWORD.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { file?: unknown; onConflict?: string; dryRun?: boolean } | null;
  if (!body) return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  const { bots: raw, error } = extractBots(body.file);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!raw.length) return NextResponse.json({ error: 'The file contains no bots' }, { status: 400 });
  if (raw.length > 200) return NextResponse.json({ error: 'Too many bots in one import (max 200)' }, { status: 400 });

  const overwrite = body.onConflict === 'overwrite';
  const existing = new Map((await getBots()).map((b) => [b.id, b]));
  const seen = new Set<string>();
  const results: ItemResult[] = [];
  const toSave: BotConfig[] = [];

  for (const item of raw) {
    const id = typeof (item as { id?: unknown })?.id === 'string' ? (item as { id: string }).id : '(missing id)';
    const v = validateBot(item);
    if (!v.ok) {
      results.push({ id, status: 'invalid', errors: v.errors });
      continue;
    }
    if (seen.has(v.bot.id)) {
      results.push({ id, status: 'invalid', errors: ['Duplicate id in this file'] });
      continue;
    }
    seen.add(v.bot.id);
    const current = existing.get(v.bot.id);
    if (current && !v.bot.agentBackend.apiKey && current.agentBackend.apiKey) v.bot.agentBackend.apiKey = current.agentBackend.apiKey;

    if (body.dryRun) results.push({ id, name: v.bot.name, status: current ? 'exists' : 'new' });
    else if (current && !overwrite) results.push({ id, name: v.bot.name, status: 'skipped' });
    else {
      toSave.push(v.bot);
      results.push({ id, name: v.bot.name, status: current ? 'updated' : 'created' });
    }
  }

  const invalid = results.filter((r) => r.status === 'invalid').length;
  if (body.dryRun || invalid) {
    return NextResponse.json({ dryRun: true, written: 0, invalid, results }, { status: body.dryRun ? 200 : 400 });
  }
  if (toSave.length) await saveBots(toSave);
  console.info(`[bots] imported ${toSave.length} bot(s): ${toSave.map((b) => b.id).join(', ')}`);
  return NextResponse.json({ dryRun: false, written: toSave.length, invalid: 0, results });
}
