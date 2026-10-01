import { describe, expect, it } from 'vitest';
import {
  applyArbiter,
  arbiterSystemPrompt,
  arbitrateDetailed,
  buildCasePrompt,
  JUDGE_SCHEMA,
  resolveStrict,
  shouldSwap,
  TIEBREAK_SCHEMA,
} from '../src/arbiter/index.js';
import type { ArbiterDecision, JudgeOpinion } from '../src/arbiter/types.js';
import type { Survey } from '../src/contract/types.js';
import type { Evidence, LlmClient, LlmRequest, LlmResponse } from '../src/detectors/types.js';
import type { Verdict } from '../src/quorum/score.js';

/** Invented survey: one suspicious respondent, one honest one. */
const survey: Survey = {
  id: 'demo-survey',
  target: 'Adults who bought a kettle this year',
  responses: [
    {
      id: 'r1',
      device: 'mobile',
      screening: [{ question: 'Age', answer: ['25-34'] }],
      blocks: [
        { type: 'choice', question: 'Which colour?', answer: ['Red'], duration: 1 },
        {
          type: 'open',
          question: 'Why did you pick that colour?',
          answer: [{ role: 'user', text: 'qwer' }],
          duration: 2,
        },
        {
          type: 'matrix',
          question: 'Rate the kettle',
          answer: { Price: ['3'], Look: ['3'] },
          duration: 2,
        },
      ],
    },
    {
      id: 'r2',
      blocks: [
        { type: 'choice', question: 'Which colour?', answer: ['Blue'], duration: 9 },
        {
          type: 'open',
          question: 'Why did you pick that colour?',
          answer: [{ role: 'user', text: 'It matches the tiles in my kitchen.' }],
          duration: 40,
        },
      ],
    },
  ],
};

const evidence: Evidence[] = [
  {
    responseId: 'r1',
    detector: 'open-answer',
    signal: 'gibberish',
    strength: 'strong',
    summary:
      'Answer "qwer" to "Why did you pick that colour?" classified as gibberish: keyboard run.',
    blocks: [1],
    stats: { label: 'gibberish', nBlocks: 1, confidence: 5 },
  },
  {
    responseId: 'r1',
    detector: 'pace',
    signal: 'consistent',
    strength: 'strong',
    summary:
      'Faster than the cohort by 2σ or more on 3 of 3 questions; total 5 s vs cohort median 90 s.',
    stats: { totalSec: 5, cohortMedianSec: 90 },
  },
];

const verdicts: Verdict[] = [
  { responseId: 'r1', outcome: 'block', score: 4, evidence, designArtifacts: [] },
  { responseId: 'r2', outcome: 'keep', score: 0, evidence: [], designArtifacts: [] },
];

/** Same survey, but the engine only sent r1 to review. */
const reviewVerdicts: Verdict[] = [{ ...verdicts[0], outcome: 'review', score: 1.5 }, verdicts[1]];

const judge = (decision: string, confidence = 4, panel = 'Panel text.', category = 'none') => ({
  decision,
  confidence,
  reason: `${decision} because`,
  panel_text: panel,
  per_signal: { 'open-answer.gibberish': 'supports', 'pace.consistent': 'does_not_support' },
  overturn_category: category,
});

/** Canned judges in call order; tie-break answers are recognised by their schema. */
function fakeLlm(
  judges: unknown[],
  tiebreak?: unknown,
  pendingTiebreak = false,
): LlmClient & {
  requests: LlmRequest[];
} {
  const queue = [...judges];
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req): Promise<LlmResponse> {
      requests.push(req);
      if (req.schema === TIEBREAK_SCHEMA) {
        if (pendingTiebreak) return { json: null, pending: true };
        return { json: tiebreak };
      }
      const next = queue.shift();
      if (next === 'pending') return { json: null, pending: true };
      return { json: next };
    },
  };
}

const lenient = { strictness: 'lenient' as const };
const balanced = { strictness: 'balanced' as const };

