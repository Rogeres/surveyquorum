import { describe, expect, it } from 'vitest';
import type { Block, Response, Survey } from '../src/contract/types.js';
import {
  firstclickOfftargetDetector,
  isOffDensity,
} from '../src/detectors/firstclick-offtarget/firstclick-offtarget.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

type Point = { top: number; left: number };

/** Four tasks, each with a primary hotspot and a secondary one (people are allowed to disagree). */
const TASKS: { question: string; spots: Point[] }[] = [
  {
    question: 'Where would you click to open the menu?',
    spots: [
      { top: 0.08, left: 0.05 },
      { top: 0.08, left: 0.92 },
    ],
  },
  {
    question: 'Where would you click to add the item to the cart?',
    spots: [
      { top: 0.72, left: 0.55 },
      { top: 0.35, left: 0.65 },
    ],
  },
  {
    question: 'Where would you click to see your orders?',
    spots: [
      { top: 0.12, left: 0.85 },
      { top: 0.5, left: 0.5 },
    ],
  },
  {
    question: 'Where would you click to contact support?',
    spots: [
      { top: 0.92, left: 0.5 },
      { top: 0.1, left: 0.5 },
    ],
  },
];

function click(question: string, p: Point, duration: number): Block {
  return { type: 'firstclick', question, answer: { top: p.top, left: p.left }, duration };
}

function jitter(p: Point, rnd: () => number, r = 0.03): Point {
  return { top: p.top + (rnd() - 0.5) * r, left: p.left + (rnd() - 0.5) * r };
}

function honest(id: string, rnd: () => number): Response {
  return {
    id,
    blocks: TASKS.map((t) => {
      const spot = t.spots[rnd() < 0.75 ? 0 : 1];
      return click(t.question, jitter(spot, rnd), 6 + Math.floor(rnd() * 10));
    }),
  };
}

function custom(id: string, points: Point[], duration: number | number[]): Response {
  return {
    id,
    blocks: TASKS.map((t, i) =>
      click(t.question, points[i], Array.isArray(duration) ? duration[i] : duration),
    ),
  };
}

/** Per-offender far points: each in its own grid cell, two or more cells from every hotspot. */
const FAR_A: Point[] = [
  { top: 0.55, left: 0.45 },
  { top: 0.05, left: 0.05 },
  { top: 0.85, left: 0.15 },
  { top: 0.45, left: 0.25 },
];
const FAR_B: Point[] = [
  { top: 0.85, left: 0.25 },
  { top: 0.95, left: 0.95 },
  { top: 0.85, left: 0.85 },
  { top: 0.55, left: 0.85 },
];
const FAR_C: Point[] = [
  { top: 0.25, left: 0.75 },
  { top: 0.55, left: 0.15 },
  { top: 0.35, left: 0.15 },
  { top: 0.65, left: 0.05 },
];
const FAR_D: Point[] = [
  { top: 0.75, left: 0.65 },
  { top: 0.05, left: 0.55 },
  { top: 0.35, left: 0.35 },
  { top: 0.45, left: 0.75 },
];

function survey(extra: Response[], honestCount = 48, seed = 21): Survey {
  const rnd = lcg(seed);
  const responses: Response[] = [];
  for (let i = 0; i < honestCount; i++) responses.push(honest(`h${i}`, rnd));
  return { id: 'synthetic-firstclick', responses: [...responses, ...extra] };
}

describe('firstclick-offtarget primitives', () => {
  it('uses leave-one-out density so a lone click is off-density and a neighbour rescues it', () => {
    const counts = new Array<number>(100).fill(0);
    counts[5 * 10 + 5] = 1; // only our own click
    counts[0] = 39; // everyone else top-left
    expect(isOffDensity(counts, 40, 5, 5)).toBe(true);
    counts[4 * 10 + 5] = 1; // one other person in the cell above
    counts[0] = 38;
    expect(isOffDensity(counts, 40, 5, 5)).toBe(false);
    expect(isOffDensity(counts, 40, 0, 0)).toBe(false);
  });
});

