import type { LlmClient, LlmRequest, LlmResponse } from '../detectors/types.js';
import type { LlmConfig } from './config.js';
import { completeJson, postJsonWithRetry, type RetryOptions } from './json-completion.js';

const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_TOKENS = 2048;

interface MessagesResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
}

/**
 * Anthropic Messages API over plain `fetch`. Same prompt-level JSON contract as the
 * OpenAI-compatible client: the schema is in the prompt, the reply is parsed, validated and
 * retried once. No vendor-specific output formatting is relied on, so the prompts stay portable.
 */
export class AnthropicClient implements LlmClient {
  constructor(
    private readonly config: LlmConfig,
    private readonly retry: RetryOptions = {},
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = this.config.models[request.role];
    return completeJson((system, prompt) => this.send(model, system, prompt), request);
  }

  private async send(model: string, system: string | undefined, prompt: string) {
    const url = `${(this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/v1/messages`;
    const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION };
    if (this.config.apiKey) headers['x-api-key'] = this.config.apiKey;
    const body: Record<string, unknown> = {
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    };
    if (system) body.system = system;
    const { status, body: res } = await postJsonWithRetry(url, headers, body, this.retry);
    const r = res as MessagesResponse;
    if (status >= 400) {
      throw new Error(
        `Anthropic endpoint returned HTTP ${status}: ${r?.error?.message ?? JSON.stringify(res).slice(0, 300)}`,
      );
    }
    const text = (r.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n');
    return {
      text,
      usage: {
        inputTokens: r.usage?.input_tokens ?? 0,
        outputTokens: r.usage?.output_tokens ?? 0,
      },
    };
  }
}
