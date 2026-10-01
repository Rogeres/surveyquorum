import type { PrototypeBlock, Survey } from '../../contract/types.js';
import { blockKey, groupByQuestion } from '../shared/cohort.js';
import { type LogStats, logStats, logZ, mean, round, sd } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** A zero-click give-up faster than this is "instant". */
export const INSTANT_GIVE_UP_SEC = 6;
/** This many zero-click give-ups is strong regardless of duration. */
export const INSTANT_GIVE_UP_MIN_TASKS = 2;
/** `low_effort`: at least this many tasks with click z and duration z both at or below LOW_EFFORT_Z. */
export const LOW_EFFORT_MIN_TASKS = 2;
export const LOW_EFFORT_Z = -1.5;
/** A task where at least this share of the cohort gave up with 0 clicks did not load. */
export const COHORT_GIVE_UP_SHARE = 0.1;

const NAME = 'prototype-effort';

interface ClickStats {
  mu: number;
  sigma: number;
}

interface TaskStats {
  clicks: ClickStats;
  duration: LogStats;
}

function zeroClickGiveUp(b: PrototypeBlock): boolean {
  return b.status === 'gave_up' && b.clickCount === 0;
}

function clickZ(b: PrototypeBlock, st: ClickStats): number {
  if (st.sigma <= 1e-9) return 0;
  return (Math.log(Math.max(0, b.clickCount) + 1) - st.mu) / st.sigma;
}

/**
 * Effort on interactive prototype tasks. Pressing "give up" without a single click within
 * seconds is the clearest low-effort act a respondent can perform, unless the prototype did
 * not load for a share of the cohort, in which case it is the survey's fault.
 */
export const prototypeEffortDetector: Detector = {
  name: NAME,
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const statsByKey = new Map<string, TaskStats>();
    const artifactKeys = new Set<string>();
    for (const [key, group] of groupByQuestion(survey)) {
      const tasks = group
        .filter((g) => g.block.type === 'prototype')
        .map((g) => g.block as PrototypeBlock);
      if (tasks.length < ctx.minCohort) continue;
      const logClicks = tasks.map((t) => Math.log(Math.max(0, t.clickCount) + 1));
      statsByKey.set(key, {
        clicks: { mu: mean(logClicks), sigma: sd(logClicks) },
        duration: logStats(tasks.map((t) => t.duration)),
      });
      const giveUps = tasks.filter(zeroClickGiveUp).length;
      if (giveUps / tasks.length >= COHORT_GIVE_UP_SHARE) artifactKeys.add(key);
    }
    if (statsByKey.size === 0) {
      ctx.log(`${NAME}: no prototype task reached the minimum cohort of ${ctx.minCohort}; skipped`);
      return [];
    }

    const out: Evidence[] = [];
    for (const r of survey.responses) {
      const artifact: number[] = [];
      const giveUps: { index: number; duration: number }[] = [];
      const lowEffort: { index: number; cz: number; dz: number }[] = [];
      let nTasks = 0;

      r.blocks.forEach((b, index) => {
        if (b.type !== 'prototype') return;
        const key = blockKey(b);
        const st = statsByKey.get(key);
        if (!st) return;
        if (artifactKeys.has(key)) {
          if (zeroClickGiveUp(b)) artifact.push(index);
          return;
        }
        nTasks++;
        if (zeroClickGiveUp(b)) giveUps.push({ index, duration: b.duration });
        if (b.duration > 0) {
          const cz = clickZ(b, st.clicks);
          const dz = logZ(b.duration, st.duration);
          if (cz <= LOW_EFFORT_Z && dz <= LOW_EFFORT_Z) lowEffort.push({ index, cz, dz });
        }
      });

      if (artifact.length > 0) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'cohort_give_up_task',
          strength: 'weak',
          designArtifact: true,
          blocks: artifact,
          summary:
            `Gave up with no clicks on ${artifact.length} task(s) where at least ` +
            `${round(COHORT_GIVE_UP_SHARE * 100, 0)}% of the cohort did the same; the prototype ` +
            'probably did not load.',
          stats: { nArtifactTasks: artifact.length, cohortShareThreshold: COHORT_GIVE_UP_SHARE },
        });
      }
      if (nTasks === 0) continue;

      const instant = giveUps.filter((g) => g.duration > 0 && g.duration < INSTANT_GIVE_UP_SEC);
      if (instant.length >= 1 || giveUps.length >= INSTANT_GIVE_UP_MIN_TASKS) {
        const fastest = giveUps.reduce((a, g) => (g.duration < a.duration ? g : a), giveUps[0]);
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'instant_give_up',
          strength: 'strong',
          blocks: giveUps.map((g) => g.index),
          summary:
            `Pressed "give up" without a single click on ${giveUps.length} of ${nTasks} prototype ` +
            `task(s); fastest after ${round(fastest.duration, 1)} s.`,
          stats: {
            nGiveUps: giveUps.length,
            nInstant: instant.length,
            nTasks,
            fastestSec: round(fastest.duration, 1),
          },
        });
        continue;
      }
      if (giveUps.length === 1) {
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'zero_click_give_up',
          strength: 'weak',
          blocks: [giveUps[0].index],
          summary:
            `Pressed "give up" without a single click on 1 of ${nTasks} prototype task(s) after ` +
            `${round(giveUps[0].duration, 1)} s. A single case is often a loading problem.`,
          stats: { nGiveUps: 1, nTasks, durationSec: round(giveUps[0].duration, 1) },
        });
        continue;
      }
      if (lowEffort.length >= LOW_EFFORT_MIN_TASKS) {
        const meanClickZ = mean(lowEffort.map((l) => l.cz));
        const meanDurationZ = mean(lowEffort.map((l) => l.dz));
        out.push({
          responseId: r.id,
          detector: NAME,
          signal: 'low_effort',
          strength: 'weak',
          blocks: lowEffort.map((l) => l.index),
          summary:
            `Far fewer clicks and far less time than the cohort on ${lowEffort.length} of ${nTasks} ` +
            `prototype task(s) (click z ${round(meanClickZ, 2)}, time z ${round(meanDurationZ, 2)}).`,
          stats: {
            nLowEffort: lowEffort.length,
            nTasks,
            meanClickZ: round(meanClickZ, 3),
            meanDurationZ: round(meanDurationZ, 3),
          },
        });
      }
    }
    return out;
  },
};
