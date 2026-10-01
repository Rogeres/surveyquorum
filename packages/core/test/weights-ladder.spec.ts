import { describe, expect, it } from 'vitest';
import type { Evidence, Strength } from '../src/detectors/types.js';
import {
  DEFAULT_WEIGHTS,
  isBayesian,
  LLR_CAP,
  llrFromPrecision,
  logit,
  scoreResponse,
  sigmoid,
  type Weights,
  weightFor,
  weightForKey,
  weightSource,
} from '../src/quorum/score.js';

const ev = (detector: string, signal: string, strength: Strength): Evidence => ({
  responseId: 'r1',
  detector,
  signal,
  strength,
  summary: 'synthetic',
});

/** Signals the detector READMEs mark as strong. */
const strongKeySet = new Set([
  'pace.consistent',
  'duplicate-open.x3',
  'open-answer.fake',
  'open-answer.gibberish',
  'open-answer.wrong_language',
  'open-answer.bad_language',
  'coherence.contradiction',
  'prototype-effort.instant_give_up',
  'website-bounce.repeated_bounce',
  'matrix-pattern.straightline_fast',
  'mass-select.heavy_pattern',
  'cardsort-consensus.random_sort',
  'firstclick-offtarget.same_spot',
]);

const strongEv = (key: string): Evidence => {
  const [detector, signal] = key.split('.');
  return ev(detector, signal, 'strong');
};

describe('v1 weights file', () => {
  it('is Bayesian, with a production prior and probability thresholds', () => {
    expect(isBayesian(DEFAULT_WEIGHTS)).toBe(true);
    expect(DEFAULT_WEIGHTS.prior).toBeCloseTo(0.0225, 4);
    expect(DEFAULT_WEIGHTS.thresholds.block).toBeGreaterThan(DEFAULT_WEIGHTS.thresholds.review);
    expect(DEFAULT_WEIGHTS.thresholds.block).toBeLessThan(1);
  });

  it('covers every strong signal and carries a source for each weight', () => {
    for (const k of strongKeySet) {
      expect(DEFAULT_WEIGHTS.weights, k).toHaveProperty(k);
      expect(weightSource(k), k).toMatch(/^(measured|assumed)/);
    }
  });

  it('caps every LLR so that no single signal can block', () => {
    for (const k of Object.keys(DEFAULT_WEIGHTS.weights)) {
      expect(Math.abs(weightForKey(k, 'strong')), k).toBeLessThanOrEqual(LLR_CAP);
    }
    const alone = sigmoid(logit(DEFAULT_WEIGHTS.prior as number) + LLR_CAP);
    expect(alone).toBeLessThan(DEFAULT_WEIGHTS.thresholds.block);
    expect(alone).toBeGreaterThanOrEqual(DEFAULT_WEIGHTS.thresholds.review);
  });

  it('derives LLRs from precision and the prior', () => {
    expect(llrFromPrecision(0.0225, 0.0225)).toBeCloseTo(0, 9);
    expect(llrFromPrecision(0.55, 0.0225)).toBeCloseTo(3.972, 3);
    expect(llrFromPrecision(0.8, 0.0225)).toBe(LLR_CAP);
    expect(llrFromPrecision(0.0001, 0.0225)).toBe(-LLR_CAP);
  });
});

