import { describe, expect, it } from 'vitest';
import type { Block, Response } from '../src/contract/types.js';
import { paceDetector } from '../src/detectors/pace/index.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';
import { CHOICE_OPTIONS, cohort, survey } from './helpers/synthetic.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

/** A respondent whose choice blocks c0..c(n-1) take the given seconds each. */
function planted(id: string, seconds: number[]): Response {
  const blocks: Block[] = seconds.map((duration, i) => ({
    type: 'choice',
    blockId: `c${i}`,
    question: `Which of these matter to you? (${i})`,
    options: CHOICE_OPTIONS,
    answer: [CHOICE_OPTIONS[0]],
    duration,
  }));
  return { id, blocks };
}

const honest = cohort(50, 11, { choice: 12, medians: { choice: 20 } });
const speeder = planted('speeder', Array(12).fill(1));
const outlier = planted('outlier', [0.5, ...Array(11).fill(20)]);
const shortBranchFast = planted('short-fast', [1, 1, 20, 20, 20, 20]);
const shortBranch = planted('short-branch', [20, 20, 20]);
const unknownDurations = planted('unknown', Array(12).fill(0));

const evidence = paceDetector.detect(
  survey([...honest, speeder, outlier, shortBranchFast, shortBranch, unknownDurations]),
  ctx,
) as Evidence[];
const isHonest = (id: string) => /^h\d+$/.test(id);
const byId = (id: string) => evidence.filter((e) => e.responseId === id);

describe('pace', () => {
  it('declares itself a statistical detector', () => {
    expect(paceDetector.name).toBe('pace');
    expect(paceDetector.needsLlm).toBe(false);
  });

  it('flags a respondent fast on every question as consistent (strong)', () => {
    const ev = byId('speeder');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('consistent');
    expect(ev[0].strength).toBe('strong');
    expect(ev[0].stats?.nFast2).toBe(12);
    expect(ev[0].blocks).toHaveLength(12);
    expect(ev[0].summary).toMatch(/12 of 12 questions/);
  });

  it('flags one extreme block as single_outlier (weak)', () => {
    const ev = byId('outlier');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('single_outlier');
    expect(ev[0].strength).toBe('weak');
    expect(ev[0].blocks).toEqual([0]);
  });

  it('flags two fast blocks on a short, quick total as fast_cluster (weak)', () => {
    const ev = byId('short-fast');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('fast_cluster');
    expect(ev[0].stats?.nFast2).toBe(2);
    expect(ev[0].stats?.ratio as number).toBeLessThan(0.5);
  });

  it('flags a very short total with no fast block as whole_survey_fast (weak)', () => {
    const ev = byId('short-branch');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('whole_survey_fast');
    expect(ev[0].stats?.nFast2).toBe(0);
    expect(ev[0].stats?.ratio as number).toBeLessThan(1 / 3);
  });

  it('is silent when durations are unknown', () => {
    expect(byId('unknown')).toHaveLength(0);
  });

  it('never gives honest respondents a strong signal and rarely a weak one', () => {
    const honestEv = evidence.filter((e) => isHonest(e.responseId));
    expect(honestEv.filter((e) => e.strength === 'strong')).toHaveLength(0);
    expect(honestEv.length).toBeLessThanOrEqual(2);
  });

  it('emits at most one evidence per respondent and never a design artifact', () => {
    const ids = evidence.map((e) => e.responseId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(evidence.some((e) => e.designArtifact)).toBe(false);
  });

  it('stays silent below the minimum cohort', () => {
    const small = survey([...honest.slice(0, 10), speeder]);
    expect(paceDetector.detect(small, ctx)).toHaveLength(0);
  });
});
