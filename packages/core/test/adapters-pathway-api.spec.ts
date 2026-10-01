import { describe, expect, it } from 'vitest';
import {
  blockDurationSec,
  classifyDevice,
  convertPathwayApi,
  type FetchLike,
  fetchPathwayResponses,
  fetchPathwayTest,
  figmaClickCount,
  importPathway,
  PathwayApiError,
  panelFromUrlParams,
  stripHtml,
} from '../src/adapters/pathway-api.js';
import type {
  CardsortBlock,
  ChoiceBlock,
  FirstClickBlock,
  MatrixBlock,
  OpenTextBlock,
  OtherBlock,
  PrototypeBlock,
  ScaleBlock,
  WebsiteBlock,
} from '../src/contract/types.js';

import { at, fakeApi, PAGE1, PAGE2, TEST, TEST_ID } from './helpers/pathway-api-fixture.js';

describe('helpers', () => {
  it('strips HTML and decodes entities', () => {
    expect(stripHtml('<p>Which <b>plants</b> do you grow?</p>')).toBe('Which plants do you grow?');
    expect(stripHtml('a &amp; b &lt;c&gt; &#39;d&#39; &#x41;')).toBe("a & b <c> 'd' A");
    expect(stripHtml(null)).toBe('');
  });

  it('classifies devices from the user agent', () => {
    expect(classifyDevice(PAGE1[0].userAgent)).toBe('mobile');
    expect(classifyDevice(PAGE1[1].userAgent)).toBe('desktop');
    expect(classifyDevice(PAGE2[0].userAgent)).toBe('tablet');
    expect(classifyDevice(PAGE2[1].userAgent)).toBe('mobile');
    expect(
      classifyDevice('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537 Safari/537'),
    ).toBe('tablet');
    expect(classifyDevice(null)).toBeUndefined();
  });

  it('reads token, age and sex from URL parameters by substring', () => {
    expect(
      panelFromUrlParams({ token: 't', onin_age: '18-24', panel_gender: 'f', utm: 'x' }),
    ).toEqual({
      token: 't',
      age: '18-24',
      sex: 'f',
    });
    expect(panelFromUrlParams({ utm: 'x' })).toBeUndefined();
    expect(panelFromUrlParams(null)).toBeUndefined();
  });

  it('derives durations: ms, then timestamps, then 0', () => {
    expect(blockDurationSec({ id: 'x', type: 'scale', data: {}, duration: 4000 })).toBe(4);
    expect(
      blockDurationSec({
        id: 'x',
        type: 'scale',
        data: {},
        duration: null,
        startedAt: at(0),
        completedAt: at(0, 8),
      }),
    ).toBe(8);
    expect(
      blockDurationSec({
        id: 'x',
        type: 'scale',
        data: {},
        duration: 0,
        startedAt: at(0),
        completedAt: null,
      }),
    ).toBe(0);
  });

  it('counts prototype clicks from numbers and arrays', () => {
    expect(
      figmaClickCount({ a: { clicks: 2 }, b: { clicks: [1, 2, 3] }, c: { hovered: true } }),
    ).toBe(5);
    expect(figmaClickCount(null)).toBe(0);
    expect(figmaClickCount({})).toBe(0);
  });
});

