import { describe, expect, it } from 'vitest';
import { ConvertError } from '../src/adapters/csv.js';
import {
  convertPathwayReport,
  isPathwayReport,
  parseChatTranscript,
  parsePathwayHeader,
  splitQuestionAndOptions,
} from '../src/adapters/pathway-report.js';
import type { ChoiceBlock, OpenTextBlock, OtherBlock } from '../src/contract/types.js';

const FIXED =
  'Answer ID,token,age,sex,Device,Device OS,Browser,Window size,Source,Status,Reward,"Completion time, s",Answer Date';
const FIXED_ROW = (id: string, status = 'Completed', token = 'tok-1') =>
  `${id},${token},25-34,female,mobile,iOS 18,Safari 18,390x844,link,${status},0.50,120,2026-03-04 10:00:00`;

/** Build a small export: header cells and one row per respondent, both after the fixed part. */
function csv(blockHeaders: string[], rows: { id: string; status?: string; cells: string[] }[]) {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [`${FIXED},${blockHeaders.map(q).join(',')}`];
  for (const r of rows) lines.push(`${FIXED_ROW(r.id, r.status)},${r.cells.map(q).join(',')}`);
  return `${lines.join('\n')}\n`;
}

describe('isPathwayReport', () => {
  it('needs both Answer ID and Completion time', () => {
    expect(isPathwayReport(['Answer ID', 'Device', 'Completion time, s'])).toBe(true);
    expect(isPathwayReport(['Answer ID', 'Device'])).toBe(false);
    expect(isPathwayReport(['survey_id', 'response_id', 'answer'])).toBe(false);
  });
});

describe('parsePathwayHeader', () => {
  it('reads every header kind', () => {
    expect(parsePathwayHeader('7. Figma, response time (ms) – Add a recipe')).toMatchObject({
      n: 7,
      kind: 'Figma',
      qualifier: 'response time (ms)',
      rest: 'Add a recipe',
    });
    expect(parsePathwayHeader('1. Choice, other answers – How often?')).toMatchObject({
      kind: 'Choice',
      qualifier: 'other answers',
      rest: 'How often?',
    });
    expect(parsePathwayHeader('2. Choice – Which features?: Grocery list')).toMatchObject({
      kind: 'Choice',
      rest: 'Which features?: Grocery list',
    });
    expect(parsePathwayHeader('5. Matrix, Grocery list')).toMatchObject({
      n: 5,
      kind: 'Matrix',
      qualifier: 'Grocery list',
    });
    expect(parsePathwayHeader('6. Card sort, Lentil soup – spicy')).toMatchObject({
      kind: 'Card sort',
      qualifier: 'Lentil soup – spicy',
    });
    expect(parsePathwayHeader('14. Agreement')).toMatchObject({ n: 14, kind: 'Agreement' });
    expect(parsePathwayHeader('16. Preference - Which home screen?')).toMatchObject({
      kind: 'Preference',
      rest: 'Which home screen?',
    });
    expect(parsePathwayHeader('12. NPS – Recommend?')).toMatchObject({ kind: 'NPS' });
    expect(parsePathwayHeader('Device')).toBeUndefined();
    expect(parsePathwayHeader('Completion time, s')).toBeUndefined();
  });

  it('keeps an en dash inside the question text', () => {
    expect(parsePathwayHeader('3. Scale – Rate it – honestly')).toMatchObject({
      kind: 'Scale',
      rest: 'Rate it – honestly',
    });
  });
});

describe('splitQuestionAndOptions', () => {
  it('cuts the common prefix at the last ": " so shared option prefixes stay in the options', () => {
    expect(
      splitQuestionAndOptions([
        'Which features: Meal plans',
        'Which features: Meal reminders',
        'Which features: Other',
      ]),
    ).toEqual({
      question: 'Which features',
      options: ['Meal plans', 'Meal reminders', 'Other'],
    });
  });

  it('handles a question that itself contains a colon', () => {
    expect(
      splitQuestionAndOptions(['Rank: by importance: Price', 'Rank: by importance: Taste']),
    ).toEqual({ question: 'Rank: by importance', options: ['Price', 'Taste'] });
  });
});