describe('schema and prompts', () => {
  it('requires overturn_category with the four causes plus none', () => {
    expect(JUDGE_SCHEMA.required).toContain('overturn_category');
    const props = JUDGE_SCHEMA.properties as Record<string, { enum?: string[] }>;
    expect(props.overturn_category.enum).toEqual([
      'technical_failure',
      'design_artifact',
      'substantive_content',
      'short_branch',
      'none',
    ]);
  });

  it('strict mode appends the burden-of-proof section; the other modes share the rubric', () => {
    const shared = arbiterSystemPrompt('lenient');
    expect(shared).toBe(arbiterSystemPrompt('balanced'));
    expect(shared).toContain('`overturn_category`');
    expect(shared).not.toContain('Burden of proof');
    const strict = arbiterSystemPrompt('strict');
    expect(strict.startsWith(shared.trimEnd())).toBe(true);
    expect(strict).toContain('# Burden of proof (strict mode)');
    expect(strict).toContain('A possibility is not a fact');
    expect(arbiterSystemPrompt()).toBe(strict); // strict is the default
  });

  it('renders the full answer set, cohort medians and the evidence into the case', () => {
    const prompt = buildCasePrompt({
      survey,
      response: survey.responses[0],
      verdict: verdicts[0],
      evidence,
      lang: 'ru',
      cohortMedians: { 'q:which colour?': 9 },
    });
    expect(prompt).toContain('DECLARED AT SCREENING');
    expect(prompt).toContain('[1] (choice, 1 s, others about 9 s) Which colour?');
    expect(prompt).toContain('-> answer: "qwer"');
    expect(prompt).toContain('* Price -> 3');
    expect(prompt).toContain('1. [open-answer.gibberish, strong]');
    expect(prompt).toContain('numbers: {"totalSec":5');
    expect(prompt).toContain('Outcome: block (score 4)');
    expect(prompt).toContain('`panel_text` in Russian');
  });
});

