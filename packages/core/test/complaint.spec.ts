import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildComplaint,
  capAtWord,
  GENERIC_PROFILE,
  hasComplaintChannel,
  PANEL_IDS,
  PANELS,
  parsePanelProfile,
  pluralRu,
  resolvePanelProfile,
  selectGround,
  times,
} from '../src/complaint/index.js';
import type { Response } from '../src/contract/types.js';
import type { Evidence } from '../src/detectors/types.js';
import type { Verdict } from '../src/quorum/score.js';

const ev = (detector: string, signal: string, extra: Partial<Evidence> = {}): Evidence => ({
  responseId: 'r1',
  detector,
  signal,
  strength: 'strong',
  summary: '',
  ...extra,
});

const nonsense = ev('open-answer', 'gibberish', {
  summary:
    'Answer "asdf gh" to "What did you like about the kettle?" classified as gibberish: keys.',
  blocks: [1],
});
const dup3 = ev('duplicate-open', 'x3', {
  summary: 'The same text "nothing special" appears on 3 different open questions.',
  blocks: [2, 3, 6],
  stats: { nQuestions: 3, textLength: 15 },
});
const dup2 = ev('duplicate-open', 'x2', { strength: 'weak', stats: { nQuestions: 2 } });
const template = ev('matrix-pattern', 'straightline_fast', {
  blocks: [4, 5],
  stats: { units: 3, patternedUnits: 2, patterns: 'straight_line,straight_line' },
});
const speedFast = ev('pace', 'consistent', { stats: { totalSec: 48, cohortMedianSec: 310 } });
const speedSlow = ev('pace', 'consistent', { stats: { totalSec: 200, cohortMedianSec: 310 } });
const speedNoTotals = ev('pace', 'single_outlier', { strength: 'weak', stats: { nFast3: 1 } });
const ms = ev('mass-select', 'nearly_all', { strength: 'weak' });

const block = (evidence: Evidence[], outcome: Verdict['outcome'] = 'block'): Verdict => ({
  responseId: 'r1',
  outcome,
  score: 3.5,
  evidence,
  designArtifacts: [],
});

const response: Response = {
  id: 'r1',
  panel: { token: 'tok-r1' },
  blocks: [
    { type: 'choice', question: 'Own a kettle?', answer: ['Yes'], duration: 3 },
    {
      type: 'open',
      question: 'What did you like about the kettle?',
      answer: [{ role: 'user', text: 'asdf gh' }],
      duration: 2,
    },
    {
      type: 'open',
      question: 'What annoyed you?',
      answer: [{ role: 'user', text: 'nothing special' }],
      duration: 2,
    },
    {
      type: 'open',
      question: 'What would you change?',
      answer: [{ role: 'user', text: 'nothing special' }],
      duration: 2,
    },
    {
      type: 'matrix',
      question: 'Rate these statements',
      answer: { 'Heats fast': ['4'], 'Looks good': ['4'], 'Easy to clean': ['4'] },
      duration: 3,
    },
    { type: 'matrix', question: 'And these', answer: { A: ['4'], B: ['4'] }, duration: 2 },
    {
      type: 'open',
      question: 'Anything else?',
      answer: [{ role: 'user', text: 'nothing special' }],
      duration: 2,
    },
  ],
};

describe('selectGround priority', () => {
  it('nonsense text beats duplicates, templates and speed', () => {
    const sel = selectGround(block([speedFast, template, dup3, nonsense]), [
      speedFast,
      template,
      dup3,
      nonsense,
    ]);
    expect(sel.ground).toBe('nonsense_text');
  });
  it('then duplicate on three questions, then the matrix template, then whole-survey speed', () => {
    expect(
      selectGround(block([speedFast, template, dup3]), [speedFast, template, dup3]).ground,
    ).toBe('duplicate_text');
    expect(selectGround(block([speedFast, template]), [speedFast, template]).ground).toBe(
      'template_pattern',
    );
    expect(selectGround(block([speedFast]), [speedFast]).ground).toBe('speed_whole_survey');
  });
  it('speed needs the whole-survey time under half the median', () => {
    expect(selectGround(block([speedSlow]), [speedSlow])).toEqual({
      ground: null,
      reason: 'speed_not_whole_survey',
    });
    expect(selectGround(block([speedNoTotals]), [speedNoTotals])).toEqual({
      ground: null,
      reason: 'speed_not_whole_survey',
    });
    expect(buildComplaint(block([speedSlow]), [speedSlow])).toBeNull();
  });
  it('duplicate on two questions, mass-select and friends are internal only', () => {
    expect(selectGround(block([dup2, ms]), [dup2, ms])).toEqual({
      ground: null,
      reason: 'internal_only',
    });
    expect(buildComplaint(block([dup2, ms]), [dup2, ms])).toBeNull();
  });
  it('ignores design artifacts, other respondents, and anything not blocked', () => {
    const artifact = { ...nonsense, designArtifact: true };
    expect(selectGround(block([artifact]), [artifact])).toEqual({
      ground: null,
      reason: 'no_evidence',
    });
    expect(selectGround(block([]), [{ ...nonsense, responseId: 'r9' }])).toEqual({
      ground: null,
      reason: 'no_evidence',
    });
    expect(selectGround(block([nonsense], 'review'), [nonsense])).toEqual({
      ground: null,
      reason: 'not_blocked',
    });
  });
});

