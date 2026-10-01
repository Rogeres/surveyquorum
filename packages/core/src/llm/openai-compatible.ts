import type { LlmClient, LlmRequest, LlmResponse } from '../detectors/types.js';
import { isYandexCloud, type LlmConfig, resolveAuthScheme } from './config.js';
import { completeJson, postJsonWithRetry, type RetryOptions } from './json-completion.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/**
 * Any server that speaks `POST /chat/completions`: OpenAI, OpenRouter, DashScope, Yandex Cloud
 * AI Studio (`https://llm.api.cloud.yandex.net/v1`, models `gpt://<folder_id>/<model>/latest`,
 * `Authorization: Api-Key`), Perplexity, Ollama, LM Studio, vLLM. Only `baseUrl`, `apiKey`,
 * `authScheme` and `model` change.
 *
 * JSON is requested in the prompt first; `response_format` is a bonus. With
 * `strictJsonSchema` we send the strict `json_schema` format (OpenAI only — Yandex never gets
 * it); otherwise `json_object` is tried once and dropped for the rest of the run if the server
 * rejects it with 400.
 */
export class OpenAiCompatibleClient implements LlmClient {
  private jsonObjectSupported = true;

  constructor(
    private readonly config: LlmConfig,
    private readonly retry: RetryOptions = {},
  ) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const model = this.config.models[request.role];
    return completeJson((system, prompt) => this.send(model, request, system, prompt), request);
  }

  /** Authorization header value for the configured scheme. */
  authorizationHeader(): string | undefined {
    if (!this.config.apiKey) return undefined;
    return resolveAuthScheme(this.config) === 'api-key'
      ? `Api-Key ${this.config.apiKey}`
      : `Bearer ${this.config.apiKey}`;
  }

  /** `response_format` variants to try, most specific first; `undefined` = prompt-only JSON. */
  responseFormats(schema: Record<string, unknown>): unknown[] {
    const formats: unknown[] = [];
    if (this.config.strictJsonSchema && !isYandexCloud(this.config.baseUrl)) {
      formats.push({ type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } });
    } else if (this.jsonObjectSupported) {
      formats.push({ type: 'json_object' });
    }
    formats.push(undefined);
    return formats;
  }

  private async send(
    model: string,
    request: LlmRequest,
    system: string | undefined,
    prompt: string,
  ) {
    const url = `${(this.config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')}/chat/completions`;
    const headers: Record<string, string> = {};
    const auth = this.authorizationHeader();
    if (auth) headers.authorization = auth;
    const messages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: prompt },
    ];

    for (const response_format of this.responseFormats(request.schema)) {
      const body: Record<string, unknown> = { model, messages };
      if (response_format) body.response_format = response_format;
      const { status, body: res } = await postJsonWithRetry(url, headers, body, this.retry);
      if (status === 400 && response_format) {
        // The server does not understand this response_format: fall back to prompt-only JSON.
        if ((response_format as { type: string }).type === 'json_object') {
          this.jsonObjectSupported = false;
        }
        continue;
      }
      const r = res as ChatResponse;
      if (status >= 400) {
        throw new Error(
          `LLM endpoint returned HTTP ${status}: ${r?.error?.message ?? JSON.stringify(res).slice(0, 300)}`,
        );
      }
      return {
        text: r.choices?.[0]?.message?.content ?? '',
        usage: {
          inputTokens: r.usage?.prompt_tokens ?? 0,
          outputTokens: r.usage?.completion_tokens ?? 0,
        },
      };
    }
    throw new Error('unreachable: every response_format variant was rejected');
  }
}
