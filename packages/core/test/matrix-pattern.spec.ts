import { describe, expect, it } from 'vitest';
import type { Block, Response, Survey } from '../src/contract/types.js';
import {
  deriveOptionOrder,
  detectPattern,
  matrixPatternDetector,
  scaleRuns,
} from '../src/detectors/matrix-pattern/matrix-pattern.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

/** Deterministic LCG so that fixtures are reproducible without any dependency. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const ROWS = ['Battery life', 'Screen', 'Camera', 'Price', 'Build quality'];
const MATRIX_QUESTIONS = ['Rate the phone', 'Rate the tablet', 'Rate the laptop'];
const SCALE_QUESTIONS = Array.from({ length: 6 }, (_, i) => `Statement ${i + 1}`);

function matrix(question: string, values: string[], duration: number): Block {
  const answer: Record<string, string[]> = {};
  ROWS.forEach((row, i) => {
    answer[row] = [values[i]];
  });
  return { type: 'matrix', question, answer, duration };
}

/** Rows like [a, a, b, a, c] — never flat, never alternating, never monotone. */
function honestValues(rnd: () => number): string[] {
  const opts = ['1', '2', '3', '4', '5'];
  const a = opts[Math.floor(rnd() * 5)];
  const others = opts.filter((o) => o !== a);
  const b = others[Math.floor(rnd() * 4)];
  const c = others.filter((o) => o !== b)[Math.floor(rnd() * 3)];
  return [a, a, b, a, c];
}

function honestScales(rnd: () => number): string[] {
  // 6 scale answers, never five identical in a row.
  return SCALE_QUESTIONS.map((_, i) => String(1 + ((i + Math.floor(rnd() * 3)) % 5)));
}

interface Spec {
  id: string;
  matrices?: (string[] | null)[];
  scales?: string[];
  duration?: number;
}

function build(spec: Spec, rnd: () => number): Response {
  const duration = spec.duration ?? 20 + Math.floor(rnd() * 25);
  const blocks: Block[] = [];
  MATRIX_QUESTIONS.forEach((q, i) => {
    const custom = spec.matrices?.[i];
    blocks.push(matrix(q, custom ?? honestValues(rnd), duration));
  });
  const scales = spec.scales ?? honestScales(rnd);
  SCALE_QUESTIONS.forEach((q, i) => {
    blocks.push({ type: 'scale', question: q, answer: scales[i], duration: 5 });
  });
  return { id: spec.id, blocks };
}

function survey(offenders: Spec[], honestCount = 45, seed = 7): Survey {
  const rnd = lcg(seed);
  const responses: Response[] = [];
  for (let i = 0; i < honestCount; i++) responses.push(build({ id: `h${i}` }, rnd));
  for (const o of offenders) responses.push(build(o, rnd));
  return { id: 'synthetic-matrix', responses };
}

const FLAT = ['3', '3', '3', '3', '3'];
const ZIGZAG = ['1', '5', '1', '5', '1'];
const DIAGONAL = ['1', '2', '3', '4', '5'];

describe('matrix-pattern primitives', () => {
  it('derives a numeric option order and refuses a textual one', () => {
    expect(deriveOptionOrder(['1', '3', '2', '5'])?.get('5')).toBe(3);
    expect(deriveOptionOrder(['Agree', 'Disagree', 'Neutral'])).toBeNull();
    expect(deriveOptionOrder(['1', '2'])).toBeNull();
  });

  it('classifies flat, zigzag and diagonal rows', () => {
    const order = deriveOptionOrder(['1', '2', '3', '4', '5']);
    expect(detectPattern(FLAT, order)).toBe('flat');
    expect(detectPattern(ZIGZAG, order)).toBe('zigzag');
    expect(detectPattern(DIAGONAL, order)).toBe('diagonal');
    expect(detectPattern(['5', '4', '3', '2', '1'], order)).toBe('diagonal');
    expect(detectPattern(DIAGONAL, null)).toBeNull();
    expect(detectPattern(['1', '1', '2', '1', '3'], order)).toBeNull();
    expect(detectPattern(['3', '3', '3'], order)).toBeNull();
  });

  it('finds a patterned scale run only when five identical answers are consecutive', () => {
    const scale = (answer: string): Block => ({
      type: 'scale',
      question: `s${answer}`,
      answer,
      duration: 3,
    });
    const patterned: Response = { id: 'a', blocks: ['4', '4', '4', '4', '4', '2'].map(scale) };
    const varied: Response = { id: 'b', blocks: ['4', '4', '2', '4', '4', '4'].map(scale) };
    const short: Response = { id: 'c', blocks: ['4', '4', '4', '4'].map(scale) };
    expect(scaleRuns(patterned)).toEqual([
      { indexes: [0, 1, 2, 3, 4, 5], patterned: true, value: '4' },
    ]);
    expect(scaleRuns(varied)[0].patterned).toBe(false);
    expect(scaleRuns(short)).toEqual([]);
  });
});