describe('quorum ladder (synthetic evidence, default weights)', () => {
  it('no evidence → keep at the base rate', () => {
    const v = scoreResponse('r1', []);
    expect(v.outcome).toBe('keep');
    expect(v.probability).toBeCloseTo(0.0225, 2);
  });

  it('one strong signal never blocks — for every strong signal', () => {
    for (const k of strongKeySet) {
      const v = scoreResponse('r1', [strongEv(k)]);
      expect(v.outcome, k).not.toBe('block');
      // Alone, a signal lands exactly at its measured precision.
      expect(v.probability as number, k).toBeLessThan(DEFAULT_WEIGHTS.thresholds.block);
    }
  });

  it('one strong signal with precision at or above the review threshold → review', () => {
    for (const k of strongKeySet) {
      const alone = sigmoid(logit(DEFAULT_WEIGHTS.prior as number) + weightForKey(k, 'strong'));
      if (alone < DEFAULT_WEIGHTS.thresholds.review) continue; // gibberish, bad_language in v1
      expect(scoreResponse('r1', [strongEv(k)]).outcome, k).toBe('review');
    }
  });

  it('one average strong signal (strength default) → review', () => {
    const v = scoreResponse('r1', [ev('some-detector', 'unknown_signal', 'strong')]);
    expect(v.outcome).toBe('review');
  });

  it('two strong signals never keep — block when both are solid, review otherwise', () => {
    // Block means "near-certain, no second look": p ≥ 0.95. Two strong signals always clear the
    // review bar; they block only when both carry a solid LLR (≥ 3.4, i.e. precision ≥ 0.41).
    const keys = [...strongKeySet];
    for (let i = 0; i < keys.length; i++) {
      for (let j = i + 1; j < keys.length; j++) {
        const v = scoreResponse('r1', [strongEv(keys[i]), strongEv(keys[j])]);
        const label = `${keys[i]} + ${keys[j]}`;
        expect(v.outcome, label).not.toBe('keep');
        const solid =
          weightForKey(keys[i], 'strong') >= 3.4 && weightForKey(keys[j], 'strong') >= 3.4;
        if (solid) expect(v.outcome, label).toBe('block');
      }
    }
  });

  it('three or more strong signals → block with p ≥ 0.9', () => {
    const v = scoreResponse('r1', [
      strongEv('open-answer.gibberish'),
      strongEv('prototype-effort.instant_give_up'),
      strongEv('website-bounce.repeated_bounce'),
    ]);
    expect(v.outcome).toBe('block');
    expect(v.probability as number).toBeGreaterThanOrEqual(0.9);
  });

  it('strong + positive → review or keep', () => {
    for (const k of strongKeySet) {
      const v = scoreResponse('r1', [
        strongEv(k),
        ev('open-answer', 'rich_open_answers', 'positive'),
      ]);
      expect(['review', 'keep'], k).toContain(v.outcome);
    }
  });

  it('two near-base-rate weak signals → keep', () => {
    const v = scoreResponse('r1', [
      ev('pace', 'whole_survey_fast', 'weak'),
      ev('open-answer', 'off_topic', 'weak'),
    ]);
    expect(v.outcome).toBe('keep');
  });

  it('exposes score as log-odds and probability as its sigmoid', () => {
    const v = scoreResponse('r1', [strongEv('duplicate-open.x3')]);
    expect(v.score).toBeCloseTo(logit(0.0225) + weightFor(strongEv('duplicate-open.x3')), 2);
    expect(v.probability).toBeCloseTo(sigmoid(v.score), 3);
  });
});

describe('weights file forms', () => {
  it('accepts bare numbers and entry objects side by side', () => {
    const w: Weights = {
      version: 't',
      provenance: 't',
      prior: 0.1,
      defaults: { strong: 2, weak: 1, positive: -1 },
      weights: { 'a.flat': 1.5, 'a.entry': { llr: 2.5, source: 'measured: test' } },
      thresholds: { block: 0.8, review: 0.3 },
    };
    expect(weightFor(ev('a', 'flat', 'strong'), w)).toBe(1.5);
    expect(weightFor(ev('a', 'entry', 'strong'), w)).toBe(2.5);
    expect(weightFor(ev('a', 'missing', 'weak'), w)).toBe(1);
    expect(weightSource('a.entry', w)).toBe('measured: test');
    expect(weightSource('a.flat', w)).toBeUndefined();
  });

  it('legacy files without a prior keep the additive semantics and report no probability', () => {
    const legacy: Weights = {
      version: 'legacy',
      provenance: 'legacy',
      defaults: { strong: 2, weak: 0.7, positive: -1.5 },
      weights: {},
      thresholds: { block: 3, review: 1.5 },
    };
    const v = scoreResponse('r1', [ev('a', 'x', 'strong'), ev('b', 'y', 'strong')], legacy);
    expect(v.score).toBe(4);
    expect(v.outcome).toBe('block');
    expect(v.probability).toBeUndefined();
  });
});
