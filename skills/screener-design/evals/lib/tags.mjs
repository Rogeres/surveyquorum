// promptfoo may hand YAML lists to graders as JSON strings; normalize.
export function arr(v) { if (Array.isArray(v)) return v; if (v == null || v === '') return []; if (typeof v === 'string') { try { const j = JSON.parse(v); return Array.isArray(j) ? j : [v]; } catch { return v.split(',').map((s) => s.trim()).filter(Boolean); } } return [v]; }
// Deterministic graders over the skill's answer. Used from cases/*.yaml via `javascript: file://lib/tags.mjs:<fn>`.
const TAGS_RE = /(?:^|\n)\W*tags\W*:\s*(.*)/i;
// code -> slug, read from TAGS.md so the graders follow the catalog
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const CODE2SLUG = Object.fromEntries([...readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'TAGS.md'), 'utf8').matchAll(/^\| `([A-D]\d+)` \| ([a-z-]+) \|/gm)].map((m) => [m[1], m[2]]));
export function parseTags(output) {
  const m = TAGS_RE.exec(output);
  if (!m) return null;
  const line = m[1].trim();
  if (/^none\b/i.test(line)) return new Set();
  return new Set([...line.matchAll(/\b([a-z]+(?:-[a-z]+)*|[A-D]\d{1,2})@(S\d+|B\d+|screener|body)\b/g)].map((x) => `${CODE2SLUG[x[1]] ?? x[1]}@${x[2]}`));
}
const WHOLE = new Set(['no-screener', 'long-screener', 'body-contradiction']);
const norm = (t) => (WHOLE.has(t.split('@')[0]) ? t.split('@')[0] : t);
/** every expected tag is present (whole-draft tags match on slug only) */
export function expectTags(output, { vars }) {
  const found = parseTags(output);
  if (!found) return { pass: false, score: 0, reason: 'no tags line' };
  const have = new Set([...found].map(norm));
  const missing = arr(vars.expect).filter((t) => !have.has(norm(t)));
  return { pass: missing.length === 0, score: 1 - missing.length / Math.max(1, arr(vars.expect).length), reason: missing.length ? `missing: ${missing.join(', ')}` : 'all expected tags present' };
}
/** none of the forbidden tags (known false alarms) is present */
export function rejectTags(output, { vars }) {
  const found = parseTags(output);
  if (!found) return { pass: false, score: 0, reason: 'no tags line' };
  const have = new Set([...found].map(norm));
  const hit = arr(vars.reject).filter((t) => have.has(norm(t)));
  return { pass: hit.length === 0, score: hit.length ? 0 : 1, reason: hit.length ? `false alarm: ${hit.join(', ')}` : 'no forbidden tags' };
}
/** clean control: the tags line must be `none` */
export function expectNone(output) {
  const found = parseTags(output);
  if (!found) return { pass: false, score: 0, reason: 'no tags line' };
  return { pass: found.size === 0, score: found.size ? 0 : 1, reason: found.size ? `flagged a clean screener: ${[...found].join(', ')}` : 'none, as expected' };
}
/** precision guard: at most `maxExtra` tags beyond expect ∪ tolerated */
export function limitExtras(output, { vars }) {
  const found = parseTags(output);
  if (!found) return { pass: false, score: 0, reason: 'no tags line' };
  const ok = new Set([...arr(vars.expect), ...arr(vars.tolerate)].map(norm));
  const extra = [...found].map(norm).filter((t) => !ok.has(t));
  const max = Number(vars.maxExtra ?? 3);
  return { pass: extra.length <= max, score: Math.max(0, 1 - extra.length / (max + 1)), reason: extra.length ? `extra: ${extra.join(', ')}` : 'no extras' };
}
