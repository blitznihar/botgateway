import { chatCompletionsUrl, modelsUrl } from './llm-defaults';

/** Minimal OpenAI-compatible Chat Completions client. Works with OpenAI, Azure OpenAI (v1 API),
 *  Docker Model Runner, Ollama, vLLM, LM Studio, LiteLLM, OpenRouter, Groq, Together, etc. */

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface LlmTarget {
  endpointUrl: string;
  apiKey?: string;
  model: string;
  extraParams?: Record<string, unknown>;
  /** Extra HTTP headers, e.g. X-User-* identity headers for your own agent backend. */
  headers?: Record<string, string>;
}

const TIMEOUT_MS = 120_000;

function headers(apiKey?: string): Record<string, string> {
  return { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) };
}

/** Turns low-level fetch failures into messages an admin can act on. */
async function request(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    if (e.name === 'TimeoutError') throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${url}`);
    const detail = e.cause?.code || e.cause?.message || e.message;
    throw new Error(`Could not reach ${url} (${detail})`);
  }
}

async function upstreamError(res: Response): Promise<Error> {
  const body = (await res.text()).slice(0, 400);
  if (res.status === 401 || res.status === 403) return new Error(`Endpoint rejected the API key (${res.status}): ${body}`);
  if (res.status === 404) return new Error(`Not found (404). Check the endpoint URL and model name: ${body}`);
  return new Error(`Endpoint returned ${res.status}: ${body}`);
}

export async function chatCompletion(target: LlmTarget, messages: LlmMessage[], timeoutMs = TIMEOUT_MS): Promise<string> {
  const url = chatCompletionsUrl(target.endpointUrl);
  const res = await request(
    url,
    {
      method: 'POST',
      headers: { ...(target.headers ?? {}), ...headers(target.apiKey) },
      // Gateway-owned fields last so extraParams can't override them.
      body: JSON.stringify({ ...(target.extraParams ?? {}), model: target.model, messages }),
    },
    timeoutMs,
  );
  if (!res.ok) throw await upstreamError(res);
  const data = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Response had no choices[0].message.content (is this a chat-completions endpoint?)');
  return content.trim();
}

/** GET {base}/models. Not every provider implements it, so callers treat failure as "unknown". */
export async function listModels(endpointUrl: string, apiKey?: string): Promise<string[]> {
  const res = await request(modelsUrl(endpointUrl), { headers: headers(apiKey) }, 10_000);
  if (!res.ok) throw await upstreamError(res);
  const data = (await res.json()) as { data?: { id?: string }[] };
  return (data.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
}
