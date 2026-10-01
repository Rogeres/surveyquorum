import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Dataset, parsePanelProfile, type SurveyResult } from 'surveyquorum';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applyDecisions,
  buildComplaints,
  CSV_HEADER,
  complaintsCommand,
  indexResponses,
  parseDecisions,
  toCsv,
} from '../src/commands/complaints.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-complaints-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const results: SurveyResult[] = [
  {
    surveyId: 's1',
    skippedDetectors: [],
    designArtifacts: [],
    verdicts: [
      {
        responseId: 'fast',
        outcome: 'block',
        score: 3.4,
        designArtifacts: [],
        evidence: [
          {
            responseId: 'fast',
            detector: 'pace',
            signal: 'consistent',
            strength: 'strong',
            summary: 'total 40 s vs cohort median 300 s',
            stats: { totalSec: 40, cohortMedianSec: 300 },
          },
          {
            responseId: 'fast',
            detector: 'mass-select',
            signal: 'nearly_all',
            strength: 'weak',
            summary: '',
          },
        ],
      },
      {
        responseId: 'quoted, "id"',
        outcome: 'block',
        score: 3,
        designArtifacts: [],
        evidence: [
          {
            responseId: 'quoted, "id"',
            detector: 'open-answer',
            signal: 'fake',
            strength: 'strong',
            summary: 'Answer "." to "Describe your morning, briefly" classified as fake: a dot.',
            blocks: [0],
          },
        ],
      },
      {
        responseId: 'outlier',
        outcome: 'block',
        score: 3,
        designArtifacts: [],
        evidence: [
          {
            responseId: 'outlier',
            detector: 'pace',
            signal: 'single_outlier',
            strength: 'weak',
            summary: '',
            stats: { totalSec: 250, cohortMedianSec: 300 },
          },
        ],
      },
      {
        responseId: 'internal',
        outcome: 'block',
        score: 3,
        designArtifacts: [],
        evidence: [
          {
            responseId: 'internal',
            detector: 'coherence',
            signal: 'contradiction',
            strength: 'strong',
            summary: '',
          },
        ],
      },
      { responseId: 'reviewed', outcome: 'review', score: 2, designArtifacts: [], evidence: [] },
      { responseId: 'fine', outcome: 'keep', score: 0, designArtifacts: [], evidence: [] },
    ],
  },
];

const dataset: Dataset = [
  {
    id: 's1',
    responses: [
      {
        id: 'quoted, "id"',
        panel: { token: 'tok-77' },
        blocks: [
          {
            type: 'open',
            question: 'Describe your morning, briefly',
            answer: [{ role: 'user', text: '.' }],
            duration: 1,
          },
        ],
      },
    ],
  },
];

