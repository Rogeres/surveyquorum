import type { LlmRequest, LlmResponse } from '../detectors/types.js';
import { parseJsonReply, validateJson } from './json-schema.js';

export interface RawCompletion {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** A transport sends one prompt (optionally with a system message) and returns the reply text. */
export type SendText = (system: string | undefined, prompt: string) => Promise<RawCompletion>;

/** Appended to every prompt so that providers without a JSON mode still answer in JSON. */
export const JSON_ONLY_SUFFIX =
  '\n\nReply with a single JSON value that satisfies the schema below and nothing else — no prose, no Markdown fences.\nSchema:\n';

/**
 * Provider-agnostic JSON completion: ask, parse, validate against the request schema, and on
 * failure retry once with the validation errors appended to the prompt. Shared by the HTTP
 * transports so that prompts stay portable across vendors.
 */
export async function completeJson(send: SendText, request: LlmRequest): Promise<LlmResponse> {
  const base = `${request.prompt}${JSON_ONLY_SUFFIX}${JSON.stringify(request.schema)}`;
  const usage = { inputTokens: 0, outputTokens: 0 };
  let prompt = base;
  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await send(request.system, prompt);
    if (raw.usage) {
      usage.inputTokens += raw.usage.inputTokens;
      usage.outputTokens += raw.usage.outputTokens;
    }
    let json: unknown;
    try {
      json = parseJsonReply(raw.text);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      prompt = `${base}\n\nYour previous reply could not be parsed as JSON (${lastError}). Reply again with valid JSON only.`;
      continue;
    }
    const errors = validateJson(json, request.schema);
    if (errors.length === 0) return { json, usage };
    lastError = errors.join('; ');
    prompt = `${base}\n\nYour previous reply did not satisfy the schema: ${lastError}. Reply again with corrected JSON only.`;
  }
  throw new Error(`LLM reply failed schema validation twice: ${lastError}`);
}

export interface RetryOptions {
  retries?: number;
  /** Base backoff in ms; doubles per attempt. Tests pass 0. */
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

/** POST JSON with up to `retries` retries on 429 and 5xx. Returns the parsed body. */
export async function postJsonWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: RetryOptions = {},
): Promise<{ status: number; body: unknown }> {
  const retries = opts.retries ?? 3;
  const backoff = opts.backoffMs ?? 500;
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  let lastStatus = 0;
  let lastText = '';
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (res.status === 429 || res.status >= 500) {
      lastStatus = res.status;
      lastText = text;
      if (attempt < retries) {
        const wait = backoff * 2 ** attempt;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // non-JSON body (e.g. a proxy error page) — callers see the text
    }
    return { status: res.status, body: parsed };
  }
  throw new Error(
    `LLM endpoint ${url} failed with HTTP ${lastStatus} after ${retries + 1} attempts: ${lastText.slice(0, 300)}`,
  );
}
