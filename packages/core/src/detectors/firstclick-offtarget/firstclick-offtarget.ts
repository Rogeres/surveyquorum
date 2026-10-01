import type { FirstClickBlock, Survey } from '../../contract/types.js';
import { groupByQuestion } from '../shared/cohort.js';
import { logStats, logZ, mean, round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** Click density is binned on a GRID × GRID lattice over the 0–1 image. */
export const GRID = 10;
/** A cell holding less than this share of the other cohort clicks is empty for our purpose. */
export const CELL_MIN_SHARE = 0.01;
/** A neighbouring cell holding at least this share makes the click "near a hotspot". */
export const NEIGHBOUR_MIN_SHARE = 0.02;
/** Number of tasks and the maximum pairwise distance for the same-spot clicker. */
export const SAME_SPOT_MIN_TASKS = 3;
export const SAME_SPOT_MAX_DISTANCE = 0.03;
/** Repeated off-density clicks must also be fast to say anything. */
export const REPEATED_MIN_TASKS = 2;
export const REPEATED_MEAN_Z = -1;
/** A task where this share of the cohort is off-density is an unclear image, not a bad cohort. */
export const SCATTERED_COHORT_SHARE = 0.3;

export function validClick(b: FirstClickBlock): boolean {
  const { top, left } = b.answer;
  return (
    Number.isFinite(top) && Number.isFinite(left) && top >= 0 && top <= 1 && left >= 0 && left <= 1
  );
}

export function cellOf(v: number): number {
  return Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)));
}

/**
 * True when the click's cell holds < CELL_MIN_SHARE of the *other* cohort clicks and no 8-neighbour
 * cell holds ≥ NEIGHBOUR_MIN_SHARE. Leave-one-out keeps a respondent from being their own hotspot.
 */
export function isOffDensity(counts: number[], n: number, col: number, row: number): boolean {
  if (n <= 1) return false;
  const others = n - 1;
  const own = counts[row * GRID + col] - 1;
  if (own / others >= CELL_MIN_SHARE) return false;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r = row + dr;
      const c = col + dc;
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) continue;
      if (counts[r * GRID + c] / others >= NEIGHBOUR_MIN_SHARE) return false;
    }
  }
  return true;
}

interface ClickTask {
  index: number;
  top: number;
  left: number;
  /** Null when the task's cohort was too small for density. */
  offDensity: boolean | null;
  durationZ: number | null;
  artifact: boolean;
  cohortOffShare: number;
}

export const firstclickOfftargetDetector: Detector = {
  name: 'firstclick-offtarget',
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const perResponse = new Map<string, ClickTask[]>();
    const add = (id: string, t: ClickTask) => {
      const list = perResponse.get(id) ?? [];
      list.push(t);
      perResponse.set(id, list);
    };

    for (const [, cohort] of groupByQuestion(survey)) {
      const items = cohort.filter(
        (cb): cb is typeof cb & { block: FirstClickBlock } =>
          cb.block.type === 'firstclick' && validClick(cb.block),
      );
      if (items.length === 0) continue;
      if (items.length < ctx.minCohort) {
        for (const it of items) {
          add(it.response.id, {
            index: it.index,
            top: it.block.answer.top,
            left: it.block.answer.left,
            offDensity: null,
            durationZ: null,
            artifact: false,
            cohortOffShare: 0,
          });
        }
        continue;
      }
      const n = items.length;
      const counts = new Array<number>(GRID * GRID).fill(0);
      for (const it of items)
        counts[cellOf(it.block.answer.top) * GRID + cellOf(it.block.answer.left)]++;
      const off = items.map((it) =>
        isOffDensity(counts, n, cellOf(it.block.answer.left), cellOf(it.block.answer.top)),
      );
      const offShare = off.filter(Boolean).length / n;
      const artifact = offShare >= SCATTERED_COHORT_SHARE;
      const durations = logStats(items.map((it) => it.block.duration));
      items.forEach((it, i) => {
        add(it.response.id, {
          index: it.index,
          top: it.block.answer.top,
          left: it.block.answer.left,
          offDensity: off[i],
          durationZ: logZ(it.block.duration, durations),
          artifact: artifact && off[i],
          cohortOffShare: offShare,
        });
      });
    }

    const evidence: Evidence[] = [];
    for (const r of survey.responses) {
      const tasks = perResponse.get(r.id) ?? [];
      if (tasks.length === 0) continue;
      tasks.sort((a, b) => a.index - b.index);

      const artifacts = tasks.filter((t) => t.artifact);
      if (artifacts.length > 0) {
        const share = Math.max(...artifacts.map((t) => t.cohortOffShare));
        evidence.push({
          responseId: r.id,
          detector: 'firstclick-offtarget',
          signal: 'cohort_scattered_clicks',
          strength: 'weak',
          designArtifact: true,
          summary: `Clicked away from every hotspot on ${artifacts.length} task(s) where ${round(share * 100, 0)}% of the cohort did the same — the image or the task was unclear.`,
          stats: { tasks: artifacts.length, cohortOffDensityShare: round(share, 3) },
          blocks: artifacts.map((t) => t.index),
        });
      }

      let maxPair = 0;
      for (let a = 0; a < tasks.length; a++) {
        for (let b = a + 1; b < tasks.length; b++) {
          const d = Math.hypot(tasks[a].top - tasks[b].top, tasks[a].left - tasks[b].left);
          if (d > maxPair) maxPair = d;
        }
      }
      const offTasks = tasks.filter((t) => t.offDensity === true && !t.artifact);
      const meanZ = offTasks.length > 0 ? mean(offTasks.map((t) => t.durationZ as number)) : null;
      const stats: Evidence['stats'] = {
        tasks: tasks.length,
        offDensityTasks: offTasks.length,
        maxPairDistance: round(maxPair, 4),
        meanZ: meanZ === null ? null : round(meanZ),
      };

      if (tasks.length >= SAME_SPOT_MIN_TASKS && maxPair < SAME_SPOT_MAX_DISTANCE) {
        evidence.push({
          responseId: r.id,
          detector: 'firstclick-offtarget',
          signal: 'same_spot',
          strength: 'strong',
          summary: `All ${tasks.length} first clicks land within ${round(maxPair, 3)} of each other regardless of the image.`,
          stats,
          blocks: tasks.map((t) => t.index),
        });
        continue;
      }
      if (offTasks.length >= REPEATED_MIN_TASKS && meanZ !== null && meanZ <= REPEATED_MEAN_Z) {
        evidence.push({
          responseId: r.id,
          detector: 'firstclick-offtarget',
          signal: 'repeated_off_density',
          strength: 'weak',
          summary: `${offTasks.length} of ${tasks.length} first clicks are away from every cohort hotspot and were made at a mean log-time z of ${round(meanZ)}.`,
          stats,
          blocks: offTasks.map((t) => t.index),
        });
      }
    }
    return evidence;
  },
};
