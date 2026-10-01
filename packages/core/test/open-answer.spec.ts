import { describe, expect, it } from 'vitest';
import type { OpenTextBlock, Response } from '../src/contract/types.js';
import { openAnswerDetector } from '../src/detectors/open-answer/index.js';
import {
  answerText,
  buildPrompt,
  cacheKeyFor,
  isNumericOnly,
  type OpenAnswerJudgement,
  RESPONSE_SCHEMA,
} from '../src/detectors/open-answer/open-answer.js';
import type { DetectorContext, Evidence, LlmClient, LlmRequest } from '../src/detectors/types.js';
import { validateJson } from '../src/llm/json-schema.js';
import { cohort, survey } from './helpers/synthetic.js';

const QUESTIONS = [
  'Tell us more about topic 0',
  'Tell us more about topic 1',
  'Tell us more about topic 2',
];

function open(i: number, text: string): OpenTextBlock {
  return {
    type: 'open',
    blockId: `o${i}`,
    question: QUESTIONS[i],
    answer: [{ role: 'user', text }],
    duration: 30,
  };
}

function planted(id: string, texts: string[]): Response {
  return { id, blocks: texts.map((t, i) => open(i, t)) };
}

/** Canned labels by answer text; everything else is valid_medium. */
const CANNED: Record<string, Partial<OpenAnswerJudgement>> = {
  'asdfgh qwerty': { label: 'gibberish' },
  '.': { label: 'fake' },
  zzzz: { label: 'gibberish' },
  'The weather is nice today.': { label: 'off_topic' },
  'Bloody hell, the checkout keeps timing out after I enter the card number.': {
    label: 'valid_medium',
    profanity: true,
  },
  'A string of swear words and nothing else.': { label: 'bad_language', profanity: true },
  'Detailed answer one with facts and a number: 3 attempts, 2 failed.': { label: 'valid_high' },
  'Detailed answer two with an example from last Tuesday.': { label: 'valid_high' },
  nothing: { label: 'no_answer' },
};

function fakeClient(opts: { pending?: boolean } = {}) {
  const seen: LlmRequest[] = [];
  const client: LlmClient = {
    async complete(req) {
      seen.push(req);
      if (opts.pending) return { json: null, pending: true };
      const answer = /## Respondent's answer\n\n([\s\S]*)$/.exec(req.prompt)?.[1].trim() ?? '';
      const canned = CANNED[answer] ?? {};
      const json: OpenAnswerJudgement = {
        label: 'valid_medium',
        confidence: 4,
        profanity: false,
        reason: 'canned',
        ...canned,
      };
      return { json };
    },
  };
  return { client, seen };
}

function run(responses: Response[], client: LlmClient) {
  const ctx: DetectorContext = { minCohort: 30, llm: client, log: () => {} };
  return openAnswerDetector.detect(survey(responses), ctx);
}

const byId = (ev: Evidence[], id: string) => ev.filter((e) => e.responseId === id);

describe('open-answer helpers', () => {
  it('recognises numeric-only answers', () => {
    for (const t of ['42', ' 1 500 ', '12.5', '3, 4', '-7', '100%', '№ 12']) {
      expect(isNumericOnly(t), t).toBe(true);
    }
    for (const t of ['42 years', 'none', '', 'a1', '...']) expect(isNumericOnly(t), t).toBe(false);
  });

  it('joins user turns and ignores assistant turns', () => {
    const b: OpenTextBlock = {
      type: 'open',
      question: 'q',
      duration: 1,
      answer: [
        { role: 'user', text: 'first ' },
        { role: 'assistant', text: 'why?' },
        { role: 'user', text: 'because' },
      ],
    };
    expect(answerText(b)).toBe('first because');
  });

  it('builds the prompt from the template with language and profanity rules', () => {
    const p = buildPrompt('Why?', 'Because.');
    expect(p).toContain('## Question\n\nWhy?');
    expect(p).toContain("## Respondent's answer\n\nBecause.");
    expect(p).toContain('Russian');
    expect(p).toContain('"profanity": true | false');
    expect(p).not.toContain('{question}');
    expect(cacheKeyFor('Why?', 'Because.')).toBe(cacheKeyFor('Why?', 'Because.'));
    expect(cacheKeyFor('Why?', 'Because.')).not.toBe(cacheKeyFor('Why?', 'Because'));
    expect(
      validateJson(
        { label: 'fake', confidence: 5, profanity: false, reason: 'x' },
        RESPONSE_SCHEMA,
      ),
    ).toEqual([]);
  });
});

