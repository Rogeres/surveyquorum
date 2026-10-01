import type { ChoiceBlock, Survey } from '../../contract/types.js';
import { blockKey, groupByQuestion } from '../shared/cohort.js';
import { type LogStats, logStats, logZ, mean, round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** A choice block is treated as multi-select when the answer has at least this many items... */
export const MULTI_MIN_ANSWER = 2;
/** ...or the option list has at least this many options. */
export const MULTI_MIN_OPTIONS = 5;
/** With known options, "mass" means answer.length >= max(MASS_MIN_ABS, ceil(MASS_SHARE * options)). */
export const MASS_MIN_ABS = 5;
export const MASS_SHARE = 0.7;
/** Without a known option list, "mass" means at least this many selected items. */
export const MASS_UNKNOWN_OPTIONS = 6;
/** `pattern`: at least this many mass blocks with mean pace z at or below PATTERN_MAX_Z. */
export const PATTERN_MIN_BLOCKS = 3;
export const PATTERN_MAX_Z = -1;
/** `heavy_pattern`, route A: at least this many mass blocks with mean pace z at or below HEAVY_MAX_Z. */
export const HEAVY_MIN_BLOCKS = 5;
export const HEAVY_MAX_Z = -1.5;
/**
 * `heavy_pattern`, route B (whole survey): at least FULL_MIN_BLOCKS mass blocks that cover at
 * least FULL_SHARE of the respondent's multi-select blocks, with mean pace z at or below
 * FULL_MAX_Z. One crowded answer is a preference; the same crowd on nearly every multi-select
 * question is the long-string index of careless responding (Curran 2016; Meade & Craig 2012).
 */
export const FULL_MIN_BLOCKS = 3;
export const FULL_SHARE = 0.75;
export const FULL_MAX_Z = -1;
/**
 * A question is multi-select at cohort level when at least this share of its cohort selected
 * two or more options. Single-select questions with a long option list look multi-select on one
 * block (the contract has no mode flag) but never at cohort level; this keeps them out of the
 * denominator of route B.
 */
export const COHORT_MULTI_SHARE = 0.1;
/** A question where at least this share of the cohort is mass is a design artifact. */
export const COHORT_MASS_SHARE = 0.3;

const NAME = 'mass-select';

export function isMultiSelect(b: ChoiceBlock): boolean {
  return (
    b.answer.length >= MULTI_MIN_ANSWER ||
    (b.options !== undefined && b.options.length >= MULTI_MIN_OPTIONS)
  );
}

export function isMass(b: ChoiceBlock): boolean {
  if (!isMultiSelect(b)) return false;
  if (b.options && b.options.length > 0) {
    return b.answer.length >= Math.max(MASS_MIN_ABS, Math.ceil(MASS_SHARE * b.options.length));
  }
  return b.answer.length >= MASS_UNKNOWN_OPTIONS;
}

interface MassBlock {
  index: number;
  z: number | null;
}

/**
 * Cross-question "ticks everything" pattern on multi-select questions. A single crowded
 * answer is a preference; the same crowd on three or more questions, answered fast, is a
 * respondent who is not reading the options.
 */
export const massSelectDetector: Detector = {
  name: NAME,
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const paceByKey = new Map<string, LogStats>();
    const artifactKeys = new Set<string>();
    const eligibleKeys = new Set<string>();
    const multiKeys = new Set<string>();

    for (const [key, group] of groupByQuestion(survey)) {
      const choice = group.filter((g) => g.block.type === 'choice');
      if (choice.length < ctx.minCohort) continue;
      eligibleKeys.add(key);
      const multiCount = choice.filter((g) => (g.block as ChoiceBlock).answer.length >= 2).length;
      if (multiCount / choice.length >= COHORT_MULTI_SHARE) multiKeys.add(key);
      const durations = choice.map((g) => g.block.duration).filter((d) => d > 0);
      if (durations.length >= ctx.minCohort) paceByKey.set(key, logStats(durations));
      const massCount = choice.filter((g) => isMass(g.block as ChoiceBlock)).length;
      if (massCount / choice.length >= COHORT_MASS_SHARE) artifactKeys.add(key);
    }
    if (eligibleKeys.size === 0) {
      ctx.log(
        `${NAME}: no choice question reached the minimum cohort of ${ctx.minCohort}; skipped`,
      );
      return [];
    }

    const out: Evidence[] = [];
    for (const r of survey.responses) {
      const counted: MassBlock[] = [];
      const artifact: number[] = [];
      /** The respondent's blocks on cohort-level multi-select questions, artifact questions excluded. */
      let nMulti = 0;
      r.blocks.forEach((b, index) => {
        if (b.type !== 'choice') return;
        const key = blockKey(b);
        if (!eligibleKeys.has(key)) return;
        if (multiKeys.has(key) && !artifactKeys.has(key)) nMulti++;
        if (!isMass(b)) return;
        if (artifactKeys.has(key)) {
          artifact.push(index);
          return;
        }
        const st = paceByKey.get(key);
        counted.push({ index, z: st && b.duration > 0 ? logZ(b.duration, st) : null });
      });

      if (artifact.length > 0) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'cohort_mass_block',
          strength: 'weak',
          designArtifact: true,
          blocks: artifact,
          summary:
            `Selected most options on ${artifact.length} question(s) where at least ` +
            `${round(COHORT_MASS_SHARE * 100, 0)}% of the cohort did the same; the question, ` +
            'not the respondent, is the likely cause.',
          stats: { nArtifactBlocks: artifact.length, cohortShareThreshold: COHORT_MASS_SHARE },
        });
      }

      const zs = counted.map((m) => m.z).filter((z): z is number => z !== null);
      if (zs.length === 0) continue;
      const meanZ = mean(zs);
      const nMass = counted.length;
      const multiShare = nMulti > 0 ? nMass / nMulti : 0;
      const heavyByCount = nMass >= HEAVY_MIN_BLOCKS && meanZ <= HEAVY_MAX_Z;
      const heavyByCoverage =
        nMass >= FULL_MIN_BLOCKS && multiShare >= FULL_SHARE && meanZ <= FULL_MAX_Z;
      let signal: string | null = null;
      let strength: Evidence['strength'] = 'weak';
      if (heavyByCount || heavyByCoverage) {
        signal = 'heavy_pattern';
        strength = 'strong';
      } else if (nMass >= PATTERN_MIN_BLOCKS && meanZ <= PATTERN_MAX_Z) {
        signal = 'pattern';
      }
      if (!signal) continue;

      out.push({
        responseId: r.id,
        detector: NAME,
        signal,
        strength,
        blocks: counted.map((m) => m.index),
        summary:
          `Selected most options on ${nMass} of ${nMulti} multi-select questions while answering them ` +
          `${round(-meanZ, 2)} sd faster than the cohort on average` +
          (heavyByCoverage && !heavyByCount
            ? ' — the same crowd across the whole survey, not one crowded answer.'
            : '.'),
        stats: {
          nMass,
          nMulti,
          multiShare: round(multiShare, 3),
          meanZ: round(meanZ, 3),
          nWithPace: zs.length,
          nArtifactBlocks: artifact.length,
        },
      });
    }
    return out;
  },
};
