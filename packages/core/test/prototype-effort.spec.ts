import { describe, expect, it } from 'vitest';
import type { Block, PrototypeBlock, Response } from '../src/contract/types.js';
import { prototypeEffortDetector } from '../src/detectors/prototype-effort/index.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';
import { cohort, survey } from './helpers/synthetic.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function task(
  i: number,
  status: PrototypeBlock['status'],
  clickCount: number,
  duration: number,
): PrototypeBlock {
  return {
    type: 'prototype',
    blockId: `p${i}`,
    question: `Find the settings screen (${i})`,
    status,
    clickCount,
    duration,
  };
}

const normal = (i: number) => task(i, 'completed', 9, 60);

function planted(id: string, overrides: Record<number, PrototypeBlock>): Response {
  const blocks: Block[] = [0, 1, 2, 3].map((i) => overrides[i] ?? normal(i));
  return { id, blocks };
}

// Honest cohort with 4 tasks; on p3 five of 40 gave up with no clicks (prototype did not load).
const honest = cohort(40, 31, { prototype: 4 });
for (let i = 0; i < 5; i++) {
  const b = honest[i].blocks[3] as PrototypeBlock;
  b.status = 'gave_up';
  b.clickCount = 0;
  b.duration = 4;
}

const instant = planted('instant', { 0: task(0, 'gave_up', 0, 3) });
const twoGiveUps = planted('two-give-ups', {
  0: task(0, 'gave_up', 0, 25),
  2: task(2, 'gave_up', 0, 40),
});
const oneSlowGiveUp = planted('one-slow', { 1: task(1, 'gave_up', 0, 20) });
const lowEffort = planted('low-effort', {
  0: task(0, 'partial', 1, 5),
  2: task(2, 'partial', 1, 4),
});
const honestGiveUp = planted('honest-give-up', { 1: task(1, 'gave_up', 14, 90) });
const artifactOnly = planted('artifact-only', { 3: task(3, 'gave_up', 0, 2) });

const evidence = prototypeEffortDetector.detect(
  survey([...honest, instant, twoGiveUps, oneSlowGiveUp, lowEffort, honestGiveUp, artifactOnly]),
  ctx,
) as Evidence[];
const isHonest = (id: string) => /^h\d+$/.test(id);
const byId = (id: string) => evidence.filter((e) => e.responseId === id);
const weighed = (id: string) => byId(id).filter((e) => !e.designArtifact);

describe('prototype-effort', () => {
  it('declares itself a statistical detector', () => {
    expect(prototypeEffortDetector.name).toBe('prototype-effort');
    expect(prototypeEffortDetector.needsLlm).toBe(false);
  });

  it('flags a zero-click give-up in under 6 s as instant_give_up (strong)', () => {
    const ev = weighed('instant');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('instant_give_up');
    expect(ev[0].strength).toBe('strong');
    expect(ev[0].blocks).toEqual([0]);
    expect(ev[0].stats?.fastestSec).toBe(3);
  });

  it('flags two zero-click give-ups as instant_give_up even when slow', () => {
    const ev = weighed('two-give-ups');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('instant_give_up');
    expect(ev[0].blocks).toEqual([0, 2]);
    expect(ev[0].stats?.nInstant).toBe(0);
  });

  it('flags one slow zero-click give-up as zero_click_give_up (weak)', () => {
    const ev = weighed('one-slow');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('zero_click_give_up');
    expect(ev[0].strength).toBe('weak');
    expect(ev[0].blocks).toEqual([1]);
  });

  it('flags two tasks with far fewer clicks and time as low_effort (weak)', () => {
    const ev = weighed('low-effort');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('low_effort');
    expect(ev[0].blocks).toEqual([0, 2]);
    expect(ev[0].stats?.meanClickZ as number).toBeLessThanOrEqual(-1.5);
  });

  it('does not flag a give-up after a real attempt', () => {
    expect(byId('honest-give-up')).toHaveLength(0);
  });

  it('treats a task many respondents gave up on as a design artifact', () => {
    const ev = byId('artifact-only');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('cohort_give_up_task');
    expect(ev[0].designArtifact).toBe(true);
    expect(ev[0].blocks).toEqual([3]);
    const honestArtifacts = evidence.filter(
      (e) => isHonest(e.responseId) && e.signal === 'cohort_give_up_task',
    );
    expect(honestArtifacts).toHaveLength(5);
  });

  it('never flags honest respondents', () => {
    expect(evidence.filter((e) => isHonest(e.responseId) && !e.designArtifact)).toHaveLength(0);
  });

  it('stays silent below the minimum cohort', () => {
    expect(
      prototypeEffortDetector.detect(survey([...honest.slice(0, 10), instant]), ctx),
    ).toHaveLength(0);
  });
});
