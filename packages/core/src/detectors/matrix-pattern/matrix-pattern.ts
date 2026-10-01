import type { MatrixBlock, Response, Survey } from '../../contract/types.js';
import { groupByQuestion } from '../shared/cohort.js';
import { logStats, logZ, mean, round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence } from '../types.js';

/** A matrix needs this many answered rows before a pattern means anything. */
export const MIN_MATRIX_ROWS = 4;
/** Consecutive scale blocks with the identical answer that count as one patterned unit. */
export const MIN_SCALE_RUN = 5;
/** Share of patterned units (of all units) a respondent needs to be called a straightliner. */
export const PATTERNED_UNIT_SHARE = 0.5;
/** Minimum number of patterned units. */
export const MIN_PATTERNED_UNITS = 2;
/**
 * `straightline_full`: the pattern covers the whole survey. At least this many patterned units …
 * (Curran 2016; Meade & Craig 2012: the long-string index is strong on its own once it spans the
 * questionnaire rather than one grid.)
 */
export const FULL_MIN_PATTERNED_UNITS = 3;
/** … and they are at least this share of all the respondent's units. */
export const FULL_PATTERNED_UNIT_SHARE = 0.75;
/** Mean log-duration z over patterned matrices at or below which the pattern becomes strong. */
export const FAST_MEAN_Z = -1.5;
/** A matrix that is flat for at least this share of the cohort is a uniform battery, not a fault. */
export const FLAT_COHORT_SHARE = 0.4;

export type MatrixPattern = 'flat' | 'zigzag' | 'diagonal';

/** First value of every answered row, in row order. Unanswered rows are dropped. */
export function matrixRowValues(b: MatrixBlock): string[] {
  const out: string[] = [];
  for (const row of Object.values(b.answer)) {
    const v = row[0]?.trim() ?? '';
    if (v !== '') out.push(v);
  }
  return out;
}

/**
 * Option order derived from the cohort's observed values: only when every value is numeric and
 * there are at least three distinct values. Returns value → rank, or null when not derivable.
 */
export function deriveOptionOrder(values: Iterable<string>): Map<string, number> | null {
  const distinct = new Set<string>();
  for (const v of values) {
    if (v === '' || !Number.isFinite(Number(v))) return null;
    distinct.add(v);
  }
  if (distinct.size < 3) return null;
  const sorted = [...distinct].sort((a, b) => Number(a) - Number(b));
  return new Map(sorted.map((v, i) => [v, i]));
}

export function detectPattern(
  values: string[],
  order: Map<string, number> | null,
): MatrixPattern | null {
  if (values.length < MIN_MATRIX_ROWS) return null;
  const distinct = new Set(values);
  if (distinct.size === 1) return 'flat';
  if (distinct.size === 2) {
    let alternating = true;
    for (let i = 1; i < values.length; i++) {
      if (values[i] === values[i - 1]) {
        alternating = false;
        break;
      }
    }
    if (alternating) return 'zigzag';
  }
  if (order && distinct.size === values.length) {
    const ranks = values.map((v) => order.get(v));
    if (ranks.every((r) => r !== undefined)) {
      const rs = ranks as number[];
      let up = true;
      let down = true;
      for (let i = 1; i < rs.length; i++) {
        if (rs[i] <= rs[i - 1]) up = false;
        if (rs[i] >= rs[i - 1]) down = false;
      }
      if (up || down) return 'diagonal';
    }
  }
  return null;
}

interface MatrixUnit {
  index: number;
  pattern: MatrixPattern | null;
  durationZ: number;
  /** The whole cohort is flat here; excluded from the tally. */
  artifact: boolean;
  cohortFlatShare: number;
}

interface ScaleRun {
  indexes: number[];
  patterned: boolean;
  value: string | null;
}

/** Maximal runs of consecutive scale blocks of length ≥ MIN_SCALE_RUN; patterned when a sub-run of ≥ MIN_SCALE_RUN identical answers exists. */
export function scaleRuns(r: Response): ScaleRun[] {
  const runs: ScaleRun[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= MIN_SCALE_RUN) {
      let best: string | null = null;
      let streak = 0;
      let prev: string | null = null;
      for (const i of current) {
        const b = r.blocks[i];
        const v = b.type === 'scale' ? b.answer.trim() : '';
        if (v !== '' && v === prev) streak++;
        else streak = v === '' ? 0 : 1;
        prev = v === '' ? null : v;
        if (streak >= MIN_SCALE_RUN) best = v;
      }
      runs.push({ indexes: current, patterned: best !== null, value: best });
    }
    current = [];
  };
  r.blocks.forEach((b, i) => {
    if (b.type === 'scale') current.push(i);
    else flush();
  });
  flush();
  return runs;
}

