import type { Response, Survey } from '../contract/types.js';
import type { Evidence, LlmClient } from '../detectors/types.js';
import { sha256 } from '../llm/hash.js';
import { mapPool } from '../llm/pool.js';
import { fillPrompt, loadPrompt } from '../llm/prompt.js';
import type { Outcome, Verdict } from '../quorum/score.js';
import { renderEvidence, renderResponse } from './render.js';
import type {
  ArbiterDecision,
  ArbiterDecisionKind,
  ArbiterLang,
  ArbiterStrictness,
  ArbitratedVerdict,
  ArbitrateOptions,
  ArbitrateResult,
  JudgeOpinion,
  OverturnCategory,
  SignalSupport,
  TiebreakOpinion,
} from './types.js';

/**
 * Prompt file names; part of every cache key so that a prompt edit invalidates cached opinions.
 * `arbiter_v2` added the required `overturn_category` field, so `arbiter_v1` answers in a cache
 * are not reused.
 */
export const RUBRIC_VERSION = 'arbiter_v2';
/** Burden-of-proof addendum appended to the rubric in strict mode. */
export const STRICT_VERSION = 'arbiter_strict_v1';
export const CASE_VERSION = 'arbiter_case_v1';
export const TIEBREAK_VERSION = 'tiebreak_v1';
export const DEFAULT_OUTCOMES: Outcome[] = ['block', 'review'];
export const DEFAULT_STRICTNESS: ArbiterStrictness = 'strict';
export const PANEL_TEXT_MAX = 450;

const DECISIONS: ArbiterDecisionKind[] = ['confirm', 'overturn', 'needs_human'];
export const OVERTURN_CATEGORIES: OverturnCategory[] = [
  'technical_failure',
  'design_artifact',
  'substantive_content',
  'short_branch',
  'none',
];

/** Minimum confidence of an overturn for it to stand, per mode (strict also needs unanimity). */
export const OVERTURN_MIN_CONFIDENCE: Record<ArbiterStrictness, number> = {
  strict: 4,
  balanced: 3,
  lenient: 1,
};

export const JUDGE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['decision', 'confidence', 'reason', 'panel_text', 'per_signal', 'overturn_category'],
  properties: {
    decision: { type: 'string', enum: DECISIONS },
    confidence: { type: 'integer', minimum: 1, maximum: 5 },
    reason: { type: 'string' },
    panel_text: { type: 'string' },
    per_signal: { type: 'object' },
    overturn_category: { type: 'string', enum: OVERTURN_CATEGORIES },
  },
};

export const TIEBREAK_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['winner', 'confidence', 'reason'],
  properties: {
    winner: { type: ['integer', 'string'], enum: [1, 2, 'human'] },
    confidence: { type: 'integer', minimum: 1, maximum: 5 },
    reason: { type: 'string' },
  },
};

const LANG_NAME: Record<ArbiterLang, string> = { en: 'English', ru: 'Russian' };
const LABEL: Record<ArbiterDecisionKind, string> = {
  confirm: 'the flag is justified',
  overturn: 'the flag is wrong',
  needs_human: 'a human must decide',
};

let rubric: string | undefined;
let strictAddendum: string | undefined;
let caseTemplate: string | undefined;
let tiebreakTemplate: string | undefined;

/** The shared rubric; in strict mode the burden-of-proof addendum is appended. */
export function arbiterSystemPrompt(strictness: ArbiterStrictness = DEFAULT_STRICTNESS): string {
  rubric ??= loadPrompt(import.meta.url, `${RUBRIC_VERSION}.txt`);
  if (strictness !== 'strict') return rubric;
  strictAddendum ??= loadPrompt(import.meta.url, `${STRICT_VERSION}.txt`);
  return `${rubric.trimEnd()}\n\n${strictAddendum}`;
}

interface CaseInput {
  survey: Survey;
  response: Response;
  verdict: Verdict;
  evidence: Evidence[];
  lang: ArbiterLang;
  strictness: ArbiterStrictness;
  cohortMedians: Record<string, number>;
}

function caseValues(c: CaseInput): Record<string, string> {
  return {
    survey: c.survey.id,
    target: c.survey.target ?? 'not stated',
    response: renderResponse(c.response, c.cohortMedians),
    outcome: c.verdict.outcome,
    score: String(c.verdict.score),
    evidence: renderEvidence(c.evidence),
    panel_lang: LANG_NAME[c.lang],
  };
}

export function buildCasePrompt(c: Omit<CaseInput, 'strictness'>): string {
  caseTemplate ??= loadPrompt(import.meta.url, `${CASE_VERSION}.txt`);
  return fillPrompt(caseTemplate, caseValues({ ...c, strictness: DEFAULT_STRICTNESS }));
}

