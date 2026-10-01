import { describe, expect, it } from 'vitest';
import type { Block, OpenTextBlock, Response } from '../src/contract/types.js';
import { comparableText, normalizeText } from '../src/detectors/duplicate-open/duplicate-open.js';
import { duplicateOpenDetector } from '../src/detectors/duplicate-open/index.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';
import { cohort, survey } from './helpers/synthetic.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function open(i: number, text: string): OpenTextBlock {
  return {
    type: 'open',
    blockId: `o${i}`,
    question: `Tell us more about topic ${i}`,
    answer: [{ role: 'user', text }],
    duration: 30,
  };
}

function planted(id: string, texts: string[]): Response {
  const blocks: Block[] = texts.map((t, i) => open(i, t));
  return { id, blocks };
}

// Honest cohort with 6 open questions; on o5 half of them answer "Yes" (design artifact).
const honest = cohort(40, 7, { open: 6 });
for (let i = 0; i < 20; i++) {
  (honest[i].blocks[5] as OpenTextBlock).answer = [{ role: 'user', text: i % 2 ? 'Yes' : 'yes.' }];
}

const paster = planted('paster', [
  'Everything is fine, nothing to add here.',
  'everything is fine,  nothing to add here',
  'EVERYTHING IS FINE, NOTHING TO ADD HERE!',
  'I like the colours.',
  'The price is too high.',
  'Yes',
]);
const twice = planted('twice', [
  'Hard to say, it depends on the day.',
  'hard to say, it depends on the day',
  'The app crashed once.',
  'Good enough.',
  'Mostly in the evening.',
  'No idea.',
]);
const empty = planted('empty', [
  'no',
  'Nothing.',
  'N/A',
  'It works for me.',
  'Mostly in the evening.',
  'Maybe.',
]);
const short = planted('short', ['k', '..', '-', 'k', 'k', 'k']);
const artifactOnly = planted('artifact-only', [
  'Fast delivery.',
  'Cheaper plans.',
  'Nothing comes to mind.',
  'The search is slow.',
  'Yes',
  'yes',
]);

const evidence = duplicateOpenDetector.detect(
  survey([...honest, paster, twice, empty, short, artifactOnly]),
  ctx,
) as Evidence[];
const isHonest = (id: string) => /^h\d+$/.test(id);
const byId = (id: string) => evidence.filter((e) => e.responseId === id);
const weighed = (id: string) => byId(id).filter((e) => !e.designArtifact);

describe('duplicate-open', () => {
  it('declares itself a statistical detector', () => {
    expect(duplicateOpenDetector.name).toBe('duplicate-open');
    expect(duplicateOpenDetector.needsLlm).toBe(false);
  });

  it('normalizes case, whitespace and trailing punctuation and drops short texts', () => {
    expect(normalizeText('  Hello,   World!!! ')).toBe('hello, world');
    expect(comparableText('k.')).toBe('');
    expect(comparableText('No')).toBe('no');
    expect(comparableText('N/A')).toBe('n/a');
  });

  it('flags the same text on three questions as x3 (strong)', () => {
    const ev = weighed('paster');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('x3');
    expect(ev[0].strength).toBe('strong');
    expect(ev[0].blocks).toEqual([0, 1, 2]);
    expect(ev[0].stats?.nQuestions).toBe(3);
  });

  it('flags the same text on two questions as x2 (weak)', () => {
    const ev = weighed('twice');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('x2');
    expect(ev[0].strength).toBe('weak');
    expect(ev[0].blocks).toEqual([0, 1]);
  });

  it('flags three placeholder answers as empty_repeat (weak)', () => {
    const ev = weighed('empty');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('empty_repeat');
    expect(ev[0].blocks).toEqual([0, 1, 2]);
  });

  it('ignores texts shorter than three characters', () => {
    expect(byId('short')).toHaveLength(0);
  });

  it('reports a cohort-wide identical answer as a design artifact and excludes it', () => {
    const ev = byId('artifact-only');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('cohort_same_answer');
    expect(ev[0].designArtifact).toBe(true);
    expect(ev[0].blocks).toEqual([5]);
    // "yes" on o4 alone is one question, not a repeat.
    expect(weighed('artifact-only')).toHaveLength(0);
    const honestArtifacts = evidence.filter(
      (e) => isHonest(e.responseId) && e.signal === 'cohort_same_answer',
    );
    expect(honestArtifacts).toHaveLength(20);
  });

  it('never flags honest respondents', () => {
    expect(evidence.filter((e) => isHonest(e.responseId) && !e.designArtifact)).toHaveLength(0);
  });

  it('stays silent below the minimum cohort', () => {
    expect(
      duplicateOpenDetector.detect(survey([...honest.slice(0, 10), paster]), ctx),
    ).toHaveLength(0);
  });
});
