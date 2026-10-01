import { describe, expect, it } from 'vitest';
import {
  type DesignArtifactGroup,
  describeDesignArtifact,
  type Evidence,
  type Survey,
  summarizeDesignArtifacts,
} from '../src/index.js';

const survey: Survey = {
  id: 's',
  responses: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    blocks: [
      { type: 'open', blockId: 'q1', question: 'Why?', duration: 5, answer: [] },
      {
        type: 'prototype',
        blockId: 'q2',
        question: 'Task: buy a thing',
        duration: 3,
        status: 'gave_up',
        clickCount: 0,
      },
    ],
  })) as Survey['responses'],
};

const artifact = (
  responseId: string,
  blocks: number[],
  signal = 'cohort_give_up_task',
): Evidence => ({
  responseId,
  detector: 'prototype-effort',
  signal,
  strength: 'weak',
  summary: 'x',
  blocks,
  designArtifact: true,
});

describe('design artifact summary', () => {
  it('groups per (detector, signal, question) and counts distinct respondents', () => {
    const evidence: Evidence[] = [
      artifact('a', [1]),
      artifact('b', [1]),
      artifact('b', [1]), // the same respondent twice counts once
      artifact('c', [0, 1]), // one evidence item on two questions lands in both groups
      { ...artifact('d', [1]), designArtifact: undefined }, // weighed evidence is not an artifact
    ];
    const groups = summarizeDesignArtifacts(survey, evidence);
    expect(groups).toEqual([
      {
        detector: 'prototype-effort',
        signal: 'cohort_give_up_task',
        blockKey: 'q2',
        question: 'Task: buy a thing',
        respondents: 3,
        cohortShare: 0.75,
      },
      {
        detector: 'prototype-effort',
        signal: 'cohort_give_up_task',
        blockKey: 'q1',
        question: 'Why?',
        respondents: 1,
        cohortShare: 0.25,
      },
    ]);
  });

  it('falls back to the question text as the key and to a whole-survey row without blocks', () => {
    const noIds: Survey = {
      id: 's',
      responses: [
        { id: 'a', blocks: [{ type: 'scale', question: 'Rate it', duration: 1, answer: '5' }] },
      ],
    };
    const groups = summarizeDesignArtifacts(noIds, [
      artifact('a', [0], 'cohort_flat_matrix'),
      { ...artifact('a', [], 'cohort_pair_fires'), blocks: undefined },
    ]);
    expect(groups.map((g) => [g.blockKey, g.question])).toEqual([
      ['Rate it', 'Rate it'],
      ['', '(whole survey)'],
    ]);
  });

  it("describes known signals in the author's words and unknown ones generically", () => {
    const g: DesignArtifactGroup = {
      detector: 'prototype-effort',
      signal: 'cohort_give_up_task',
      blockKey: 'q2',
      question: 'Task: buy a thing',
      respondents: 16,
      cohortShare: 0.16,
    };
    expect(describeDesignArtifact(g)).toBe(
      "prototype task 'Task: buy a thing' — 16 respondents (16% of the cohort) gave up with no clicks; the prototype likely did not load",
    );
    expect(
      describeDesignArtifact({
        ...g,
        detector: 'new',
        signal: 'thing',
        respondents: 1,
        cohortShare: 0.01,
      }),
    ).toBe(
      "new.thing on 'Task: buy a thing' — 1 respondent (1% of the cohort) triggered the same signal; the question, not the respondents, is the likely cause",
    );
    const long = 'Q'.repeat(90);
    expect(describeDesignArtifact({ ...g, question: long })).toContain(`'${'Q'.repeat(69)}…'`);
  });
});