describe('firstclick-offtarget detector', () => {
  const s = survey([
    custom(
      'same-spot',
      [
        { top: 0.5, left: 0.5 },
        { top: 0.51, left: 0.5 },
        { top: 0.5, left: 0.515 },
        { top: 0.49, left: 0.49 },
      ],
      8,
    ),
    custom('off-fast', FAR_A, 1),
    custom('off-slow', FAR_B, 10),
    custom('one-off', [FAR_C[0], TASKS[1].spots[0], TASKS[2].spots[0], TASKS[3].spots[0]], 1),
    custom(
      'two-off-fast',
      [FAR_D[0], FAR_D[1], TASKS[2].spots[0], TASKS[3].spots[0]],
      [1, 1, 9, 9],
    ),
  ]);
  const evidence = firstclickOfftargetDetector.detect(s, ctx) as Evidence[];
  const byId = (id: string) => evidence.filter((e) => e.responseId === id);

  it('clicking the same place on every image is same_spot (strong)', () => {
    const [e] = byId('same-spot');
    expect(e.signal).toBe('same_spot');
    expect(e.strength).toBe('strong');
    expect(e.stats?.tasks).toBe(4);
    expect(e.stats?.maxPairDistance as number).toBeLessThan(0.03);
    expect(e.blocks).toEqual([0, 1, 2, 3]);
  });

  it('several fast off-density clicks are repeated_off_density (weak)', () => {
    const [e] = byId('off-fast');
    expect(e.signal).toBe('repeated_off_density');
    expect(e.strength).toBe('weak');
    expect(e.stats?.offDensityTasks).toBe(4);
    expect(e.stats?.meanZ as number).toBeLessThanOrEqual(-1);
    const [f] = byId('two-off-fast');
    expect(f.signal).toBe('repeated_off_density');
    expect(f.stats?.offDensityTasks).toBe(2);
    expect(f.blocks).toEqual([0, 1]);
  });

  it('slow disagreement with the room is allowed', () => {
    expect(byId('off-slow')).toEqual([]);
  });

  it('a single off-density click is allowed even when fast', () => {
    expect(byId('one-off')).toEqual([]);
  });

  it('honest respondents are silent and there is one evidence per respondent', () => {
    expect(evidence.filter((e) => e.responseId.startsWith('h'))).toEqual([]);
    expect(new Set(evidence.map((e) => e.responseId)).size).toBe(evidence.length);
  });

  it('same_spot does not need a cohort, density does', () => {
    const small = survey(
      [
        custom('same-spot', Array(4).fill({ top: 0.5, left: 0.5 }), 8),
        custom('off-fast', FAR_A, 1),
      ],
      10,
    );
    const ev = firstclickOfftargetDetector.detect(small, ctx) as Evidence[];
    expect(ev.map((e) => `${e.responseId}:${e.signal}`)).toEqual(['same-spot:same_spot']);
  });

  it('a task where 30%+ of the cohort is off-density is a design artifact and does not count', () => {
    const rnd = lcg(4);
    // Task 0 becomes a scattered image: 16 respondents click unique isolated cells (odd rows and
    // columns 1–7, so no two neighbourhoods touch), 34 share 8 spots along row 9 and column 9.
    const isolated: Point[] = [];
    for (const t of [0.15, 0.35, 0.55, 0.75]) {
      for (const l of [0.15, 0.35, 0.55, 0.75]) isolated.push({ top: t, left: l });
    }
    const shared: Point[] = [
      ...[0.15, 0.35, 0.55, 0.75].map((l) => ({ top: 0.95, left: l })),
      ...[0.15, 0.35, 0.55, 0.75].map((t) => ({ top: t, left: 0.95 })),
    ];
    const responses: Response[] = [];
    for (let i = 0; i < 50; i++) {
      const r = honest(`r${i}`, rnd);
      const spot = i < 16 ? isolated[i] : shared[i % shared.length];
      r.blocks[0] = click(TASKS[0].question, spot, i < 16 ? 1 : 8);
      responses.push(r);
    }
    // Fast off-density on the scattered task AND on one more task: only one counted → silent.
    const planted = honest('planted', rnd);
    planted.blocks[0] = click(TASKS[0].question, { top: 0.95, left: 0.95 }, 1);
    planted.blocks[1] = click(TASKS[1].question, FAR_A[1], 1);
    responses.push(planted);
    const ev = firstclickOfftargetDetector.detect(
      { id: 'scattered', responses },
      ctx,
    ) as Evidence[];
    const artifacts = ev.filter((e) => e.signal === 'cohort_scattered_clicks');
    expect(artifacts.length).toBe(17);
    expect(artifacts.every((e) => e.designArtifact === true && e.blocks?.[0] === 0)).toBe(true);
    expect(ev.filter((e) => !e.designArtifact)).toEqual([]);
  });
});
