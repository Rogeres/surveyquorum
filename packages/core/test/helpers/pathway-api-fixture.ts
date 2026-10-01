/**
 * Invented Pathway public-API payloads for the `pathway-api` adapter tests: one test definition
 * with every block type, two pages of answers, and a fake `fetch` that serves them (with one
 * 429 and optional 5xx failures). No real survey data.
 */
import type {
  FetchLike,
  PathwayAnswer,
  PathwayApiOptions,
  PathwayTest,
} from '../../src/adapters/pathway-api.js';

export const TEST_ID = 'demo-test-1';

export const TEST: PathwayTest = {
  id: TEST_ID,
  name: 'Garden app concept check',
  status: 'active',
  blocks: [
    { id: 'b-ctx', type: 'context', text: '<p>Welcome</p>' },
    {
      id: 'b-choice',
      type: 'choice',
      text: '<p>Which <b>plants</b> do you grow?</p>',
      replyType: 'multi',
      other: true,
      noneOfTheAbove: true,
      noneOfTheAboveOptionText: 'I grow nothing',
      options: [
        { id: 'o1', value: 'Tomatoes' },
        { id: 'o2', value: 'Basil' },
        { id: 'o3', value: 'Roses' },
      ],
    },
    { id: 'b-open', type: 'openquestion', text: 'Why did you start gardening?' },
    { id: 'b-ai', type: 'ai', text: 'Tell us about your last harvest &amp; what went wrong' },
    { id: 'b-q', type: 'question', text: 'Anything else?' },
    {
      id: 'b-matrix',
      type: 'matrix',
      text: 'Rate each tool',
      rows: [
        { id: 'r1', value: 'Trowel' },
        { id: 'r2', value: 'Pruner' },
      ],
      columns: [
        { id: 'c1', value: 'Poor' },
        { id: 'c2', value: 'Fine' },
        { id: 'c3', value: 'Great' },
      ],
    },
    { id: 'b-scale', type: 'scale', text: 'How green is your thumb?', from: 1, to: 7 },
    { id: 'b-nps', type: 'nps', text: 'Would you recommend the app?' },
    {
      id: 'b-rank',
      type: 'ranking',
      text: 'Rank the features',
      options: [
        { id: 'f1', value: 'Watering reminders' },
        { id: 'f2', value: 'Plant diary' },
      ],
    },
    { id: 'b-click', type: 'firstclick', text: 'Where would you tap to add a plant?' },
    { id: 'b-figma', type: 'figma', text: 'Add a tomato plant to your garden' },
    { id: 'b-live', type: 'livetesting', text: 'Find the seed catalogue on the site' },
    { id: 'b-cards', type: 'cardsort', text: 'Sort the tools' },
    { id: 'b-agree', type: 'agreement', text: 'I accept the terms' },
    { id: 'b-pref', type: 'preference', text: 'Pick the nicer logo' },
    { id: 'b-kano', type: 'kanomodel', text: 'Kano on reminders' },
    { id: 'b-tree', type: 'treetesting', text: 'Find the compost guide' },
    { id: 'b-maxdiff', type: 'maxdiff', text: 'Most and least important' },
    { id: 'b-5s', type: 'fiveseconds', text: 'Look at this screen' },
    { id: 'b-shuffle', type: 'shuffle' },
    { id: 'b-split', type: 'split' },
    { id: 'b-page', type: 'page', text: 'Thanks' },
  ],
};