describe('parseChatTranscript', () => {
  it('turns AI/User lines into alternating turns', () => {
    expect(parseChatTranscript('AI: Why?; User: Because; it was cheap.; AI: Thanks;')).toEqual([
      { role: 'assistant', text: 'Why?' },
      { role: 'user', text: 'Because; it was cheap.' },
      { role: 'assistant', text: 'Thanks' },
    ]);
  });

  it('accepts newlines between turns and a last turn without ";"', () => {
    expect(parseChatTranscript('AI: Why?;\nUser: Just because')).toEqual([
      { role: 'assistant', text: 'Why?' },
      { role: 'user', text: 'Just because' },
    ]);
  });

  it('keeps plain text as a single user turn', () => {
    expect(parseChatTranscript('I planned on Sunday: AI did not help.')).toEqual([
      { role: 'user', text: 'I planned on Sunday: AI did not help.' },
    ]);
  });
});

describe('convertPathwayReport', () => {
  it('rejects a CSV that is not a Pathway export', () => {
    expect(() => convertPathwayReport('a,b\n1,2\n')).toThrow(ConvertError);
    expect(() => convertPathwayReport('')).toThrow(/empty/);
  });

  it('groups multi-choice option columns into one block with options and Other text', () => {
    const q = 'Which features?';
    const text = csv(
      [
        `2. Choice – ${q}: Meal plans`,
        `2. Choice – ${q}: Other`,
        `2. Choice – ${q}: Other (text)`,
        `2. Choice – ${q}: None of the above`,
      ],
      [
        { id: 'r1', cells: ['TRUE', 'TRUE', 'Leftovers', 'FALSE'] },
        { id: 'r2', cells: ['FALSE', 'TRUE', '', 'FALSE'] },
        { id: 'r3', cells: ['', '', '', ''] },
      ],
    );
    const { dataset, report } = convertPathwayReport(text, { surveyId: 's' });
    const [r1, r2, r3] = dataset[0].responses;
    const b1 = r1.blocks[0] as ChoiceBlock;
    expect(b1).toMatchObject({
      blockId: 'pw-2',
      type: 'choice',
      question: q,
      answer: ['Meal plans', 'Other: Leftovers'],
      options: ['Meal plans', 'Other', 'None of the above'],
    });
    expect((r2.blocks[0] as ChoiceBlock).answer).toEqual(['Other']);
    expect(r3.blocks).toEqual([]); // never reached
    expect(dataset[0].inventory).toEqual([
      {
        scope: 'body',
        type: 'choice',
        question: q,
        options: ['Meal plans', 'Other', 'None of the above'],
      },
    ]);
    expect(report.blocksByType).toEqual({ choice: 2 });
  });

  it('single choice: splits on ";" and replaces Other with its text', () => {
    const text = csv(
      ['1. Choice – How often?', '1. Choice, other answers – How often?'],
      [
        { id: 'r1', cells: ['Other', 'Only lunches'] },
        { id: 'r2', cells: ['Daily;Weekends', ''] },
      ],
    );
    const [r1, r2] = convertPathwayReport(text).dataset[0].responses;
    expect((r1.blocks[0] as ChoiceBlock).answer).toEqual(['Other: Only lunches']);
    expect((r2.blocks[0] as ChoiceBlock).answer).toEqual(['Daily', 'Weekends']);
    expect((r2.blocks[0] as ChoiceBlock).options).toBeUndefined();
  });

  it('Figma, Live website and Click carry the only durations; status maps to the contract', () => {
    const text = csv(
      [
        '7. Figma, response time (ms) – Task',
        '7. Figma, final screen – Task',
        '7. Figma, status – Task',
        '8. Live website, response time (ms) – Site',
        '8. Live website, result – Site',
        '9. Click, response time (ms) – Tap',
        '3. Scale – Rate',
      ],
      [
        { id: 'r1', cells: ['18420', 'Done', 'Succeeded', '1500', 'Gave up', '640', '4'] },
        { id: 'r2', cells: ['4000', 'Home', 'Gave up', '2000', 'Succeeded', '', '5'] },
        { id: 'r3', cells: ['9000', 'Home', '', '', '', '', ''] },
      ],
    );
    const { dataset, report } = convertPathwayReport(text);
    const [r1, r2, r3] = dataset[0].responses;
    // Blocks are ordered by N, not by column position.
    expect(r1.blocks.map((b) => b.blockId)).toEqual(['pw-3', 'pw-7', 'pw-8', 'pw-9']);
    expect(r1.blocks[1]).toMatchObject({
      type: 'prototype',
      duration: 18.42,
      status: 'completed',
      clickCount: 0,
    });
    expect(r1.blocks[2]).toMatchObject({ type: 'website', duration: 1.5, gaveUp: true });
    expect(r1.blocks[3]).toMatchObject({ type: 'other', sourceType: 'firstclick', duration: 0.64 });
    expect(r2.blocks[1]).toMatchObject({ type: 'prototype', status: 'gave_up', duration: 4 });
    expect(r2.blocks[2]).toMatchObject({ type: 'website', gaveUp: false });
    expect(r2.blocks.map((b) => b.blockId)).toEqual(['pw-3', 'pw-7', 'pw-8']);
    expect(r3.blocks).toEqual([
      {
        blockId: 'pw-7',
        question: 'Task',
        duration: 9,
        type: 'prototype',
        status: 'partial',
        clickCount: 0,
      },
    ]);
    expect(report.hasDuration).toBe(true);
    expect(report.detectorsAvailable).toEqual(
      expect.arrayContaining(['prototype-effort', 'website-bounce']),
    );
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('prototype click counts are not present'),
        expect.stringContaining('first-click coordinates are not present'),
        expect.stringContaining('per-question durations are not present'),
      ]),
    );
    expect(report.detectorsUnavailable).toContainEqual({
      detector: 'firstclick-offtarget',
      reason: 'no first-click tasks',
    });
  });

  it('matrix rows and card-sort cards share one block number and get synthetic questions', () => {
    const text = csv(
      ['5. Matrix, Row A', '5. Matrix, Row B', '6. Card sort, Oatmeal', '6. Card sort, Soup'],
      [
        { id: 'r1', cells: ['Good;Cheap', 'Poor', 'Breakfast', 'Lunch'] },
        { id: 'r2', cells: ['Good', '', 'Breakfast', ''] },
      ],
    );
    const [r1, r2] = convertPathwayReport(text).dataset[0].responses;
    expect(r1.blocks[0]).toEqual({
      blockId: 'pw-5',
      question: 'Matrix 5',
      duration: 0,
      type: 'matrix',
      answer: { 'Row A': ['Good', 'Cheap'], 'Row B': ['Poor'] },
    });
    expect(r1.blocks[1]).toEqual({
      blockId: 'pw-6',
      question: 'Card sort 6',
      duration: 0,
      type: 'cardsort',
      answer: { Breakfast: ['Oatmeal'], Lunch: ['Soup'] },
    });
    expect(r2.blocks[0]).toMatchObject({ answer: { 'Row A': ['Good'] } });
    expect(r2.blocks[1]).toMatchObject({ answer: { Breakfast: ['Oatmeal'] } });
  });

  it('open, Question (chat or plain), AI with tag columns, NPS, ranking, tree test, Agreement', () => {
    const text = csv(
      [
        '4. Open question – Why?',
        '10. Question – Tell us',
        '11. AI – What stops you?',
        '11. AI – What stops you?: tags',
        '12. NPS – Recommend?',
        '13. Ranking – Rank: Price',
        '13. Ranking – Rank: Taste',
        '14. Agreement',
        '15. Tree testing – Find it: status',
        '15. Tree testing – Find it: selected node',
      ],
      [
        {
          id: 'r1',
          cells: [
            'Cheaper.',
            'AI: How?; User: On paper.;',
            'AI: Why?; User: Time.;',
            'time,energy',
            '9',
            '2',
            '1',
            'Agree',
            'Succeeded',
            'Home > Saved',
          ],
        },
        { id: 'r2', cells: ['', 'Plain answer', '', '', '', '', '', 'Agree', '', ''] },
      ],
    );
    const { dataset, report } = convertPathwayReport(text);
    const [r1, r2] = dataset[0].responses;
    expect(r1.blocks.map((b) => [b.blockId, b.type])).toEqual([
      ['pw-4', 'open'],
      ['pw-10', 'open'],
      ['pw-11', 'open'],
      ['pw-12', 'scale'],
      ['pw-13', 'other'],
      ['pw-15', 'other'],
    ]);
    expect((r1.blocks[1] as OpenTextBlock).answer).toEqual([
      { role: 'assistant', text: 'How?' },
      { role: 'user', text: 'On paper.' },
    ]);
    expect((r1.blocks[2] as OpenTextBlock).question).toBe('What stops you?');
    expect(r1.blocks[3]).toMatchObject({ type: 'scale', answer: '9', question: 'Recommend?' });
    expect(r1.blocks[4]).toMatchObject({
      sourceType: 'ranking',
      question: 'Rank',
      rawAnswer: { Price: 2, Taste: 1 },
    });
    expect(r1.blocks[5] as OtherBlock).toMatchObject({
      sourceType: 'tree testing',
      question: 'Find it',
      rawAnswer: { status: 'Succeeded', 'selected node': 'Home > Saved' },
    });
    expect(r2.blocks).toEqual([
      {
        blockId: 'pw-10',
        question: 'Tell us',
        duration: 0,
        type: 'open',
        answer: [{ role: 'user', text: 'Plain answer' }],
      },
    ]);
    expect(report.warnings).toContainEqual(
      expect.stringContaining('ignored 1 AI tag column(s): "11. AI – What stops you?: tags"'),
    );
    expect(report.warnings).toContainEqual('block type(s) kept as "other": Tree testing');
    expect(report.hasDuration).toBe(false);
    expect(report.detectorsUnavailable).toContainEqual({
      detector: 'pace',
      reason: 'no duration column',
    });
  });

  it('keeps only completed rows and reports the others by status', () => {
    const text = csv(
      ['3. Scale – Rate'],
      [
        { id: 'r1', cells: ['4'] },
        { id: 'r2', status: 'Screened out', cells: ['4'] },
        { id: 'r3', status: 'In progress', cells: [''] },
        { id: 'r4', status: 'completed', cells: ['5'] },
        { id: '', cells: ['5'] },
      ],
    );
    const { dataset, report } = convertPathwayReport(text, { surveyId: 'demo' });
    expect(dataset[0].id).toBe('demo');
    expect(dataset[0].responses.map((r) => r.id)).toEqual(['r1', 'r4']);
    expect(report).toMatchObject({ rowsRead: 5, rowsConverted: 2, rowsSkipped: 3 });
    expect(report.skipped).toEqual([
      {
        reason: 'status "Screened out" is not completed',
        count: 1,
        examples: [{ line: 3, detail: 'answer r2' }],
      },
      {
        reason: 'status "In progress" is not completed',
        count: 1,
        examples: [{ line: 4, detail: 'answer r3' }],
      },
      {
        reason: 'empty response id',
        count: 1,
        examples: [{ line: 6, detail: 'column "Answer ID" is empty' }],
      },
    ]);
  });

  it('maps URL tags to panel metadata, Device to device and a uniform Source to the survey', () => {
    const { dataset, report } = convertPathwayReport(
      csv(['3. Scale – Rate'], [{ id: 'r1', cells: ['4'] }]),
    );
    const s = dataset[0];
    expect(s.id).toBe('pathway');
    expect(s.source).toBe('link');
    expect(s.responses[0]).toMatchObject({
      device: 'mobile',
      panel: { token: 'tok-1', age: '25-34', sex: 'female' },
    });
    expect(report.warnings[0]).toContain('median 120 s over 1 response(s)');
  });

  it('drops unknown URL tags with a warning and leaves source empty when it differs', () => {
    const text = [
      'Answer ID,campaign,Device,Source,Status,"Completion time, s",3. Scale – Rate',
      'r1,spring,desktop,link,Completed,100,4',
      'r2,spring,desktop,panel-a,Completed,90,5',
    ].join('\n');
    const { dataset, report } = convertPathwayReport(text);
    expect(dataset[0].source).toBeUndefined();
    expect(dataset[0].responses[0].panel).toBeUndefined();
    expect(report.warnings).toContainEqual(expect.stringContaining('"Source" differs'));
    expect(report.warnings).toContainEqual(
      'URL-tag column(s) "campaign" have no place in the contract and were dropped',
    );
  });
});
