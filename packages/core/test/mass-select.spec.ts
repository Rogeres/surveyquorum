import { describe, expect, it } from 'vitest';
import type { Block, ChoiceBlock, Response } from '../src/contract/types.js';
import { massSelectDetector } from '../src/detectors/mass-select/index.js';
import { isMass } from '../src/detectors/mass-select/mass-select.js';
import type { DetectorContext, Evidence } from '../src/detectors/types.js';
import { CHOICE_OPTIONS, cohort, survey } from './helpers/synthetic.js';

const ctx: DetectorContext = { minCohort: 30, log: () => {} };

function choice(i: number, answer: string[], duration: number): ChoiceBlock {
  return {
    type: 'choice',
    blockId: `c${i}`,
    question: `Which of these matter to you? (${i})`,
    options: CHOICE_OPTIONS,
    answer,
    duration,
  };
}

/** `massIdx` blocks get all options, the rest a single option; all at `massSec`. */
function planted(id: string, massIdx: number[], massSec: number, otherSec = 12): Response {
  const blocks: Block[] = [];
  for (let i = 0; i < 8; i++) {
    blocks.push(
      massIdx.includes(i)
        ? choice(i, CHOICE_OPTIONS, massSec)
        : choice(i, [CHOICE_OPTIONS[1]], otherSec),
    );
  }
  return { id, blocks };
}

// Honest cohort; on question c7 40% of them genuinely select 7 of 8 options (design artifact).
const honest = cohort(50, 23, { choice: 8 });
for (let i = 0; i < 20; i++) {
  const b = honest[i].blocks[7] as ChoiceBlock;
  b.answer = CHOICE_OPTIONS.slice(0, 7);
}

const heavy = planted('heavy', [0, 1, 2, 3, 4, 5, 7], 2);
const pattern = planted('pattern', [0, 1, 2], 6);
const slowMass = planted('slow-mass', [0, 1, 2, 3, 4, 5], 12);
const twoMass = planted('two-mass', [0, 1], 2);
const onlyArtifact = planted('only-artifact', [7], 2);

const evidence = massSelectDetector.detect(
  survey([...honest, heavy, pattern, slowMass, twoMass, onlyArtifact]),
  ctx,
) as Evidence[];
const isHonest = (id: string) => /^h\d+$/.test(id);
const byId = (id: string) => evidence.filter((e) => e.responseId === id);
const weighed = (id: string) => byId(id).filter((e) => !e.designArtifact);

