import type { BotConfig } from './bot-store';

/** File format for bot import/export. Plain JSON, easy to diff, review and keep in git. */
export const EXPORT_FORMAT = 'nextbot.bots';
export const EXPORT_VERSION = 1;

export interface BotExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** Bots whose API key was stripped from this file (re-enter it after import). */
  apiKeysOmitted: string[];
  bots: BotConfig[];
}

export function buildExport(bots: BotConfig[]): BotExportFile {
  const apiKeysOmitted: string[] = [];
  const clean = bots.map((b) => {
    if (!b.agentBackend.apiKey) return b;
    apiKeysOmitted.push(b.id);
    const { apiKey: _k, ...agentBackend } = b.agentBackend;
    return { ...b, agentBackend };
  });
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), apiKeysOmitted, bots: clean };
}

/** Accepts an export file, a plain array of bots, or a single bot object. */
export function extractBots(input: unknown): { bots: unknown[]; error?: string } {
  if (Array.isArray(input)) return { bots: input };
  if (input && typeof input === 'object') {
    const o = input as Record<string, unknown>;
    if (Array.isArray(o.bots)) {
      if (o.format !== undefined && o.format !== EXPORT_FORMAT) return { bots: [], error: `Unknown file format "${String(o.format)}"` };
      return { bots: o.bots };
    }
    if (typeof o.id === 'string') return { bots: [o] };
  }
  return { bots: [], error: 'Expected an exported bots file, an array of bots, or a single bot object.' };
}
