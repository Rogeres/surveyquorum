import { describe, expect, it } from 'vitest';
import { ConvertError, convertCsv } from '../src/adapters/csv.js';
import { parseCsv, parseCsvRows } from '../src/adapters/csv-parser.js';
import { parseMapping } from '../src/adapters/mapping.js';

describe('RFC 4180 parser', () => {
  it('handles quotes, escaped quotes, embedded newlines, CRLF and a BOM', () => {
    const text = '﻿a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line1\nline2",\r\n';
    const t = parseCsv(text);
    expect(t.header).toEqual(['a', 'b', 'c']);
    expect(t.rows).toEqual([
      ['1', 'x, y', 'say "hi"'],
      ['2', 'line1\nline2', ''],
    ]);
  });

  it('supports another delimiter and drops blank lines', () => {
    expect(parseCsvRows('a;b\n\n1;2\n', ';')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('rejects an unterminated quote', () => {
    expect(() => parseCsvRows('a,b\n1,"oops')).toThrow(/quoted/);
  });
});

const longMapping = parseMapping({
  layout: 'long',
  surveyId: 'survey',
  responseId: 'rid',
  blockId: 'qid',
  question: 'q',
  questionType: 'type',
  answer: 'a',
  durationMs: 'ms',
  device: 'dev',
  panelToken: 'tok',
  screening: { blockIds: ['s1'], questionPrefixes: ['S2.'] },
  target: { const: 'Adults who buy tea monthly' },
});

const LONG = [
  'survey,rid,qid,type,q,a,ms,dev,tok',
  's1,r1,s1,choice,Which do you buy?,Tea;Coffee,4000,mobile,p-77',
  's1,r1,s2,single,S2. Your age group,25-34,2000,mobile,p-77',
  's1,r1,q1,open,Why?,Because it is cheap,30000,mobile,p-77',
  's1,r1,q2,matrix,Rate brands,Alpha=Good;Beta=Poor|Fair,15000,mobile,p-77',
  's1,r1,q3,firstclick,Click the price,"35,60",5000,mobile,p-77',
  's1,r1,q4,prototype,Buy it,gave up;3,8000,mobile,p-77',
  's1,r1,q5,website,Find hours,yes,3000,mobile,p-77',
  's1,r1,q6,ranking,Rank them,A>B,7000,mobile,p-77',
  's1,r2,q1,open,Why?,,1000,,',
  's1,,q1,open,Why?,orphan,1000,,',
  's1,r2,q3,firstclick,Click the price,nowhere,5000,,',
  's2,r9,q1,open,Why?,Different survey,2500,desktop,',
].join('\n');

describe('convertCsv — long layout', () => {
  const { dataset, report } = convertCsv(LONG, longMapping);

  it('groups rows into surveys and responses in order', () => {
    expect(dataset.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(dataset[0].responses.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(dataset[0].target).toBe('Adults who buy tea monthly');
  });

  it('routes screening rows to response.screening and keeps body blocks', () => {
    const r1 = dataset[0].responses[0];
    expect(r1.screening).toEqual([
      { question: 'Which do you buy?', answer: ['Tea', 'Coffee'] },
      { question: 'S2. Your age group', answer: ['25-34'] },
    ]);
    expect(r1.blocks.map((b) => b.type)).toEqual([
      'open',
      'matrix',
      'firstclick',
      'prototype',
      'website',
      'other',
    ]);
    expect(r1.device).toBe('mobile');
    expect(r1.panel).toEqual({ token: 'p-77' });
  });

  it('parses each answer shape', () => {
    const [open, matrix, click, proto, site, other] = dataset[0].responses[0].blocks;
    expect(open).toMatchObject({
      duration: 30,
      answer: [{ role: 'user', text: 'Because it is cheap' }],
    });
    expect(matrix).toMatchObject({ answer: { Alpha: ['Good'], Beta: ['Poor', 'Fair'] } });
    expect(click).toMatchObject({ answer: { top: 0.35, left: 0.6 } });
    expect(proto).toMatchObject({ status: 'gave_up', clickCount: 3 });
    expect(site).toMatchObject({ gaveUp: true });
    expect(other).toMatchObject({ type: 'other', sourceType: 'ranking', rawAnswer: 'A>B' });
  });

  it('keeps an empty open answer as an empty user turn', () => {
    expect(dataset[0].responses[1].blocks[0]).toMatchObject({
      type: 'open',
      answer: [{ role: 'user', text: '' }],
    });
  });

  it('reports skipped rows with line numbers and reasons', () => {
    expect(report.rowsRead).toBe(12);
    expect(report.rowsConverted).toBe(10);
    expect(report.rowsSkipped).toBe(2);
    expect(report.skipped).toEqual([
      {
        reason: 'empty response id',
        count: 1,
        examples: [{ line: 11, detail: 'column "rid" is empty' }],
      },
      {
        reason: 'unreadable firstclick answer',
        count: 1,
        examples: [{ line: 12, detail: expect.stringContaining('nowhere') }],
      },
    ]);
    expect(report.warnings).toEqual([
      expect.stringMatching(/unknown question type "ranking" on 1 row/),
    ]);
  });

  it('lists available and unavailable detectors with reasons', () => {
    expect(report.hasDuration).toBe(true);
    expect(report.detectorsAvailable).toEqual([
      'pace',
      'open-answer',
      'duplicate-open',
      'coherence (screening-vs-body)',
      'matrix-pattern',
      'prototype-effort',
      'firstclick-offtarget',
      'website-bounce',
      'positive',
    ]);
    expect(report.detectorsUnavailable).toEqual([
      { detector: 'mass-select', reason: 'no choice questions' },
      { detector: 'cardsort-consensus', reason: 'no card-sort tasks' },
    ]);
  });
});

describe('convertCsv — minimum viable data', () => {
  it('works with respondent + question + answer and explains what is missing', () => {
    const m = parseMapping({ layout: 'long', responseId: 'who', question: 'q', answer: 'a' });
    const { dataset, report } = convertCsv('who,q,a\nr1,Why?,Because\nr2,Why?,Dunno\n', m);
    expect(dataset).toHaveLength(1);
    expect(dataset[0].id).toBe('survey');
    expect(dataset[0].responses[0].blocks[0]).toMatchObject({ type: 'open', duration: 0 });
    expect(report.hasDuration).toBe(false);
    const byReason = new Map<string, string[]>();
    for (const u of report.detectorsUnavailable) {
      byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), u.detector]);
    }
    expect(byReason.get('no duration column')).toEqual(['pace']);
    expect(byReason.get('no prototype tasks; no duration column')).toEqual(['prototype-effort']);
    expect(byReason.get('no screening answers')).toEqual(['coherence (screening-vs-body)']);
    expect(report.warnings[0]).toMatch(/constant "open"/);
  });

  it('fails loudly when the mapping names a column the header lacks', () => {
    const m = parseMapping({ layout: 'long', responseId: 'who', question: 'q', answer: 'answer' });
    expect(() => convertCsv('who,q,a\nr1,Why?,Because\n', m)).toThrow(ConvertError);
    expect(() => convertCsv('who,q,a\nr1,Why?,Because\n', m)).toThrow(/"answer".*Header has/);
  });

  it('resolves byQuestion types by block id first, then question text', () => {
    const m = parseMapping({
      layout: 'long',
      responseId: 'who',
      blockId: 'id',
      question: 'q',
      answer: 'a',
      questionType: { byQuestion: { q2: 'scale', 'Pick some': 'multi' }, default: 'open' },
    });
    const { dataset } = convertCsv(
      'who,id,q,a\nr1,q1,Pick some,A|B\nr1,q2,Rate,5\nr1,q3,Why,Text\n',
      m,
    );
    expect(dataset[0].responses[0].blocks.map((b) => b.type)).toEqual(['choice', 'scale', 'open']);
  });
});

describe('convertCsv — wide layout', () => {
  const m = parseMapping({
    layout: 'wide',
    surveyId: { const: 'wide-1' },
    responseId: 'Respondent',
    separator: ',',
    questions: [
      { column: 'Age', type: 'choice', screening: true },
      { column: 'Q1', question: 'Which apps do you use?', type: 'multi', durationColumn: 'Q1_sec' },
      { column: 'Q2', type: 'scale', blockId: 'nps' },
      { column: 'Q3', type: 'open', durationColumn: 'Q3_sec' },
    ],
  });
  const text = [
    'Respondent,Age,Q1,Q1_sec,Q2,Q3,Q3_sec',
    'a,25-34,"Mail, Maps",12,9,Love it,20',
    'b,,"Mail",3,,,',
    ',35-44,Maps,5,7,x,1',
  ].join('\n');
  const { dataset, report } = convertCsv(text, m);

  it('builds one response per row, skipping empty cells as not reached', () => {
    expect(dataset[0].id).toBe('wide-1');
    expect(dataset[0].responses.map((r) => r.id)).toEqual(['a', 'b']);
    const a = dataset[0].responses[0];
    expect(a.screening).toEqual([{ question: 'Age', answer: ['25-34'] }]);
    expect(a.blocks).toEqual([
      {
        question: 'Which apps do you use?',
        duration: 12,
        type: 'choice',
        answer: ['Mail', 'Maps'],
      },
      { blockId: 'nps', question: 'Q2', duration: 0, type: 'scale', answer: '9' },
      { question: 'Q3', duration: 20, type: 'open', answer: [{ role: 'user', text: 'Love it' }] },
    ]);
    expect(dataset[0].responses[1].blocks).toHaveLength(1);
    expect(dataset[0].responses[1].screening).toBeUndefined();
  });

  it('writes the question inventory from the mapping', () => {
    expect(dataset[0].inventory).toEqual([
      { scope: 'screening', type: 'choice', question: 'Age' },
      { scope: 'body', type: 'choice', question: 'Which apps do you use?' },
      { scope: 'body', type: 'scale', question: 'Q2' },
      { scope: 'body', type: 'open', question: 'Q3' },
    ]);
  });

  it('counts rows and detectors', () => {
    expect(report).toMatchObject({
      rowsRead: 3,
      rowsConverted: 2,
      rowsSkipped: 1,
      responses: 2,
      blocksByType: { choice: 2, scale: 1, open: 1 },
      screeningAnswers: 1,
      hasDuration: true,
    });
    expect(report.detectorsAvailable).toContain('mass-select');
    expect(report.detectorsUnavailable.map((u) => u.detector)).not.toContain('pace');
  });
});

describe('mapping schema', () => {
  it('rejects an unknown type name with a path', () => {
    expect(() =>
      parseMapping({
        layout: 'wide',
        responseId: 'r',
        questions: [{ column: 'c', type: 'hologram' }],
      }),
    ).toThrow(/questions.*type|type/);
  });

  it('applies defaults', () => {
    const m = parseMapping({ layout: 'long', responseId: 'r', question: 'q', answer: 'a' });
    expect(m).toMatchObject({
      delimiter: ',',
      surveyId: { const: 'survey' },
      questionType: { const: 'open' },
    });
  });
});
