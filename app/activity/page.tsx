'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { ActivityEvent, ActivityType, BotActivityStats } from '@/lib/activity';
import styles from './activity.module.css';

type BotSummary = { id: string; name: string; primaryColor: string };
type Payload = { bots: BotSummary[]; stats: Record<string, BotActivityStats>; total: number; events: ActivityEvent[] };

const TYPE_FILTERS: { value: '' | ActivityType; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'chat', label: 'Chats' },
  { value: 'widget_load', label: 'Widget loads' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'error', label: 'Errors' },
];

const TYPE_LABEL: Record<ActivityType, string> = { chat: 'Chat', widget_load: 'Widget load', blocked: 'Blocked', error: 'Error' };

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const sum = (stats: BotActivityStats[], key: 'chats' | 'widgetLoads' | 'blocked' | 'errors') => stats.reduce((a, s) => a + s[key], 0);

export default function ActivityPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [botId, setBotId] = useState('');
  const [type, setType] = useState<'' | ActivityType>('');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Deep link: /activity?botId=bot_x (used by the "View activity" link in the editor).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('botId');
    if (id) setBotId(id);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '300' });
    if (botId) params.set('botId', botId);
    if (type) params.set('type', type);
    if (debouncedQuery) params.set('q', debouncedQuery);
    try {
      const res = await fetch(`/api/activity?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to load activity (${res.status})`);
      setData(await res.json());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [botId, type, debouncedQuery]);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, autoRefresh]);

  function selectBot(id: string) {
    setBotId(id);
    setExpanded(null);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('botId', id);
    else url.searchParams.delete('botId');
    window.history.replaceState(null, '', url);
  }

  const bots = data?.bots ?? [];
  const botById = new Map(bots.map((b) => [b.id, b]));
  // Include bots that only exist in the log (e.g. deleted from bots.json).
  const loggedOnly = Object.keys(data?.stats ?? {}).filter((id) => !botById.has(id));
  const allStats = Object.values(data?.stats ?? {});
  const selectedStats: BotActivityStats | null = botId ? (data?.stats[botId] ?? null) : null;

  const cards = botId
    ? {
        chats: selectedStats?.chats ?? 0,
        widgetLoads: selectedStats?.widgetLoads ?? 0,
        blocked: selectedStats?.blocked ?? 0,
        errors: selectedStats?.errors ?? 0,
        avg: selectedStats?.avgLatencyMs ?? null,
        users: selectedStats ? `${selectedStats.uniqueUsers} (${selectedStats.signedInUsers} signed in)` : '0',
        last: selectedStats?.lastActivity ?? null,
      }
    : {
        chats: sum(allStats, 'chats'),
        widgetLoads: sum(allStats, 'widgetLoads'),
        blocked: sum(allStats, 'blocked'),
        errors: sum(allStats, 'errors'),
        avg: null,
        users: `${allStats.reduce((a, s) => a + s.uniqueUsers, 0)} (${allStats.reduce((a, s) => a + s.signedInUsers, 0)} signed in)`,
        last: allStats.reduce<string | null>((a, s) => (!a || (s.lastActivity ?? '') > a ? s.lastActivity : a), null),
      };

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <span className={styles.logo}>◆</span> Bot Control Plane
        </div>
        <nav className={styles.nav}>
          <Link href="/">Bots</Link>
          <Link href="/activity" className={styles.navActive}>
            Activity
          </Link>
        </nav>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <button className={`${styles.botItem} ${!botId ? styles.botItemActive : ''}`} onClick={() => selectBot('')}>
            <span className={styles.swatch} style={{ background: 'conic-gradient(#6366f1, #10b981, #f59e0b, #6366f1)' }} />
            <span className={styles.botItemText}>
              <strong>All bots</strong>
              <small>{plural(sum(allStats, 'chats'), 'chat')}</small>
            </span>
          </button>
          {[...bots, ...loggedOnly.map((id) => ({ id, name: id, primaryColor: '#94a3b8' }))].map((b) => {
            const s = data?.stats[b.id];
            return (
              <button key={b.id} className={`${styles.botItem} ${botId === b.id ? styles.botItemActive : ''}`} onClick={() => selectBot(b.id)}>
                <span className={styles.swatch} style={{ background: b.primaryColor }} />
                <span className={styles.botItemText}>
                  <strong>{b.name}</strong>
                  <small>
                    {plural(s?.chats ?? 0, 'chat')} · {timeAgo(s?.lastActivity ?? null)}
                    {s && s.blocked + s.errors > 0 && <span className={styles.alertDot} title={`${s.blocked} blocked, ${s.errors} errors`} />}
                  </small>
                </span>
              </button>
            );
          })}
        </aside>

        <main className={styles.main}>
          <div className={styles.titleRow}>
            <h1>{botId ? (botById.get(botId)?.name ?? botId) : 'All activity'}</h1>
            {botId && (
              <Link className={styles.editLink} href={`/?botId=${encodeURIComponent(botId)}`}>
                Edit bot →
              </Link>
            )}
          </div>

          <div className={styles.cards}>
            <Stat label="Chats" value={cards.chats} />
            <Stat label="Users" value={cards.users} />
            <Stat label="Widget loads" value={cards.widgetLoads} />
            <Stat label="Blocked" value={cards.blocked} tone={cards.blocked ? 'warn' : undefined} />
            <Stat label="Errors" value={cards.errors} tone={cards.errors ? 'bad' : undefined} />
            {botId && <Stat label="Avg response" value={cards.avg === null ? '—' : `${(cards.avg / 1000).toFixed(1)}s`} />}
            <Stat label="Last activity" value={timeAgo(cards.last)} />
          </div>

          {selectedStats && selectedStats.topOrigins.length > 0 && (
            <div className={styles.origins}>
              <span className={styles.originsLabel}>Top host origins</span>
              {selectedStats.topOrigins.map((o) => (
                <span key={o.origin} className={styles.originChip}>
                  {o.origin} <b>{o.count}</b>
                </span>
              ))}
            </div>
          )}

          <div className={styles.filters}>
            <div className={styles.segmented} role="tablist">
              {TYPE_FILTERS.map((f) => (
                <button key={f.value} role="tab" aria-selected={type === f.value} className={type === f.value ? styles.segActive : ''} onClick={() => setType(f.value)}>
                  {f.label}
                </button>
              ))}
            </div>
            <input
              className={styles.search}
              placeholder="Search messages, replies, users, origins…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search activity"
            />
            <label className={styles.toggle}>
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} /> Live
            </label>
            <button className={styles.refresh} onClick={load}>
              Refresh
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Time</th>
                  {!botId && <th>Bot</th>}
                  <th>Type</th>
                  <th>User</th>
                  <th>Host</th>
                  <th>Details</th>
                  <th className={styles.num}>Latency</th>
                </tr>
              </thead>
              <tbody>
                {data && data.events.length === 0 && (
                  <tr>
                    <td colSpan={7} className={styles.empty}>
                      No activity yet. Open a test host and chat with a bot.
                    </td>
                  </tr>
                )}
                {data?.events.map((e) => {
                  const bot = botById.get(e.botId);
                  const open = expanded === e.id;
                  return (
                    <Fragment key={e.id}>
                      <tr className={`${styles.row} ${open ? styles.rowOpen : ''}`} onClick={() => setExpanded(open ? null : e.id)}>
                        <td className={styles.time} title={new Date(e.ts).toLocaleString()}>
                          {new Date(e.ts).toLocaleTimeString()}
                          <small>{new Date(e.ts).toLocaleDateString()}</small>
                        </td>
                        {!botId && (
                          <td>
                            <span className={styles.botCell}>
                              <span className={styles.swatch} style={{ background: bot?.primaryColor ?? '#94a3b8' }} />
                              {e.botId}
                            </span>
                          </td>
                        )}
                        <td>
                          <span className={`${styles.badge} ${styles[`badge_${e.type}`]}`}>
                            {TYPE_LABEL[e.type]}
                            {e.httpStatus && e.type !== 'chat' && e.type !== 'widget_load' ? ` ${e.httpStatus}` : ''}
                          </span>
                        </td>
                        <td className={styles.userCell}>
                          {e.userId ? (
                            e.anonymous ? (
                              <span className={styles.muted} title={e.userId}>Guest</span>
                            ) : (
                              <span title={`${e.userId}${e.userEmail ? ` · ${e.userEmail}` : ''}`}>{e.userName ?? e.userEmail ?? e.userId}</span>
                            )
                          ) : (
                            <span className={styles.muted}>—</span>
                          )}
                        </td>
                        <td className={styles.host}>{e.origin ?? '—'}</td>
                        <td className={styles.details}>
                          {e.type === 'chat' && (
                            <>
                              <span className={styles.q}>{e.message}</span>
                              <span className={styles.a}>{e.reply}</span>
                            </>
                          )}
                          {(e.type === 'blocked' || e.type === 'error') && <span className={styles.reason}>{e.error}</span>}
                          {e.type === 'widget_load' && <span className={styles.muted}>{e.pageUrl ?? 'Widget config fetched'}</span>}
                        </td>
                        <td className={styles.num}>{typeof e.latencyMs === 'number' ? `${(e.latencyMs / 1000).toFixed(1)}s` : ''}</td>
                      </tr>
                      {open && (
                        <tr className={styles.expandRow}>
                          <td colSpan={7}>
                            <dl className={styles.dl}>
                              {e.message && (
                                <>
                                  <dt>User message</dt>
                                  <dd className={styles.pre}>{e.message}</dd>
                                </>
                              )}
                              {e.reply && (
                                <>
                                  <dt>Reply</dt>
                                  <dd className={styles.pre}>{e.reply}</dd>
                                </>
                              )}
                              {e.error && (
                                <>
                                  <dt>Reason</dt>
                                  <dd className={styles.pre}>{e.error}</dd>
                                </>
                              )}
                              {e.userId && (
                                <>
                                  <dt>User</dt>
                                  <dd>
                                    {e.anonymous ? 'Guest (anonymous)' : `${e.userName ?? ''} ${e.userEmail ? `<${e.userEmail}>` : ''}`.trim() || 'Signed in'}
                                    <span className={styles.muted}> · {e.userId}</span>
                                  </dd>
                                </>
                              )}
                              {e.pageSnapshot && (
                                <>
                                  <dt>Screen seen by bot</dt>
                                  <dd>
                                    <pre className={styles.json}>{JSON.stringify(e.pageSnapshot, null, 2)}</pre>
                                  </dd>
                                </>
                              )}
                              {e.pageUrl && (
                                <>
                                  <dt>Page</dt>
                                  <dd>{e.pageUrl}</dd>
                                </>
                              )}
                              {(e.backend || e.model) && (
                                <>
                                  <dt>Backend</dt>
                                  <dd>
                                    {e.backend}
                                    {e.model ? ` · ${e.model}` : ''}
                                  </dd>
                                </>
                              )}
                              {e.context && Object.keys(e.context).length > 0 && (
                                <>
                                  <dt>Host context</dt>
                                  <dd>
                                    <pre className={styles.json}>{JSON.stringify(e.context, null, 2)}</pre>
                                  </dd>
                                </>
                              )}
                              <dt>Event</dt>
                              <dd className={styles.muted}>
                                {e.id} · {e.ts}
                              </dd>
                            </dl>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {data && data.total > data.events.length && (
            <p className={styles.muted}>
              Showing the latest {data.events.length} of {data.total} matching events.
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'bad' }) {
  return (
    <div className={`${styles.card} ${tone ? styles[`card_${tone}`] : ''}`}>
      <span className={styles.cardLabel}>{label}</span>
      <span className={styles.cardValue}>{value}</span>
    </div>
  );
}
