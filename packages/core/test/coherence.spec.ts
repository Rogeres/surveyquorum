import { describe, expect, it } from 'vitest';
import type { Block, InventoryItem, Response, Survey } from '../src/contract/types.js';
import {
  answerFor,
  buildInventory,
  type CandidatePair,
  coherenceDetector,
  MAX_PAIRS,
  normalizePairs,
  renderAnswer,
  renderInventory,
} from '../src/detectors/coherence/coherence.js';
import type { DetectorContext, Evidence, LlmClient, LlmRequest } from '../src/detectors/types.js';

const INVENTORY: InventoryItem[] = [
  {
    scope: 'screening',
    type: 'choice',
    question: 'Your age group',
    options: ['18–24', '25–34', '35–44'],
  },
  { scope: 'body', type: 'scale', question: 'How old are you?' },
  {
    scope: 'body',
    type: 'choice',
    question: 'Which of these tools did you use last month?',
    options: ['Alpha', 'Beta', 'Gamma'],
  },
  {
    scope: 'body',
    type: 'choice',
    question: 'Which of these tools do you know?',
    options: ['Alpha', 'Beta', 'Gamma'],
  },
  { scope: 'body', type: 'open', question: 'Anything else?' },
];

interface Person {
  id: string;
  band: string;
  age: string;
  used: string[];
  known: string[];
}

function respondent(p: Person): Response {
  const blocks: Block[] = [
    { type: 'scale', question: 'How old are you?', answer: p.age, duration: 5 },
    {
      type: 'choice',
      question: 'Which of these tools did you use last month?',
      answer: p.used,
      options: ['Alpha', 'Beta', 'Gamma'],
      duration: 8,
    },
    {
      type: 'choice',
      question: 'Which of these tools do you know?',
      answer: p.known,
      options: ['Alpha', 'Beta', 'Gamma'],
      duration: 8,
    },
    {
      type: 'open',
      question: 'Anything else?',
      answer: [{ role: 'user', text: 'No.' }],
      duration: 4,
    },
  ];
  return { id: p.id, blocks, screening: [{ question: 'Your age group', answer: [p.band] }] };
}

function honestCohort(n: number): Response[] {
  return Array.from({ length: n }, (_, i) =>
    respondent({
      id: `r${i}`,
      band: '25–34',
      age: String(25 + (i % 9)),
      used: ['Alpha'],
      known: ['Alpha', 'Beta'],
    }),
  );
}

const PAIRS = {
  pairs: [
    { a: 1, b: 2, relation: 'must_match', rule: 'typed age must fall inside the screening band' },
    { a: 3, b: 4, relation: 'subset', rule: 'tools used must be among tools known' },
  ],
};

/** Stage 1 returns the two pairs; stage 2 judges items by reading the rendered answers. */
function fakeClient(opts: { stage1Pending?: boolean; pairs?: unknown } = {}) {
  const seen: LlmRequest[] = [];
  const client: LlmClient = {
    async complete(req) {
      seen.push(req);
      if (req.role === 'arbiter') {
        if (opts.stage1Pending) return { json: null, pending: true };
        return { json: opts.pairs ?? PAIRS };
      }
      const items = req.prompt.split('### Item ').slice(1);
      const results = items.map((chunk, idx) => {
        const a1 = /A1: (.*)/.exec(chunk)?.[1] ?? '';
        const a2 = /A2: (.*)/.exec(chunk)?.[1] ?? '';
        if (chunk.includes('Relation: must_match')) {
          const m = /(\d+)–(\d+)/.exec(a1);
          const age = Number(a2);
          const contradicts = m ? !(age >= Number(m[1]) && age <= Number(m[2])) : false;
          return {
            i: idx + 1,
            contradicts,
            confidence: contradicts ? 5 : 1,
            explanation: contradicts ? `age band "${a1}" vs typed age "${a2}"` : '',
          };
        }
        const used = a1.split(', ');
        const known = a2.split(', ');
        const extra = used.filter((u) => !known.includes(u));
        // "Gamma" is a deliberately shaky case: flagged with low confidence only.
        const confidence = extra.includes('Gamma') ? 3 : 4;
        return {
          i: idx + 1,
          contradicts: extra.length > 0,
          confidence,
          explanation: extra.length ? `used "${extra.join(', ')}" without knowing it` : '',
        };
      });
      return { json: { results } };
    },
  };
  return { client, seen };
}

