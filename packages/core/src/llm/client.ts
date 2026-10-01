import type { LlmClient } from '../detectors/types.js';
import { AgentFileClient } from './agent-file.js';
import { AnthropicClient } from './anthropic.js';
import { type CachedLlmClient, DEFAULT_CACHE_DIR, withCache } from './cache.js';
import type { LlmConfig } from './config.js';
import type { RetryOptions } from './json-completion.js';
import { OpenAiCompatibleClient } from './openai-compatible.js';

/** Transport only — no cache. Prefer `createLlmClient` unless you wrap the cache yourself. */
export function createRawLlmClient(config: LlmConfig, retry: RetryOptions = {}): LlmClient {
  switch (config.provider) {
    case 'openai-compatible':
      return new OpenAiCompatibleClient(config, retry);
    case 'anthropic':
      return new AnthropicClient(config, retry);
    case 'agent-file':
      return new AgentFileClient(config.agentDir);
    default:
      throw new Error(`unknown LLM provider: ${String((config as LlmConfig).provider)}`);
  }
}

/**
 * Client for a configuration, wrapped in the file cache (`config.cacheDir`, default
 * `.surveyquorum/llm-cache`). Every detector call goes through the cache first, so a second
 * run over the same data costs nothing and agent-mode answers are picked up transparently.
 */
export function createLlmClient(config: LlmConfig, retry: RetryOptions = {}): CachedLlmClient {
  return withCache(createRawLlmClient(config, retry), config.cacheDir ?? DEFAULT_CACHE_DIR);
}