describe('buildComplaint text', () => {
  it('speed, both languages, with the numbers', () => {
    const en = buildComplaint(block([speedFast]), [speedFast])!;
    expect(en.text).toBe(
      'Whole survey completed in 48 s; cohort median 310 s (6 times faster). In that time the questions and answer options cannot be read.',
    );
    expect(en.chars).toBe(en.text.length);
    expect(en.eligible).toBe(true);
    expect(en.code).toBe('');
    const ru = buildComplaint(block([speedFast]), [speedFast], { lang: 'ru' })!;
    expect(ru.text).toContain(
      'Анкета пройдена за 48 с при медиане других участников 310 с (в 6 раз быстрее)',
    );
    expect(ru.text).not.toMatch(/signal|сигнал|совокуп/i);
  });

  it('nonsense quotes the question and the answer, from the response when given, else from the summary', () => {
    const fromSummary = buildComplaint(block([nonsense]), [nonsense])!;
    expect(fromSummary.text).toBe(
      'Question: "What did you like about the kettle?" Answer: "asdf gh". This is not an answer to the question but a string of letters without meaning.',
    );
    const ru = buildComplaint(block([nonsense]), [nonsense], { lang: 'ru', response })!;
    expect(ru.text).toBe(
      'Вопрос: «What did you like about the kettle?» Ответ: «asdf gh». Это не ответ на вопрос, а набор букв без смысла.',
    );
    expect(ru.panelToken).toBe('tok-r1');
  });

  it('duplicate lists the questions when the response is available and agrees Russian numerals', () => {
    const en = buildComplaint(block([dup3]), [dup3], { response })!;
    expect(en.text).toContain(
      'The same answer "nothing special" was given to 3 different open questions: "What annoyed you?", "What would you change?", "Anything else?"',
    );
    const ru = buildComplaint(block([dup3]), [dup3], { lang: 'ru' })!;
    expect(ru.text).toContain('дан на 3 разных открытых вопроса.');
    expect(pluralRu(5, 'вопрос', 'вопроса', 'вопросов')).toBe('вопросов');
    expect(pluralRu(21, 'вопрос', 'вопроса', 'вопросов')).toBe('вопрос');
    expect(times(2.5, 'ru')).toBe('в 2,5 раза');
    expect(times(7, 'ru')).toBe('в 7 раз');
    expect(times(3.4, 'en')).toBe('3 times');
  });

  it('template names the grid and the row count', () => {
    const en = buildComplaint(block([template]), [template], { response })!;
    expect(en.text).toBe(
      'In the rating grid "Rate these statements" the same rating is given in all 3 rows although the statements differ in meaning. The pattern repeats in 2 of 3 rating questions; the grids were filled without reading.',
    );
    const ru = buildComplaint(block([template]), [template], { lang: 'ru' })!;
    expect(ru.text).toContain('В табличных вопросах одна и та же оценка в каждой строке');
  });

  it('the only built-in profile is generic: no codes, no token requirement, 500 characters', () => {
    expect(PANEL_IDS).toEqual(['generic']);
    expect(PANELS.generic).toBe(GENERIC_PROFILE);
    expect(GENERIC_PROFILE).toMatchObject({ maxChars: 500, requiresToken: false, codes: {} });
    expect(resolvePanelProfile()).toBe(GENERIC_PROFILE);
    expect(resolvePanelProfile('generic')).toBe(GENERIC_PROFILE);
    expect(resolvePanelProfile('something-else')).toBe(GENERIC_PROFILE);
    expect(buildComplaint(block([speedFast]), [speedFast], { panel: 'generic' })!.code).toBe('');
  });

  it('a custom profile supplies the codes, the token requirement and the language', () => {
    const coded = parsePanelProfile({
      id: 'coded',
      name: 'Coded panel',
      requiresToken: true,
      codes: { nonsense_text: 1, template_pattern: '3', speed_whole_survey: 4 },
      language: 'ru',
    });
    expect(coded).toMatchObject({
      maxChars: 500,
      requiresToken: true,
      codes: { nonsense_text: '1', template_pattern: '3', speed_whole_survey: '4' },
      language: 'ru',
    });
    expect(coded.acceptedGrounds).toBeUndefined();
    expect(hasComplaintChannel(coded)).toBe(true);
    // Without a token the profile refuses the row.
    expect(buildComplaint(block([speedFast]), [speedFast], { panel: coded })).toBeNull();
    const c = buildComplaint(block([speedFast]), [speedFast], { panel: coded, response })!;
    expect(c.code).toBe('4');
    expect(c.panelToken).toBe('tok-r1');
    expect(c.text).toContain('Анкета пройдена за 48 с');
    expect(buildComplaint(block([template]), [template], { panel: coded, response })!.code).toBe(
      '3',
    );
    // A ground without a code gets an empty cell; --lang still wins over the profile.
    const dup = buildComplaint(block([dup3]), [dup3], { panel: coded, response, lang: 'en' })!;
    expect(dup.code).toBe('');
    expect(dup.text).toContain('The same answer');
  });

  it('acceptedGrounds narrows eligibility; an empty list means no complaint channel', () => {
    const narrow = parsePanelProfile({
      id: 'narrow',
      name: 'Speed only',
      acceptedGrounds: ['speed_whole_survey', 'speed_whole_survey'],
    });
    expect(narrow.acceptedGrounds).toEqual(['speed_whole_survey']);
    expect(selectGround(block([nonsense]), [nonsense], narrow)).toEqual({
      ground: null,
      reason: 'ground_not_accepted',
    });
    expect(buildComplaint(block([nonsense]), [nonsense], { panel: narrow })).toBeNull();
    expect(selectGround(block([speedFast]), [speedFast], narrow).ground).toBe('speed_whole_survey');

    const records = parsePanelProfile({ id: 'records', name: 'Records only', acceptedGrounds: [] });
    expect(hasComplaintChannel(records)).toBe(false);
    for (const evidence of [[nonsense], [dup3], [template], [speedFast]]) {
      expect(selectGround(block(evidence), evidence, records)).toEqual({
        ground: null,
        reason: 'ground_not_accepted',
      });
      expect(buildComplaint(block(evidence), evidence, { panel: records })).toBeNull();
    }
    // Without a profile the selection is unchanged.
    expect(selectGround(block([nonsense]), [nonsense]).ground).toBe('nonsense_text');
  });

  it('rejects a malformed profile with a message that names every problem', () => {
    expect(() => parsePanelProfile({ name: 'no id' })).toThrow(/invalid panel profile: id:/);
    expect(() =>
      parsePanelProfile({ id: 'x', name: 'x', codes: { bogus_ground: 1 }, maxChars: 0 }),
    ).toThrow(/maxChars/);
    expect(() => parsePanelProfile({ id: 'x', name: 'x', acceptedGround: [] })).toThrow(
      /acceptedGround/,
    );
    expect(() => parsePanelProfile({ id: 'x', name: 'x', language: 'de' })).toThrow(/language/);
    expect(() => parsePanelProfile('generic')).toThrow(/invalid panel profile/);
  });

  it('the shipped example profiles are valid', () => {
    const load = (f: string) =>
      parsePanelProfile(
        JSON.parse(
          readFileSync(new URL(`../../../adapters/panel-profiles/${f}`, import.meta.url), 'utf8'),
        ),
      );
    const coded = load('coded-api.example.json');
    expect(coded.requiresToken).toBe(true);
    expect(coded.codes).toEqual({
      nonsense_text: '1',
      duplicate_text: '1',
      template_pattern: '3',
      speed_whole_survey: '4',
    });
    const records = load('records-only.example.json');
    expect(records.acceptedGrounds).toEqual([]);
    expect(hasComplaintChannel(records)).toBe(false);
  });

  it('prefers the arbiter text when it fits, falls back to the template when it does not', () => {
    const short = buildComplaint(block([speedFast]), [speedFast], { panelText: '  Too   fast. ' })!;
    expect(short.text).toBe('Too fast.');
    const long = buildComplaint(block([speedFast]), [speedFast], { panelText: 'x'.repeat(600) })!;
    expect(long.text).toContain('Whole survey completed');
  });

  it('never exceeds the cap, shortening quotes first and cutting at a word last', () => {
    const longAnswer: Response = {
      id: 'r1',
      blocks: [
        { type: 'choice', question: 'Q0', answer: [], duration: 1 },
        {
          type: 'open',
          question: `${'very long question text '.repeat(20)}?`,
          answer: [{ role: 'user', text: 'blah '.repeat(300) }],
          duration: 1,
        },
      ],
    };
    const c = buildComplaint(block([nonsense]), [nonsense], { response: longAnswer })!;
    expect(c.chars).toBeLessThanOrEqual(500);
    expect(c.text).toContain('…');
    const tiny = buildComplaint(block([nonsense]), [nonsense], {
      response: longAnswer,
      maxChars: 80,
    })!;
    expect(tiny.chars).toBeLessThanOrEqual(80);
    expect(tiny.text.endsWith('…')).toBe(true);
    expect(capAtWord('one two three four five', 14)).toBe('one two three…');
    expect(capAtWord('short', 14)).toBe('short');
  });
});
