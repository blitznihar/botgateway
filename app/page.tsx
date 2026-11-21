'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdminBotConfig } from '@/lib/bot-store';
import {
  chatCompletionsUrl,
  DEFAULT_EXTRA_PARAMS,
  DEFAULT_FORMATTING_RULES,
  DEFAULT_MODEL,
  DOCKER_MODEL_RUNNER_URL,
} from '@/lib/llm-defaults';
import { ANONYMOUS_IDENTITY } from '@/lib/identity-defaults';
import { DEFAULT_PAGE_CONTEXT, PAGE_CONTEXT_OFF } from '@/lib/page-context';
import ContextSection from './_admin/ContextSection';
import IdentitySection from './_admin/IdentitySection';
import ImportPanel from './_admin/ImportPanel';
import { Draft, Field, splitList } from './_admin/shared';
import styles from './admin.module.css';

const TEST_HOSTS = [
  { file: 'angular-mock.html', label: 'Angular portal' },
  { file: 'wordpress-mock.html', label: 'WordPress site' },
  { file: 'salesforce-mock.html', label: 'Salesforce record page' },
];

type BotConfig = AdminBotConfig;

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** One-click starting points. Every value lands in visible, editable fields. */
const PRESETS: { label: string; endpointUrl: string; model: string; extraParams: Record<string, unknown>; keyHint: string }[] = [
  { label: 'Docker Model Runner · Gemma 4', endpointUrl: DOCKER_MODEL_RUNNER_URL, model: DEFAULT_MODEL, extraParams: DEFAULT_EXTRA_PARAMS, keyHint: 'No key needed' },
  { label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1', model: '', extraParams: {}, keyHint: 'sk-…' },
  { label: 'OpenRouter', endpointUrl: 'https://openrouter.ai/api/v1', model: '', extraParams: {}, keyHint: 'sk-or-…' },
  { label: 'Ollama (on host)', endpointUrl: 'http://host.docker.internal:11434/v1', model: '', extraParams: {}, keyHint: 'No key needed' },
];

function parseExtraParams(text: string): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: null };
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Extra request parameters must be a JSON object, e.g. {"temperature": 0.3}' };
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: `Extra request parameters are not valid JSON: ${(e as Error).message}` };
  }
}

type TestResult = { ok: boolean; url?: string; latencyMs?: number; reply?: string; error?: string; models?: string[] | null; modelsError?: string | null };

/**
 * New bots start with the full feature set of the template bot (the Salesforce copilot): identity verification,
 * screen awareness, host-context rules and model settings. Only identity/branding fields start blank.
 */
const TEMPLATE_BOT_ID = 'bot_salesforce';

function blankBot(template: BotConfig | null): Draft {
  const base = blankBotDefaults();
  if (!template) return base;
  const t = toDraft(template);
  return {
    ...base,
    agentBackend: { ...t.agentBackend, apiKeyPreview: undefined, systemPrompt: base.agentBackend.systemPrompt },
    extraParamsText: t.extraParamsText,
    identity: t.identity,
    audienceText: t.audienceText,
    extraClaimsText: t.extraClaimsText,
    pageContext: { ...t.pageContext, includeSelectors: [] },
    includeText: '',
    excludeText: t.excludeText,
    hostContext: t.hostContext,
    hostKeysText: t.hostKeysText,
  };
}

const blankBotDefaults = (): Draft => ({
  id: '',
  name: '',
  description: '',
  agentBackend: {
    type: 'openai_compatible',
    endpointUrl: DOCKER_MODEL_RUNNER_URL,
    model: DEFAULT_MODEL,
    systemPrompt: 'You are a helpful assistant.',
    formattingRules: DEFAULT_FORMATTING_RULES,
  },
  security: { allowedDomains: [] },
  identity: structuredClone(ANONYMOUS_IDENTITY),
  hostContext: { allowedKeys: [] },
  pageContext: structuredClone(DEFAULT_PAGE_CONTEXT),
  theme: {
    primaryColor: '#4f46e5',
    headerTextColor: '#ffffff',
    botTitle: 'Assistant',
    welcomeMessage: 'Hi there! How can I help you today?',
    position: 'bottom-right',
  },
  domainsText: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  extraParamsText: pretty(DEFAULT_EXTRA_PARAMS),
  apiKeyInput: '',
  clearApiKey: false,
  audienceText: '',
  extraClaimsText: '',
  includeText: '',
  excludeText: DEFAULT_PAGE_CONTEXT.excludeSelectors.join(', '),
  hostKeysText: '',
});

