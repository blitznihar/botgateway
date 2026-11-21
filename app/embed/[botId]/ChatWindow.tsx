'use client';

import { CSSProperties, FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { PublicBotConfig } from '@/lib/bot-store';
import { isOriginAllowed } from '@/lib/origin';
import styles from './chat.module.css';
import Markdown from './Markdown';

type Message = { role: 'user' | 'assistant'; content: string; error?: boolean };
type HostContext = Record<string, unknown> & { hostOrigin?: string; authToken?: string };
type SessionUser = { anonymous: boolean; name?: string; email?: string };
type AuthState = { status: 'checking' } | { status: 'ok'; user: SessionUser } | { status: 'login_required' | 'error'; message: string };

const TOKEN_ERRORS = ['login_required', 'token_expired', 'token_invalid'];

/** Random per-browser visitor id (correlation only, not identity). Storage is partitioned per host site by modern browsers. */
function anonymousId(): string {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
  try {
    const existing = localStorage.getItem('nextbot_anon_id');
    if (existing) return existing;
    const id = make();
    localStorage.setItem('nextbot_anon_id', id);
    return id;
  } catch {
    return make();
  }
}

export default function ChatWindow({ bot, allowedDomains }: { bot: PublicBotConfig; allowedDomains: string[] }) {
  const { theme } = bot;
  const [messages, setMessages] = useState<Message[]>(theme.welcomeMessage ? [{ role: 'assistant', content: theme.welcomeMessage }] : []);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [context, setContext] = useState<HostContext | null>(null);
  const [embedded, setEmbedded] = useState(false);
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' });
  // The server-rendered form is inert until React hydrates; without this, a fast click would do a
  // native form submit and reload the iframe.
  const [hydrated, setHydrated] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const contextRef = useRef<HostContext>({});
  const contextWaiters = useRef<((c: HostContext) => void)[]>([]);
  const snapshotWaiters = useRef(new Map<string, (s: unknown) => void>());
  const anonId = useRef('');
  const refreshedFor = useRef(new Set<string>());
  const hasWelcome = Boolean(theme.welcomeMessage);
  const screenAware = bot.pageContext.mode === 'auto';

  // ---- Messages from widget.js: host context / token, and page snapshots ----------------------
  useEffect(() => {
    anonId.current = anonymousId();
    const inFrame = window.parent !== window;
    const isAdminPreview = new URLSearchParams(window.location.search).get('preview') === '1';
    setEmbedded(inFrame && !isAdminPreview);
    setHydrated(true);

    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return;
      // event.origin is set by the browser, so it reliably identifies the host page.
      if (event.origin !== window.location.origin && !isOriginAllowed(event.origin, allowedDomains)) return;
      const data = event.data as { type?: string; payload?: unknown; requestId?: string } | null;
      if (data?.type === 'INIT_CONTEXT' && data.payload && typeof data.payload === 'object') {
        const next = { ...(data.payload as Record<string, unknown>), hostOrigin: event.origin };
        contextRef.current = next;
        setContext(next);
        contextWaiters.current.splice(0).forEach((resolve) => resolve(next));
      } else if (data?.type === 'PAGE_SNAPSHOT' && data.requestId) {
        snapshotWaiters.current.get(data.requestId)?.(data.payload);
        snapshotWaiters.current.delete(data.requestId);
      }
    }
    window.addEventListener('message', onMessage);
    // Tell widget.js we're hydrated and listening; it replies with INIT_CONTEXT (after fetching a token if it has a provider).
    if (inFrame && !isAdminPreview) window.parent.postMessage({ type: 'NEXTBOT_READY', botId: bot.id }, '*');
    else setContext({}); // admin preview / standalone: no host
    return () => window.removeEventListener('message', onMessage);
  }, [allowedDomains, bot.id]);

  const withAnon = useCallback((ctx: HostContext) => ({ ...ctx, anonymousId: anonId.current }), []);

  // ---- Resolve "who is this?" whenever host context / token changes ---------------------------
  useEffect(() => {
    if (context === null) return;
    let cancelled = false;
    fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ botId: bot.id, context: withAnon(context) }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (res.ok) setAuth({ status: 'ok', user: data.user });
        else if (TOKEN_ERRORS.includes(data.code)) {
          // Expired / missing token: ask the host's token provider for a fresh one, once per token value.
          const key = String(context.authToken ?? '');
          if (window.parent !== window && !refreshedFor.current.has(key)) {
            refreshedFor.current.add(key);
            window.parent.postMessage({ type: 'NEXTBOT_TOKEN_REQUEST', botId: bot.id }, '*');
            return; // the new INIT_CONTEXT re-runs this check
          }
          setAuth({ status: 'login_required', message: data.error });
        }
        else setAuth({ status: 'error', message: data.error ?? `Session check failed (${res.status})` });
      })
      .catch(() => !cancelled && setAuth({ status: 'error', message: 'Could not reach the assistant.' }));
    return () => {
      cancelled = true;
    };
  }, [context, bot.id, withAnon]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  /** Ask the host for a fresh token (its getAuthToken provider) and wait for the next INIT_CONTEXT. */
  function refreshToken(): Promise<HostContext | null> {
    if (window.parent === window) return Promise.resolve(null);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 9000);
      contextWaiters.current.push((c) => {
        clearTimeout(timer);
        resolve(c);
      });
      window.parent.postMessage({ type: 'NEXTBOT_TOKEN_REQUEST', botId: bot.id }, '*');
    });
  }

  /** Fresh capture of the host page right before sending (records change without page reloads). */
  function requestSnapshot(): Promise<unknown> {
    if (!screenAware || !embedded) return Promise.resolve(null);
    const requestId = Math.random().toString(36).slice(2);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        snapshotWaiters.current.delete(requestId);
        resolve(null);
      }, 1500);
      snapshotWaiters.current.set(requestId, (s) => {
        clearTimeout(timer);
        resolve(s);
      });
      window.parent.postMessage({ type: 'NEXTBOT_SNAPSHOT_REQUEST', botId: bot.id, requestId }, '*');
    });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || sending) return;

    const next: Message[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setSending(true);
    try {
      // Skip the static welcome bubble and any local error bubbles; send the real conversation.
      const history = next.slice(hasWelcome ? 1 : 0).filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const pageSnapshot = await requestSnapshot();
      const post = (ctx: HostContext) =>
        fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ botId: bot.id, messages: history, context: withAnon(ctx), pageSnapshot }),
        });

      let res = await post(contextRef.current);
      let data = await res.json().catch(() => ({}));
      // Expired/missing token: get a fresh one from the host app and retry once.
      if (res.status === 401 && TOKEN_ERRORS.includes(data.code)) {
        const fresh = await refreshToken();
        if (fresh) {
          res = await post(fresh);
          data = await res.json().catch(() => ({}));
        }
      }
      if (!res.ok) {
        if (TOKEN_ERRORS.includes(data.code)) setAuth({ status: 'login_required', message: data.error });
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      if (data.user) setAuth({ status: 'ok', user: data.user });
      setMessages((m) => [...m, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: (err as Error).message, error: true }]);
    } finally {
      setSending(false);
    }
  }

  const themeVars = { '--primary': theme.primaryColor, '--header-text': theme.headerTextColor } as CSSProperties;
  const blocked = auth.status === 'login_required';
  const subtitle = sending
    ? 'Typing…'
    : auth.status === 'ok'
      ? auth.user.anonymous
        ? 'Guest'
        : `Signed in as ${auth.user.name ?? auth.user.email ?? 'you'}`
      : auth.status === 'login_required'
        ? 'Sign-in required'
        : 'Online';

  return (
    <div className={styles.shell} style={themeVars}>
      <header className={styles.header}>
        <div className={styles.avatar} aria-hidden>
          {theme.botTitle.charAt(0).toUpperCase()}
        </div>
        <div className={styles.titleBlock}>
          <div className={styles.title}>{theme.botTitle}</div>
          <div className={styles.subtitle} data-testid="session-status">
            {subtitle}
            {screenAware && (
              <span className={styles.aware} title="This assistant can read the page you are on to answer questions about it.">
                {' '}
                · reads this page
              </span>
            )}
          </div>
        </div>
        {embedded && (
          <button className={styles.close} aria-label="Close chat" onClick={() => window.parent.postMessage({ type: 'NEXTBOT_CLOSE', botId: bot.id }, '*')}>
            ×
          </button>
        )}
      </header>

      <div className={styles.messages} ref={listRef} aria-live="polite">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`${styles.bubble} ${m.role === 'user' ? styles.user : `${styles.assistant} ${styles.md}`} ${m.error ? styles.error : ''}`}
          >
            {m.role === 'assistant' && !m.error ? <Markdown text={m.content} /> : m.content}
          </div>
        ))}
        {blocked && (
          <div className={`${styles.bubble} ${styles.assistant} ${styles.notice}`} role="status">
            {auth.message}
            {embedded ? ' Sign in on this site, then reopen the chat.' : ' (Admin preview: test signed-in chat from a test host.)'}
          </div>
        )}
        {sending && (
          <div className={`${styles.bubble} ${styles.assistant} ${styles.typing}`} aria-label="Assistant is typing">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className={styles.composer} onSubmit={send}>
        <input
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={blocked ? 'Sign in to chat' : 'Type a message…'}
          aria-label="Message"
          maxLength={4000}
          autoComplete="off"
          disabled={!hydrated || blocked}
        />
        <button className={styles.send} type="submit" disabled={!hydrated || blocked || !input.trim() || sending} aria-label="Send">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2 11 13" />
            <path d="M22 2 15 22l-4-9-9-4 20-7z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
