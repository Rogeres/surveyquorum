import type { Response, Survey } from '../contract/types.js';

/**
 * A detector looks at one survey (the cohort) and emits evidence about respondents.
 * It never decides anything — `quorum/score.ts` turns evidence into outcomes.
 */
export interface Detector {
  /** Stable machine name, e.g. "pace", "open-answer". Used as the weight key prefix. */
  readonly name: string;
  /** True when the detector needs an LLM client; such detectors are skipped without one. */
  readonly needsLlm: boolean;
  detect(survey: Survey, ctx: DetectorContext): Promise<Evidence[]> | Evidence[];
}

export interface DetectorContext {
  /** Minimum cohort size before cohort statistics are trusted. */
  minCohort: number;
  /** LLM client, present only when the user configured one. */
  llm?: LlmClient;
  /** Logger for progress and warnings; defaults to a no-op. */
  log: (message: string) => void;
}

/**
 * strong   — on its own this would be a ban in a rule-based system
 * weak     — corroborating signal; needs company
 * positive — evidence that the respondent is genuine (negative weight)
 */
export type Strength = 'strong' | 'weak' | 'positive';

export interface Evidence {
  responseId: string;
  /** Detector name. */
  detector: string;
  /** Specific signal within the detector, e.g. "consistent", "single_outlier". Weight key = `${detector}.${signal}`. */
  signal: string;
  strength: Strength;
  /** One or two sentences in English a reviewer can read. Numbers included. */
  summary: string;
  /** Machine-readable facts behind the summary. */
  stats?: Record<string, number | string | boolean | null>;
  /** Block index(es) in `response.blocks` this evidence refers to. */
  blocks?: number[];
  /**
   * Set when the same signal fires for a large share of the cohort on the same block —
   * the questionnaire, not the respondent, is the likely cause. Such evidence carries no weight
   * but is reported to the survey author.
   */
  designArtifact?: boolean;
}

/** Minimal provider-agnostic LLM interface. Implemented for OpenAI-compatible HTTP, Anthropic and agent-file mode. */
export interface LlmClient {
  /** Model role lets the caller route cheap classification and expensive arbitration differently. */
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export interface LlmRequest {
  role: 'classifier' | 'arbiter';
  system?: string;
  prompt: string;
  /** JSON schema the answer must satisfy; the client validates and retries once. */
  schema: Record<string, unknown>;
  /** Stable cache key; the client may serve from cache. */
  cacheKey: string;
}

export interface LlmResponse {
  /** Parsed JSON that satisfied the request schema; `null` when `pending`. */
  json: unknown;
  usage?: { inputTokens: number; outputTokens: number };
  fromCache?: boolean;
  /**
   * Agent-file mode: the request was written to the judge-requests file and no answer exists
   * yet. Detectors must skip the respondent (or the whole stage) and emit nothing for it.
   */
  pending?: boolean;
}

export type { Response };