describe('arbitrate (strict, the default)', () => {
  it('two confirming judges confirm; keep verdicts are not sent; no tie-break exists', async () => {
    const llm = fakeLlm([judge('confirm', 5), judge('confirm', 3)]);
    const res = await arbitrateDetailed(survey, verdicts, evidence, llm);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0].system).toContain('Burden of proof');
    expect(llm.requests[0].cacheKey).not.toBe(llm.requests[1].cacheKey);
    const [d] = res.decisions;
    expect(d).toMatchObject({
      responseId: 'r1',
      decision: 'confirm',
      confidence: 3,
      strictness: 'strict',
      overturnCategory: 'none',
    });
    expect(d.unsure).toBeUndefined();
    expect(d.judges[0].perSignal['pace.consistent']).toBe('does_not_support');
    expect(applyArbiter(verdicts, [d])[0].outcome).toBe('block');
  });

  it('two confirming judges on a review verdict complete the quorum: review → block', async () => {
    const llm = fakeLlm([judge('confirm', 4), judge('confirm', 5)]);
    const [d] = (await arbitrateDetailed(survey, reviewVerdicts, evidence, llm)).decisions;
    expect(d.decision).toBe('confirm');
    const [v] = applyArbiter(reviewVerdicts, [d]);
    expect(v.outcome).toBe('block');
    expect(v.arbiter).toMatchObject({
      decision: 'confirm',
      originalOutcome: 'review',
      strictness: 'strict',
    });
  });

  it('a unanimous, confident overturn with one shared cause releases the respondent', async () => {
    const llm = fakeLlm([
      judge('overturn', 5, 'A.', 'technical_failure'),
      judge('overturn', 4, 'B.', 'technical_failure'),
    ]);
    const [d] = (await arbitrateDetailed(survey, verdicts, evidence, llm)).decisions;
    expect(d.decision).toBe('overturn');
    expect(d.overturnCategory).toBe('technical_failure');
    expect(d.confidence).toBe(4);
    expect(d.judges.map((j) => j.overturnCategory)).toEqual([
      'technical_failure',
      'technical_failure',
    ]);
    const [v] = applyArbiter(verdicts, [d]);
    expect(v.outcome).toBe('keep');
    expect(v.arbiter).toMatchObject({
      strictness: 'strict',
      overturnCategory: 'technical_failure',
    });
  });

  it('unanimous overturn with differing causes goes to a human, not to keep', async () => {
    const llm = fakeLlm([
      judge('overturn', 5, 'A.', 'technical_failure'),
      judge('overturn', 5, 'B.', 'design_artifact'),
    ]);
    const [d] = (await arbitrateDetailed(survey, verdicts, evidence, llm)).decisions;
    expect(llm.requests).toHaveLength(2);
    expect(d.decision).toBe('needs_human');
    expect(d.unsure).toBe(true);
    expect(d.reason).toMatch(
      /^arbiter unsure: overturn causes differ \(technical_failure vs design_artifact\)/,
    );
    expect(d.overturnCategory).toBe('none');
    const [v] = applyArbiter(verdicts, [d]);
    expect(v.outcome).toBe('review');
    expect(v.arbiter?.decision).toBe('needs_human');
  });

  it('unanimous overturn below confidence 4, or without a cause, goes to a human', async () => {
    const weak = fakeLlm([
      judge('overturn', 5, 'A.', 'short_branch'),
      judge('overturn', 3, 'B.', 'short_branch'),
    ]);
    const [d1] = (await arbitrateDetailed(survey, verdicts, evidence, weak)).decisions;
    expect(d1.decision).toBe('needs_human');
    expect(d1.reason).toContain('arbiter unsure: overturn at confidence 5/3, strict mode needs 4');
    const uncategorised = fakeLlm([judge('overturn', 5), judge('overturn', 5)]);
    const [d2] = (await arbitrateDetailed(survey, verdicts, evidence, uncategorised)).decisions;
    expect(d2.decision).toBe('needs_human');
    expect(d2.reason).toContain('arbiter unsure: overturn without a named cause');
  });

  it('a split makes no tie-break call: block → review, review stays review, both needs_human', async () => {
    const llm = fakeLlm([
      judge('confirm', 5, 'Conf.'),
      judge('overturn', 5, 'Over.', 'short_branch'),
    ]);
    const [d] = (await arbitrateDetailed(survey, verdicts, evidence, llm)).decisions;
    expect(llm.requests).toHaveLength(2); // no third request
    expect(llm.requests.some((r) => r.schema === TIEBREAK_SCHEMA)).toBe(false);
    expect(d.decision).toBe('needs_human');
    expect(d.tiebreak).toBeUndefined();
    expect(d.unsure).toBe(true);
    expect(d.reason).toContain('arbiter unsure: judges split (confirm vs overturn)');
    expect(d.reason).toContain('judge 1: confirm because');
    expect(d.panelText).toBe('Conf.'); // the confirming judge's text survives for a complaint
    const [blocked] = applyArbiter(verdicts, [d]);
    expect(blocked.outcome).toBe('review');
    expect(blocked.arbiter).toMatchObject({ decision: 'needs_human', originalOutcome: 'block' });

    const llm2 = fakeLlm([judge('needs_human', 4), judge('confirm', 4)]);
    const [d2] = (await arbitrateDetailed(survey, reviewVerdicts, evidence, llm2)).decisions;
    expect(d2.decision).toBe('needs_human');
    expect(applyArbiter(reviewVerdicts, [d2])[0].outcome).toBe('review');
  });

  it('resolveStrict: both judges asking for a human is needs_human and counted as hesitation', () => {
    const op = (decision: JudgeOpinion['decision'], judge: 1 | 2): JudgeOpinion => ({
      judge,
      decision,
      confidence: 4,
      reason: `r${judge}`,
      panelText: `p${judge}`,
      perSignal: {},
      overturnCategory: 'none',
    });
    const d = resolveStrict('r1', [op('needs_human', 1), op('needs_human', 2)]);
    expect(d.decision).toBe('needs_human');
    expect(d.unsure).toBe(true);
    expect(d.reason).toContain('both judges asked for a human');
  });

  it('strict and shared-rubric answers do not share cache entries', async () => {
    const strict = fakeLlm([judge('confirm'), judge('confirm')]);
    await arbitrateDetailed(survey, verdicts, evidence, strict);
    const soft = fakeLlm([judge('confirm'), judge('confirm')]);
    await arbitrateDetailed(survey, verdicts, evidence, soft, lenient);
    expect(strict.requests[0].cacheKey).not.toBe(soft.requests[0].cacheKey);
    expect(soft.requests[0].system).not.toContain('Burden of proof');
    const bal = fakeLlm([judge('confirm'), judge('confirm')]);
    await arbitrateDetailed(survey, verdicts, evidence, bal, balanced);
    expect(bal.requests[0].cacheKey).toBe(soft.requests[0].cacheKey); // balanced/lenient share
  });
});

