import { createHash } from 'node:crypto';

/** sha256 hex of the parts, each terminated so that ("ab","c") and ("a","bc") differ. */
export function sha256(...parts: string[]): string {
  const h = createHash('sha256');
  for (const p of parts) {
    h.update(p);
    h.update('');
  }
  return h.digest('hex');
}

/** Cache key for an LLM request: role + prompt + schema, so a prompt edit invalidates the entry. */
export function requestCacheKey(role: string, prompt: string, schema: unknown): string {
  return sha256(role, prompt, JSON.stringify(schema));
}
