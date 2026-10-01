import {
  DEFAULT_WEIGHTS,
  isBayesian,
  logit,
  sigmoid,
  type WeightEntry,
  type Weights,
  weightSource,
} from 'surveyquorum';
import { arg, consoleIo, type Io, readJson, wantsHelp } from './shared.js';

export const WEIGHTS_USAGE = 'surveyquorum weights [--file <weights.json>]';

const llrOf = (v: number | WeightEntry): number => (typeof v === 'number' ? v : v.llr);
const fmt = (x: number, d = 3): string => (x >= 0 ? '+' : '') + x.toFixed(d);

/**
 * Read a weights file (hand-written or produced by `calibration/fit-weights.ts`). The same
 * check serves `weights --file` and `run --weights`; throws with a one-line reason.
 */
export function loadWeightsFile(path: string): Weights {
  let parsed: Partial<Weights>;
  try {
    parsed = readJson(path) as Partial<Weights>;
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.weights || !parsed.thresholds) {
    throw new Error(`${path}: expected a weights file with "weights" and "thresholds"`);
  }
  if (!parsed.defaults) {
    throw new Error(`${path}: expected a weights file with "defaults" (strong, weak, positive)`);
  }
  return parsed as Weights;
}

/** Human-readable table of the active weights, strongest first, with provenance. */
export function formatWeights(w: Weights): string {
  const lines: string[] = [];
  lines.push(`weights ${w.version}`);
  lines.push(`  ${w.provenance}`);
  lines.push('');
  if (isBayesian(w)) {
    const prior = w.prior as number;
    lines.push(
      `prior ${prior} (base rate of junk; log-odds ${fmt(logit(prior))})  ` +
        `block at p ≥ ${w.thresholds.block}, review at p ≥ ${w.thresholds.review}`,
    );
    lines.push(
      'score = logit(prior) + Σ LLR over distinct detector.signal; p = sigmoid(score). "alone" = p when only that signal fires.',
    );
  } else {
    lines.push(
      `legacy additive form: block at score ≥ ${w.thresholds.block}, review at ≥ ${w.thresholds.review}`,
    );
  }
  lines.push(
    `defaults when a signal has no entry: strong ${fmt(w.defaults.strong)}, weak ${fmt(w.defaults.weak)}, positive ${fmt(w.defaults.positive)}`,
  );
  lines.push('');

  const rows = Object.keys(w.weights)
    .map((key) => ({ key, llr: llrOf(w.weights[key]), source: weightSource(key, w) ?? '' }))
    .sort((a, b) => b.llr - a.llr || a.key.localeCompare(b.key));
  const keyWidth = Math.max(6, ...rows.map((r) => r.key.length));
  const bayes = isBayesian(w);
  lines.push(`${'signal'.padEnd(keyWidth)}  ${'LLR'.padStart(7)}${bayes ? '  alone' : ''}  source`);
  for (const r of rows) {
    const alone = bayes ? `  ${sigmoid(logit(w.prior as number) + r.llr).toFixed(3)}` : '';
    lines.push(`${r.key.padEnd(keyWidth)}  ${fmt(r.llr).padStart(7)}${alone}  ${r.source}`);
  }
  const assumed = rows.filter((r) => /^assumed/i.test(r.source)).length;
  const measured = rows.filter((r) => /^measured/i.test(r.source)).length;
  lines.push('');
  lines.push(
    `${rows.length} weights: ${measured} measured, ${assumed} assumed, ${rows.length - measured - assumed} without a source.`,
  );
  return lines.join('\n');
}

export function weightsCommand(rest: string[], io: Io = consoleIo): number {
  if (wantsHelp(rest)) {
    io.out(WEIGHTS_USAGE);
    return 0;
  }
  const file = arg(rest, '--file');
  let w: Weights = DEFAULT_WEIGHTS;
  if (file) {
    try {
      w = loadWeightsFile(file);
    } catch (err) {
      io.err(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  io.out(formatWeights(w));
  return 0;
}
