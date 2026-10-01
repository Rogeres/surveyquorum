import type { Survey } from '../../contract/types.js';
import { blockKey, groupByQuestion, openText } from '../shared/cohort.js';
import { round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** Normalized texts shorter than this are ignored. */
export const MIN_TEXT_LENGTH = 3;
/** Repeats of non-answers become `empty_repeat` from this many distinct questions. */
export const EMPTY_REPEAT_MIN = 3;
/** Substantive text repeated on at least this many distinct questions is `x3`. */
export const X3_MIN_QUESTIONS = 3;
/** A question where at least this share of the cohort gives the same text is a design artifact. */
export const COHORT_SAME_SHARE = 0.3;

/** Placeholder answers (English and Russian). Repeating them is a weak signal only. */
export const NON_ANSWER: ReadonlySet<string> = new Set([
  'no',
  'none',
  'nothing',
  'n/a',
  'idk',
  "don't know",
  'dont know',
  'нет',
  'не знаю',
  'ничего',
  'затрудняюсь ответить',
  'норм',
  'ок',
  'ok',
]);

const NAME = 'duplicate-open';

/** Lower-case, trim, collapse whitespace, strip trailing punctuation. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s.,!?;:-]+$/u, '')
    .trim();
}

/**
 * Normalized text that takes part in the comparison: a known placeholder (whatever its length)
 * or a substantive text of at least MIN_TEXT_LENGTH characters. Empty otherwise.
 */
export function comparableText(text: string): string {
  const t = normalizeText(text);
  if (NON_ANSWER.has(t)) return t;
  return t.length < MIN_TEXT_LENGTH ? '' : t;
}

interface TextEntry {
  keys: Set<string>;
  blocks: number[];
}

/**
 * The same text pasted into different open questions by one respondent. Three distinct
 * questions with one substantive text is the strong signal; two is weak (a sincere "see
 * above" happens). Repeated non-answers are weak on their own.
 */
export const duplicateOpenDetector: Detector = {
  name: NAME,
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    // (question key, normalized text) pairs that a large share of the cohort shares.
    const artifactShare = new Map<string, number>();
    let anyOpenCohort = false;
    for (const [key, group] of groupByQuestion(survey)) {
      const open = group.filter((g) => g.block.type === 'open');
      if (open.length < ctx.minCohort) continue;
      anyOpenCohort = true;
      const counts = new Map<string, number>();
      for (const g of open) {
        const t = comparableText(openText(g.block));
        if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      for (const [t, c] of counts) {
        const share = c / open.length;
        if (share >= COHORT_SAME_SHARE) artifactShare.set(`${key} ${t}`, share);
      }
    }
    if (!anyOpenCohort) {
      ctx.log(`${NAME}: no open question reached the minimum cohort of ${ctx.minCohort}; skipped`);
      return [];
    }

    const out: Evidence[] = [];
    for (const r of survey.responses) {
      const byText = new Map<string, TextEntry>();
      const artifactBlocks: number[] = [];
      let maxArtifactShare = 0;
      const emptyKeys = new Set<string>();
      const emptyBlocks: number[] = [];

      r.blocks.forEach((b, index) => {
        if (b.type !== 'open') return;
        const t = comparableText(openText(b));
        if (!t) return;
        const key = blockKey(b);
        const share = artifactShare.get(`${key} ${t}`);
        if (share !== undefined) {
          artifactBlocks.push(index);
          maxArtifactShare = Math.max(maxArtifactShare, share);
          return;
        }
        if (NON_ANSWER.has(t)) {
          emptyKeys.add(key);
          emptyBlocks.push(index);
          return;
        }
        let entry = byText.get(t);
        if (!entry) {
          entry = { keys: new Set(), blocks: [] };
          byText.set(t, entry);
        }
        entry.keys.add(key);
        entry.blocks.push(index);
      });

      if (artifactBlocks.length > 0) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'cohort_same_answer',
          strength: 'weak',
          designArtifact: true,
          blocks: artifactBlocks,
          summary:
            `Gave the same text as at least ${round(COHORT_SAME_SHARE * 100, 0)}% of the cohort on ` +
            `${artifactBlocks.length} open question(s); the question invites one answer.`,
          stats: {
            nArtifactBlocks: artifactBlocks.length,
            maxCohortShare: round(maxArtifactShare, 3),
          },
        });
      }

      // Strongest repeated substantive text: the one on the most distinct questions.
      let best: { text: string; keys: number; blocks: number[] } | null = null;
      for (const [text, entry] of byText) {
        if (entry.keys.size < 2) continue;
        if (!best || entry.keys.size > best.keys) {
          best = { text, keys: entry.keys.size, blocks: entry.blocks };
        }
      }

      if (best) {
        const strong = best.keys >= X3_MIN_QUESTIONS;
        const excerpt = best.text.length > 60 ? `${best.text.slice(0, 57)}...` : best.text;
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: strong ? 'x3' : 'x2',
          strength: strong ? 'strong' : 'weak',
          blocks: best.blocks,
          summary: `The same text "${excerpt}" appears on ${best.keys} different open questions.`,
          stats: { nQuestions: best.keys, textLength: best.text.length },
        });
        continue;
      }

      if (emptyKeys.size >= EMPTY_REPEAT_MIN) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'empty_repeat',
          strength: 'weak',
          blocks: emptyBlocks,
          summary:
            `Placeholder answers ("no", "nothing", "don't know") on ${emptyKeys.size} ` +
            'different open questions.',
          stats: { nQuestions: emptyKeys.size },
        });
      }
    }
    return out;
  },
};