describe('arbitrate (balanced and lenient)', () => {
  it('two agreeing judges settle the case without a tie-break', async () => {
    const llm = fakeLlm([judge('confirm', 5), judge('confirm', 3)]);
    const res = await arbitrateDetailed(survey, verdicts, evidence, llm, lenient);
    expect(llm.requests).toHaveLength(2);
    expect(llm.requests[0].role).toBe('arbiter');
    expect(llm.requests[0].schema).toBe(JUDGE_SCHEMA);
    expect(llm.requests[0].prompt).toBe(llm.requests[1].prompt);
    const d = res.decisions[0];
    expect(d.decision).toBe('confirm');
    expect(d.confidence).toBe(3); // the less confident judge bounds the pair
    expect(d.strictness).toBe('lenient');
    expect(d.tiebreak).toBeUndefined();
    expect(d.judges.map((j) => j.judge)).toEqual([1, 2]);
    expect(res.pending).toEqual([]);
  });

  it('balanced and lenient: a confirmed review verdict becomes a block too', async () => {
    for (const opts of [balanced, lenient]) {
      const llm = fakeLlm([judge('confirm', 4), judge('confirm', 4)]);
      const [d] = (await arbitrateDetailed(survey, reviewVerdicts, evidence, llm, opts)).decisions;
      const [v] = applyArbiter(reviewVerdicts, [d]);
      expect(v.outcome).toBe('block');
      expect(v.arbiter).toMatchObject({
        decision: 'confirm',
        originalOutcome: 'review',
        strictness: opts.strictness,
      });
    }
    // A tie-break won by the confirming judge blocks a review verdict as well.
    const a = judge('confirm', 4, 'Confirm text.');
    const b = judge('overturn', 4, 'Overturn text.', 'design_artifact');
    const confirmWins = shouldSwap('r1') ? 2 : 1; // a is "Review 2" when swapped
    const llm = fakeLlm([a, b], { winner: confirmWins, confidence: 4, reason: 'the texts' });
    const [d] = (await arbitrateDetailed(survey, reviewVerdicts, evidence, llm, lenient)).decisions;
    expect(d.decision).toBe('confirm');
    expect(d.tiebreak).toBe(true);
    expect(applyArbiter(reviewVerdicts, [d])[0].outcome).toBe('block');
  });

  it('disagreeing judges go to a blind tie-break whose winner decides', async () => {
    const a = judge('confirm', 4, 'Confirm text.');
    const b = judge('overturn', 4, 'Overturn text.', 'design_artifact');
    // Review 1 / Review 2 order is fixed per response id; find which opinion is "2".
    const swapped = shouldSwap('r1');
    const llm = fakeLlm([a, b], { winner: 2, confidence: 3, reason: 'review 2 checked the time' });
    const [d] = (await arbitrateDetailed(survey, verdicts, evidence, llm, balanced)).decisions;
    expect(llm.requests).toHaveLength(3);
    expect(llm.requests[2].schema).toBe(TIEBREAK_SCHEMA);
    expect(llm.requests[2].prompt).toContain('# Review 1 — conclusion:');
    const expected = swapped ? a : b;
    expect(d.decision).toBe(expected.decision);
    expect(d.panelText).toBe(expected.panel_text);
    expect(d.overturnCategory).toBe(expected.decision === 'overturn' ? 'design_artifact' : 'none');
    expect(d.tiebreak).toBe(true);
    expect(d.confidence).toBe(3);
    expect(d.reason).toContain('tie-break: review 2 checked the time');
  });

  it('balanced: an overturn below confidence 3 goes to a human; at 3 it stands; lenient takes any', async () => {
    const weak = [
      judge('overturn', 2, 'A.', 'short_branch'),
      judge('overturn', 2, 'B.', 'short_branch'),
    ];
    const [b2] = (await arbitrateDetailed(survey, verdicts, evidence, fakeLlm(weak), balanced))
      .decisions;
    expect(b2.decision).toBe('needs_human');
    expect(b2.unsure).toBe(true);
    expect(b2.reason).toContain('arbiter unsure: overturn at confidence 2, balanced mode needs 3');
    expect(applyArbiter(verdicts, [b2])[0].outcome).toBe('review');

    const ok = [judge('overturn', 3, 'A.', 'short_branch'), judge('overturn', 5, 'B.', 'none')];
    const [b3] = (await arbitrateDetailed(survey, verdicts, evidence, fakeLlm(ok), balanced))
      .decisions;
    expect(b3.decision).toBe('overturn'); // balanced does not require a shared cause
    expect(b3.overturnCategory).toBe('none'); // the lead (more confident) judge named none
    expect(applyArbiter(verdicts, [b3])[0].outcome).toBe('keep');

    const [l] = (await arbitrateDetailed(survey, verdicts, evidence, fakeLlm(weak), lenient))
      .decisions;
    expect(l.decision).toBe('overturn');
    expect(l.unsure).toBeUndefined();
    expect(applyArbiter(verdicts, [l])[0]).toMatchObject({
      outcome: 'keep',
      arbiter: { strictness: 'lenient', overturnCategory: 'short_branch' },
    });
  });

  it('a "human" tie-break yields needs_human and keeps the confirming judge\'s panel text', async () => {
    const llm = fakeLlm([judge('overturn', 4, 'Over.'), judge('confirm', 4, 'Conf.')], {
      winner: 'human',
      confidence: 2,
      reason: 'the question needs the image',
    });
    const [d] = (await arbitrateDetailed(survey, verdicts, evidence, llm, lenient)).decisions;
    expect(d.decision).toBe('needs_human');
    expect(d.unsure).toBe(true);
    expect(d.tiebreak).toBe(true);
    expect(d.panelText).toBe('Conf.');
  });

  it('a pending judge leaves the respondent out of the decisions and counts it', async () => {
    const llm = fakeLlm([judge('confirm'), 'pending']);
    const res = await arbitrateDetailed(survey, verdicts, evidence, llm, lenient);
    expect(res.decisions).toEqual([]);
    expect(res.pending).toEqual(['r1']);
    const tb = fakeLlm([judge('confirm'), judge('overturn')], undefined, true);
    expect((await arbitrateDetailed(survey, verdicts, evidence, tb, lenient)).pending).toEqual([
      'r1',
    ]);
  });

  it('a failing call is reported, not thrown', async () => {
    const llm: LlmClient = {
      async complete() {
        throw new Error('boom');
      },
    };
    const log: string[] = [];
    const res = await arbitrateDetailed(survey, verdicts, evidence, llm, {
      log: (m) => log.push(m),
    });
    expect(res.failed).toEqual(['r1']);
    expect(log[0]).toContain('boom');
  });
});