describe('open-answer detector', () => {
  const honest = cohort(40, 11, { open: 3 });
  const gibberish = planted('gibberish', ['asdfgh qwerty', 'Fine, I guess.', 'nothing']);
  const faker = planted('faker', ['.', 'Good enough.', '.']);
  const offTopic = planted('off-topic', ['The weather is nice today.', 'Good.', 'Fine.']);
  const sweary = planted('sweary', [
    'Bloody hell, the checkout keeps timing out after I enter the card number.',
    'Good.',
    'Fine.',
  ]);
  const abusive = planted('abusive', [
    'A string of swear words and nothing else.',
    'Good.',
    'Fine.',
  ]);
  const rich = planted('rich', [
    'Detailed answer one with facts and a number: 3 attempts, 2 failed.',
    'Detailed answer two with an example from last Tuesday.',
    'Fine.',
  ]);
  const richButFake = planted('rich-but-fake', [
    'Detailed answer one with facts and a number: 3 attempts, 2 failed.',
    'Detailed answer two with an example from last Tuesday.',
    '.',
  ]);

  it('maps labels to evidence: strong hard labels, weak off_topic, positive rich, nothing for profanity with content', async () => {
    const { client, seen } = fakeClient();
    const ev = await run(
      [...honest, gibberish, faker, offTopic, sweary, abusive, rich, richButFake],
      client,
    );

    expect(byId(ev, 'gibberish')).toMatchObject([
      { signal: 'gibberish', strength: 'strong', blocks: [0] },
    ]);
    expect(byId(ev, 'gibberish')[0].designArtifact).toBeUndefined();
    // Two fake blocks collapse into one evidence listing both blocks.
    expect(byId(ev, 'faker')).toMatchObject([
      { signal: 'fake', strength: 'strong', blocks: [0, 2] },
    ]);
    expect(byId(ev, 'faker')[0].summary).toContain('and 1 more');
    expect(byId(ev, 'off-topic')).toMatchObject([{ signal: 'off_topic', strength: 'weak' }]);
    expect(byId(ev, 'sweary')).toEqual([]);
    expect(byId(ev, 'abusive')).toMatchObject([{ signal: 'bad_language', strength: 'strong' }]);
    expect(byId(ev, 'rich')).toMatchObject([
      {
        signal: 'rich_open_answers',
        strength: 'positive',
        blocks: [0, 1],
        stats: { nValidHigh: 2 },
      },
    ]);
    // Positive evidence is withheld when a hard label fired for the same respondent.
    expect(byId(ev, 'rich-but-fake').map((e) => e.signal)).toEqual(['fake']);
    // Honest cohort: all valid_medium → nothing.
    expect(ev.filter((e) => /^r\d+$/.test(e.responseId)).length).toBe(0);
    expect(seen.every((r) => r.role === 'classifier')).toBe(true);
    expect(seen).toHaveLength(47 * 3);
  });

  it('skips numeric-only answers, never sends them to the LLM, and reports the question once', async () => {
    const cohortCopy = cohort(40, 12, { open: 3 });
    for (let i = 0; i < 20; i++) {
      (cohortCopy[i].blocks[2] as OpenTextBlock).answer = [{ role: 'user', text: `${20 + i}` }];
    }
    const { client, seen } = fakeClient();
    const ev = await run(cohortCopy, client);
    expect(seen.some((r) => /answer\n\n\d+$/.test(r.prompt))).toBe(false);
    expect(seen).toHaveLength(40 * 3 - 20);
    const numeric = ev.filter((e) => e.signal === 'numeric_open_question');
    expect(numeric).toHaveLength(1);
    expect(numeric[0]).toMatchObject({
      designArtifact: true,
      blocks: [2],
      stats: { nNumeric: 20, nAnswered: 40, share: 0.5 },
    });
  });

  it('marks a hard label shared by ≥5% of the cohort on one question as a design artifact', async () => {
    const cohortCopy = cohort(40, 13, { open: 3 });
    // 5/41 respondents (12%) type gibberish on question 0 — the question is at fault.
    for (let i = 0; i < 5; i++) {
      (cohortCopy[i].blocks[0] as OpenTextBlock).answer = [{ role: 'user', text: 'zzzz' }];
    }
    const lone = planted('lone', ['Fine.', 'asdfgh qwerty', 'Fine.']);
    const { client } = fakeClient();
    const ev = await run([...cohortCopy, lone], client);
    const artifacts = ev.filter((e) => e.signal === 'gibberish' && e.designArtifact);
    expect(artifacts).toHaveLength(5);
    expect(artifacts[0].summary).toContain('% of the cohort');
    expect(artifacts[0].stats?.cohortShare).toBeCloseTo(5 / 41, 3);
    // Gibberish on a different question stays a real signal.
    expect(byId(ev, 'lone')).toMatchObject([
      { signal: 'gibberish', strength: 'strong', blocks: [1] },
    ]);
    expect(byId(ev, 'lone')[0].designArtifact).toBeUndefined();
  });

  it('below three offenders the guard does not fire even above 5%', async () => {
    const small = cohort(30, 14, { open: 3 });
    for (let i = 0; i < 2; i++) {
      (small[i].blocks[0] as OpenTextBlock).answer = [{ role: 'user', text: 'zzzz' }];
    }
    const ev = await run(small, fakeClient().client);
    expect(ev.filter((e) => e.signal === 'gibberish' && !e.designArtifact)).toHaveLength(2);
  });

  it('emits nothing for pending judgements and nothing without a client', async () => {
    const pending = fakeClient({ pending: true });
    const ev = await run([...honest, gibberish], pending.client);
    expect(ev).toEqual([]);
    expect(pending.seen.length).toBeGreaterThan(0);
    const ctx: DetectorContext = { minCohort: 30, log: () => {} };
    expect(await openAnswerDetector.detect(survey([gibberish]), ctx)).toEqual([]);
  });

  it('is registered as an LLM detector', () => {
    expect(openAnswerDetector.needsLlm).toBe(true);
    expect(openAnswerDetector.name).toBe('open-answer');
  });
});