export function buildTiebreakPrompt(
  c: Omit<CaseInput, 'strictness'>,
  a: JudgeOpinion,
  b: JudgeOpinion,
): string {
  tiebreakTemplate ??= loadPrompt(import.meta.url, `${TIEBREAK_VERSION}.txt`);
  return fillPrompt(tiebreakTemplate, {
    ...caseValues({ ...c, strictness: DEFAULT_STRICTNESS }),
    label_a: LABEL[a.decision],
    reason_a: a.reason,
    label_b: LABEL[b.decision],
    reason_b: b.reason,
  });
}

/**
 * Fixed but arbitrary presentation order for the tie-break, derived from the response id:
 * stable across re-runs, uncorrelated with which judge produced which opinion, so position
 * bias cannot systematically favour one judge.
 */
export function shouldSwap(responseId: string): boolean {
  return Number.parseInt(sha256(responseId).slice(0, 2), 16) % 2 === 1;
}

interface RawJudge {
  decision: ArbiterDecisionKind;
  confidence: number;
  reason: string;
  panel_text: string;
  per_signal: Record<string, unknown>;
  overturn_category?: unknown;
}

function toCategory(v: unknown): OverturnCategory {
  return OVERTURN_CATEGORIES.includes(v as OverturnCategory) ? (v as OverturnCategory) : 'none';
}

function toOpinion(judge: 1 | 2, raw: RawJudge): JudgeOpinion {
  const perSignal: Record<string, SignalSupport> = {};
  for (const [k, v] of Object.entries(raw.per_signal ?? {})) {
    perSignal[k] = v === 'supports' ? 'supports' : 'does_not_support';
  }
  return {
    judge,
    decision: raw.decision,
    confidence: raw.confidence,
    reason: raw.reason.trim(),
    panelText: raw.panel_text.replace(/\s+/g, ' ').trim(),
    perSignal,
    // A category only means something on an overturn.
    overturnCategory: raw.decision === 'overturn' ? toCategory(raw.overturn_category) : 'none',
  };
}

type Call<T> = { value: T } | { pending: true };

async function callJudge(
  llm: LlmClient,
  c: CaseInput,
  prompt: string,
  judge: 1 | 2,
): Promise<Call<JudgeOpinion>> {
  // Strict mode has a different system prompt, so its answers must not share balanced/lenient
  // cache entries; those two modes share answers and differ only in how they are applied.
  const salt = c.strictness === 'strict' ? STRICT_VERSION : 'shared';
  const res = await llm.complete({
    role: 'arbiter',
    system: arbiterSystemPrompt(c.strictness),
    prompt,
    schema: JUDGE_SCHEMA,
    cacheKey: sha256(RUBRIC_VERSION, CASE_VERSION, salt, `judge-${judge}`, prompt),
  });
  if (res.pending) return { pending: true };
  return { value: toOpinion(judge, res.json as RawJudge) };
}

async function callTiebreak(llm: LlmClient, prompt: string): Promise<Call<TiebreakOpinion>> {
  const res = await llm.complete({
    role: 'arbiter',
    prompt,
    schema: TIEBREAK_SCHEMA,
    cacheKey: sha256(TIEBREAK_VERSION, prompt),
  });
  if (res.pending) return { pending: true };
  const raw = res.json as { winner: 1 | 2 | 'human'; confidence: number; reason: string };
  return {
    value: { winner: raw.winner, confidence: raw.confidence, reason: raw.reason.trim() },
  };
}

/** The confirming judge's panel text when there is one: it is the text a complaint would carry. */
function panelTextFor(judges: JudgeOpinion[], fallback: JudgeOpinion): string {
  return (judges.find((j) => j.decision === 'confirm') ?? fallback).panelText;
}

/** A `needs_human` that the mode's rule produced because the arbiter hesitated. */
function unsure(
  id: string,
  strictness: ArbiterStrictness,
  judges: JudgeOpinion[],
  why: string,
  confidence: number,
  extra: Partial<ArbiterDecision> = {},
): ArbiterDecision {
  const [a, b] = judges;
  return {
    responseId: id,
    decision: 'needs_human',
    confidence,
    reason: `arbiter unsure: ${why} — judge 1: ${a.reason} judge 2: ${b.reason}`,
    panelText: panelTextFor(judges, a),
    judges,
    strictness,
    overturnCategory: 'none',
    unsure: true,
    ...extra,
  };
}

