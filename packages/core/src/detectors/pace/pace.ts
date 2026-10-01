import type { Survey } from '../../contract/types.js';
import { blockKey, groupByQuestion, totalDuration } from '../shared/cohort.js';
import { type LogStats, logStats, logZ, median, round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** A block is "fast" when its log-time z-score is at or below this. */
export const FAST_Z = -2;
/** A block is "extreme" when its log-time z-score is at or below this. */
export const EXTREME_Z = -3;
/** `consistent` fires at this many fast blocks… */
export const CONSISTENT_MIN_FAST = 3;
/** …or when the median z over scored blocks is at or below this. */
export const CONSISTENT_MEDIAN_Z = -1.5;
/** Median-z rules and the cohort total need at least this many scored blocks per respondent. */
export const MIN_SCORED_FOR_MEDIAN = 5;
/** `fast_cluster`: 1–2 fast blocks and total time below this share of the cohort median total. */
export const FAST_CLUSTER_RATIO = 0.5;
/** `whole_survey_fast`: no fast block but total time below this share of the cohort median total. */
export const WHOLE_SURVEY_RATIO = 1 / 3;

const NAME = 'pace';

interface Scored {
  index: number;
  z: number;
}

/**
 * Per-question speed profile. Every question with a large enough cohort gets log-time
 * statistics; each respondent's blocks are then measured in cohort standard deviations.
 * Consistent speed across many questions is the strong signal; one extreme block or a
 * short total alone are weak — short branches and skimmed instructions look the same.
 */
export const paceDetector: Detector = {
  name: NAME,
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const statsByKey = new Map<string, LogStats>();
    for (const [key, blocks] of groupByQuestion(survey)) {
      const durations = blocks.map((b) => b.block.duration).filter((d) => d > 0);
      if (durations.length >= ctx.minCohort) statsByKey.set(key, logStats(durations));
    }
    if (statsByKey.size === 0) {
      ctx.log(`${NAME}: no question reached the minimum cohort of ${ctx.minCohort}; skipped`);
      return [];
    }

    const scored = new Map<string, Scored[]>();
    for (const r of survey.responses) {
      const list: Scored[] = [];
      r.blocks.forEach((b, index) => {
        if (!(b.duration > 0)) return;
        const st = statsByKey.get(blockKey(b));
        if (st) list.push({ index, z: logZ(b.duration, st) });
      });
      scored.set(r.id, list);
    }

    const fullTotals = survey.responses
      .filter((r) => (scored.get(r.id)?.length ?? 0) >= MIN_SCORED_FOR_MEDIAN)
      .map((r) => totalDuration(r))
      .filter((t) => t > 0);
    const cohortMedianTotal = fullTotals.length >= ctx.minCohort ? median(fullTotals) : null;

    const out: Evidence[] = [];
    for (const r of survey.responses) {
      const list = scored.get(r.id) ?? [];
      if (list.length === 0) continue;
      const nScored = list.length;
      const fast2 = list.filter((s) => s.z <= FAST_Z);
      const fast3 = list.filter((s) => s.z <= EXTREME_Z);
      const nFast2 = fast2.length;
      const nFast3 = fast3.length;
      const medZ = nScored >= MIN_SCORED_FOR_MEDIAN ? median(list.map((s) => s.z)) : null;
      const total = totalDuration(r);
      const ratio = cohortMedianTotal && total > 0 ? total / cohortMedianTotal : null;

      let signal: string | null = null;
      let strength: Evidence['strength'] = 'weak';
      let summary = '';
      let blocks: number[] | undefined;

      const totalPhrase =
        cohortMedianTotal !== null
          ? `total ${round(total, 0)} s vs cohort median ${round(cohortMedianTotal, 0)} s`
          : `total ${round(total, 0)} s`;

      if (nFast2 >= CONSISTENT_MIN_FAST || (medZ !== null && medZ <= CONSISTENT_MEDIAN_Z)) {
        signal = 'consistent';
        strength = 'strong';
        blocks = (fast2.length > 0 ? fast2 : list.filter((s) => s.z < 0)).map((s) => s.index);
        summary =
          `Faster than the cohort by 2σ or more on ${nFast2} of ${nScored} questions` +
          (medZ !== null ? ` (median z ${round(medZ, 2)})` : '') +
          `; ${totalPhrase}.`;
      } else if (nFast2 >= 1 && nFast2 <= 2 && ratio !== null && ratio < FAST_CLUSTER_RATIO) {
        signal = 'fast_cluster';
        blocks = fast2.map((s) => s.index);
        summary =
          `${nFast2} of ${nScored} questions answered 2σ faster than the cohort and ` +
          `${totalPhrase} (${round(ratio * 100, 0)}% of the median).`;
      } else if (nFast3 >= 1 && nFast2 <= 1) {
        signal = 'single_outlier';
        blocks = fast3.map((s) => s.index);
        summary =
          `One isolated block answered 3σ faster than the cohort (z ${round(fast3[0].z, 2)}); ` +
          `the other ${nScored - 1} scored questions are at normal pace; ${totalPhrase}.`;
      } else if (nFast2 === 0 && ratio !== null && ratio < WHOLE_SURVEY_RATIO) {
        signal = 'whole_survey_fast';
        summary =
          `No single question stands out, but ${totalPhrase} ` +
          `(${round(ratio * 100, 0)}% of the median). Short branches look like this too.`;
      }

      if (!signal) continue;
      out.push({
        responseId: r.id,
        detector: NAME,
        signal,
        strength,
        summary,
        blocks,
        stats: {
          nScored,
          nFast2,
          nFast3,
          medZ: medZ === null ? null : round(medZ, 3),
          totalSec: round(total, 1),
          cohortMedianSec: cohortMedianTotal === null ? null : round(cohortMedianTotal, 1),
          ratio: ratio === null ? null : round(ratio, 3),
          shareFast2: round(nFast2 / nScored, 3),
        },
      });
    }
    return out;
  },
};
