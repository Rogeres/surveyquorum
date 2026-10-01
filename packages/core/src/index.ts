import type { Dataset, Survey } from './contract/types.js';
import { defaultDetectors } from './detectors/registry.js';
import type { Detector, DetectorContext, Evidence, LlmClient } from './detectors/types.js';
import { DEFAULT_WEIGHTS, scoreResponse, type Verdict, type Weights } from './quorum/score.js';

export * from './adapters/index.js';
export * from './arbiter/index.js';
export * from './complaint/index.js';
export * from './contract/index.js';
export { coherenceDetector, defaultDetectors, openAnswerDetector } from './detectors/registry.js';
export * from './detectors/types.js';
export * from './llm/index.js';
export type { Outcome, Verdict, WeightEntry, Weights } from './quorum/score.js';
export {
  DEFAULT_WEIGHTS,
  isBayesian,
  LLR_CAP,
  llrFromPrecision,
  logit,
  outcomeFor,
  probabilityFor,
  scoreResponse,
  sigmoid,
  weightFor,
  weightForKey,
  weightSource,
} from './quorum/score.js';

export interface RunOptions {
  detectors?: Detector[];
  weights?: Weights;
  llm?: LlmClient;
  /** Minimum cohort size for cohort statistics. Default 30. */
  minCohort?: number;
  log?: (message: string) => void;
}

/**
 * One design artifact as the survey author should see it: the same signal fired for many
 * respondents on the same question, so the question — not the respondents — is the likely
 * cause. One row per (detector, signal, question).
 */
export interface DesignArtifactGroup {
  detector: string;
  signal: string;
  /** The question's `blockId` when the source had one, otherwise its text. */
  blockKey: string;
  question: string;
  /** Distinct respondents the signal fired on for this question. */
  respondents: number;
  /** `respondents / cohort size`, rounded to three decimals. */
  cohortShare: number;
}

export interface SurveyResult {
  surveyId: string;
  verdicts: Verdict[];
  /** Every piece of evidence suppressed as a design artifact (one entry per respondent). */
  designArtifacts: Evidence[];
  /** The same evidence grouped per question for the survey author. */
  designArtifactSummary: DesignArtifactGroup[];
  skippedDetectors: string[];
}

