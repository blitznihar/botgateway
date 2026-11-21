import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Append-only activity log (JSON Lines) at data/activity.jsonl, next to bots.json so it
 * persists on the same Docker volume. Bounded: when it grows past ACTIVITY_MAX_BYTES the
 * oldest half is dropped. Set ACTIVITY_LOG=off to disable logging entirely.
 *
 * Contains end-user chat text. Auth tokens are never logged (context is redacted by callers).
 */

export type ActivityType = 'chat' | 'widget_load' | 'blocked' | 'error';

export interface ActivityEvent {
  id: string;
  ts: string; // ISO timestamp
  botId: string;
  type: ActivityType;
  origin?: string | null; // host page origin (or request origin)
  pageUrl?: string;
  httpStatus?: number;
  message?: string; // last user message
  reply?: string;
  error?: string; // error / block reason
  latencyMs?: number;
  backend?: string;
  model?: string;
  context?: Record<string, unknown>;
  /** Resolved identity (verified via the host's IdP, or anon:<id>). */
  userId?: string;
  userName?: string;
  userEmail?: string;
  anonymous?: boolean;
  /** Bounded excerpt of what the bot saw on screen. */
  pageSnapshot?: Record<string, unknown>;
}

export interface BotActivityStats {
  botId: string;
  chats: number;
  widgetLoads: number;
  blocked: number;
  errors: number;
  avgLatencyMs: number | null;
  lastActivity: string | null;
  uniqueUsers: number;
  signedInUsers: number;
  topOrigins: { origin: string; count: number }[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'activity.jsonl');
const MAX_BYTES = Number(process.env.ACTIVITY_MAX_BYTES) || 5 * 1024 * 1024;
const MAX_TEXT = 2000;

const clip = (s: string | undefined) => (s && s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

let chain: Promise<unknown> = Promise.resolve();

/** Fire-and-forget: never blocks or fails the request that triggered it. */
export function logActivity(event: Omit<ActivityEvent, 'id' | 'ts'>): void {
  if (process.env.ACTIVITY_LOG === 'off') return;
  const full: ActivityEvent = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    ...event,
    message: clip(event.message),
    reply: clip(event.reply),
  };
  chain = chain
    .then(async () => {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.appendFile(FILE, JSON.stringify(full) + '\n', 'utf8');
      const { size } = await fs.stat(FILE);
      if (size > MAX_BYTES) {
        const lines = (await fs.readFile(FILE, 'utf8')).split('\n').filter(Boolean);
        const tmp = `${FILE}.${process.pid}.tmp`;
        await fs.writeFile(tmp, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n', 'utf8');
        await fs.rename(tmp, FILE);
      }
    })
    .catch((err) => console.error('[activity] failed to write log:', err));
}

/** All events, newest first. */
export async function readActivity(): Promise<ActivityEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(FILE, 'utf8');
  } catch {
    return [];
  }
  const events: ActivityEvent[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip a partially written line
    }
  }
  return events.reverse();
}

export function computeStats(events: ActivityEvent[]): Record<string, BotActivityStats> {
  const stats: Record<string, BotActivityStats & { _lat: number[]; _origins: Map<string, number>; _users: Set<string>; _signedIn: Set<string> }> = {};
  for (const e of events) {
    const s = (stats[e.botId] ??= {
      botId: e.botId,
      chats: 0,
      widgetLoads: 0,
      blocked: 0,
      errors: 0,
      avgLatencyMs: null,
      lastActivity: null,
      topOrigins: [],
      _lat: [],
      _origins: new Map(),
      _users: new Set<string>(),
      _signedIn: new Set<string>(),
      uniqueUsers: 0,
      signedInUsers: 0,
    });
    if (e.userId) {
      s._users.add(e.userId);
      if (e.anonymous === false) s._signedIn.add(e.userId);
    }
    if (e.type === 'chat') s.chats++;
    else if (e.type === 'widget_load') s.widgetLoads++;
    else if (e.type === 'blocked') s.blocked++;
    else if (e.type === 'error') s.errors++;
    if (e.type === 'chat' && typeof e.latencyMs === 'number') s._lat.push(e.latencyMs);
    if (!s.lastActivity || e.ts > s.lastActivity) s.lastActivity = e.ts;
    if (e.origin) s._origins.set(e.origin, (s._origins.get(e.origin) ?? 0) + 1);
  }
  const out: Record<string, BotActivityStats> = {};
  for (const [id, { _lat, _origins, _users, _signedIn, ...s }] of Object.entries(stats)) {
    out[id] = {
      ...s,
      uniqueUsers: _users.size,
      signedInUsers: _signedIn.size,
      avgLatencyMs: _lat.length ? Math.round(_lat.reduce((a, b) => a + b, 0) / _lat.length) : null,
      topOrigins: [..._origins.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([origin, count]) => ({ origin, count })),
    };
  }
  return out;
}