export const at = (minute: number, second = 0) =>
  `2026-02-10T09:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;

/** A full respondent: one answer per block, invented content. */
export function fullAnswer(id: string, overrides: Partial<PathwayAnswer> = {}): PathwayAnswer {
  return {
    id,
    createdAt: at(1),
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605 (KHTML, like Gecko) Mobile/15E148 Safari/604',
    urlParams: { token: `tok-${id}`, onin_age: '35-44', onin_sex: 'male', utm: 'x' },
    referrer: null,
    source: 'customHiring',
    status: 'completed',
    blocks: [
      {
        id: 'b-ctx',
        type: 'context',
        data: {},
        startedAt: at(0),
        completedAt: at(0, 5),
        duration: 5000,
      },
      {
        id: 'b-choice',
        type: 'choice',
        data: {
          selectedOptions: [
            { id: 'o1', value: 'Tomatoes' },
            { id: 'o2', value: 'Basil' },
          ],
        },
        startedAt: at(0, 5),
        completedAt: at(0, 17),
        duration: 12000,
      },
      {
        id: 'b-open',
        type: 'openquestion',
        data: { text: '  My grandmother kept a vegetable patch and I missed the smell of it. ' },
        startedAt: at(0, 17),
        completedAt: at(1, 2),
        duration: 45000,
      },
      {
        id: 'b-ai',
        type: 'ai',
        data: {
          messages: [
            { role: 'assistant', content: 'Tell us about your last harvest' },
            { role: 'user', content: 'Blight took half the tomatoes.' },
            { role: 'assistant', content: 'What would you do differently?' },
            { role: 'user', content: 'Space the plants out more.' },
          ],
        },
        startedAt: at(1, 2),
        completedAt: at(2, 32),
        duration: 90000,
      },
      {
        id: 'b-q',
        type: 'question',
        data: { messages: [{ role: 'user', content: 'No, that is all.' }] },
        startedAt: at(2, 32),
        completedAt: at(2, 40),
        duration: null, // falls back to completedAt − startedAt = 8 s
      },
      {
        id: 'b-matrix',
        type: 'matrix',
        data: { selectedOptions: { r1: ['c3'], r2: ['c1', 'c2'] } },
        startedAt: at(2, 40),
        completedAt: at(3),
        duration: 20000,
      },
      {
        id: 'b-scale',
        type: 'scale',
        data: { selectedOption: 6 },
        startedAt: at(3),
        completedAt: at(3, 4),
        duration: 4000,
      },
      {
        id: 'b-nps',
        type: 'nps',
        data: { selectedOption: '9' },
        startedAt: at(3, 4),
        completedAt: at(3, 7),
        duration: 3000,
      },
      {
        id: 'b-rank',
        type: 'ranking',
        data: {
          orderedOptions: [
            { id: 'f2', value: 'Plant diary' },
            { id: 'f1', value: 'Watering reminders' },
          ],
        },
        startedAt: at(3, 7),
        completedAt: at(3, 20),
        duration: 13000,
      },
      {
        id: 'b-click',
        type: 'firstclick',
        data: { clickData: { left: 0.82, top: 0.91 } },
        startedAt: at(3, 20),
        completedAt: at(3, 26),
        duration: 6000,
      },
      {
        id: 'b-figma',
        type: 'figma',
        data: {
          givenUp: false,
          path: ['home', 'garden', 'add-plant', 'done'],
          nodeEventData: {
            home: { clicks: 2 },
            garden: { clicks: [{ x: 1 }, { x: 2 }, { x: 3 }] },
            'add-plant': { hovered: true },
          },
        },
        startedAt: at(3, 26),
        completedAt: at(4, 26),
        duration: 60000,
      },
      {
        id: 'b-live',
        type: 'livetesting',
        data: { givenUp: false },
        startedAt: at(4, 26),
        completedAt: at(5),
        duration: 34000,
      },
      {
        id: 'b-cards',
        type: 'cardsort',
        data: {
          sorting: [
            {
              categoryId: 'cat1',
              categoryName: 'Cutting',
              cards: [
                { cardId: 'k1', cardValue: 'Pruner' },
                { cardId: 'k2', cardValue: 'Shears' },
              ],
            },
            {
              categoryId: 'cat2',
              categoryName: '',
              cards: [{ cardId: 'k3', cardValue: 'Trowel' }],
            },
          ],
        },
        startedAt: at(5),
        completedAt: at(5, 40),
        duration: 40000,
      },
      {
        id: 'b-agree',
        type: 'agreement',
        data: { agreed: true },
        startedAt: at(5, 40),
        completedAt: at(5, 42),
        duration: 2000,
      },
      {
        id: 'b-pref',
        type: 'preference',
        data: { selected: 'logo-b' },
        startedAt: at(5, 42),
        completedAt: at(5, 50),
        duration: 8000,
      },
      {
        id: 'b-kano',
        type: 'kanomodel',
        data: { functional: 'like', dysfunctional: 'dislike' },
        startedAt: at(5, 50),
        completedAt: at(6),
        duration: 10000,
      },
      {
        id: 'b-tree',
        type: 'treetesting',
        data: { status: 'success', selectedNode: 'guides/compost' },
        startedAt: at(6),
        completedAt: at(6, 30),
        duration: 30000,
      },
      {
        id: 'b-maxdiff',
        type: 'maxdiff',
        data: { best: 'f1', worst: 'f2' },
        startedAt: at(6, 30),
        completedAt: at(6, 45),
        duration: 15000,
      },
      {
        id: 'b-5s',
        type: 'fiveseconds',
        data: {},
        startedAt: at(6, 45),
        completedAt: at(6, 50),
        duration: 5000,
      },
      {
        id: 'b-page',
        type: 'page',
        data: {},
        startedAt: at(6, 50),
        completedAt: null,
        duration: null,
      },
    ],
    ...overrides,
  };
}

export const PAGE1: PathwayAnswer[] = [
  fullAnswer('a1'),
  fullAnswer('a2', {
    createdAt: at(2),
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537 (KHTML, like Gecko) Chrome/120 Safari/537',
    urlParams: null,
    status: null,
    blocks: [
      { id: 'b-choice', type: 'choice', data: { selectedOptions: [] }, duration: 3000 },
      { id: 'b-open', type: 'openquestion', data: { text: '   ' }, duration: 2000 },
      {
        id: 'b-figma',
        type: 'figma',
        data: { givenUp: true, path: ['home'], nodeEventData: null },
        duration: 9000,
      },
      { id: 'b-live', type: 'livetesting', data: { givenUp: true }, duration: 4000 },
      { id: 'b-matrix', type: 'matrix', data: { selectedOptions: { r9: ['c9'] } }, duration: 7000 },
      { id: 'b-unknown', type: 'hologram', data: { beam: 1 }, duration: 1000 },
    ],
  }),
];
export const PAGE2: PathwayAnswer[] = [
  fullAnswer('a3', {
    createdAt: at(3),
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605 Safari/604',
    status: 'screened_out',
  }),
  fullAnswer('a4', {
    createdAt: at(4),
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537 Chrome/120 Mobile Safari/537',
    source: 'link',
    blocks: [
      {
        id: 'b-figma',
        type: 'figma',
        data: { givenUp: false, path: [], nodeEventData: {} },
        duration: 1500,
      },
    ],
  }),
];

// ----------------------------------------------------------------------------
// Fake API: two pages, one 429 on the first responses call
// ----------------------------------------------------------------------------

interface FakeApi {
  fetch: FetchLike;
  calls: { url: string; auth: string | undefined }[];
  sleeps: number[];
  opts: PathwayApiOptions;
}

export function fakeApi({
  failFirstResponses = true,
  serverErrors = 0,
}: {
  failFirstResponses?: boolean;
  serverErrors?: number;
} = {}): FakeApi {
  const calls: FakeApi['calls'] = [];
  const sleeps: number[] = [];
  let responsesCalls = 0;
  let errorsLeft = serverErrors;
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    json: async () => body,
  });
  const fetch: FetchLike = async (url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    calls.push({ url, auth: headers?.Authorization });
    const u = new URL(url);
    if (errorsLeft > 0) {
      errorsLeft--;
      return json(503, { error: 'maintenance' });
    }
    if (u.pathname === `/api/public/v1/tests/${TEST_ID}`) return json(200, TEST);
    if (u.pathname === `/api/public/v1/tests/${TEST_ID}/responses`) {
      responsesCalls++;
      if (failFirstResponses && responsesCalls === 1)
        return json(429, { error: 'rate limited' }, { 'retry-after': '2' });
      const cursor = u.searchParams.get('lastCreatedAt');
      if (cursor === null) {
        return json(200, {
          answers: PAGE1,
          totalCount: 4,
          pagination: {
            limit: Number(u.searchParams.get('limit')),
            hasNextPage: true,
            lastCreatedAt: at(2),
          },
        });
      }
      if (cursor === at(2)) {
        return json(200, {
          answers: PAGE2,
          totalCount: 4,
          pagination: { limit: 100, hasNextPage: false, lastCreatedAt: at(4) },
        });
      }
      return json(200, {
        answers: [],
        totalCount: 4,
        pagination: { limit: 100, hasNextPage: false },
      });
    }
    return json(404, { error: 'not found' });
  };
  const opts: PathwayApiOptions = {
    baseUrl: 'https://api.example.test/',
    token: 'demo-token',
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
  return { fetch, calls, sleeps, opts };
}