describe('complaints', () => {
  it('builds only eligible rows and explains the rest', () => {
    const { rows, summary } = buildComplaints(results, { lang: 'en', panel: 'generic' });
    expect(rows.map((r) => r.responseId)).toEqual(['fast', 'quoted, "id"']);
    expect(rows[0].ground).toBe('speed_whole_survey');
    expect(rows[0].text).toContain('Whole survey completed in 40 s; cohort median 300 s');
    expect(rows[1].ground).toBe('nonsense_text');
    expect(summary).toEqual({
      eligible: 2,
      notEligible: {
        not_blocked: 1,
        no_evidence: 0,
        speed_not_whole_survey: 1,
        internal_only: 1,
        ground_not_accepted: 0,
      },
      fromArbiter: 0,
      skippedNoToken: [],
    });
  });

  it('writes CSV with the fixed header, quoting commas and quotes, and the dataset supplies tokens', () => {
    const { rows } = buildComplaints(results, {
      lang: 'ru',
      panel: 'generic',
      responses: indexResponses(dataset),
    });
    const csv = toCsv(rows);
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe(CSV_HEADER);
    expect(lines).toHaveLength(3);
    expect(lines[1].startsWith('fast,,speed_whole_survey,,')).toBe(true);
    expect(lines[1]).toContain('Анкета пройдена за 40 с');
    expect(lines[2].startsWith('"quoted, ""id""",tok-77,nonsense_text,,')).toBe(true);
    expect(lines[2]).toContain('Вопрос: «Describe your morning, briefly» Ответ: «.»');
  });

  it('the command reads verdicts, writes the file and prints a summary; rejects a bad panel', () => {
    const verdictsPath = join(dir, 'verdicts.json');
    const datasetPath = join(dir, 'dataset.json');
    const out = join(dir, 'out', 'complaints.csv');
    writeFileSync(verdictsPath, JSON.stringify(results));
    writeFileSync(datasetPath, JSON.stringify(dataset));
    const lines = { out: [] as string[], err: [] as string[] };
    const io: Io = { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
    expect(complaintsCommand([verdictsPath, '--out', out, '--dataset', datasetPath], io)).toBe(0);
    expect(readFileSync(out, 'utf8').split('\n')[0]).toBe(CSV_HEADER);
    expect(lines.out[0]).toBe(`2 complaint(s) written to ${out}`);
    expect(lines.err[0]).toContain(
      'complaints: 2 eligible; not eligible: 1 speed without whole-survey time, 1 internal-only grounds',
    );
    expect(complaintsCommand([verdictsPath, '--panel', 'nope'], io)).toBe(2);
    expect(lines.err.at(-1)).toContain('--panel-profile');
    expect(complaintsCommand([verdictsPath, '--lang', 'de'], io)).toBe(2);
    expect(complaintsCommand([], io)).toBe(2);
    expect(complaintsCommand(['--help'], io)).toBe(0);
    expect(lines.err.at(-1)).toContain('--panel accepts: generic');
    expect(lines.err.at(-1)).toContain('--panel-profile');
  });
});

describe('complaints --panel-profile', () => {
  const coded = {
    id: 'my-panel',
    name: 'My panel',
    requiresToken: true,
    codes: { nonsense_text: 1, duplicate_text: 1, template_pattern: 3, speed_whole_survey: 4 },
    note: 'Token, one numeric code, 500 characters.',
    language: 'ru',
  };

  it('fills the code column from the profile and skips rows without a token', () => {
    const { rows, summary } = buildComplaints(results, {
      panel: parsePanelProfile(coded),
      responses: indexResponses(dataset),
    });
    // "fast" has a ground but no token in the dataset; "quoted" has tok-77.
    expect(rows.map((r) => r.responseId)).toEqual(['quoted, "id"']);
    expect(rows[0].code).toBe('1');
    expect(rows[0].panelToken).toBe('tok-77');
    expect(rows[0].text).toContain('Вопрос:'); // the profile's language is the default
    expect(summary.skippedNoToken).toEqual(['fast']);
    expect(summary.eligible).toBe(1);
    expect(toCsv(rows)).toContain('"quoted, ""id""",tok-77,nonsense_text,1,');
    const en = buildComplaints(results, {
      lang: 'en',
      panel: parsePanelProfile(coded),
      responses: indexResponses(dataset),
    });
    expect(en.rows[0].text).toContain('Question:');
  });

  it('acceptedGrounds: [] makes every row ineligible with its own reason', () => {
    const records = parsePanelProfile({ id: 'records', name: 'Records only', acceptedGrounds: [] });
    const { rows, summary } = buildComplaints(results, { lang: 'en', panel: records });
    expect(rows).toEqual([]);
    expect(summary.eligible).toBe(0);
    expect(summary.notEligible.ground_not_accepted).toBe(2);
    expect(summary.notEligible.speed_not_whole_survey).toBe(1);
    expect(summary.notEligible.internal_only).toBe(1);
  });

  it('the command loads the file, reports skips and acceptance, and rejects an invalid one with exit 2', () => {
    const verdictsPath = join(dir, 'verdicts-profile.json');
    const datasetPath = join(dir, 'dataset-profile.json');
    const codedPath = join(dir, 'coded.json');
    const recordsPath = join(dir, 'records.json');
    const badPath = join(dir, 'bad-profile.json');
    const notJsonPath = join(dir, 'not-json.json');
    const out = join(dir, 'out', 'complaints-profile.csv');
    writeFileSync(verdictsPath, JSON.stringify(results));
    writeFileSync(datasetPath, JSON.stringify(dataset));
    writeFileSync(codedPath, JSON.stringify(coded));
    writeFileSync(
      recordsPath,
      JSON.stringify({
        id: 'records',
        name: 'Records only',
        acceptedGrounds: [],
        note: 'No channel.',
      }),
    );
    writeFileSync(badPath, JSON.stringify({ name: 'no id', codes: { nope: 1 }, maxChars: -1 }));
    writeFileSync(notJsonPath, '{ not json');
    const lines = { out: [] as string[], err: [] as string[] };
    const io: Io = { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };

    expect(
      complaintsCommand(
        [verdictsPath, '--out', out, '--dataset', datasetPath, '--panel-profile', codedPath],
        io,
      ),
    ).toBe(0);
    expect(lines.out.at(-1)).toBe(`1 complaint(s) written to ${out}`);
    const err = () => lines.err.join('\n');
    expect(err()).toContain(
      'skipped: profile requires a respondent token; 1 eligible row(s) without one: fast',
    );
    expect(err()).toContain('panel my-panel (My panel): Token, one numeric code, 500 characters.');
    expect(readFileSync(out, 'utf8')).toContain(',tok-77,nonsense_text,1,');

    lines.err.length = 0;
    expect(
      complaintsCommand([verdictsPath, '--out', out, '--panel-profile', recordsPath], io),
    ).toBe(0);
    expect(lines.err[0]).toContain('complaints: 0 eligible');
    expect(lines.err[0]).toContain('2 ground not accepted by this profile');
    expect(err()).toContain('no complaint channel');
    expect(readFileSync(out, 'utf8').trimEnd()).toBe(CSV_HEADER);

    lines.err.length = 0;
    expect(complaintsCommand([verdictsPath, '--out', out, '--panel-profile', badPath], io)).toBe(2);
    expect(lines.err[0]).toContain(`${badPath}: invalid panel profile: id:`);
    expect(lines.err[0]).toContain('maxChars');
    expect(lines.err[0]).toContain('codes.nope');
    expect(lines.err[1]).toContain('adapters/panel-profiles/README.md');

    lines.err.length = 0;
    expect(
      complaintsCommand([verdictsPath, '--out', out, '--panel-profile', notJsonPath], io),
    ).toBe(2);
    expect(lines.err[0]).toContain(`${notJsonPath}: cannot read panel profile`);
    expect(
      complaintsCommand(
        [verdictsPath, '--out', out, '--panel-profile', join(dir, 'missing.json')],
        io,
      ),
    ).toBe(2);
  });
});

describe('complaints --decisions', () => {
  /** A review verdict with a ground a panel accepts, so a human "block" makes it eligible. */
  const reviewedWithEvidence: SurveyResult = {
    ...results[0],
    verdicts: [
      ...results[0].verdicts,
      {
        responseId: 'slow-to-decide',
        outcome: 'review',
        score: 0.7,
        designArtifacts: [],
        evidence: [
          {
            responseId: 'slow-to-decide',
            detector: 'pace',
            signal: 'consistent',
            strength: 'strong',
            summary: 'total 60 s vs cohort median 300 s',
            stats: { totalSec: 60, cohortMedianSec: 300 },
          },
        ],
      },
    ],
  };

  it('parses the long and the short form and rejects anything else', () => {
    const d = parseDecisions({
      a: { decision: 'block', note: 'three pasted answers' },
      b: 'keep',
    });
    expect([...d.entries()]).toEqual([
      ['a', 'block'],
      ['b', 'keep'],
    ]);
    expect(() => parseDecisions({ a: { decision: 'maybe' } })).toThrow(
      '"a" must be "keep" or "block"',
    );
    expect(() => parseDecisions({ a: 'yes' })).toThrow('"a"');
    expect(() => parseDecisions([])).toThrow('expected an object');
  });

  it('block makes a review verdict eligible, keep excludes a block, the input is not mutated', () => {
    const decisions = parseDecisions({
      'slow-to-decide': 'block',
      fast: { decision: 'keep', note: 'fast on scales only' },
      reviewed: 'keep',
      ghost: 'block',
    });
    const { results: decided, applied } = applyDecisions([reviewedWithEvidence], decisions);
    expect(applied).toEqual({ toBlock: 1, toKeep: 2, unknown: ['ghost'] });
    expect(reviewedWithEvidence.verdicts.find((v) => v.responseId === 'fast')?.outcome).toBe(
      'block',
    );
    expect(
      reviewedWithEvidence.verdicts.find((v) => v.responseId === 'slow-to-decide')?.outcome,
    ).toBe('review');
    const { rows, summary } = buildComplaints(decided, { lang: 'en', panel: 'generic' });
    expect(rows.map((r) => r.responseId)).toEqual(['quoted, "id"', 'slow-to-decide']);
    expect(rows[1].ground).toBe('speed_whole_survey');
    expect(summary.eligible).toBe(2);
  });

  it('an undecided review verdict is never filed', () => {
    const { results: decided } = applyDecisions([reviewedWithEvidence], new Map());
    const { rows } = buildComplaints(decided, { lang: 'en', panel: 'generic' });
    expect(rows.map((r) => r.responseId)).not.toContain('slow-to-decide');
  });

  it('the command reads --decisions, reports both directions, and rejects a malformed file', () => {
    const verdictsPath = join(dir, 'verdicts-decisions.json');
    const decisionsPath = join(dir, 'decisions.json');
    const badPath = join(dir, 'decisions-bad.json');
    const out = join(dir, 'out', 'complaints-decided.csv');
    writeFileSync(verdictsPath, JSON.stringify([reviewedWithEvidence]));
    writeFileSync(
      decisionsPath,
      JSON.stringify({ 'slow-to-decide': { decision: 'block', note: 'confirmed' }, fast: 'keep' }),
    );
    writeFileSync(badPath, JSON.stringify({ fast: 'delete' }));
    const lines = { out: [] as string[], err: [] as string[] };
    const io: Io = { out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
    expect(complaintsCommand([verdictsPath, '--out', out, '--decisions', decisionsPath], io)).toBe(
      0,
    );
    expect(lines.err[0]).toBe(
      'decisions: 2 read; 1 changed to block (human confirmed), 1 changed to keep (human kept)',
    );
    expect(lines.out[0]).toBe(`2 complaint(s) written to ${out}`);
    const csv = readFileSync(out, 'utf8');
    expect(csv).toContain('slow-to-decide,,speed_whole_survey');
    expect(csv).not.toContain('\nfast,');
    expect(complaintsCommand([verdictsPath, '--out', out, '--decisions', badPath], io)).toBe(1);
    expect(lines.err.at(-1)).toContain('"fast" must be "keep" or "block"');
  });
});