function toDraft(bot: BotConfig): Draft {
  const identity = structuredClone(bot.identity ?? ANONYMOUS_IDENTITY);
  const pageContext = structuredClone(bot.pageContext ?? PAGE_CONTEXT_OFF);
  return {
    ...bot,
    identity,
    pageContext,
    hostContext: bot.hostContext ?? { allowedKeys: [] },
    agentBackend: { endpointUrl: '', model: '', formattingRules: '', ...bot.agentBackend },
    domainsText: bot.security.allowedDomains.join(', '),
    extraParamsText: bot.agentBackend.extraParams ? pretty(bot.agentBackend.extraParams) : '',
    apiKeyInput: '',
    clearApiKey: false,
    audienceText: (identity.audience ?? []).join(', '),
    extraClaimsText: (identity.claims.extra ?? []).join(', '),
    includeText: pageContext.includeSelectors.join(', '),
    excludeText: pageContext.excludeSelectors.join(', '),
    hostKeysText: (bot.hostContext?.allowedKeys ?? []).join(', '),
  };
}

/** Payload for POST /api/bots. apiKey is only sent when a new one was typed. */
function fromDraft({
  domainsText,
  extraParamsText,
  apiKeyInput,
  clearApiKey,
  audienceText,
  extraClaimsText,
  includeText,
  excludeText,
  hostKeysText,
  ...bot
}: Draft) {
  const { apiKeyPreview: _preview, extraParams: _old, ...agentBackend } = bot.agentBackend;
  const parsed = parseExtraParams(extraParamsText);
  return {
    ...bot,
    agentBackend: {
      ...agentBackend,
      extraParams: parsed.ok ? parsed.value : extraParamsText,
      ...(apiKeyInput.trim() ? { apiKey: apiKeyInput.trim() } : {}),
      ...(clearApiKey ? { clearApiKey: true } : {}),
    },
    security: { ...bot.security, allowedDomains: domainsText.split(/[,\s]+/).map((d) => d.trim()).filter(Boolean) },
    identity: { ...bot.identity, audience: splitList(audienceText), claims: { ...bot.identity.claims, extra: splitList(extraClaimsText) } },
    pageContext: { ...bot.pageContext, includeSelectors: splitList(includeText), excludeSelectors: splitList(excludeText) },
    hostContext: { allowedKeys: splitList(hostKeysText) },
  };
}