describe('matrix-pattern detector', () => {
  const s = survey([
    { id: 'flat-all', matrices: [FLAT, FLAT, FLAT] },
    { id: 'flat-fast', matrices: [FLAT, FLAT, FLAT], duration: 2 },
    { id: 'mixed-patterns', matrices: [ZIGZAG, ZIGZAG, DIAGONAL] },
    { id: 'two-flat', matrices: [FLAT, FLAT, null] },
    { id: 'one-flat', matrices: [FLAT, null, null] },
    { id: 'scale-run', matrices: [FLAT, null, null], scales: ['4', '4', '4', '4', '4', '4'] },
    { id: 'scale-run-only', scales: ['2', '2', '2', '2', '2', '2'] },
  ]);
  const evidence = matrixPatternDetector.detect(s, ctx) as Evidence[];
  const byId = (id: string) => evidence.filter((e) => e.responseId === id);

  it('flags straightline_full (strong) when every matrix is flat at normal speed — 3 of 4 units', () => {
    const [e] = byId('flat-all');
    expect(e.signal).toBe('straightline_full');
    expect(e.strength).toBe('strong');
    expect(e.stats?.patternedUnits).toBe(3);
    expect(e.stats?.units).toBe(4);
    expect(e.stats?.patternedShare).toBe(0.75);
    expect(e.stats?.meanDurationZ as number).toBeGreaterThan(-1.5);
    expect(e.blocks).toEqual([0, 1, 2]);
    expect(e.designArtifact).toBeUndefined();
  });

  it('flags only straightline (weak) for two flat matrices — 2 of 4 units', () => {
    const [e] = byId('two-flat');
    expect(e.signal).toBe('straightline');
    expect(e.strength).toBe('weak');
    expect(e.stats?.patternedUnits).toBe(2);
    expect(e.stats?.patternedShare).toBe(0.5);
  });

  it('upgrades to straightline_fast when the patterned matrices were rushed', () => {
    const [e] = byId('flat-fast');
    expect(e.signal).toBe('straightline_fast');
    expect(e.strength).toBe('strong');
    expect(e.stats?.meanDurationZ as number).toBeLessThanOrEqual(-1.5);
  });

  it('counts zigzag and diagonal as patterns', () => {
    const [e] = byId('mixed-patterns');
    expect(e.signal).toBe('straightline_full');
    expect(e.stats?.patterns).toBe('zigzag,zigzag,diagonal');
  });

  it('stays silent on a single flat matrix', () => {
    expect(byId('one-flat')).toEqual([]);
  });

  it('counts a run of identical scale answers as one patterned unit', () => {
    const [e] = byId('scale-run');
    expect(e.signal).toBe('straightline');
    expect(e.stats?.patternedScaleRuns).toBe(1);
    expect(e.stats?.patternedMatrices).toBe(1);
    expect(e.blocks).toEqual([0, 3, 4, 5, 6, 7, 8]);
  });

  it('a lone scale run is not enough', () => {
    expect(byId('scale-run-only')).toEqual([]);
  });

  it('does not flag honest respondents and emits one evidence per respondent', () => {
    const honest = evidence.filter((e) => e.responseId.startsWith('h'));
    expect(honest).toEqual([]);
    const ids = evidence.map((e) => `${e.responseId}:${e.signal}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('is silent when the cohort is below minCohort', () => {
    const small = survey([{ id: 'flat-all', matrices: [FLAT, FLAT, FLAT] }], 10);
    expect(matrixPatternDetector.detect(small, ctx)).toEqual([]);
  });

  it('reports a matrix flat for 40%+ of the cohort as a design artifact and excludes it from the tally', () => {
    const rnd = lcg(11);
    const responses: Response[] = [];
    // 25 of 50 respondents are flat on the first matrix (a uniform battery) and honest elsewhere.
    for (let i = 0; i < 50; i++) {
      responses.push(build({ id: `r${i}`, matrices: [i < 25 ? FLAT : null, null, null] }, rnd));
    }
    // Someone flat on the uniform battery AND on one more matrix: 1 patterned of 3 counted units → silent.
    responses.push(build({ id: 'flat-two', matrices: [FLAT, FLAT, null] }, rnd));
    // Someone flat everywhere: 2 patterned of 3 counted units → straightline, battery excluded.
    // Counting the battery it would be 3 of 4 = straightline_full; the artifact rule keeps it weak.
    responses.push(build({ id: 'flat-three', matrices: [FLAT, FLAT, FLAT] }, rnd));
    const ev = matrixPatternDetector.detect({ id: 'uniform', responses }, ctx) as ReturnType<
      typeof Array.of
    >;

    const artifacts = ev.filter((e) => e.signal === 'cohort_flat_matrix');
    expect(artifacts.length).toBe(27);
    expect(artifacts.every((e) => e.designArtifact === true)).toBe(true);
    expect(artifacts[0].blocks).toEqual([0]);
    expect(artifacts[0].stats?.cohortFlatShare as number).toBeGreaterThanOrEqual(0.4);

    expect(ev.filter((e) => e.responseId === 'flat-two' && !e.designArtifact)).toEqual([]);
    const strong = ev.filter((e) => e.responseId === 'flat-three' && !e.designArtifact);
    expect(strong.length).toBe(1);
    expect(strong[0].signal).toBe('straightline');
    expect(strong[0].strength).toBe('weak');
    expect(strong[0].stats?.units).toBe(3);
    expect(strong[0].stats?.patternedUnits).toBe(2);
    expect(strong[0].blocks).toEqual([1, 2]);
  });
});
