import type { LlmClient, LlmRequest, LlmResponse } from '../detectors/types.js';
import { type CachedLlmClient, withCache } from './cache.js';

/**
 * A client that answers only from a recorded cache and never calls a model.
 *
 * Used when a cache directory is given but no provider is configured — the shipped demo
 * (`examples/llm-cache/`) is the main case. A request that is not in the cache comes back as
 * `pending`, so the detectors skip it and the run summary shows how many judgements are
 * missing instead of failing or silently dropping them.
 */
export function createCacheOnlyClient(cacheDir: string): CachedLlmClient {
  const miss: LlmClient = {
    complete(_request: LlmRequest): Promise<LlmResponse> {
      return Promise.resolve({ json: null, pending: true });
    },
  };
  return withCache(miss, cacheDir);
}