/**
 * Strict mode decision table. (a) both confirm → confirm. (b) both overturn, both with
 * confidence ≥ 4, the same named category → overturn. (c) anything else — a split, a weak
 * overturn, differing or missing categories, a judge asking for a human — → `needs_human`:
 * when the arbiter hesitates, a person looks; the engine's verdict is never silently released.
 * No tie-break is called.
 */
export function resolveStrict(id: string, judges: [JudgeOpinion, JudgeOpinion]): ArbiterDecision {
  const [a, b] = judges;
  const min = Math.min(a.confidence, b.confidence);
  const base = { responseId: id, judges, strictness: 'strict' as const };
  if (a.decision === 'confirm' && b.decision === 'confirm') {
    const lead = a.confidence >= b.confidence ? a : b;
    return {
      ...base,
      decision: 'confirm',
      confidence: min,
      reason: lead.reason,
      panelText: lead.panelText,
      overturnCategory: 'none',
    };
  }
  if (a.decision !== b.decision) {
    return unsure(id, 'strict', judges, `judges split (${a.decision} vs ${b.decision})`, min);
  }
  if (a.decision === 'needs_human') {
    return unsure(id, 'strict', judges, 'both judges asked for a human', min);
  }
  // Both overturn.
  if (min < OVERTURN_MIN_CONFIDENCE.strict) {
    return unsure(
      id,
      'strict',
      judges,
      `overturn at confidence ${a.confidence}/${b.confidence}, strict mode needs ${OVERTURN_MIN_CONFIDENCE.strict} from both`,
      min,
    );
  }
  if (a.overturnCategory === 'none' || b.overturnCategory === 'none') {
    return unsure(id, 'strict', judges, 'overturn without a named cause', min);
  }
  if (a.overturnCategory !== b.overturnCategory) {
    return unsure(
      id,
      'strict',
      judges,
      `overturn causes differ (${a.overturnCategory} vs ${b.overturnCategory})`,
      min,
    );
  }
  const lead = a.confidence >= b.confidence ? a : b;
  return {
    ...base,
    decision: 'overturn',
    confidence: min,
    reason: lead.reason,
    panelText: lead.panelText,
    overturnCategory: a.overturnCategory,
  };
}

/**
 * Balanced and lenient: the final decision after agreement or tie-break. An overturn below the
 * mode's confidence floor (balanced: 3; lenient: none) goes to a human instead of releasing.
 */
function gateOverturn(d: ArbiterDecision): ArbiterDecision {
  const floor = OVERTURN_MIN_CONFIDENCE[d.strictness];
  if (d.decision !== 'overturn' || d.confidence >= floor) return d;
  return unsure(
    d.responseId,
    d.strictness,
    d.judges,
    `overturn at confidence ${d.confidence}, ${d.strictness} mode needs ${floor}`,
    d.confidence,
    { tiebreak: d.tiebreak, tiebreakOpinion: d.tiebreakOpinion },
  );
}

/**
 * Two judges read the same case under the same rubric (different cache salt so that the
 * calls are independent even on a deterministic provider). In strict mode the decision table
 * above settles the case without a third call. Otherwise, when they agree, that is the
 * decision; when they disagree, a blind tie-breaker sees both anonymised opinions in a
 * fixed-but-arbitrary order and says which reading survives, or hands the case to a human.
 */
async function arbitrateOne(
  llm: LlmClient,
  c: CaseInput,
): Promise<Call<ArbiterDecision> | { failed: string }> {
  try {
    const prompt = buildCasePrompt(c);
    const [a, b] = await Promise.all([callJudge(llm, c, prompt, 1), callJudge(llm, c, prompt, 2)]);
    if ('pending' in a || 'pending' in b) return { pending: true };
    const judges: [JudgeOpinion, JudgeOpinion] = [a.value, b.value];
    const id = c.response.id;
    if (c.strictness === 'strict') return { value: resolveStrict(id, judges) };
    const base = { responseId: id, judges, strictness: c.strictness };
    if (a.value.decision === b.value.decision) {
      const lead = a.value.confidence >= b.value.confidence ? a.value : b.value;
      return {
        value: gateOverturn({
          ...base,
          decision: lead.decision,
          confidence: Math.min(a.value.confidence, b.value.confidence),
          reason: lead.reason,
          panelText: lead.panelText,
          overturnCategory: lead.decision === 'overturn' ? lead.overturnCategory : 'none',
        }),
      };
    }
    const [first, second] = shouldSwap(id) ? [b.value, a.value] : [a.value, b.value];
    const tb = await callTiebreak(llm, buildTiebreakPrompt(c, first, second));
    if ('pending' in tb) return { pending: true };
    const t = tb.value;
    const winner = t.winner === 1 ? first : t.winner === 2 ? second : undefined;
    if (!winner) {
      return {
        value: unsure(
          id,
          c.strictness,
          judges,
          `tie-break sent it to a human: ${t.reason}`,
          t.confidence,
          {
            tiebreak: true,
            tiebreakOpinion: t,
          },
        ),
      };
    }
    return {
      value: gateOverturn({
        ...base,
        decision: winner.decision,
        confidence: Math.min(t.confidence, winner.confidence),
        reason: `${winner.reason} (tie-break: ${t.reason})`,
        panelText: winner.panelText,
        overturnCategory: winner.decision === 'overturn' ? winner.overturnCategory : 'none',
        tiebreak: true,
        tiebreakOpinion: t,
      }),
    };
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  }
}

