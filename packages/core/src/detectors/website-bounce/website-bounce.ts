import type { Survey, WebsiteBlock } from '../../contract/types.js';
import { blockKey, groupByQuestion } from '../shared/cohort.js';
import { type LogStats, logStats, logZ, round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** A website task bounces when its log-time z is at or below this... */
export const BOUNCE_Z = -2;
/** ...or when the respondent gave up in under this many seconds. */
export const GIVE_UP_BOUNCE_SEC = 5;
/** `repeated_bounce`: at least this many bounced tasks. */
export const REPEATED_MIN = 2;
/** A single bounce only counts when the cohort median for that task is at least this long. */
export const SINGLE_BOUNCE_MIN_MEDIAN_SEC = 20;
/** A task where at least this share of the cohort bounces is a design artifact. */
export const COHORT_BOUNCE_SHARE = 0.1;

const NAME = 'website-bounce';

function bounces(b: WebsiteBlock, st: LogStats): boolean {
  if (!(b.duration > 0)) return false;
  return logZ(b.duration, st) <= BOUNCE_Z || (b.gaveUp && b.duration < GIVE_UP_BOUNCE_SEC);
}

interface Bounced {
  index: number;
  z: number;
  medianSec: number;
  gaveUp: boolean;
  duration: number;
}

/**
 * Live-website tasks (`website` blocks). A respondent sent to a real site with a task who
 * returns in a few seconds did not do the task. Two such bounces are strong; one is weak and
 * only counts when the cohort actually spent time on the task.
 */
export const websiteBounceDetector: Detector = {
  name: NAME,
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const statsByKey = new Map<string, LogStats>();
    const artifactKeys = new Set<string>();
    for (const [key, group] of groupByQuestion(survey)) {
      const tasks = group
        .filter((g) => g.block.type === 'website')
        .map((g) => g.block as WebsiteBlock);
      const durations = tasks.map((t) => t.duration).filter((d) => d > 0);
      if (durations.length < ctx.minCohort) continue;
      const st = logStats(durations);
      statsByKey.set(key, st);
      const n = tasks.filter((t) => bounces(t, st)).length;
      if (n / durations.length >= COHORT_BOUNCE_SHARE) artifactKeys.add(key);
    }
    if (statsByKey.size === 0) {
      ctx.log(`${NAME}: no website task reached the minimum cohort of ${ctx.minCohort}; skipped`);
      return [];
    }

    const out: Evidence[] = [];
    for (const r of survey.responses) {
      const artifact: number[] = [];
      const bounced: Bounced[] = [];
      let nTasks = 0;
      r.blocks.forEach((b, index) => {
        if (b.type !== 'website') return;
        const key = blockKey(b);
        const st = statsByKey.get(key);
        if (!st || !(b.duration > 0)) return;
        if (artifactKeys.has(key)) {
          if (bounces(b, st)) artifact.push(index);
          return;
        }
        nTasks++;
        if (bounces(b, st)) {
          bounced.push({
            index,
            z: logZ(b.duration, st),
            medianSec: st.medianSec,
            gaveUp: b.gaveUp,
            duration: b.duration,
          });
        }
      });

      if (artifact.length > 0) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'cohort_bounce_task',
          strength: 'weak',
          designArtifact: true,
          blocks: artifact,
          summary:
            `Left ${artifact.length} website task(s) almost immediately where at least ` +
            `${round(COHORT_BOUNCE_SHARE * 100, 0)}% of the cohort did the same; the site or the ` +
            'task, not the respondent, is the likely cause.',
          stats: { nArtifactTasks: artifact.length, cohortShareThreshold: COHORT_BOUNCE_SHARE },
        });
      }
      if (bounced.length === 0) continue;

      if (bounced.length >= REPEATED_MIN) {
        const gaveUps = bounced.filter((x) => x.gaveUp).length;
        const detail = bounced
          .map((x) => `${round(x.duration, 0)} s vs median ${round(x.medianSec, 0)} s`)
          .join('; ');
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'repeated_bounce',
          strength: 'strong',
          blocks: bounced.map((x) => x.index),
          summary:
            `Left ${bounced.length} of ${nTasks} website task(s) within seconds (${detail})` +
            (gaveUps > 0 ? `, gave up on ${gaveUps}.` : '.'),
          stats: { nBounced: bounced.length, nTasks, nGaveUp: gaveUps },
        });
        continue;
      }

      const one = bounced[0];
      if (one.medianSec >= SINGLE_BOUNCE_MIN_MEDIAN_SEC) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'bounce',
          strength: 'weak',
          blocks: [one.index],
          summary:
            `Left 1 of ${nTasks} website task(s) after ${round(one.duration, 0)} s while the cohort ` +
            `median is ${round(one.medianSec, 0)} s (z ${round(one.z, 2)})` +
            (one.gaveUp ? ', and gave up.' : '.'),
          stats: {
            nBounced: 1,
            nTasks,
            durationSec: round(one.duration, 1),
            cohortMedianSec: round(one.medianSec, 1),
            z: round(one.z, 3),
            gaveUp: one.gaveUp,
          },
        });
      }
    }
    return out;
  },
};
