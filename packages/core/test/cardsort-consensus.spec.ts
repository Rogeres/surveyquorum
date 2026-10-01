import { describe, expect, it } from 'vitest';
import type { Block, Response, Survey } from '../src/contract/types.js';
import {
  cardsortConsensusDetector,
  isUnnamedCategory,
} from '../src/detectors/cardsort-consensus/cardsort-consensus.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const GROUPS: Record<string, string[]> = {
  Fruit: ['Apple', 'Pear', 'Plum', 'Grape'],
  Tools: ['Hammer', 'Wrench', 'Saw', 'Drill'],
  Animals: ['Fox', 'Owl', 'Deer', 'Hare'],
};
const CARDS = Object.values(GROUPS).flat();
const TASK = 'Sort these cards into groups that make sense to you';

function cardsort(answer: Record<string, string[]>, duration: number): Block {
  return { type: 'cardsort', question: TASK, answer, duration };
}

/** The natural sort, with one card moved to a wrong pile every other respondent. */
function honestSort(rnd: () => number, names = Object.keys(GROUPS)): Record<string, string[]> {
  const answer: Record<string, string[]> = {};
  Object.keys(GROUPS).forEach((g, i) => {
    answer[names[i]] = [...GROUPS[g]];
  });
  if (rnd() < 0.5) {
    const keys = Object.keys(answer);
    const from = keys[Math.floor(rnd() * 3)];
    const to = keys.filter((k) => k !== from)[Math.floor(rnd() * 2)];
    const card = answer[from].pop() as string;
    answer[to].push(card);
  }
  return answer;
}

function randomSort(rnd: () => number): Record<string, string[]> {
  const answer: Record<string, string[]> = { 'Group A': [], 'Group B': [], 'Group C': [] };
  const keys = Object.keys(answer);
  for (const c of CARDS) answer[keys[Math.floor(rnd() * 3)]].push(c);
  return answer;
}

/**
 * Deterministic worst case: card i of every group goes to pile i mod 3, so every pile mixes the
 * three groups and almost no "together" pair survives. Agreement ≈ 0.5 against a clean cohort.
 */
function scrambledSort(): Record<string, string[]> {
  const answer: Record<string, string[]> = { 'Group A': [], 'Group B': [], 'Group C': [] };
  const keys = Object.keys(answer);
  for (const cards of Object.values(GROUPS)) {
    cards.forEach((c, i) => {
      answer[keys[i % 3]].push(c);
    });
  }
  return answer;
}

function response(id: string, answer: Record<string, string[]>, duration: number): Response {
  return {
    id,
    blocks: [
      { type: 'choice', question: 'Which device do you use most?', answer: ['Phone'], duration: 4 },
      cardsort(answer, duration),
    ],
  };
}

function honestDuration(rnd: () => number): number {
  return 60 + Math.floor(rnd() * 60);
}

function survey(extra: Response[], honestCount = 45, seed = 3): Survey {
  const rnd = lcg(seed);
  const responses: Response[] = [];
  for (let i = 0; i < honestCount; i++) {
    responses.push(response(`h${i}`, honestSort(rnd), honestDuration(rnd)));
  }
  return { id: 'synthetic-cardsort', responses: [...responses, ...extra] };
}

describe('cardsort-consensus primitives', () => {
  it('recognises empty, numeric and one-character category names', () => {
    expect(isUnnamedCategory('')).toBe(true);
    expect(isUnnamedCategory(' ')).toBe(true);
    expect(isUnnamedCategory('2')).toBe(true);
    expect(isUnnamedCategory('12')).toBe(true);
    expect(isUnnamedCategory('A')).toBe(true);
    expect(isUnnamedCategory('Fruit')).toBe(false);
  });
});