/** Full result including pending and failed respondents. */
export async function arbitrateDetailed(
  survey: Survey,
  verdicts: Verdict[],
  evidence: Evidence[],
  llm: LlmClient,
  opts: ArbitrateOptions = {},
): Promise<ArbitrateResult> {
  const outcomes = new Set(opts.outcomes ?? DEFAULT_OUTCOMES);
  const log = opts.log ?? (() => {});
  const byId = new Map(survey.responses.map((r) => [r.id, r]));
  const cases: CaseInput[] = [];
  for (const v of verdicts) {
    if (!outcomes.has(v.outcome)) continue;
    const response = byId.get(v.responseId);
    if (!response) continue;
    cases.push({
      survey,
      response,
      verdict: v,
      evidence: evidence.filter((e) => e.responseId === v.responseId && !e.designArtifact),
      lang: opts.lang ?? 'en',
      strictness: opts.strictness ?? DEFAULT_STRICTNESS,
      cohortMedians: opts.cohortMedians ?? {},
    });
  }
  const results = await mapPool(cases, opts.concurrency ?? 4, (c) => arbitrateOne(llm, c));
  const out: ArbitrateResult = { decisions: [], pending: [], failed: [] };
  results.forEach((r, i) => {
    const id = cases[i].response.id;
    if ('failed' in r) {
      out.failed.push(id);
      log(`arbiter: ${id}: ${r.failed}`);
    } else if ('pending' in r) out.pending.push(id);
    else out.decisions.push(r.value);
  });
  if (out.pending.length) log(`arbiter: ${out.pending.length} case(s) pending LLM judgement`);
  return out;
}

/** Second opinion on every verdict whose outcome is in `opts.outcomes` (default block + review). */
export async function arbitrate(
  survey: Survey,
  verdicts: Verdict[],
  evidence: Evidence[],
  llm: LlmClient,
  opts: ArbitrateOptions = {},
): Promise<ArbiterDecision[]> {
  return (await arbitrateDetailed(survey, verdicts, evidence, llm, opts)).decisions;
}

/**
 * Apply decisions, in every strictness mode:
 *
 * - `confirm` → `block`. An engine `review` means "needs a second independent look"; the arbiter
 *   is that look, so a confirmed `review` completes the quorum (engine evidence plus an
 *   independent judge) and is blocked. A confirmed `block` stays a block.
 * - `overturn` → `keep`. The mode's gate (unanimity, confidence floor, named cause) was already
 *   resolved into `decision` by `arbitrate`, so an `overturn` here always stands.
 * - `needs_human` → `review`. After the arbiter, `review` means exactly "a person must look".
 *
 * The mode, the cause and the pre-arbiter outcome (`originalOutcome`) are recorded on the
 * verdict. Verdicts without a decision (pending, failed, not arbitrated) are returned as they
 * were. Pure.
 */
export function applyArbiter(
  verdicts: Verdict[],
  decisions: ArbiterDecision[],
): ArbitratedVerdict[] {
  const byId = new Map(decisions.map((d) => [d.responseId, d]));
  return verdicts.map((v) => {
    const d = byId.get(v.responseId);
    if (!d) return v;
    const outcome: Outcome =
      d.decision === 'overturn' ? 'keep' : d.decision === 'needs_human' ? 'review' : 'block';
    const out: ArbitratedVerdict = {
      ...v,
      outcome,
      arbiter: {
        decision: d.decision,
        confidence: d.confidence,
        reason: d.reason,
        tiebreak: d.tiebreak === true,
        originalOutcome: v.outcome,
        strictness: d.strictness ?? DEFAULT_STRICTNESS,
        overturnCategory: d.decision === 'overturn' ? (d.overturnCategory ?? 'none') : 'none',
      },
    };
    if (d.panelText) out.panelText = d.panelText.slice(0, PANEL_TEXT_MAX);
    return out;
  });
}