export default function AdminPage() {
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null); // null + draft => creating new
  const [draft, setDraft] = useState<Draft | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<string>('');
  const [importOpen, setImportOpen] = useState(false);
  const errorsRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);
  const [origin, setOrigin] = useState('http://localhost:3000');
  const [copied, setCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const loadBots = useCallback(async () => {
    const res = await fetch('/api/bots', { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load bots (${res.status})`);
    const list: BotConfig[] = await res.json();
    setBots(list);
    return list;
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    loadBots()
      .then((list) => {
        const wanted = new URLSearchParams(window.location.search).get('botId');
        const initial = list.find((b) => b.id === wanted) ?? list[0];
        if (initial) {
          setSelectedId(initial.id);
          setDraft(toDraft(initial));
        }
      })
      .catch((e: Error) => setErrors([e.message]));
  }, [loadBots]);

  const savedBot = useMemo(() => bots.find((b) => b.id === selectedId) ?? null, [bots, selectedId]);
  const isNew = draft !== null && savedBot === null;
  const dirty = useMemo(
    () => !!draft && (!savedBot || JSON.stringify(fromDraft(draft)) !== JSON.stringify(fromDraft(toDraft(savedBot)))),
    [draft, savedBot],
  );

  function confirmDiscard() {
    return !dirty || window.confirm('Discard unsaved changes?');
  }

  function selectBot(bot: BotConfig) {
    if (bot.id === selectedId || !confirmDiscard()) return;
    setSelectedId(bot.id);
    setDraft(toDraft(bot));
    setErrors([]);
    setStatus('');
    setTestResult(null);
  }

  function createNew() {
    if (!confirmDiscard()) return;
    setSelectedId(null);
    const template = bots.find((b) => b.id === TEMPLATE_BOT_ID) ?? null;
    setDraft(blankBot(template));
    setStatus(template ? `Feature settings (sign-in, screen awareness, context, model) copied from “${template.name}”.` : '');
    setErrors([]);
    setTestResult(null);
  }

  async function testConnection() {
    if (!draft) return;
    const parsed = parseExtraParams(draft.extraParamsText);
    if (!parsed.ok) {
      setTestResult({ ok: false, error: parsed.error });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/test-backend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpointUrl: draft.agentBackend.endpointUrl,
          model: draft.agentBackend.model,
          apiKey: draft.clearApiKey ? '' : draft.apiKeyInput,
          extraParams: parsed.value,
          botId: savedBot && !draft.clearApiKey ? savedBot.id : undefined,
        }),
      });
      setTestResult(await res.json());
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTesting(false);
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    update((d) => {
      d.agentBackend.endpointUrl = p.endpointUrl;
      d.agentBackend.model = p.model;
      d.extraParamsText = Object.keys(p.extraParams).length ? pretty(p.extraParams) : '';
    });
    setTestResult(null);
  }

  function update(mutator: (d: Draft) => void) {
    setDraft((d) => {
      if (!d) return d;
      const next: Draft = structuredClone(d);
      mutator(next);
      return next;
    });
  }

  /** Errors are rendered at the top of a long form: always bring them into view. */
  function showErrors(list: string[]) {
    setErrors(list);
    requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  async function save() {
    if (!draft) return;
    const parsed = parseExtraParams(draft.extraParamsText);
    const pre: string[] = [];
    if (!parsed.ok) pre.push(parsed.error);
    if (!draft.id.trim()) pre.push('Bot ID is required (Identity section at the top).');
    if (!draft.name.trim()) pre.push('Name is required (Identity section at the top).');
    if (isNew && bots.some((b) => b.id === draft.id.trim())) pre.push(`A bot with id "${draft.id}" already exists. Pick another Bot ID.`);
    if (pre.length) {
      showErrors(pre);
      return;
    }
    setSaving(true);
    setErrors([]);
    setStatus('');
    try {
      const res = await fetch('/api/bots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fromDraft(draft)),
      });
      const data = await res.json();
      if (!res.ok) {
        showErrors(data.errors ?? [data.error ?? `Save failed (${res.status})`]);
        return;
      }
      await loadBots();
      setSelectedId(data.id);
      setDraft(toDraft(data));
      setPreviewVersion((v) => v + 1);
      setStatus(`Saved ${new Date().toLocaleTimeString()} · written to data/bots.json (previous version backed up in data/backups/)`);
    } catch (e) {
      showErrors([`Could not reach the server, nothing was saved: ${(e as Error).message}`]);
    } finally {
      setSaving(false);
    }
  }

  const botId = savedBot?.id ?? '';
  // Test hosts sign in with the dev IdP flavour that matches this bot's identity settings.
  const idpParam = savedBot?.identity?.mode === 'jwt' ? (savedBot.identity.provider === 'dev_entra' || savedBot.identity.provider === 'entra' ? '&idp=entra' : '&idp=auth0') : '';
  const snippet = `<script src="${origin}/widget.js" data-bot-id="${botId}" async></script>`;
  const crossOrigin = useMemo(() => {
    try {
      const u = new URL(origin);
      if (u.hostname === 'localhost') u.hostname = '127.0.0.1';
      else if (u.hostname === '127.0.0.1') u.hostname = 'localhost';
      else return null;
      return u.origin;
    } catch {
      return null;
    }
  }, [origin]);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
    } catch {
      window.prompt('Copy the embed snippet:', snippet);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>◆</span> Bot Control Plane
        </div>
        <nav className={styles.nav}>
          <Link href="/" className={styles.navActive}>
            Bots
          </Link>
          <Link href="/activity">Activity</Link>
        </nav>
      </header>

      <div className={styles.layout}>
        {/* ---------------- Sidebar ---------------- */}
        <aside className={styles.sidebar}>
          <button className={styles.primaryBtn} onClick={createNew}>
            + Create New Bot
          </button>
          <div className={styles.transferRow}>
            <button type="button" className={styles.secondaryBtn} onClick={() => setImportOpen(true)}>
              Import JSON
            </button>
            <a className={styles.secondaryBtn} href="/api/admin/bots/export" download>
              Export all
            </a>
          </div>
          <ul className={styles.botList}>
            {bots.map((b) => (
              <li key={b.id}>
                <button className={`${styles.botItem} ${b.id === selectedId ? styles.botItemActive : ''}`} onClick={() => selectBot(b)}>
                  <span className={styles.swatch} style={{ background: b.theme.primaryColor }} />
                  <span className={styles.botItemText}>
                    <strong>{b.name}</strong>
                    <code>{b.id}</code>
                  </span>
                </button>
              </li>
            ))}
            {isNew && (
              <li>
                <div className={`${styles.botItem} ${styles.botItemActive}`}>
                  <span className={styles.swatch} style={{ background: draft.theme.primaryColor }} />
                  <span className={styles.botItemText}>
                    <strong>{draft.name || 'New bot'}</strong>
                    <code>{draft.id || 'unsaved'}</code>
                  </span>
                </div>
              </li>
            )}
          </ul>
        </aside>

        {/* ---------------- Editor ---------------- */}
        <main className={styles.editor}>
          {!draft ? (
            <p className={styles.muted}>{errors.length ? errors.join(' ') : 'Loading bots…'}</p>
          ) : (
            <>
              <div className={styles.editorHead}>
                <h1>
                  {isNew ? 'Create bot' : draft.name}
                  {savedBot && (
                    <>
                      <Link className={styles.activityLink} href={`/activity?botId=${encodeURIComponent(savedBot.id)}`}>
                        View activity →
                      </Link>
                      <a className={styles.activityLink} href={`/api/admin/bots/export?ids=${encodeURIComponent(savedBot.id)}`} download>
                        Export JSON ↓
                      </a>
                    </>
                  )}
                </h1>
                <button className={styles.primaryBtn} onClick={save} disabled={saving || !dirty}>
                  {saving ? 'Saving…' : isNew ? 'Create bot' : dirty ? 'Save changes' : 'Saved'}
                </button>
              </div>
              <div ref={errorsRef}>
                {errors.length > 0 && (
                  <ul className={styles.errors} role="alert">
                    {errors.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </div>
              {status && <p className={styles.status}>{status}</p>}

              <section className={styles.section}>
                <h2>Identity</h2>
                <div className={styles.grid2}>
                  <Field label="Bot ID (slug)" hint={isNew ? 'Lowercase letters, digits, _ and -. Cannot be changed later.' : 'Immutable: embedded snippets reference it.'}>
                    <input value={draft.id} disabled={!isNew} placeholder="bot_my_portal" onChange={(e) => update((d) => void (d.id = e.target.value.toLowerCase()))} />
                  </Field>
                  <Field label="Name">
                    <input value={draft.name} placeholder="My Portal Assistant" onChange={(e) => update((d) => void (d.name = e.target.value))} />
                  </Field>
                </div>
                <Field label="Description">
                  <input value={draft.description} onChange={(e) => update((d) => void (d.description = e.target.value))} />
                </Field>
              </section>

              <section className={styles.section}>
                <h2>Appearance</h2>
                <div className={styles.grid2}>
                  <Field label="Primary color">
                    <ColorInput value={draft.theme.primaryColor} onChange={(v) => update((d) => void (d.theme.primaryColor = v))} />
                  </Field>
                  <Field label="Header text color">
                    <ColorInput value={draft.theme.headerTextColor} onChange={(v) => update((d) => void (d.theme.headerTextColor = v))} />
                  </Field>
                  <Field label="Bot title">
                    <input value={draft.theme.botTitle} onChange={(e) => update((d) => void (d.theme.botTitle = e.target.value))} />
                  </Field>
                  <Field label="Screen position">
                    <select
                      value={draft.theme.position}
                      onChange={(e) => update((d) => void (d.theme.position = e.target.value as Draft['theme']['position']))}
                    >
                      <option value="bottom-right">Bottom right</option>
                      <option value="bottom-left">Bottom left</option>
                    </select>
                  </Field>
                </div>
                <Field label="Welcome message">
                  <textarea rows={2} value={draft.theme.welcomeMessage} onChange={(e) => update((d) => void (d.theme.welcomeMessage = e.target.value))} />
                </Field>
              </section>

              <section className={styles.section}>
                <h2>Exposure &amp; Security</h2>
                <Field
                  label="Allowed domains"
                  hint="Comma-separated origins allowed to embed this bot (CSP frame-ancestors + CORS). Wildcards: https://*.force.com"
                >
                  <textarea
                    rows={2}
                    value={draft.domainsText}
                    placeholder="http://localhost:3000, https://company.com, https://*.force.com"
                    onChange={(e) => update((d) => void (d.domainsText = e.target.value))}
                  />
                </Field>
              </section>

              <IdentitySection key={`id-${selectedId ?? 'new'}`} draft={draft} update={update} />
              <ContextSection draft={draft} update={update} />

              <section className={styles.section}>
                <h2>Agent Routing</h2>
                <Field label="Backend type">
                  <select
                    value={draft.agentBackend.type}
                    onChange={(e) => update((d) => void (d.agentBackend.type = e.target.value as Draft['agentBackend']['type']))}
                  >
                    <option value="openai_compatible">openai_compatible: any OpenAI-compatible Chat Completions API</option>
                    <option value="mock_echo">mock_echo: echoes the request (testing, no model)</option>
                  </select>
                </Field>

                {draft.agentBackend.type === 'openai_compatible' && (
                  <>
                    <div className={styles.presets}>
                      <span className={styles.hint}>Quick fill:</span>
                      {PRESETS.map((p) => (
                        <button key={p.label} type="button" className={styles.chip} onClick={() => applyPreset(p)}>
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <Field
                      label="Endpoint URL"
                      hint={
                        draft.agentBackend.endpointUrl
                          ? `Requests go to ${chatCompletionsUrl(draft.agentBackend.endpointUrl)}`
                          : 'Base URL (…/v1) or full …/chat/completions URL of any OpenAI-compatible API.'
                      }
                    >
                      <input
                        value={draft.agentBackend.endpointUrl ?? ''}
                        placeholder="https://api.openai.com/v1"
                        spellCheck={false}
                        onChange={(e) => update((d) => void (d.agentBackend.endpointUrl = e.target.value))}
                      />
                    </Field>

                    <div className={styles.grid2}>
                      <Field label="Model" hint="Exact model id the endpoint expects. Use Test connection to list them.">
                        <input
                          value={draft.agentBackend.model ?? ''}
                          placeholder="ai/gemma4"
                          spellCheck={false}
                          list="model-options"
                          onChange={(e) => update((d) => void (d.agentBackend.model = e.target.value))}
                        />
                        <datalist id="model-options">
                          {testResult?.models?.map((m) => <option key={m} value={m} />)}
                        </datalist>
                      </Field>
                      <div>
                      <Field
                        label="API key"
                        hint={
                          draft.agentBackend.apiKeyPreview && !draft.clearApiKey
                            ? 'Saved key is kept unless you type a new one.'
                            : 'Optional. Sent as "Authorization: Bearer <key>". Stored server-side, never shown again.'
                        }
                      >
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={draft.apiKeyInput}
                          disabled={draft.clearApiKey}
                          placeholder={draft.agentBackend.apiKeyPreview ? `Saved: ${draft.agentBackend.apiKeyPreview}` : 'No key'}
                          onChange={(e) => update((d) => void (d.apiKeyInput = e.target.value))}
                        />
                      </Field>
                      {draft.agentBackend.apiKeyPreview && (
                        <label className={`${styles.checkbox} ${styles.underField}`}>
                          <input type="checkbox" checked={draft.clearApiKey} onChange={(e) => update((d) => void ((d.clearApiKey = e.target.checked), (d.apiKeyInput = '')))} />
                          Remove saved key
                        </label>
                      )}
                      </div>
                    </div>

                    <div className={styles.testRow}>
                      <button type="button" className={styles.secondaryBtn} onClick={testConnection} disabled={testing || !draft.agentBackend.endpointUrl}>
                        {testing ? 'Testing…' : 'Test connection'}
                      </button>
                      <span className={styles.hint}>Uses the values above, including unsaved changes.</span>
                    </div>
                    {testResult && (
                      <div className={`${styles.testResult} ${testResult.ok ? styles.testOk : styles.testFail}`} role="status">
                        <strong>{testResult.ok ? `✓ Connected · ${((testResult.latencyMs ?? 0) / 1000).toFixed(1)}s` : '✗ Failed'}</strong>
                        {testResult.ok ? <span> · model replied “{testResult.reply?.slice(0, 80)}”</span> : <div className={styles.testError}>{testResult.error}</div>}
                        {testResult.url && <div className={styles.hint}>POST {testResult.url}</div>}
                        {testResult.models && testResult.models.length > 0 && (
                          <div className={styles.modelList}>
                            <span className={styles.hint}>Available models (click to use):</span>
                            {testResult.models.map((m) => (
                              <button
                                key={m}
                                type="button"
                                className={`${styles.chip} ${m === draft.agentBackend.model ? styles.chipActive : ''}`}
                                onClick={() => update((d) => void (d.agentBackend.model = m))}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        )}
                        {testResult.modelsError && <div className={styles.hint}>Model list unavailable: {testResult.modelsError}</div>}
                      </div>
                    )}

                    <Field
                      label="Extra request parameters (JSON)"
                      hint='Merged into every request body, e.g. {"temperature": 0.3}. The Gemma preset sets chat_template_kwargs.enable_thinking=false (llama.cpp); remove it for hosted APIs that reject unknown params.'
                    >
                      <textarea
                        rows={3}
                        className={styles.mono}
                        spellCheck={false}
                        value={draft.extraParamsText}
                        placeholder="{}"
                        onChange={(e) => update((d) => void (d.extraParamsText = e.target.value))}
                      />
                    </Field>
                  </>
                )}

                <Field label="System prompt">
                  <textarea rows={4} value={draft.agentBackend.systemPrompt} onChange={(e) => update((d) => void (d.agentBackend.systemPrompt = e.target.value))} />
                </Field>
                {draft.agentBackend.type === 'openai_compatible' && (
                  <Field label="Formatting rules" hint="Appended after the system prompt. Keeps replies short and readable in the 380px widget. Clear to disable.">
                    <textarea
                      rows={5}
                      value={draft.agentBackend.formattingRules ?? ''}
                      onChange={(e) => update((d) => void (d.agentBackend.formattingRules = e.target.value))}
                    />
                    <button
                      type="button"
                      className={styles.linkBtn}
                      onClick={() => update((d) => void (d.agentBackend.formattingRules = DEFAULT_FORMATTING_RULES))}
                    >
                      Reset to default rules
                    </button>
                  </Field>
                )}
              </section>
            </>
          )}
          {draft && (dirty || errors.length > 0) && (
            <div className={styles.saveBar} role="region" aria-label="Save changes">
              <span className={errors.length ? styles.saveBarError : styles.saveBarText}>
                {errors.length
                  ? `Not saved: ${errors.length} problem${errors.length > 1 ? 's' : ''}. ${errors[0]}`
                  : isNew
                    ? 'New bot, not saved yet'
                    : 'Unsaved changes'}
              </span>
              <button className={styles.primaryBtn} onClick={save} disabled={saving}>
                {saving ? 'Saving…' : isNew ? 'Create bot' : 'Save changes'}
              </button>
            </div>
          )}
        </main>
        {importOpen && (
          <ImportPanel
            existingIds={bots.map((b) => b.id)}
            onClose={() => setImportOpen(false)}
            onImported={async (msg) => {
              await loadBots();
              setStatus(msg);
              setPreviewVersion((v) => v + 1);
            }}
          />
        )}

        {/* ---------------- Preview + embed ---------------- */}
        <aside className={styles.previewCol}>
          <h2 className={styles.colTitle}>
            Live preview {dirty && savedBot && <span className={styles.badge}>unsaved changes not shown</span>}
          </h2>
          <div className={styles.previewFrame}>
            {savedBot ? (
              <iframe key={`${savedBot.id}-${previewVersion}`} src={`/embed/${encodeURIComponent(savedBot.id)}?preview=1`} title="Bot preview" />
            ) : (
              <div className={styles.previewEmpty}>Save the bot to see a live preview.</div>
            )}
          </div>

          {savedBot && (
            <>
              <h2 className={styles.colTitle}>Embed snippet</h2>
              <pre className={styles.snippet}>{snippet}</pre>
              <button className={styles.secondaryBtn} onClick={copySnippet}>
                {copied ? '✓ Copied' : 'Copy snippet'}
              </button>

              <h2 className={styles.colTitle}>Test hosts</h2>
              <ul className={styles.links}>
                {TEST_HOSTS.map((h) => (
                  <li key={h.file}>
                    {h.label}:{' '}
                    <a href={`/test-hosts/${h.file}?botId=${encodeURIComponent(botId)}${idpParam}`} target="_blank" rel="noreferrer">
                      same origin ↗
                    </a>
                    {crossOrigin && (
                      <>
                        {' · '}
                        <a
                          href={`${crossOrigin}/test-hosts/${h.file}?botId=${encodeURIComponent(botId)}&gateway=${encodeURIComponent(origin)}${idpParam}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          cross-origin via {new URL(crossOrigin).host} ↗
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>
                Test hosts only render the bot if their origin is in <em>Allowed domains</em>.
              </p>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <span className={styles.colorRow}>
      <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      <input value={value} onChange={(e) => onChange(e.target.value)} maxLength={7} />
    </span>
  );
}