describe('convertPathwayApi', () => {
  const { dataset, report } = convertPathwayApi(TEST, [...PAGE1, ...PAGE2]);
  const survey = dataset[0];
  const a1 = survey.responses.find((r) => r.id === 'a1')!;
  const block = <T>(id: string) => a1.blocks.find((b) => b.blockId === id) as T;

  it('keeps completed and null-status responses, reports the others by status', () => {
    expect(survey.id).toBe(TEST_ID);
    expect(survey.responses.map((r) => r.id)).toEqual(['a1', 'a2', 'a4']);
    expect(report.rowsRead).toBe(4);
    expect(report.rowsConverted).toBe(3);
    expect(report.rowsSkipped).toBe(1);
    expect(report.skipped).toEqual([
      {
        reason: 'status "screened_out" is not completed',
        count: 1,
        examples: [{ line: 3, detail: 'answer a3' }],
      },
    ]);
  });

  it('builds the inventory from the test definition in order, skipping non-questions', () => {
    const inv = survey.inventory!;
    expect(inv.map((i) => i.type)).toEqual([
      'choice',
      'open',
      'open',
      'open',
      'matrix',
      'scale',
      'scale',
      'other',
      'firstclick',
      'prototype',
      'website',
      'cardsort',
      'other',
      'other',
      'other',
      'other',
      'other',
    ]);
    expect(inv.every((i) => i.scope === 'body')).toBe(true);
    expect(inv[0]).toEqual({
      scope: 'body',
      type: 'choice',
      question: 'Which plants do you grow?',
      options: ['Tomatoes', 'Basil', 'Roses', 'Other', 'I grow nothing'],
    });
    expect(inv[2].question).toBe('Tell us about your last harvest & what went wrong');
    expect(inv[4].options).toEqual(['Poor', 'Fine', 'Great']);
    expect(inv[7].options).toEqual(['Watering reminders', 'Plant diary']);
  });

  it('maps every block type and converts durations to seconds', () => {
    expect(a1.blocks.map((b) => b.type)).toEqual([
      'choice',
      'open',
      'open',
      'open',
      'matrix',
      'scale',
      'scale',
      'other',
      'firstclick',
      'prototype',
      'website',
      'cardsort',
      'other',
      'other',
      'other',
      'other',
      'other',
    ]);
    const choice = block<ChoiceBlock>('b-choice');
    expect(choice.answer).toEqual(['Tomatoes', 'Basil']);
    expect(choice.options).toEqual(['Tomatoes', 'Basil', 'Roses', 'Other', 'I grow nothing']);
    expect(choice.duration).toBe(12);
    expect(choice.question).toBe('Which plants do you grow?');

    const open = block<OpenTextBlock>('b-open');
    expect(open.answer).toEqual([
      { role: 'user', text: 'My grandmother kept a vegetable patch and I missed the smell of it.' },
    ]);
    expect(open.duration).toBe(45);

    const ai = block<OpenTextBlock>('b-ai');
    expect(ai.answer.map((t) => t.role)).toEqual(['assistant', 'user', 'assistant', 'user']);
    expect(ai.answer[1].text).toBe('Blight took half the tomatoes.');

    expect(block<OpenTextBlock>('b-q').duration).toBe(8); // completedAt − startedAt fallback

    const matrix = block<MatrixBlock>('b-matrix');
    expect(matrix.answer).toEqual({ Trowel: ['Great'], Pruner: ['Poor', 'Fine'] });

    expect(block<ScaleBlock>('b-scale').answer).toBe('6');
    expect(block<ScaleBlock>('b-nps').answer).toBe('9');

    const rank = block<OtherBlock>('b-rank');
    expect(rank.sourceType).toBe('ranking');
    expect(rank.rawAnswer).toEqual(['Plant diary', 'Watering reminders']);

    expect(block<FirstClickBlock>('b-click').answer).toEqual({ top: 0.91, left: 0.82 });

    const figma = block<PrototypeBlock>('b-figma');
    expect(figma).toMatchObject({ status: 'completed', clickCount: 5, duration: 60 });

    expect(block<WebsiteBlock>('b-live')).toMatchObject({ gaveUp: false, duration: 34 });

    const cards = block<CardsortBlock>('b-cards');
    expect(cards.answer).toEqual({ Cutting: ['Pruner', 'Shears'], cat2: ['Trowel'] });

    for (const id of ['b-agree', 'b-pref', 'b-kano', 'b-tree', 'b-maxdiff']) {
      const o = block<OtherBlock>(id);
      expect(o.type).toBe('other');
      expect(o.rawAnswer).toBeDefined();
    }
    expect(block<OtherBlock>('b-tree').sourceType).toBe('treetesting');
    expect(a1.blocks.some((b) => ['b-ctx', 'b-5s', 'b-page'].includes(b.blockId!))).toBe(false);
  });

  it('fills device, panel and source from the response envelope', () => {
    expect(a1.device).toBe('mobile');
    expect(a1.panel).toEqual({ token: 'tok-a1', age: '35-44', sex: 'male' });
    const a2 = survey.responses[1];
    expect(a2.device).toBe('desktop');
    expect(a2.panel).toBeUndefined();
    expect(survey.source).toBeUndefined(); // a4 came from "link", the others from "customHiring"
    expect(report.warnings.some((w) => w.includes('"source" differs'))).toBe(true);
  });

  it('drops empty answers, keeps gave-up and partial tasks, falls back to ids', () => {
    const a2 = survey.responses[1];
    const types = a2.blocks.map((b) => b.type);
    expect(types).toEqual(['prototype', 'website', 'matrix', 'other']);
    expect(a2.blocks[0]).toMatchObject({ status: 'gave_up', clickCount: 0, duration: 9 });
    expect(a2.blocks[1]).toMatchObject({ gaveUp: true });
    expect((a2.blocks[2] as MatrixBlock).answer).toEqual({ r9: ['c9'] }); // unknown ids kept
    expect(a2.blocks[3]).toMatchObject({
      type: 'other',
      sourceType: 'hologram',
      question: 'hologram b-unknown',
    });
    const a4 = survey.responses[2];
    expect(a4.blocks[0]).toMatchObject({ type: 'prototype', status: 'partial', duration: 1.5 });
    expect(
      report.warnings.some((w) => w.startsWith('2 answer block(s) carried no usable answer')),
    ).toBe(true);
    expect(report.warnings.some((w) => w.includes('missing from the test definition'))).toBe(true);
  });

  it('reports what the API cannot give and which detectors can run', () => {
    expect(report.hasDuration).toBe(true);
    expect(report.screeningAnswers).toBe(0);
    expect(
      report.warnings.some((w) => w.includes('screening questions and answers are not exposed')),
    ).toBe(true);
    expect(report.warnings.some((w) => w.includes('recruiting target'))).toBe(true);
    expect(report.detectorsAvailable).toEqual(
      expect.arrayContaining([
        'pace',
        'open-answer',
        'matrix-pattern',
        'mass-select',
        'prototype-effort',
        'cardsort-consensus',
        'firstclick-offtarget',
        'website-bounce',
      ]),
    );
    expect(report.detectorsUnavailable).toEqual([
      { detector: 'coherence (screening-vs-body)', reason: 'no screening answers' },
    ]);
    expect(report.blocksByType).toMatchObject({ open: 3, other: 7, prototype: 3, website: 2 });
  });

  it('honours --survey-id', () => {
    expect(convertPathwayApi(TEST, PAGE1, { surveyId: 'spring-wave' }).dataset[0].id).toBe(
      'spring-wave',
    );
  });
});

