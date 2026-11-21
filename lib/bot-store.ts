import { promises as fs } from 'fs';
import path from 'path';
import { HostContextConfig, IDENTITY_PRESETS, identityOf, IdentityConfig } from './identity-defaults';
import { DEFAULT_EXTRA_PARAMS, DEFAULT_FORMATTING_RULES, DEFAULT_MODEL, DOCKER_MODEL_RUNNER_URL, maskKey } from './llm-defaults';
import { DEFAULT_PAGE_CONTEXT, pageContextOf, PageContextConfig } from './page-context';

export interface BotConfig {
  id: string;
  name: string;
  description: string;
  agentBackend: {
    type: 'openai_compatible' | 'mock_echo';
    /** OpenAI-compatible base URL (…/v1) or full …/chat/completions URL. Required for openai_compatible. */
    endpointUrl?: string;
    /** Sent as "Authorization: Bearer <apiKey>". Never returned by any API; admins see a masked preview. */
    apiKey?: string;
    model?: string;
    systemPrompt: string;
    /** Appended to systemPrompt (chat-widget formatting guidance). */
    formattingRules?: string;
    /** Merged into the request body, e.g. {"temperature":0.3} or llama.cpp's chat_template_kwargs. */
    extraParams?: Record<string, unknown>;
  };
  security: {
    allowedDomains: string[]; // e.g. ["http://localhost:3000", "https://company.com", "https://*.force.com"]
  };
  /** Who the user is: anonymous visitor, or verified from the host site's Auth0 / Entra ID / OIDC token. */
  identity?: IdentityConfig;
  /** Which NextBot.setContext() keys reach the model. */
  hostContext?: HostContextConfig;
  /** Whether/how the bot reads the page it's embedded on. */
  pageContext?: PageContextConfig;
  theme: {
    primaryColor: string;
    headerTextColor: string;
    botTitle: string;
    welcomeMessage: string;
    position: 'bottom-right' | 'bottom-left';
  };
}

/** The subset of a bot that is safe to expose to any allowed host page (no prompts, endpoints, keys or IdP settings). */
export interface PublicBotConfig {
  id: string;
  name: string;
  theme: BotConfig['theme'];
  identity: { mode: IdentityConfig['mode']; required: boolean };
  /** widget.js needs this to capture the page. */
  pageContext: PageContextConfig;
}

/** What the admin UI receives: the API key is replaced by a masked preview. */
export type AdminBotConfig = Omit<BotConfig, 'agentBackend'> & {
  agentBackend: Omit<BotConfig['agentBackend'], 'apiKey'> & { apiKeyPreview?: string };
};

export function toAdminConfig(bot: BotConfig): AdminBotConfig {
  const { apiKey, ...agentBackend } = bot.agentBackend;
  return { ...bot, agentBackend: { ...agentBackend, ...(apiKey ? { apiKeyPreview: maskKey(apiKey) } : {}) } };
}

export function toPublicConfig(bot: BotConfig): PublicBotConfig {
  const identity = identityOf(bot);
  return {
    id: bot.id,
    name: bot.name,
    theme: bot.theme,
    identity: { mode: identity.mode, required: identity.mode === 'jwt' && identity.required },
    pageContext: pageContextOf(bot),
  };
}

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'bots.json');

const GEMMA_ON_DOCKER_MODEL_RUNNER = {
  type: 'openai_compatible' as const,
  endpointUrl: DOCKER_MODEL_RUNNER_URL,
  model: DEFAULT_MODEL,
  formattingRules: DEFAULT_FORMATTING_RULES,
  extraParams: DEFAULT_EXTRA_PARAMS,
};

const LOCAL_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

function presetIdentity(key: 'dev_entra' | 'dev_auth0', required: boolean): IdentityConfig {
  const p = IDENTITY_PRESETS.find((x) => x.key === key)!;
  return { mode: 'jwt', required, provider: key, issuer: p.issuer, audience: [p.audience], claims: p.claims, forwardHeaders: false };
}

/**
 * Seed bots run on Gemma 4 via Docker Model Runner. Every setting is stored on the bot itself and
 * editable in the admin UI. The two signed-in bots trust the built-in *test* IdP: replace issuer and
 * audience with your real Auth0 / Entra ID tenant values before production.
 *
 * Used to seed data/bots.json when it does not exist yet (e.g. a fresh, empty Docker volume). */
