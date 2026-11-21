import { NextRequest, NextResponse } from 'next/server';
import { logActivity } from '@/lib/activity';
import { BotConfig, getBotById } from '@/lib/bot-store';
import { describeUserForModel, filterHostContext, identityHeaders, publicUser, resolveIdentity } from '@/lib/identity';
import { identityOf, ResolvedUser } from '@/lib/identity-defaults';
import { chatCompletion } from '@/lib/llm';
import { describeSnapshotForModel, pageContextOf, PageSnapshot, sanitizeSnapshot } from '@/lib/page-context';
import { checkOrigin, parseContext } from '@/lib/request-guard';

export const dynamic = 'force-dynamic';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

const MAX_MESSAGES = 40;
const MAX_CONTENT = 4000;

/**
 * Body: { botId, messages, context, pageSnapshot? }
 *  - context: host context from NextBot.setContext() plus authToken / anonymousId / pageUrl… (unverified)
 *  - pageSnapshot: what widget.js captured from the visible page just before this message
 */
export async function POST(req: NextRequest) {
  let body: { botId?: unknown; messages?: unknown; context?: unknown; pageSnapshot?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const botId = typeof body.botId === 'string' ? body.botId : '';
  const bot = botId ? await getBotById(botId) : null;
  if (!bot) return NextResponse.json({ error: `Unknown bot "${botId}"` }, { status: 404 });

  const queryBotId = req.nextUrl.searchParams.get('botId');
  if (queryBotId && queryBotId !== botId) return NextResponse.json({ error: 'botId mismatch' }, { status: 400 });

  const messages = parseMessages(body.messages);
  if (!messages) return NextResponse.json({ error: 'messages must be a non-empty array of {role, content}' }, { status: 400 });

  const context = parseContext(body.context);
  const hostContext = filterHostContext(bot.hostContext, context);
  const snapshot = sanitizeSnapshot(body.pageSnapshot, pageContextOf(bot));
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const { requestOrigin, error: originError } = checkOrigin(req, bot, context);
  const base = {
    botId: bot.id,
    origin: (typeof context.hostOrigin === 'string' && context.hostOrigin) || requestOrigin,
    pageUrl: typeof context.pageUrl === 'string' ? context.pageUrl : undefined,
    message: lastUser,
    context: hostContext,
    ...(snapshot ? { pageSnapshot: snapshotForLog(snapshot) } : {}),
  };
  if (originError) {
    logActivity({ ...base, type: 'blocked', httpStatus: 403, error: originError });
    return NextResponse.json({ error: originError }, { status: 403 });
  }

  // Who is this? Verified from the host site's Auth0 / Entra ID / OIDC token, or anonymous.
  const identity = await resolveIdentity(bot, context);
  if (!identity.ok) {
    logActivity({ ...base, type: 'blocked', httpStatus: identity.status, error: `${identity.code}: ${identity.error}` });
    return NextResponse.json({ error: identity.error, code: identity.code }, { status: identity.status });
  }
  const user = identity.user;
  const who = userForLog(user);

  const backend = bot.agentBackend.type;
  const model = backend === 'openai_compatible' ? bot.agentBackend.model : undefined;
  const started = Date.now();
  try {
    const reply =
      backend === 'openai_compatible'
        ? await callOpenAICompatible(bot, messages, user, hostContext, snapshot)
        : mockEcho(bot, lastUser, user, hostContext, snapshot);
    logActivity({ ...base, ...who, type: 'chat', httpStatus: 200, reply, latencyMs: Date.now() - started, backend, model, ...(identity.warning ? { error: identity.warning } : {}) });
    return NextResponse.json({ botId: bot.id, reply, user: publicUser(user) });
  } catch (err) {
    console.error(`[chat] ${bot.id} backend error:`, err);
    logActivity({ ...base, ...who, type: 'error', httpStatus: 502, error: (err as Error).message, latencyMs: Date.now() - started, backend, model });
    return NextResponse.json({ error: 'The agent backend failed to respond. Please try again.' }, { status: 502 });
  }
}

function parseMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out: ChatMessage[] = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    out.push({ role: m.role, content: m.content.slice(0, MAX_CONTENT) });
  }
  return out;
}

const userForLog = (u: ResolvedUser) => ({ userId: u.id, userName: u.name, userEmail: u.email, anonymous: u.anonymous });

/** Page snapshots can contain customer PII: the log keeps a bounded excerpt, not the full text. */
const snapshotForLog = (s: PageSnapshot) => ({
  title: s.title,
  selection: s.selection,
  fields: s.fields?.slice(0, 40),
  textExcerpt: s.text.slice(0, 600),
  textChars: s.text.length,
  truncated: s.truncated,
});

function mockEcho(bot: BotConfig, lastUser: string, user: ResolvedUser, hostContext: Record<string, unknown>, snapshot: PageSnapshot | null): string {
  return [
    `[${bot.id}] "${bot.name}" handled this via the mock_echo backend.`,
    ``,
    `You said: "${lastUser}"`,
    `User: ${JSON.stringify(user)}`,
    `Host context: ${JSON.stringify(hostContext, null, 2)}`,
    snapshot ? `Page snapshot: ${snapshot.fields?.length ?? 0} fields, ${snapshot.text.length} chars of text${snapshot.selection ? `, selection "${snapshot.selection}"` : ''}` : 'Page snapshot: none',
  ].join('\n');
}

async function callOpenAICompatible(
  bot: BotConfig,
  messages: ChatMessage[],
  user: ResolvedUser,
  hostContext: Record<string, unknown>,
  snapshot: PageSnapshot | null,
): Promise<string> {
  const { endpointUrl, apiKey, model, extraParams, systemPrompt, formattingRules } = bot.agentBackend;
  if (!endpointUrl || !model) throw new Error(`Bot ${bot.id} has no endpoint URL or model configured`);

  const system = [
    systemPrompt,
    formattingRules,
    describeUserForModel(user),
    Object.keys(hostContext).length ? `Context provided by the host application (unverified): ${JSON.stringify(hostContext)}` : '',
    snapshot ? describeSnapshotForModel(snapshot) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const headers = identityOf(bot).forwardHeaders ? identityHeaders(user) : undefined;
  return chatCompletion({ endpointUrl, apiKey, model, extraParams, headers }, [{ role: 'system', content: system }, ...messages]);
}
