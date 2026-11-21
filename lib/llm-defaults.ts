/**
 * Default values the admin UI pre-fills into new bots. Pure constants (safe to import client-side).
 * Nothing here is applied implicitly: every bot stores its own copy, visible and editable in the UI.
 */

/** Docker Model Runner's OpenAI-compatible API, as reachable from containers on Docker Desktop. */
export const DOCKER_MODEL_RUNNER_URL = 'http://model-runner.docker.internal/engines/v1';
export const DEFAULT_MODEL = 'ai/gemma4';

/**
 * Reasoning models served by llama.cpp (Gemma 4, Qwen 3…) "think" before answering by default,
 * ~30x slower for chat. Most hosted APIs (OpenAI, Azure…) reject unknown params, so clear this for them.
 */
export const DEFAULT_EXTRA_PARAMS: Record<string, unknown> = { chat_template_kwargs: { enable_thinking: false } };

/** Appended to the system prompt. Models default to long, document-style Markdown that reads badly in a 380px bubble. */
export const DEFAULT_FORMATTING_RULES = `You are replying inside a small chat widget (about 380px wide), so write like a helpful colleague in a chat, not a document.
Formatting rules:
- Be brief: answer in 1-3 short sentences, or a one-line intro plus at most 5 bullet points. If more detail would help, offer it in a closing question instead of writing it.
- Lead with the direct answer. No filler openers ("Certainly!", "Great question") and do not restate the question.
- Use simple Markdown only: short paragraphs, "-" bullets or "1." steps (one line each), and **bold** for at most 2-3 key terms per reply.
- Never use headings, tables, horizontal rules, code blocks (unless the user asks for code), HTML, or nested lists.
- Do not put a bold label at the start of every bullet.`;

/** Params the gateway controls itself; extraParams may not override them. */
export const RESERVED_PARAMS = ['model', 'messages', 'stream'];

/** Accepts a base URL (…/v1) or a full …/chat/completions URL. */
export function chatCompletionsUrl(endpoint: string): string {
  const url = endpoint.trim().replace(/\/+$/, '');
  return /\/chat\/completions$/.test(url) ? url : `${url}/chat/completions`;
}

export function modelsUrl(endpoint: string): string {
  return `${endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/models`;
}

export function maskKey(key: string): string {
  return key.length > 10 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '••••••';
}
