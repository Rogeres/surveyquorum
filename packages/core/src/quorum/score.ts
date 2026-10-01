import type { Evidence, Strength } from '../detectors/types.js';
import defaultWeights from './weights.json' with { type: 'json' };

export type Outcome = 'block' | 'review' | 'keep';

/** One calibrated weight: a log-likelihood ratio and where the number came from. */
export interface WeightEntry {
  /** ln( P(signal | junk) / P(signal | honest) ). Positive evidence has a negative LLR. */
  llr: number;
  /** Provenance in words — "measured: …" or "assumed: …" — so readers know which numbers to trust. */
  source?: string;
}

/**
 * Weights file. Two forms are accepted:
 *
 * - **v1 (Bayesian)** — `prior` is present. `score = logit(prior) + Σ LLR`, the posterior
 *   `probability = sigmoid(score)` is compared with `thresholds` expressed as probabilities.
 * - **legacy (additive)** — no `prior`. `score = Σ weight`, compared with `thresholds` as raw
 *   scores. Kept so that user files written against the provisional format still load.
 *
 * In both forms a weight may be a bare number or a `WeightEntry` object.
 */
export interface Weights {
  version: string;
  provenance: string;
  /** Base rate of confirmed junk among all respondents, e.g. 0.0225. Its presence selects the Bayesian form. */
  prior?: number;
  /** Fallback weight by strength when a specific `detector.signal` key is absent. */
  defaults: Record<Strength, number>;
  /** Specific weights keyed by `${detector}.${signal}`. */
  weights: Record<string, number | WeightEntry>;
  /** Bayesian form: posterior probabilities in (0, 1). Legacy form: raw score cut-offs. */
  thresholds: { block: number; review: number };
}

export interface Verdict {
  responseId: string;
  outcome: Outcome;
  /** Bayesian form: `logit(prior) + Σ LLR`. Legacy form: the additive score. */
  score: number;
  /** Posterior probability that the respondent is junk, rounded to 3 decimals. Absent in legacy form. */
  probability?: number;
  evidence: Evidence[];
  /** Evidence suppressed as a questionnaire design artifact; reported, not weighed. */
  designArtifacts: Evidence[];
  /** True when the respondent answered no open questions — the engine is blind to content here. */
  noContentToCheck?: boolean;
}

export const DEFAULT_WEIGHTS: Weights = defaultWeights as Weights;

/**
 * Largest magnitude an LLR may carry. With the production prior of 2.25 % a single capped signal
 * reaches a posterior of about 0.67 — inside `review`, never `block`. That is the quorum principle
 * expressed as a number: one signal asks for a second look, two agreeing signals decide.
 */
export const LLR_CAP = 4.5;

export function logit(p: number): number {
  return Math.log(p / (1 - p));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000 || 0; // `|| 0` folds -0 into 0

/**
 * LLR of a signal from its precision — the share of confirmed junk among respondents it selects —
 * given the base rate. `LLR = logit(precision) − logit(prior)`, clipped to `±cap`.
 */
export function llrFromPrecision(precision: number, prior: number, cap = LLR_CAP): number {
  const raw = logit(precision) - logit(prior);
  return Math.max(-cap, Math.min(cap, raw));
}

/** True when the file uses the Bayesian (v1) form. */
export function isBayesian(w: Weights): boolean {
  return typeof w.prior === 'number';
}

const entryLlr = (v: number | WeightEntry): number => (typeof v === 'number' ? v : v.llr);

/** Weight of one `detector.signal` key, or the strength default when the key is absent. */
export function weightForKey(
  key: string,
  strength: Strength,
  w: Weights = DEFAULT_WEIGHTS,
): number {
  if (key in w.weights) return entryLlr(w.weights[key]);
  return w.defaults[strength];
}

export function weightFor(e: Evidence, w: Weights = DEFAULT_WEIGHTS): number {
  return weightForKey(`${e.detector}.${e.signal}`, e.strength, w);
}

/** Provenance text of a specific weight; undefined for bare numbers and strength defaults. */
export function weightSource(key: string, w: Weights = DEFAULT_WEIGHTS): string | undefined {
  const v = w.weights[key];
  return v !== undefined && typeof v !== 'number' ? v.source : undefined;
}

/** Posterior probability of junk for a raw score under the Bayesian form. */
export function probabilityFor(score: number, w: Weights = DEFAULT_WEIGHTS): number | undefined {
  return isBayesian(w) ? sigmoid(score) : undefined;
}

/** Outcome for a Bayesian posterior or a legacy score, depending on the file form. */
export function outcomeFor(value: number, w: Weights = DEFAULT_WEIGHTS): Outcome {
  if (value >= w.thresholds.block) return 'block';
  if (value >= w.thresholds.review) return 'review';
  return 'keep';
}

/**
 * Turn all evidence about a respondent into a verdict. Evidence from the same detector and
 * signal is counted once — repetition within one detector is the detector's job to express
 * through a stronger signal, not through volume.
 *
 * Bayesian form: the signals are treated as conditionally independent given the class, so the
 * posterior log-odds are the prior log-odds plus the sum of the signals' LLRs (naive Bayes).
 */
export function scoreResponse(
  responseId: string,
  evidence: Evidence[],
  w: Weights = DEFAULT_WEIGHTS,
): Verdict {
  const own = evidence.filter((e) => e.responseId === responseId);
  const designArtifacts = own.filter((e) => e.designArtifact);
  const weighed = own.filter((e) => !e.designArtifact);

  const seen = new Set<string>();
  let sum = 0;
  for (const e of weighed) {
    const key = `${e.detector}.${e.signal}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sum += weightFor(e, w);
  }

  if (!isBayesian(w)) {
    const score = round3(sum);
    return { responseId, outcome: outcomeFor(score, w), score, evidence: weighed, designArtifacts };
  }

  const score = round3(logit(w.prior as number) + sum);
  const probability = round3(sigmoid(score));
  return {
    responseId,
    outcome: outcomeFor(probability, w),
    score,
    probability,
    evidence: weighed,
    designArtifacts,
  };
}