describe('fetching', () => {
  it('sends the bearer token and validates the test payload', async () => {
    const api = fakeApi();
    const test = await fetchPathwayTest(TEST_ID, api.opts);
    expect(test.blocks).toHaveLength(TEST.blocks.length);
    expect(api.calls[0]).toEqual({
      url: `https://api.example.test/api/public/v1/tests/${TEST_ID}`,
      auth: 'Bearer demo-token',
    });
  });

  it('paginates with lastCreatedAt until hasNextPage is false and retries a 429', async () => {
    const api = fakeApi();
    const pages = [];
    for await (const p of fetchPathwayResponses(TEST_ID, { ...api.opts, pageSize: 2 }))
      pages.push(p);
    expect(pages.map((p) => p.answers.map((a) => a.id))).toEqual([
      ['a1', 'a2'],
      ['a3', 'a4'],
    ]);
    const urls = api.calls.map((c) => c.url);
    expect(urls).toHaveLength(3); // 429, page 1, page 2
    expect(urls[0]).toContain('limit=2');
    expect(urls[0]).not.toContain('lastCreatedAt');
    expect(urls[2]).toContain(`lastCreatedAt=${encodeURIComponent(at(2))}`);
    expect(api.sleeps).toContain(2000); // Retry-After: 2 honoured
  });

  it('stops after --max-pages', async () => {
    const api = fakeApi({ failFirstResponses: false });
    const pages = [];
    for await (const p of fetchPathwayResponses(TEST_ID, { ...api.opts, maxPages: 1 }))
      pages.push(p);
    expect(pages).toHaveLength(1);
    expect(api.calls).toHaveLength(1);
  });

  it('spaces requests to respect the rate limit', async () => {
    const api = fakeApi({ failFirstResponses: false });
    await importPathway(TEST_ID, { ...api.opts, minIntervalMs: 600 });
    // Three requests back to back: at least two throttle sleeps, each at most one interval.
    expect(api.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(api.sleeps.every((ms) => ms > 0 && ms <= 600)).toBe(true);
  });

  it('retries 5xx with backoff and gives up after maxRetries', async () => {
    const ok = fakeApi({ failFirstResponses: false, serverErrors: 2 });
    await expect(
      fetchPathwayTest(TEST_ID, { ...ok.opts, minIntervalMs: 0 }),
    ).resolves.toBeDefined();
    expect(ok.calls).toHaveLength(3);
    expect(ok.sleeps.slice(0, 2)).toEqual([500, 1000]);

    const dead = fakeApi({ failFirstResponses: false, serverErrors: 10 });
    await expect(
      fetchPathwayTest(TEST_ID, { ...dead.opts, maxRetries: 2, minIntervalMs: 0 }),
    ).rejects.toThrow(/answered 503 .* after 3 attempt/);
  });

  it('fails fast on 401 and 404', async () => {
    const api = fakeApi({ failFirstResponses: false });
    await expect(fetchPathwayTest('other-test', api.opts)).rejects.toBeInstanceOf(PathwayApiError);
    await expect(fetchPathwayTest('other-test', api.opts)).rejects.toThrow(/not found/);
    const unauthorized: FetchLike = async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    await expect(fetchPathwayTest(TEST_ID, { ...api.opts, fetch: unauthorized })).rejects.toThrow(
      /PATHWAY_API_TOKEN/,
    );
  });

  it('requires a base URL and a token', async () => {
    await expect(fetchPathwayTest(TEST_ID, { baseUrl: '', token: 't' })).rejects.toThrow(
      /base URL/,
    );
    await expect(
      fetchPathwayTest(TEST_ID, { baseUrl: 'https://api.example.test', token: '' }),
    ).rejects.toThrow(/token/);
  });

  it('importPathway composes fetch + convert', async () => {
    const api = fakeApi();
    const seen: number[] = [];
    const result = await importPathway(TEST_ID, {
      ...api.opts,
      onPage: (p) => seen.push(p.received),
    });
    expect(result.pagesFetched).toBe(2);
    expect(result.answersFetched).toBe(4);
    expect(seen).toEqual([2, 2]);
    expect(result.test.name).toBe('Garden app concept check');
    expect(result.report.responses).toBe(3);
    expect(result.dataset[0].responses.map((r) => r.id)).toEqual(['a1', 'a2', 'a4']);
  });
});
