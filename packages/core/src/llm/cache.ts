import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmClient, LlmRequest, LlmResponse } from '../detectors/types.js';

export const DEFAULT_CACHE_DIR = '.surveyquorum/llm-cache';

/** What is stored per key. `usage` is kept so that replays can still report what a live run cost. */
export interface CacheEntry {
  json: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  /** Model that produced the answer, when known; informational. */
  model?: string;
  storedAt: string;
}

export interface LlmCache {
  readonly dir: string;
  get(key: string): CacheEntry | undefined;
  /** Best-effort: a read-only directory (e.g. a shipped demo cache) never fails the run. */
  set(key: string, entry: CacheEntry): boolean;
  has(key: string): boolean;
}

/** Path layout: `<dir>/<k[0..2]>/<k[2..4]>/<k>.json` — two hash levels keep directories small. */
export function cachePath(dir: string, key: string): string {
  const k = key.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(dir, k.slice(0, 2), k.slice(2, 4), `${k}.json`);
}

export function createFileCache(dir: string = DEFAULT_CACHE_DIR): LlmCache {
  return {
    dir,
    get(key) {
      const p = cachePath(dir, key);
      if (!existsSync(p)) return undefined;
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as CacheEntry;
      } catch {
        return undefined;
      }
    },
    has(key) {
      return existsSync(cachePath(dir, key));
    },
    set(key, entry) {
      const p = cachePath(dir, key);
      try {
        mkdirSync(join(p, '..'), { recursive: true });
        writeFileSync(p, `${JSON.stringify(entry, null, 2)}\n`);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export interface CachedLlmClient extends LlmClient {
  readonly cache: LlmCache;
  /** Counters for the run summary. */
  readonly stats: { hits: number; misses: number; pending: number };
}

/**
 * Wrap any client with the file cache. Pending answers (agent-file mode) are not cached;
 * everything else is written once and served from disk afterwards, which is what makes a
 * re-run on the demo dataset free and deterministic.
 */
export function withCache(
  client: LlmClient,
  dirOrCache: string | LlmCache = DEFAULT_CACHE_DIR,
): CachedLlmClient {
  const cache = typeof dirOrCache === 'string' ? createFileCache(dirOrCache) : dirOrCache;
  const stats = { hits: 0, misses: 0, pending: 0 };
  return {
    cache,
    stats,
    async complete(request: LlmRequest): Promise<LlmResponse> {
      const hit = cache.get(request.cacheKey);
      if (hit) {
        stats.hits++;
        return { json: hit.json, usage: hit.usage, fromCache: true };
      }
      const res = await client.complete(request);
      if (res.pending) {
        stats.pending++;
        return res;
      }
      stats.misses++;
      cache.set(request.cacheKey, {
        json: res.json,
        usage: res.usage,
        storedAt: new Date().toISOString(),
      });
      return res;
    },
  };
}
