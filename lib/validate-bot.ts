import type { BotConfig } from './bot-store';
import { IdentityConfig } from './identity-defaults';
import { DEFAULT_FORMATTING_RULES, RESERVED_PARAMS } from './llm-defaults';
import { DEFAULT_PAGE_CONTEXT, PageContextConfig } from './page-context';
import { normalizeDomain } from './origin';

export const BOT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{1,63}$/;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/**
 * `bot.agentBackend.apiKey` is only present when the admin typed a new key. The route merges it with
 * the stored key: absent = keep existing, `clearApiKey` = remove.
 */
type Result = { ok: true; bot: BotConfig; clearApiKey: boolean } | { ok: false; errors: string[] };

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** Validates and normalizes untrusted input from the admin UI into a BotConfig. */
export function validateBot(input: unknown): Result {
  const errors: string[] = [];
  const b = (input ?? {}) as Record<string, any>;
  const agent = (b.agentBackend ?? {}) as Record<string, unknown>;
  const security = (b.security ?? {}) as Record<string, unknown>;
  const theme = (b.theme ?? {}) as Record<string, unknown>;

  const id = str(b.id);
  if (!BOT_ID_PATTERN.test(id)) errors.push('Bot ID must be 2-64 chars: lowercase letters, digits, "_" or "-".');

  const name = str(b.name);
  if (!name || name.length > 100) errors.push('Name is required (max 100 chars).');
  const description = str(b.description).slice(0, 500);

  const type = agent.type;
  if (type !== 'mock_echo' && type !== 'openai_compatible') errors.push('Backend type must be mock_echo or openai_compatible.');
  const endpointUrl = str(agent.endpointUrl);
  if (endpointUrl) {
    try {
      const u = new URL(endpointUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error();
    } catch {
      errors.push('Endpoint URL must be an http(s) URL.');
    }
  }
  const systemPrompt = str(agent.systemPrompt);
  if (systemPrompt.length > 8000) errors.push('System prompt is too long (max 8000 chars).');
  const model = str(agent.model);
  if (model.length > 200) errors.push('Model name is too long.');
  if (type === 'openai_compatible') {
    if (!endpointUrl) errors.push('Endpoint URL is required for openai_compatible bots.');
    if (!model) errors.push('Model is required for openai_compatible bots.');
  }

  const apiKey = str(agent.apiKey);
  if (apiKey.length > 4096 || /\s/.test(apiKey)) errors.push('API key must not contain whitespace (max 4096 chars).');
  const clearApiKey = agent.clearApiKey === true;

  // Absent = the standard rules (every bot gets them by default); an explicit empty string turns them off.
  const formattingRules = agent.formattingRules === undefined ? DEFAULT_FORMATTING_RULES : str(agent.formattingRules);
  if (formattingRules.length > 4000) errors.push('Formatting rules are too long (max 4000 chars).');

  let extraParams: Record<string, unknown> | undefined;
  if (agent.extraParams !== undefined && agent.extraParams !== null) {
    const ep = agent.extraParams;
    if (typeof ep !== 'object' || Array.isArray(ep)) errors.push('Extra request parameters must be a JSON object.');
    else if (JSON.stringify(ep).length > 4000) errors.push('Extra request parameters are too large (max 4000 chars).');
    else {
      const reserved = Object.keys(ep).filter((k) => RESERVED_PARAMS.includes(k));
      if (reserved.length) errors.push(`Extra request parameters may not set ${reserved.join(', ')} (managed by the gateway).`);
      else if (Object.keys(ep).length) extraParams = ep as Record<string, unknown>;
    }
  }

  const rawDomains = Array.isArray(security.allowedDomains) ? security.allowedDomains : [];
  const allowedDomains: string[] = [];
  for (const d of rawDomains) {
    if (typeof d !== 'string' || !d.trim()) continue;
    const normalized = normalizeDomain(d);
    if (!normalized) errors.push(`Invalid allowed domain "${d}". Use scheme://host[:port], e.g. https://*.force.com`);
    else if (!allowedDomains.includes(normalized)) allowedDomains.push(normalized);
  }

  const primaryColor = str(theme.primaryColor);
  const headerTextColor = str(theme.headerTextColor);
  if (!HEX_COLOR.test(primaryColor)) errors.push('Primary color must be a hex color like #1d4ed8.');
  if (!HEX_COLOR.test(headerTextColor)) errors.push('Header text color must be a hex color like #ffffff.');
  const botTitle = str(theme.botTitle);
  if (!botTitle || botTitle.length > 60) errors.push('Bot title is required (max 60 chars).');
  const welcomeMessage = str(theme.welcomeMessage);
  if (welcomeMessage.length > 1000) errors.push('Welcome message is too long (max 1000 chars).');
  const position = theme.position;
  if (position !== 'bottom-right' && position !== 'bottom-left') errors.push('Position must be bottom-right or bottom-left.');

  const identity = validateIdentity(b.identity, errors);
  const hostContext = { allowedKeys: stringList(b.hostContext?.allowedKeys, 50, 100) };
  const pageContext = validatePageContext(b.pageContext, errors);

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    clearApiKey,
    bot: {
      id,
      name,
      description,
      agentBackend: {
        type: type as BotConfig['agentBackend']['type'],
        ...(endpointUrl ? { endpointUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
        ...(model ? { model } : {}),
        systemPrompt,
        ...(formattingRules ? { formattingRules } : {}),
        ...(extraParams ? { extraParams } : {}),
      },
      security: { allowedDomains },
      identity,
      hostContext,
      pageContext,
      theme: {
        primaryColor: primaryColor.toLowerCase(),
        headerTextColor: headerTextColor.toLowerCase(),
        botTitle,
        welcomeMessage,
        position: position as BotConfig['theme']['position'],
      },
    },
  };
}

function stringList(v: unknown, maxItems: number, maxLen: number): string[] {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  return [...new Set(arr.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter((x) => x && x.length <= maxLen))].slice(0, maxItems);
}

function validateIdentity(input: unknown, errors: string[]): IdentityConfig {
  const i = (input ?? {}) as Record<string, any>;
  const mode = i.mode === 'jwt' ? 'jwt' : 'anonymous';
  const claimsIn = (i.claims ?? {}) as Record<string, unknown>;
  const claim = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 200) : '');
  const identity: IdentityConfig = {
    mode,
    required: mode === 'jwt' && i.required === true,
    ...(typeof i.provider === 'string' && ['auth0', 'entra', 'oidc', 'dev_entra', 'dev_auth0'].includes(i.provider) ? { provider: i.provider as IdentityConfig['provider'] } : {}),
    claims: {
      userId: claim(claimsIn.userId) || 'sub',
      ...(claim(claimsIn.email) ? { email: claim(claimsIn.email) } : {}),
      ...(claim(claimsIn.name) ? { name: claim(claimsIn.name) } : {}),
      ...(claim(claimsIn.roles) ? { roles: claim(claimsIn.roles) } : {}),
      extra: stringList(claimsIn.extra, 20, 200),
    },
    forwardHeaders: i.forwardHeaders === true,
  };
  if (mode === 'anonymous') return identity;

  const isHttpsOrLocal = (u: string) => {
    try {
      const url = new URL(u);
      return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
    } catch {
      return false;
    }
  };
  const issuer = typeof i.issuer === 'string' ? i.issuer.trim() : '';
  if (!issuer || !isHttpsOrLocal(issuer)) errors.push('Identity: issuer must be an https URL (e.g. https://YOUR_TENANT.auth0.com/).');
  else if (/YOUR_|your-/.test(issuer)) errors.push('Identity: replace the placeholder in the issuer with your tenant value.');
  const audience = stringList(i.audience, 10, 300);
  if (!audience.length) errors.push('Identity: at least one audience is required, so tokens issued for other apps are rejected.');
  else if (audience.some((a) => /YOUR_|your-/.test(a))) errors.push('Identity: replace the placeholder in the audience with your API identifier / client id.');
  const jwksUrl = typeof i.jwksUrl === 'string' ? i.jwksUrl.trim() : '';
  if (jwksUrl && !isHttpsOrLocal(jwksUrl)) errors.push('Identity: JWKS URL must be https.');
  return { ...identity, issuer, audience, ...(jwksUrl ? { jwksUrl } : {}) };
}

function validatePageContext(input: unknown, errors: string[]): PageContextConfig {
  // Absent = screen awareness on with the standard exclusions (every bot gets it by default).
  if (input === undefined || input === null) return structuredClone(DEFAULT_PAGE_CONTEXT);
  const p = input as Record<string, unknown>;
  const maxChars = Number(p.maxChars);
  if (p.maxChars !== undefined && (!Number.isFinite(maxChars) || maxChars < 500 || maxChars > 20000)) {
    errors.push('Page context: max characters must be between 500 and 20000.');
  }
  return {
    mode: p.mode === 'auto' ? 'auto' : 'off',
    includeSelectors: stringList(p.includeSelectors, 20, 200),
    excludeSelectors: stringList(p.excludeSelectors, 40, 200),
    maxChars: Number.isFinite(maxChars) ? Math.min(Math.max(Math.round(maxChars), 500), 20000) : 6000,
    redact: p.redact !== false,
  };
}