function run(
  responses: Response[],
  client: LlmClient,
  inventory: InventoryItem[] | undefined = INVENTORY,
) {
  const s: Survey = { id: 's1', inventory, responses };
  const ctx: DetectorContext = { minCohort: 30, llm: client, log: () => {} };
  return coherenceDetector.detect(s, ctx);
}

const byId = (ev: Evidence[], id: string) => ev.filter((e) => e.responseId === id);

describe('coherence helpers', () => {
  it('uses the survey inventory when present and rebuilds it from answers otherwise', () => {
    const fromInventory = buildInventory({ id: 's', inventory: INVENTORY, responses: [] });
    expect(fromInventory.map((q) => q.scope)).toEqual([
      'screening',
      'body',
      'body',
      'body',
      'body',
    ]);
    const rebuilt = buildInventory({ id: 's', responses: honestCohort(3) });
    expect(rebuilt.map((q) => q.question)).toEqual(INVENTORY.map((q) => q.question));
    expect(rebuilt[2].options).toEqual(['Alpha', 'Beta', 'Gamma']);
    const text = renderInventory(fromInventory);
    expect(text).toContain(
      '1. [screening] (choice) Your age group — options: 18–24 | 25–34 | 35–44',
    );
    expect(text).toContain('5. [body] (open) Anything else?');
  });

  it('renders answers compactly and resolves a respondent answer per inventory question', () => {
    const r = respondent({
      id: 'x',
      band: '25–34',
      age: '30',
      used: ['Alpha'],
      known: ['Alpha', 'Beta'],
    });
    const inv = buildInventory({ id: 's', inventory: INVENTORY, responses: [] });
    expect(answerFor(r, inv[0])).toEqual({ text: '25–34' });
    expect(answerFor(r, inv[1])).toEqual({ text: '30', block: 0 });
    expect(answerFor(r, inv[3])).toEqual({ text: 'Alpha, Beta', block: 2 });
    expect(
      renderAnswer({ type: 'matrix', question: 'm', duration: 1, answer: { row: ['col'] } }),
    ).toBe('row: col');
    expect(
      renderAnswer({ type: 'choice', question: 'c', duration: 1, answer: [] }),
    ).toBeUndefined();
    expect(
      renderAnswer({
        type: 'prototype',
        question: 'p',
        duration: 1,
        status: 'completed',
        clickCount: 3,
      }),
    ).toBeUndefined();
  });

  it('normalises stage-1 pairs: 1-based, ordered, distinct, in range, capped', () => {
    const raw = {
      pairs: [
        { a: 2, b: 1, relation: 'must_match', rule: 'r' },
        { a: 1, b: 2, relation: 'must_match', rule: 'dup' },
        { a: 3, b: 3, relation: 'semantic', rule: 'self' },
        { a: 4, b: 9, relation: 'semantic', rule: 'out of range' },
        ...Array.from({ length: 20 }, (_, i) => ({
          a: 1,
          b: 3 + (i % 3),
          relation: 'semantic',
          rule: `x${i}`,
        })),
      ],
    };
    const pairs: CandidatePair[] = normalizePairs(raw, 5);
    expect(pairs[0]).toMatchObject({ a: 0, b: 1, rule: 'r' });
    expect(pairs.length).toBeLessThanOrEqual(MAX_PAIRS);
    expect(pairs.map((p) => `${p.a}-${p.b}`)).toEqual(['0-1', '0-2', '0-3', '0-4']);
  });
});