describe('cardsort-consensus detector', () => {
  const rnd = lcg(99);
  const s = survey([
    response('random-fast', randomSort(rnd), 4),
    response('random-slow', randomSort(rnd), 95),
    response('scrambled-slow', scrambledSort(), 95),
    response('single-pile', { Everything: [...CARDS] }, 70),
    response('unnamed', honestSort(rnd, ['1', '2', 'Animals']), 80),
    response('honest-fast', honestSort(rnd), 5),
  ]);
  const evidence = cardsortConsensusDetector.detect(s, ctx) as Evidence[];
  const byId = (id: string) => evidence.filter((e) => e.responseId === id);

  it('random placement at speed is random_sort (strong)', () => {
    const [e] = byId('random-fast');
    expect(e.signal).toBe('random_sort');
    expect(e.strength).toBe('strong');
    expect(e.stats?.z as number).toBeLessThanOrEqual(-2);
    expect(e.stats?.durationZ as number).toBeLessThanOrEqual(-1);
    expect(e.stats?.cards).toBe(12);
    expect(e.stats?.decidedPairs as number).toBeGreaterThan(50);
    expect(e.blocks).toEqual([1]);
  });

  it('moderate disagreement at normal speed is only low_consensus (weak)', () => {
    const [e] = byId('random-slow');
    expect(e.signal).toBe('low_consensus');
    expect(e.strength).toBe('weak');
    expect(e.stats?.z as number).toBeLessThanOrEqual(-2);
    expect(e.stats?.z as number).toBeGreaterThan(-2.5);
    expect(e.stats?.durationZ as number).toBeGreaterThan(-1);
    expect(e.stats?.agreement as number).toBeLessThan(e.stats?.cohortMeanAgreement as number);
  });

  it('placement far from the room is random_sort (strong) regardless of duration', () => {
    const [e] = byId('scrambled-slow');
    expect(e.signal).toBe('random_sort');
    expect(e.strength).toBe('strong');
    expect(e.stats?.z as number).toBeLessThanOrEqual(-2.5);
    expect(e.stats?.durationZ as number).toBeGreaterThan(-1);
    expect(e.summary).toContain('too far from the room');
  });

  it('one pile for all cards is single_pile', () => {
    const [e] = byId('single-pile');
    expect(e.signal).toBe('single_pile');
    expect(e.designArtifact).toBeUndefined();
    expect(e.stats?.categories).toBe(1);
  });

  it('numeric category names are unnamed_categories', () => {
    const [e] = byId('unnamed');
    expect(e.signal).toBe('unnamed_categories');
    expect(e.stats?.categories).toBe(3);
  });

  it('a fast but correct sort is not flagged', () => {
    expect(byId('honest-fast')).toEqual([]);
  });

  it('honest respondents are silent and there is one evidence per respondent', () => {
    expect(evidence.filter((e) => e.responseId.startsWith('h'))).toEqual([]);
    expect(new Set(evidence.map((e) => e.responseId)).size).toBe(evidence.length);
  });

  it('is silent below minCohort', () => {
    const small = survey([response('random-fast', randomSort(lcg(1)), 4)], 10);
    expect(cardsortConsensusDetector.detect(small, ctx)).toEqual([]);
  });

  it('reports single piles as a design artifact when 20%+ of the cohort did the same', () => {
    const rnd2 = lcg(5);
    const piles: Response[] = [];
    for (let i = 0; i < 12; i++) piles.push(response(`p${i}`, { Everything: [...CARDS] }, 70));
    const ev = cardsortConsensusDetector.detect(survey(piles, 36, 5), ctx) as Evidence[];
    const artifacts = ev.filter((e) => e.signal === 'cohort_single_pile');
    expect(artifacts.length).toBe(12);
    expect(artifacts.every((e) => e.designArtifact === true)).toBe(true);
    expect(ev.filter((e) => e.signal === 'single_pile')).toEqual([]);
    expect(rnd2()).toBeGreaterThanOrEqual(0);
  });

  it('reports unnamed categories as a design artifact when half the cohort shares them', () => {
    const rnd3 = lcg(8);
    const responses: Response[] = [];
    for (let i = 0; i < 48; i++) {
      responses.push(response(`c${i}`, honestSort(rnd3, ['1', '2', '3']), honestDuration(rnd3)));
    }
    const ev = cardsortConsensusDetector.detect(
      { id: 'closed-sort', responses },
      ctx,
    ) as Evidence[];
    expect(ev.length).toBe(48);
    expect(ev.every((e) => e.signal === 'cohort_unnamed_categories' && e.designArtifact)).toBe(
      true,
    );
  });
});
