import { NextRequest, NextResponse } from 'next/server';
import { getBotById } from '@/lib/bot-store';
import { chatCompletion, listModels } from '@/lib/llm';
import { chatCompletionsUrl, RESERVED_PARAMS } from '@/lib/llm-defaults';

export const dynamic = 'force-dynamic';

/**
 * Admin: try an OpenAI-compatible backend with the settings currently in the editor (saved or not).
 * Body: { endpointUrl, model, apiKey?, extraParams?, botId? }. If apiKey is empty and botId is given,
 * the bot's stored key is used, so admins can test without re-typing it.
 * Always 200 with { ok, ... } so the UI can show the upstream's error verbatim.
 * Protected by ADMIN_PASSWORD (see middleware): it makes server-side requests to arbitrary URLs.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    endpointUrl?: string;
    model?: string;
    apiKey?: string;
    extraParams?: unknown;
    botId?: string;
  };

  const endpointUrl = body.endpointUrl?.trim() ?? '';
  const model = body.model?.trim() ?? '';
  try {
    const u = new URL(endpointUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
  } catch {
    return NextResponse.json({ ok: false, error: 'Enter a valid http(s) endpoint URL first.' });
  }

  let extraParams: Record<string, unknown> | undefined;
  if (body.extraParams && typeof body.extraParams === 'object' && !Array.isArray(body.extraParams)) {
    extraParams = Object.fromEntries(Object.entries(body.extraParams).filter(([k]) => !RESERVED_PARAMS.includes(k)));
  }

  let apiKey = body.apiKey?.trim() || undefined;
  if (!apiKey && body.botId) apiKey = (await getBotById(body.botId))?.agentBackend.apiKey;

  // Model list is best-effort: not every provider implements GET /models.
  let models: string[] | null = null;
  let modelsError: string | null = null;
  try {
    models = await listModels(endpointUrl, apiKey);
  } catch (e) {
    modelsError = (e as Error).message;
  }

  if (!model) {
    return NextResponse.json({ ok: false, url: chatCompletionsUrl(endpointUrl), models, modelsError, error: 'Enter a model name to send a test message.' });
  }

  const started = Date.now();
  try {
    const reply = await chatCompletion(
      { endpointUrl, apiKey, model, extraParams },
      [{ role: 'user', content: 'Reply with exactly one word: OK' }],
      60_000,
    );
    return NextResponse.json({ ok: true, url: chatCompletionsUrl(endpointUrl), latencyMs: Date.now() - started, reply, models, modelsError });
  } catch (e) {
    return NextResponse.json({ ok: false, url: chatCompletionsUrl(endpointUrl), latencyMs: Date.now() - started, error: (e as Error).message, models, modelsError });
  }
}
