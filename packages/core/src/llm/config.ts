import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type LlmProvider = 'openai-compatible' | 'anthropic' | 'agent-file';

export interface LlmConfig {
  provider: LlmProvider;
  /** API root. Defaults: OpenAI `https://api.openai.com/v1`, Anthropic `https://api.anthropic.com`. */
  baseUrl?: string;
  apiKey?: string;
  /** Model per role: cheap `classifier` for per-answer calls, stronger `arbiter` for once-per-survey calls. */
  models: { classifier: string; arbiter: string };
  /** File cache directory; default `.surveyquorum/llm-cache`. */
  cacheDir?: string;
  /**
   * How the key is sent on OpenAI-compatible endpoints: `Authorization: Bearer <key>` (default)
   * or `Authorization: Api-Key <key>` (Yandex Cloud AI Studio). Defaults to `api-key` when the
   * base URL host ends with `cloud.yandex.net`.
   */
  authScheme?: 'bearer' | 'api-key';
  /**
   * Send OpenAI strict `response_format: json_schema`. Only OpenAI itself is known to accept it;
   * ignored for Yandex Cloud, which gets `json_object` or prompt-only JSON.
   */
  strictJsonSchema?: boolean;
  /** Agent-file mode: where `judge-requests.jsonl` / `judge-responses.jsonl` live. Default `.surveyquorum`. */
  agentDir?: string;
}

export const CONFIG_FILE = 'surveyquorum.config.json';

/**
 * Keys accepted in `surveyquorum.config.json`; camelCase versions of the env variables.
 *
 * OpenAI:        { "provider": "openai-compatible", "apiKey": "...", "model": "<mini model>", "arbiterModel": "<flagship>" }
 * Ollama:        { "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "<local model>" }
 * Yandex Cloud:  { "provider": "openai-compatible", "baseUrl": "https://llm.api.cloud.yandex.net/v1",
 *                  "apiKey": "<Yandex Cloud API key>", "authScheme": "api-key",
 *                  "model": "gpt://<folder_id>/yandexgpt/latest",
 *                  "arbiterModel": "gpt://<folder_id>/qwen3-235b-a22b-fp8/latest" }
 *                — Qwen served by Yandex uses the same `gpt://<folder_id>/<model>/latest` id format;
 *                  `authScheme` may be omitted, it defaults to `api-key` for that host.
 * Anthropic:     { "provider": "anthropic", "apiKey": "...", "model": "<haiku-class>", "arbiterModel": "<sonnet-class>" }
 * Agent mode:    { "provider": "agent-file" }  (or just `--llm agent` on the CLI)
 */
interface ConfigFile {
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  arbiterModel?: string;
  cacheDir?: string;
  authScheme?: 'bearer' | 'api-key';
  strictJsonSchema?: boolean;
  agentDir?: string;
}

/** Yandex Cloud AI Studio needs `Authorization: Api-Key` and rejects strict `json_schema`. */
export function isYandexCloud(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname.endsWith('cloud.yandex.net');
  } catch {
    return false;
  }
}

export function resolveAuthScheme(
  config: Pick<LlmConfig, 'authScheme' | 'baseUrl'>,
): 'bearer' | 'api-key' {
  return config.authScheme ?? (isYandexCloud(config.baseUrl) ? 'api-key' : 'bearer');
}

const PROVIDERS: ReadonlySet<string> = new Set(['openai-compatible', 'anthropic', 'agent-file']);

/**
 * Read the LLM configuration from the environment (`SURVEYQUORUM_LLM_*`) or, for keys the
 * environment does not set, from `surveyquorum.config.json` in `cwd`. Returns `undefined`
 * when neither names a provider or a model — the engine then runs in statistical mode.
 */
export function loadLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): LlmConfig | undefined {
  let file: ConfigFile = {};
  const path = join(cwd, CONFIG_FILE);
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ConfigFile;
    } catch (e) {
      throw new Error(
        `${CONFIG_FILE} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  const provider = env.SURVEYQUORUM_LLM_PROVIDER ?? file.provider;
  const model = env.SURVEYQUORUM_LLM_MODEL ?? file.model;
  if (!provider && !model) return undefined;

  const resolved = provider ?? 'openai-compatible';
  if (!PROVIDERS.has(resolved)) {
    throw new Error(
      `unknown LLM provider "${resolved}"; expected one of ${[...PROVIDERS].join(', ')}`,
    );
  }
  const classifier = model ?? (resolved === 'agent-file' ? 'agent' : '');
  if (!classifier) {
    throw new Error(
      'LLM provider set but no model: set SURVEYQUORUM_LLM_MODEL or "model" in the config file',
    );
  }
  const arbiter = env.SURVEYQUORUM_LLM_ARBITER_MODEL ?? file.arbiterModel ?? classifier;
  const strict = env.SURVEYQUORUM_LLM_STRICT_JSON_SCHEMA;
  const authScheme = env.SURVEYQUORUM_LLM_AUTH_SCHEME ?? file.authScheme;
  if (authScheme !== undefined && authScheme !== 'bearer' && authScheme !== 'api-key') {
    throw new Error(`unknown LLM auth scheme "${authScheme}"; expected bearer or api-key`);
  }
  return {
    provider: resolved as LlmProvider,
    baseUrl: env.SURVEYQUORUM_LLM_BASE_URL ?? file.baseUrl,
    apiKey: env.SURVEYQUORUM_LLM_API_KEY ?? file.apiKey,
    models: { classifier, arbiter },
    cacheDir: env.SURVEYQUORUM_LLM_CACHE_DIR ?? file.cacheDir,
    authScheme,
    strictJsonSchema:
      strict !== undefined ? strict === '1' || strict === 'true' : file.strictJsonSchema,
    agentDir: env.SURVEYQUORUM_AGENT_DIR ?? file.agentDir,
  };
}
