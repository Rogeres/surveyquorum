import type { Outcome, Verdict } from '../quorum/score.js';

export type ArbiterDecisionKind = 'confirm' | 'overturn' | 'needs_human';
export type SignalSupport = 'supports' | 'does_not_support';
export type ArbiterLang = 'en' | 'ru';

/**
 * How much the arbiter is allowed to release.
 *
 * - `strict` (default) — an overturn stands only when both judges overturn with confidence ≥ 4
 *   and name the same `OverturnCategory`; both confirm → confirm; everything else goes to a
 *   human (`needs_human`), never silently to keep. No tie-break call is made.
 *
 * In every mode `applyArbiter` maps confirm → `block` (a confirmed `review` completes the
 * quorum), overturn → `keep`, needs_human → `review` (a person must look).
 * - `balanced` — two judges, blind tie-break on disagreement; an overturn stands at confidence ≥ 3,
 *   a weaker one goes to a human.
 * - `lenient` — two judges, blind tie-break; any overturn stands. This is the mode the production
 *   measurements in `docs/arbiter.md` refer to.
 */
export type ArbiterStrictness = 'strict' | 'balanced' | 'lenient';

/**
 * The cause a judge names when overturning. `none` on confirm / needs_human, or when no cause
 * fits — in strict mode an overturn without a cause does not stand.
 */
export type OverturnCategory =
  | 'technical_failure'
  | 'design_artifact'
  | 'substantive_content'
  | 'short_branch'
  | 'none';

/** What one judge (or the tie-breaker, mapped onto the winning opinion) said. */
export interface JudgeOpinion {
  judge: 1 | 2;
  decision: ArbiterDecisionKind;
  /** 1 (a guess) … 5 (certain). Self-reported; models are overconfident. */
  confidence: number;
  /** One or two sentences in English for the owner's reviewer. */
  reason: string;
  /** Panel-facing text in the requested language, one ground, ≤ 450 chars. */
  panelText: string;
  perSignal: Record<string, SignalSupport>;
  /** Named cause of an overturn; `none` otherwise. */
  overturnCategory: OverturnCategory;
}

export interface TiebreakOpinion {
  winner: 1 | 2 | 'human';
  confidence: number;
  reason: string;
}

export interface ArbiterDecision {
  responseId: string;
  /** The decision after the strictness rules were applied; `overturn` here always stands. */
  decision: ArbiterDecisionKind;
  confidence: number;
  reason: string;
  panelText: string;
  judges: JudgeOpinion[];
  /** The mode the decision was resolved under. */
  strictness: ArbiterStrictness;
  /** Cause of the overturn (the judges' common cause in strict mode); `none` unless overturned. */
  overturnCategory: OverturnCategory;
  /**
   * True when the case went to a human because the arbiter hesitated — a split, a weak or
   * uncategorised overturn — rather than because both judges asked for a human outright.
   */
  unsure?: boolean;
  /** True when the two judges disagreed and a blind tie-break settled it. */
  tiebreak?: boolean;
  tiebreakOpinion?: TiebreakOpinion;
}

export interface ArbitrateOptions {
  /** Which outcomes get a second opinion. Default: block and review. */
  outcomes?: Outcome[];
  /** Language of `panelText`. Default `en`. */
  lang?: ArbiterLang;
  /** How much the arbiter may release. Default `strict`. */
  strictness?: ArbiterStrictness;
  /** Cohort median seconds per block key (see `cohortMedianDurations`), shown next to each block. */
  cohortMedians?: Record<string, number>;
  /** Parallel LLM calls. Default 4. */
  concurrency?: number;
  log?: (message: string) => void;
}

export interface ArbitrateResult {
  decisions: ArbiterDecision[];
  /** Respondents whose judgement is still pending (agent-file mode); their verdicts stay as they were. */
  pending: string[];
  /** Respondents whose LLM call failed; logged, verdicts untouched. */
  failed: string[];
}

/** Compact record stored on the verdict so that a verdicts file explains itself. */
export interface ArbiterSummary {
  decision: ArbiterDecisionKind;
  confidence: number;
  reason: string;
  tiebreak: boolean;
  /**
   * Outcome before the arbiter was applied. `review` with `decision: 'confirm'` is the quorum
   * completed by the arbiter: the engine asked for a second look and the judge gave it.
   */
  originalOutcome: Outcome;
  /** Mode the decision was made under. */
  strictness: ArbiterStrictness;
  /** Cause of the overturn; `none` unless the verdict was overturned. */
  overturnCategory: OverturnCategory;
}

/** A verdict after `applyArbiter`. The extra fields are absent when no arbiter ran. */
export interface ArbitratedVerdict extends Verdict {
  arbiter?: ArbiterSummary;
  /** Panel-facing text from the arbiter, when it produced one. */
  panelText?: string;
}
