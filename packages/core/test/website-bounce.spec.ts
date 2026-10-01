import { describe, expect, it } from 'vitest';
import type { Block, Response, WebsiteBlock } from '../src/contract/types.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';
import { websiteBounceDetector } from '../src/detectors/website-bounce/index.js';
import { cohort, logNormalSec, rng, survey } from './helpers/synthetic.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function site(i: number, duration: number, gaveUp = false): WebsiteBlock {
  return {
    type: 'website',
    blockId: `w${i}`,
    question: `Find the returns policy on the site (${i})`,
    gaveUp,
    duration,
  };
}

function planted(id: string, overrides: Record<number, WebsiteBlock>): Response {
  const blocks: Block[] = [0, 1, 2, 3].map((i) => overrides[i] ?? site(i, i === 3 ? 10 : 45));
  return { id, blocks };
}

// Honest cohort: w0..w2 take ~45 s, w3 is a quick task (~10 s median).
// On w2 six of 40 respondents gave up within 2 s (the site did not load for them).
const honest = cohort(40, 41, { website: 3 });
const next = rng(42);
for (const r of honest) r.blocks.push(site(3, logNormalSec(next, 10)));
for (let i = 0; i < 6; i++) {
  const b = honest[i].blocks[2] as WebsiteBlock;
  b.gaveUp = true;
  b.duration = 2;
}

const repeated = planted('repeated', { 0: site(0, 2, true), 1: site(1, 3) });
const single = planted('single', { 0: site(0, 3) });
const singleShortTask = planted('single-short-task', { 3: site(3, 1) });
const slowGiveUp = planted('slow-give-up', { 1: site(1, 70, true) });
const artifactOnly = planted('artifact-only', { 2: site(2, 1, true) });
const unknown = planted('unknown', { 0: site(0, 0, true), 1: site(1, 0, true) });

const evidence = websiteBounceDetector.detect(
  survey([...honest, repeated, single, singleShortTask, slowGiveUp, artifactOnly, unknown]),
  ctx,
) as Evidence[];
const isHonest = (id: string) => /^h\d+$/.test(id);
const byId = (id: string) => evidence.filter((e) => e.responseId === id);
const weighed = (id: string) => byId(id).filter((e) => !e.designArtifact);

describe('website-bounce', () => {
  it('declares itself a statistical detector', () => {
    expect(websiteBounceDetector.name).toBe('website-bounce');
    expect(websiteBounceDetector.needsLlm).toBe(false);
  });

  it('flags two bounced tasks as repeated_bounce (strong)', () => {
    const ev = weighed('repeated');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('repeated_bounce');
    expect(ev[0].strength).toBe('strong');
    expect(ev[0].blocks).toEqual([0, 1]);
    expect(ev[0].stats?.nGaveUp).toBe(1);
  });

  it('flags one bounce on a long task as bounce (weak)', () => {
    const ev = weighed('single');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('bounce');
    expect(ev[0].strength).toBe('weak');
    expect(ev[0].blocks).toEqual([0]);
    expect(ev[0].stats?.cohortMedianSec as number).toBeGreaterThanOrEqual(20);
  });

  it('ignores a single bounce on a task the cohort finishes in under 20 s', () => {
    expect(byId('single-short-task')).toHaveLength(0);
  });

  it('does not flag a give-up after a real attempt', () => {
    expect(byId('slow-give-up')).toHaveLength(0);
  });

  it('ignores blocks with unknown duration', () => {
    expect(byId('unknown')).toHaveLength(0);
  });

  it('treats a task many respondents bounce on as a design artifact', () => {
    const ev = byId('artifact-only');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('cohort_bounce_task');
    expect(ev[0].designArtifact).toBe(true);
    expect(ev[0].blocks).toEqual([2]);
    const honestArtifacts = evidence.filter(
      (e) => isHonest(e.responseId) && e.signal === 'cohort_bounce_task',
    );
    expect(honestArtifacts).toHaveLength(6);
  });

  it('never flags honest respondents', () => {
    expect(evidence.filter((e) => isHonest(e.responseId) && !e.designArtifact)).toHaveLength(0);
  });

  it('stays silent below the minimum cohort', () => {
    expect(
      websiteBounceDetector.detect(survey([...honest.slice(0, 10), repeated]), ctx),
    ).toHaveLength(0);
  });
});