describe('applyArbiter', () => {
  const base = (d: 'confirm' | 'overturn' | 'needs_human'): ArbiterDecision => ({
    responseId: 'r1',
    decision: d,
    confidence: 4,
    reason: 'r',
    panelText: 'p',
    judges: [],
    strictness: 'balanced',
    overturnCategory: d === 'overturn' ? 'design_artifact' : 'none',
  });

  it('maps overturn → keep, confirm → block, needs_human → review and stores the record', () => {
    const [over] = applyArbiter(verdicts, [base('overturn')]);
    expect(over.outcome).toBe('keep');
    expect(over.arbiter).toMatchObject({
      decision: 'overturn',
      originalOutcome: 'block',
      tiebreak: false,
      strictness: 'balanced',
      overturnCategory: 'design_artifact',
    });
    expect(over.panelText).toBe('p');
    const [conf] = applyArbiter(verdicts, [base('confirm')]);
    expect(conf.outcome).toBe('block');
    expect(conf.arbiter?.overturnCategory).toBe('none');
    const [human] = applyArbiter(verdicts, [base('needs_human')]);
    expect(human.outcome).toBe('review');
  });

  it('a confirmed review verdict becomes a block in every mode; the original outcome is kept', () => {
    for (const strictness of ['strict', 'balanced', 'lenient'] as const) {
      const [v] = applyArbiter(reviewVerdicts, [{ ...base('confirm'), strictness }]);
      expect(v.outcome).toBe('block');
      expect(v.arbiter).toMatchObject({
        decision: 'confirm',
        originalOutcome: 'review',
        strictness,
        overturnCategory: 'none',
      });
      expect(v.panelText).toBe('p');
    }
    // The other two decisions on a review verdict: released, or handed to a person.
    expect(applyArbiter(reviewVerdicts, [base('overturn')])[0].outcome).toBe('keep');
    const [human] = applyArbiter(reviewVerdicts, [base('needs_human')]);
    expect(human.outcome).toBe('review');
    expect(human.arbiter?.originalOutcome).toBe('review');
  });

  it('leaves verdicts without a decision untouched and does not mutate the input', () => {
    const out = applyArbiter(verdicts, []);
    expect(out[0]).toBe(verdicts[0]);
    applyArbiter(verdicts, [base('overturn')]);
    expect(verdicts[0].outcome).toBe('block');
  });
});