describe('mass-select', () => {
  it('declares itself a statistical detector', () => {
    expect(massSelectDetector.name).toBe('mass-select');
    expect(massSelectDetector.needsLlm).toBe(false);
  });

  it('isMass follows max(5, ceil(0.7 × options)) and 6 without options', () => {
    expect(isMass(choice(0, CHOICE_OPTIONS.slice(0, 6), 1))).toBe(true);
    expect(isMass(choice(0, CHOICE_OPTIONS.slice(0, 5), 1))).toBe(false);
    expect(
      isMass({ type: 'choice', question: 'q', answer: ['a', 'b', 'c', 'd', 'e'], duration: 1 }),
    ).toBe(false);
    expect(
      isMass({
        type: 'choice',
        question: 'q',
        answer: ['a', 'b', 'c', 'd', 'e', 'f'],
        duration: 1,
      }),
    ).toBe(true);
  });

  it('flags six fast mass blocks as heavy_pattern (strong), excluding the artifact block', () => {
    const ev = weighed('heavy');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('heavy_pattern');
    expect(ev[0].strength).toBe('strong');
    expect(ev[0].stats?.nMass).toBe(6);
    // 8 cohort-level multi-select questions minus the artifact one.
    expect(ev[0].stats?.nMulti).toBe(7);
    expect(ev[0].blocks).not.toContain(7);
    expect(byId('heavy').some((e) => e.designArtifact && e.signal === 'cohort_mass_block')).toBe(
      true,
    );
  });

  it('flags three moderately fast mass blocks out of seven as pattern (weak)', () => {
    const ev = weighed('pattern');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('pattern');
    expect(ev[0].strength).toBe('weak');
    expect(ev[0].stats?.meanZ as number).toBeLessThanOrEqual(-1);
    expect(ev[0].stats?.meanZ as number).toBeGreaterThan(-1.5);
    expect(ev[0].stats?.multiShare as number).toBeLessThan(0.75);
  });

  it('does not flag a slow respondent who selects everything', () => {
    expect(weighed('slow-mass')).toHaveLength(0);
  });

  it('does not flag two mass blocks', () => {
    expect(weighed('two-mass')).toHaveLength(0);
  });

  it('reports a cohort-wide mass question as a design artifact only', () => {
    const ev = byId('only-artifact');
    expect(ev).toHaveLength(1);
    expect(ev[0].signal).toBe('cohort_mass_block');
    expect(ev[0].designArtifact).toBe(true);
    expect(ev[0].blocks).toEqual([7]);
    // The honest respondents who were mass on c7 see the same artifact and nothing else.
    const artifactHonest = evidence.filter(
      (e) => isHonest(e.responseId) && e.signal === 'cohort_mass_block',
    );
    expect(artifactHonest).toHaveLength(20);
  });

  it('never flags honest respondents', () => {
    expect(evidence.filter((e) => isHonest(e.responseId) && !e.designArtifact)).toHaveLength(0);
  });

  describe('whole-survey route', () => {
    // Four multi-select questions plus two single-select questions with a long option list.
    // The singles look multi-select on one block (>= 5 options) but never at cohort level.
    function withSingles(r: Response, massSingles = false): Response {
      const singles: Block[] = [8, 9].map((i) => ({
        type: 'choice' as const,
        blockId: `s${i}`,
        question: `Which one best describes you? (${i})`,
        options: CHOICE_OPTIONS,
        answer: massSingles ? CHOICE_OPTIONS : [CHOICE_OPTIONS[i % CHOICE_OPTIONS.length]],
        duration: massSingles ? 2 : 10,
      }));
      return { ...r, blocks: [...r.blocks, ...singles] };
    }
    function plantedFour(id: string, massIdx: number[], massSec: number): Response {
      const blocks: Block[] = [];
      for (let i = 0; i < 4; i++) {
        blocks.push(
          massIdx.includes(i)
            ? choice(i, CHOICE_OPTIONS, massSec)
            : choice(i, [CHOICE_OPTIONS[1]], 12),
        );
      }
      return withSingles({ id, blocks });
    }
    const small = cohort(50, 29, { choice: 4 }).map((r) => withSingles(r));
    const ev = massSelectDetector.detect(
      survey([
        ...small,
        plantedFour('three-of-four', [0, 1, 2], 6),
        plantedFour('two-of-four', [0, 1], 6),
        plantedFour('three-of-four-slow', [0, 1, 2], 12),
      ]),
      ctx,
    ) as Evidence[];
    const own = (id: string) => ev.filter((e) => e.responseId === id && !e.designArtifact);

    it('three moderately fast mass blocks covering 75% of the multi-select questions are heavy_pattern (strong)', () => {
      const e = own('three-of-four');
      expect(e).toHaveLength(1);
      expect(e[0].signal).toBe('heavy_pattern');
      expect(e[0].strength).toBe('strong');
      expect(e[0].stats?.nMass).toBe(3);
      expect(e[0].stats?.nMulti).toBe(4);
      expect(e[0].stats?.multiShare).toBe(0.75);
      expect(e[0].stats?.meanZ as number).toBeLessThanOrEqual(-1);
      expect(e[0].stats?.meanZ as number).toBeGreaterThan(-1.5);
      expect(e[0].summary).toContain('across the whole survey');
    });

    it('two of four is below both the count and the coverage route', () => {
      expect(own('two-of-four')).toHaveLength(0);
    });

    it('full coverage at normal speed is still an opinion, not a signal', () => {
      expect(own('three-of-four-slow')).toHaveLength(0);
    });

    it('never flags the honest cohort', () => {
      expect(ev.filter((e) => isHonest(e.responseId) && !e.designArtifact)).toHaveLength(0);
    });
  });

  it('stays silent below the minimum cohort', () => {
    expect(massSelectDetector.detect(survey([...honest.slice(0, 10), heavy]), ctx)).toHaveLength(0);
  });
});
