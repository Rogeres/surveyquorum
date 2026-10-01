import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  SurveyResult,
} from '../packages/core/src/index.js';
import { withCache } from '../packages/core/src/index.js';

/** Compact, diff-friendly form of the engine output used as the regression baseline. */
export interface CompactVerdict {
  outcome: 'block' | 'review' | 'keep';
  score: number;
  /** Sorted `detector.signal` keys that carried weight. */
  signals: string[];
  /** Sorted `detector.signal` keys reported as design artifacts. */
  artifacts: string[];
}

export type CompactResults = Record<string, Record<string, CompactVerdict>>;

export function compactVerdicts(results: SurveyResult[]): CompactResults {
  const out: CompactResults = {};
  for (const r of results) {
    const survey: Record<string, CompactVerdict> = {};
    for (const v of r.verdicts) {
      survey[v.responseId] = {
        outcome: v.outcome,
        score: v.score,
        signals: [...new Set(v.evidence.map((e) => `${e.detector}.${e.signal}`))].sort(),
        artifacts: [...new Set(v.designArtifacts.map((e) => `${e.detector}.${e.signal}`))].sort(),
      };
    }
    out[r.surveyId] = survey;
  }
  return out;
}

/**
 * An LLM client that only serves answers recorded in `examples/llm-cache/` and fails loudly on
 * a miss. This is what makes the demo reproducible offline: the LLM detectors run against the
 * recorded model answers, never against a live model.
 */
export function cacheOnlyLlmClient(cacheDir: string): LlmClient {
  const miss: LlmClient = {
    complete(request: LlmRequest): Promise<LlmResponse> {
      return Promise.reject(
        new Error(
          `LLM cache miss for ${request.role} request ${request.cacheKey.slice(0, 12)}… — ` +
            'the demo must run entirely from examples/llm-cache; regenerate the cache with a live run if a prompt changed',
        ),
      );
    },
  };
  return withCache(miss, cacheDir);
}
