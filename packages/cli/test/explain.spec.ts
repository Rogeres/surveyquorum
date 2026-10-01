import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SurveyResult } from 'surveyquorum';
import { afterAll, describe, expect, it } from 'vitest';
import { explainCommand, formatExplanation } from '../src/commands/explain.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-explain-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const results: SurveyResult[] = [
  {
    surveyId: 's1',
    skippedDetectors: ['open-answer'],
    designArtifacts: [],
    verdicts: [
      {
        responseId: 'r1',
        outcome: 'block',
        score: 2.7,
        noContentToCheck: true,
        evidence: [
          {
            responseId: 'r1',
            detector: 'pace',
            signal: 'consistent',
            strength: 'strong',
            summary: '6 of 8 blocks below cohort mean minus two sigma.',
            stats: { blocksBelow: 6, blocksTotal: 8, medianZ: -2.4 },
            blocks: [0, 1, 2, 4, 5, 7],
          },
          {
            responseId: 'r1',
            detector: 'matrix-pattern',
            signal: 'straight_line',
            strength: 'weak',
            summary: 'Same column in every row of 2 matrices.',
          },
        ],
        designArtifacts: [
          {
            responseId: 'r1',
            detector: 'matrix-pattern',
            signal: 'straight_line',
            strength: 'weak',
            summary: 'Fired for 41% of the cohort on block 3.',
            blocks: [3],
            designArtifact: true,
          },
        ],
      },
    ],
  },
];

describe('explain command', () => {
  it('prints outcome, score, evidence with weights, design artifacts and the no-content note', () => {
    const text = formatExplanation(results, 'r1')!;
    expect(text).toContain('r1 (survey s1): BLOCK');
    // Thresholds and weights come from the v1 weights file (posterior probabilities, LLRs).
    expect(text).toContain('score 2.7 — block at ≥ 0.95, review at ≥ 0.2');
    expect(text).toContain('note: no open answers');
    expect(text).toContain('- pace.consistent [strong, weight +4.5]');
    expect(text).toContain('stats: blocksBelow=6, blocksTotal=8, medianZ=-2.4');
    expect(text).toContain('blocks: 0, 1, 2, 4, 5, 7');
    expect(text).toContain('- matrix-pattern.straight_line [weak, weight +2.119]');
    expect(text).toContain('design artifacts (1)');
    expect(text).toContain('- matrix-pattern.straight_line [weak, not weighed]');
    expect(text).toContain('detectors skipped in this run (no LLM): open-answer');
  });

  it('returns undefined for an unknown respondent', () => {
    expect(formatExplanation(results, 'zz')).toBeUndefined();
  });

  it('reads a verdicts file and reports a missing id with exit code 1', () => {
    const path = join(dir, 'verdicts.json');
    writeFileSync(path, JSON.stringify(results));
    const lines = { out: [] as string[], err: [] as string[] };
    const io: Io = { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
    expect(explainCommand([path, 'r1'], io)).toBe(0);
    expect(lines.out[0]).toContain('BLOCK');
    expect(explainCommand([path, 'r2'], io)).toBe(1);
    expect(lines.err[0]).toBe(`r2: not found among 1 verdict(s) in ${path}`);
    expect(explainCommand([path], io)).toBe(2);
  });
});