describe('coherence detector', () => {
  const honest = honestCohort(30);
  const liar = respondent({
    id: 'liar',
    band: '18–24',
    age: '41',
    used: ['Alpha'],
    known: ['Alpha', 'Beta'],
  });
  const slip = respondent({
    id: 'slip',
    band: '25–34',
    age: '30',
    used: ['Alpha', 'Beta'],
    known: ['Alpha'],
  });
  const shaky = respondent({
    id: 'shaky',
    band: '25–34',
    age: '30',
    used: ['Gamma'],
    known: ['Alpha'],
  });
  const both = respondent({
    id: 'both',
    band: '35–44',
    age: '22',
    used: ['Beta'],
    known: ['Alpha'],
  });

  it('one contradiction is weak, two (or one screening↔body) are strong, low confidence is ignored', async () => {
    const { client, seen } = fakeClient();
    const ev = await run([...honest, liar, slip, shaky, both], client);
    expect(seen.filter((r) => r.role === 'arbiter')).toHaveLength(1);
    expect(seen.filter((r) => r.role === 'classifier')).toHaveLength(34);
    expect(ev.filter((e) => e.responseId.startsWith('r'))).toEqual([]);
    // Screening band vs typed age counts double → strong on its own.
    expect(byId(ev, 'liar')).toMatchObject([
      {
        signal: 'contradiction',
        strength: 'strong',
        blocks: [0],
        stats: { nContradictions: 1, nScreeningVsBody: 1, weightedCount: 2 },
      },
    ]);
    expect(byId(ev, 'liar')[0].summary).toContain('declared screening profile');
    expect(byId(ev, 'slip')).toMatchObject([
      {
        signal: 'possible_contradiction',
        strength: 'weak',
        blocks: [1, 2],
        stats: { weightedCount: 1 },
      },
    ]);
    expect(byId(ev, 'shaky')).toEqual([]);
    expect(byId(ev, 'both')).toMatchObject([
      { signal: 'contradiction', stats: { nContradictions: 2, weightedCount: 3 } },
    ]);
  });

  it('suppresses a pair that fires for ≥20% of the cohort as a design artifact', async () => {
    const cohortCopy = honestCohort(30);
    for (let i = 0; i < 10; i++) {
      (cohortCopy[i].blocks[1] as { answer: string[] }).answer = ['Alpha', 'Beta'];
      (cohortCopy[i].blocks[2] as { answer: string[] }).answer = ['Alpha'];
    }
    const ev = await run([...cohortCopy, liar, slip], fakeClient().client);
    const artifacts = ev.filter((e) => e.signal === 'cohort_pair_fires');
    expect(artifacts).toHaveLength(11);
    expect(artifacts.every((e) => e.designArtifact)).toBe(true);
    expect(byId(ev, 'slip').map((e) => e.signal)).toEqual(['cohort_pair_fires']);
    // The age pair is unaffected: still strong for the liar.
    expect(byId(ev, 'liar').map((e) => e.signal)).toEqual(['contradiction']);
  });

  it('caches stage 1 per question list and stage 2 per rendered items', async () => {
    const { client, seen } = fakeClient();
    await run([...honest, liar], client);
    const stage1 = seen.filter((r) => r.role === 'arbiter')[0];
    expect(stage1.prompt).toContain('Your age group');
    expect(stage1.cacheKey).toHaveLength(64);
    const stage2 = seen.filter((r) => r.role === 'classifier');
    // Identical answers share a key: 9 distinct honest age values + the liar = 10 keys for 31 calls.
    expect(new Set(stage2.map((r) => r.cacheKey)).size).toBe(10);
    expect(stage2[0].prompt).toContain(
      'Relation: must_match. Hint: typed age must fall inside the screening band',
    );
    expect(stage2[0].prompt).toContain('Russian');
    const again = fakeClient();
    await run([...honest, liar], again.client);
    expect(again.seen.filter((r) => r.role === 'arbiter')[0].cacheKey).toBe(stage1.cacheKey);
  });

  it('emits nothing when stage 1 is pending, proposes no pairs, or the survey has one question', async () => {
    expect(await run([...honest, liar], fakeClient({ stage1Pending: true }).client)).toEqual([]);
    const none = fakeClient({ pairs: { pairs: [] } });
    expect(await run([...honest, liar], none.client)).toEqual([]);
    expect(none.seen).toHaveLength(1);
    const tiny = fakeClient();
    expect(await run([...honest, liar], tiny.client, [INVENTORY[0]])).toEqual([]);
    expect(tiny.seen).toHaveLength(0);
  });

  it('is registered as an LLM detector', () => {
    expect(coherenceDetector.needsLlm).toBe(true);
    expect(coherenceDetector.name).toBe('coherence');
  });
});