/** Group design-artifact evidence per (detector, signal, question); most respondents first. */
export function summarizeDesignArtifacts(
  survey: Survey,
  evidence: Evidence[],
): DesignArtifactGroup[] {
  const responses = new Map(survey.responses.map((r) => [r.id, r]));
  const groups = new Map<string, { group: DesignArtifactGroup; ids: Set<string> }>();
  for (const e of evidence) {
    if (!e.designArtifact) continue;
    const r = responses.get(e.responseId);
    const indexes: (number | undefined)[] = e.blocks?.length ? e.blocks : [undefined];
    for (const i of indexes) {
      const b = i === undefined ? undefined : r?.blocks[i];
      const blockKey = b ? (b.blockId ?? b.question) : '';
      const question = b ? b.question : '(whole survey)';
      const key = `${e.detector} ${e.signal} ${blockKey}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          group: {
            detector: e.detector,
            signal: e.signal,
            blockKey,
            question,
            respondents: 0,
            cohortShare: 0,
          },
          ids: new Set(),
        };
        groups.set(key, g);
      }
      g.ids.add(e.responseId);
    }
  }
  const cohort = survey.responses.length || 1;
  return [...groups.values()]
    .map(({ group, ids }) => ({
      ...group,
      respondents: ids.size,
      cohortShare: Math.round((ids.size / cohort) * 1000) / 1000,
    }))
    .sort(
      (a, b) =>
        b.respondents - a.respondents ||
        a.detector.localeCompare(b.detector) ||
        a.signal.localeCompare(b.signal) ||
        a.blockKey.localeCompare(b.blockKey),
    );
}

/** What kind of question each cohort-level signal points at, what the respondents did, and the likely cause. */
const ARTIFACT_NOTES: Record<string, { kind: string; did: string; cause: string }> = {
  'prototype-effort.cohort_give_up_task': {
    kind: 'prototype task',
    did: 'gave up with no clicks',
    cause: 'the prototype likely did not load',
  },
  'website-bounce.cohort_bounce_task': {
    kind: 'website task',
    did: 'left the site within seconds',
    cause: 'the site or the task likely did not load',
  },
  'mass-select.cohort_mass_block': {
    kind: 'multi-select question',
    did: 'selected most of the options',
    cause: 'the question invites it',
  },
  'duplicate-open.cohort_same_answer': {
    kind: 'open question',
    did: 'gave the same short text',
    cause: 'the question invites one answer and should probably be a choice question',
  },
  'matrix-pattern.cohort_flat_matrix': {
    kind: 'matrix',
    did: 'gave one rating down the whole grid',
    cause: 'a one-sided battery, not a respondent fault',
  },
  'cardsort-consensus.cohort_single_pile': {
    kind: 'card sort',
    did: 'put every card in one pile',
    cause: 'the task invites it',
  },
  'cardsort-consensus.cohort_unnamed_categories': {
    kind: 'card sort',
    did: 'left the same categories unnamed',
    cause: 'it reads like a closed sort with given labels',
  },
  'firstclick-offtarget.cohort_scattered_clicks': {
    kind: 'first-click task',
    did: 'clicked away from every hotspot',
    cause: 'the image or the task is unclear',
  },
  'coherence.cohort_pair_fires': {
    kind: 'question',
    did: 'contradicted themselves on a pair that includes it',
    cause: 'the two questions are ambiguous',
  },
};

/**
 * One line for the survey author, e.g.
 * `prototype task 'Task 2: …' — 16 respondents (16% of the cohort) gave up with no clicks; the prototype likely did not load`.
 */
export function describeDesignArtifact(g: DesignArtifactGroup): string {
  const note = ARTIFACT_NOTES[`${g.detector}.${g.signal}`] ?? {
    kind: `${g.detector}.${g.signal} on`,
    did: 'triggered the same signal',
    cause: 'the question, not the respondents, is the likely cause',
  };
  const q = g.question.length > 70 ? `${g.question.slice(0, 69)}…` : g.question;
  const pct = Math.round(g.cohortShare * 100);
  return (
    `${note.kind} '${q}' — ${g.respondents} respondent${g.respondents === 1 ? '' : 's'} ` +
    `(${pct}% of the cohort) ${note.did}; ${note.cause}`
  );
}

/** Run every detector over one survey and score each respondent. */
export async function runSurvey(survey: Survey, opts: RunOptions = {}): Promise<SurveyResult> {
  const detectors = opts.detectors ?? defaultDetectors();
  const ctx: DetectorContext = {
    minCohort: opts.minCohort ?? 30,
    llm: opts.llm,
    log: opts.log ?? (() => {}),
  };

  const evidence: Evidence[] = [];
  const skipped: string[] = [];
  for (const d of detectors) {
    if (d.needsLlm && !ctx.llm) {
      skipped.push(d.name);
      continue;
    }
    ctx.log(`${survey.id}: ${d.name}`);
    evidence.push(...(await d.detect(survey, ctx)));
  }

  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const verdicts = survey.responses.map((r) => {
    const v = scoreResponse(r.id, evidence, weights);
    v.noContentToCheck = !r.blocks.some((b) => b.type === 'open');
    return v;
  });

  const designArtifacts = evidence.filter((e) => e.designArtifact);
  return {
    surveyId: survey.id,
    verdicts,
    designArtifacts,
    designArtifactSummary: summarizeDesignArtifacts(survey, designArtifacts),
    skippedDetectors: skipped,
  };
}

/** Run over a whole dataset, survey by survey. */
export async function run(dataset: Dataset, opts: RunOptions = {}): Promise<SurveyResult[]> {
  const out: SurveyResult[] = [];
  for (const s of dataset) out.push(await runSurvey(s, opts));
  return out;
}
