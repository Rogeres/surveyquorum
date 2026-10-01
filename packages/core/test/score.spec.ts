import { describe, expect, it } from 'vitest';
import type { Evidence } from '../src/detectors/types.js';
import { scoreResponse, type Weights } from '../src/quorum/score.js';

const w: Weights = {
  version: 'test',
  provenance: 'test',
  defaults: { strong: 2, weak: 0.7, positive: -1.5 },
  weights: { 'pace.consistent': 2.4 },
  thresholds: { block: 3, review: 1.5 },
};

const ev = (
  signal: string,
  strength: Evidence['strength'],
  detector = 'pace',
  extra: Partial<Evidence> = {},
): Evidence => ({
  responseId: 'r1',
  detector,
  signal,
  strength,
  summary: 'test',
  ...extra,
});

describe('quorum scoring', () => {
  it('keeps a respondent with no evidence', () => {
    expect(scoreResponse('r1', [], w).outcome).toBe('keep');
  });

  it('uses a specific weight when present and the strength default otherwise', () => {
    const v = scoreResponse(
      'r1',
      [ev('consistent', 'strong'), ev('x3', 'strong', 'duplicate-open')],
      w,
    );
    expect(v.score).toBe(4.4);
    expect(v.outcome).toBe('block');
  });

  it('counts the same detector.signal once', () => {
    const v = scoreResponse('r1', [ev('single_outlier', 'weak'), ev('single_outlier', 'weak')], w);
    expect(v.score).toBe(0.7);
    expect(v.outcome).toBe('keep');
  });

  it('positive evidence lowers the score', () => {
    const v = scoreResponse(
      'r1',
      [ev('consistent', 'strong'), ev('two_rich_open', 'positive', 'positive')],
      w,
    );
    expect(v.score).toBe(0.9);
    expect(v.outcome).toBe('keep');
  });

  it('design artifacts are reported but not weighed', () => {
    const v = scoreResponse(
      'r1',
      [ev('off_topic', 'strong', 'open-answer', { designArtifact: true })],
      w,
    );
    expect(v.score).toBe(0);
    expect(v.designArtifacts).toHaveLength(1);
  });

  it('ignores evidence about other respondents', () => {
    const v = scoreResponse('r1', [{ ...ev('consistent', 'strong'), responseId: 'r2' }], w);
    expect(v.score).toBe(0);
  });
});