export const SEED_BOTS: BotConfig[] = [
  {
    id: 'bot_internal_1',
    name: 'Internal Angular Portal 1',
    description: 'Employee self-service assistant embedded in the internal Angular portal (employees sign in with Entra ID).',
    agentBackend: {
      ...GEMMA_ON_DOCKER_MODEL_RUNNER,
      systemPrompt: 'You are an internal IT and HR helpdesk assistant. Be concise and cite internal policy names when relevant. Address the signed-in employee by first name.',
    },
    security: { allowedDomains: [...LOCAL_ORIGINS, 'http://localhost:4200'] },
    identity: presetIdentity('dev_entra', true),
    hostContext: { allowedKeys: [] },
    pageContext: { ...DEFAULT_PAGE_CONTEXT, includeSelectors: ['main'] },
    theme: {
      primaryColor: '#1d4ed8',
      headerTextColor: '#ffffff',
      botTitle: 'Portal Assistant',
      welcomeMessage: 'Hi! I can help with IT tickets, HR policies and portal navigation. What do you need?',
      position: 'bottom-right',
    },
  },
  {
    id: 'bot_wordpress',
    name: 'Public WordPress Site',
    description: 'Public-facing FAQ and lead-capture bot for the marketing WordPress site (guests, plus customers who log in via Auth0).',
    agentBackend: {
      ...GEMMA_ON_DOCKER_MODEL_RUNNER,
      systemPrompt: 'You are a friendly website assistant. Answer product questions and offer to connect visitors with sales.',
    },
    security: { allowedDomains: [...LOCAL_ORIGINS, 'https://www.example.com'] },
    // Open website: tokens are verified when a customer is logged in, everyone else chats as a guest.
    identity: presetIdentity('dev_auth0', false),
    hostContext: { allowedKeys: [] },
    pageContext: { ...DEFAULT_PAGE_CONTEXT, includeSelectors: ['article'] },
    theme: {
      primaryColor: '#059669',
      headerTextColor: '#ffffff',
      botTitle: 'Ask Us Anything',
      welcomeMessage: 'Welcome! Have a question about our products or services? Ask away.',
      position: 'bottom-left',
    },
  },
  {
    id: 'bot_salesforce',
    name: 'Salesforce Call Center Copilot',
    description: 'Screen-aware copilot for insurance call-center agents working policy records in Salesforce (agents sign in via Auth0).',
    agentBackend: {
      ...GEMMA_ON_DOCKER_MODEL_RUNNER,
      systemPrompt:
        'You are a copilot for insurance call-center agents working in Salesforce. Answer questions about the policy, policyholder, coverage, billing and claims shown on the agent\'s screen. Quote exact values (policy numbers, names, amounts, dates) from the screen. If the answer is not on screen, say so and suggest where to look.',
    },
    security: {
      allowedDomains: [...LOCAL_ORIGINS, 'https://*.force.com', 'https://*.lightning.force.com', 'https://*.my.salesforce.com'],
    },
    identity: presetIdentity('dev_auth0', true),
    hostContext: { allowedKeys: [] },
    pageContext: { ...DEFAULT_PAGE_CONTEXT, excludeSelectors: [...DEFAULT_PAGE_CONTEXT.excludeSelectors, '.global-header', '.app-nav', '.harness-notes'] },
    theme: {
      primaryColor: '#0176d3',
      headerTextColor: '#ffffff',
      botTitle: 'Policy Copilot',
      welcomeMessage: 'Hi! I can see the record on your screen. Ask me about this policy, the policyholder, coverage or claims.',
      position: 'bottom-right',
    },
  },
];

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await writeAll(SEED_BOTS);
  }
}

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 30;

async function writeAll(bots: BotConfig[]): Promise<void> {
  await backupCurrent();
  // Write-then-rename so a crash mid-write never leaves a truncated bots.json.
  const tmp = `${DATA_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(bots, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, DATA_FILE);
}

/** Before every write, keep a timestamped copy of bots.json in data/backups/ (newest MAX_BACKUPS kept). */
async function backupCurrent(): Promise<void> {
  try {
    const current = await fs.readFile(DATA_FILE, 'utf8');
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await fs.writeFile(path.join(BACKUP_DIR, `bots-${stamp}.json`), current, 'utf8');
    const files = (await fs.readdir(BACKUP_DIR)).filter((f) => /^bots-.*\.json$/.test(f)).sort();
    await Promise.all(files.slice(0, Math.max(0, files.length - MAX_BACKUPS)).map((f) => fs.unlink(path.join(BACKUP_DIR, f))));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[bot-store] backup failed:', err);
  }
}

export async function getBots(): Promise<BotConfig[]> {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error(`${DATA_FILE} must contain a JSON array of bots`);
  return parsed as BotConfig[];
}

export async function getBotById(id: string): Promise<BotConfig | null> {
  const bots = await getBots();
  return bots.find((b) => b.id === id) ?? null;
}

// Serialize writes within this process so concurrent saves can't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();

/** Insert or replace (by id). Callers must validate the bot first (see lib/validate-bot.ts). */
export async function saveBot(bot: BotConfig): Promise<BotConfig> {
  await saveBots([bot]);
  return bot;
}

/** Insert or replace several bots in one atomic write (used by import). */
export function saveBots(toSave: BotConfig[]): Promise<void> {
  const run = writeChain.then(async () => {
    const bots = await getBots();
    for (const bot of toSave) {
      const index = bots.findIndex((b) => b.id === bot.id);
      if (index === -1) bots.push(bot);
      else bots[index] = bot;
    }
    await writeAll(bots);
  });
  writeChain = run.catch(() => undefined);
  return run;
}