export const matrixPatternDetector: Detector = {
  name: 'matrix-pattern',
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const perResponse = new Map<string, MatrixUnit[]>();
    const add = (id: string, u: MatrixUnit) => {
      const list = perResponse.get(id) ?? [];
      list.push(u);
      perResponse.set(id, list);
    };

    for (const [, cohort] of groupByQuestion(survey)) {
      const items: { id: string; index: number; values: string[]; duration: number }[] = [];
      for (const cb of cohort) {
        if (cb.block.type !== 'matrix') continue;
        const values = matrixRowValues(cb.block);
        if (values.length < MIN_MATRIX_ROWS) continue;
        items.push({ id: cb.response.id, index: cb.index, values, duration: cb.block.duration });
      }
      if (items.length < ctx.minCohort) continue;

      const order = deriveOptionOrder(items.flatMap((it) => it.values));
      const stats = logStats(items.map((it) => it.duration));
      const patterns = items.map((it) => detectPattern(it.values, order));
      const flatShare = patterns.filter((p) => p === 'flat').length / items.length;
      const artifact = flatShare >= FLAT_COHORT_SHARE;

      items.forEach((it, i) => {
        add(it.id, {
          index: it.index,
          pattern: patterns[i],
          durationZ: logZ(it.duration, stats),
          artifact: artifact && patterns[i] === 'flat',
          cohortFlatShare: flatShare,
        });
      });
    }

    const evidence: Evidence[] = [];
    for (const r of survey.responses) {
      const matrices = perResponse.get(r.id) ?? [];
      const artifacts = matrices.filter((m) => m.artifact);
      if (artifacts.length > 0) {
        const share = Math.max(...artifacts.map((m) => m.cohortFlatShare));
        evidence.push({
          responseId: r.id,
          detector: 'matrix-pattern',
          signal: 'cohort_flat_matrix',
          strength: 'weak',
          designArtifact: true,
          summary: `${artifacts.length} flat matrix answer(s) on blocks where ${round(share * 100, 0)}% of the cohort is flat — a uniform battery, not a respondent fault.`,
          stats: { matrices: artifacts.length, cohortFlatShare: round(share, 3) },
          blocks: artifacts.map((m) => m.index),
        });
      }

      const counted = matrices.filter((m) => !m.artifact);
      const runs = scaleRuns(r);
      const units = counted.length + runs.length;
      const patternedMatrices = counted.filter((m) => m.pattern !== null);
      const patternedRuns = runs.filter((s) => s.patterned);
      const patterned = patternedMatrices.length + patternedRuns.length;
      if (units === 0 || patterned < MIN_PATTERNED_UNITS) continue;
      const share = patterned / units;
      if (share < PATTERNED_UNIT_SHARE) continue;

      const meanZ =
        patternedMatrices.length > 0 ? mean(patternedMatrices.map((m) => m.durationZ)) : null;
      const fast = meanZ !== null && meanZ <= FAST_MEAN_Z;
      const full = patterned >= FULL_MIN_PATTERNED_UNITS && share >= FULL_PATTERNED_UNIT_SHARE;
      const kinds = [
        ...patternedMatrices.map((m) => m.pattern as string),
        ...patternedRuns.map(() => 'scale_run'),
      ];
      const blocks = [
        ...patternedMatrices.map((m) => m.index),
        ...patternedRuns.flatMap((s) => s.indexes),
      ].sort((a, b) => a - b);

      // Strongest first: speed is the most specific explanation, then whole-survey coverage.
      let signal = 'straightline';
      let summary = `${patterned} of ${units} rating units are patterned (${kinds.join(', ')}); without reverse-coded items this alone is only a weak sign.`;
      if (fast) {
        signal = 'straightline_fast';
        summary = `${patterned} of ${units} rating units are patterned (${kinds.join(', ')}) and the patterned matrices were filled at a mean log-time z of ${round(meanZ as number)} — straightlining at speed.`;
      } else if (full) {
        signal = 'straightline_full';
        summary = `${patterned} of ${units} rating units are patterned (${kinds.join(', ')}) — the same pattern across the whole survey, the long-string index of careless responding.`;
      }

      evidence.push({
        responseId: r.id,
        detector: 'matrix-pattern',
        signal,
        strength: fast || full ? 'strong' : 'weak',
        summary,
        stats: {
          units,
          patternedUnits: patterned,
          patternedShare: round(share, 3),
          patternedMatrices: patternedMatrices.length,
          patternedScaleRuns: patternedRuns.length,
          patterns: kinds.join(','),
          meanDurationZ: meanZ === null ? null : round(meanZ),
        },
        blocks,
      });
    }
    return evidence;
  },
};
