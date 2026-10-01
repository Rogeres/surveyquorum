import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  convertCommand,
  detectPreset,
  FLAT_LONG_HEADER,
  formatReport,
  listPresets,
  loadPreset,
  PRESETS_DIR,
} from '../src/commands/convert.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-convert-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function capture(): Io & { out: string[]; err: string[] } & {
  lines: { out: string[]; err: string[] };
} {
  const lines = { out: [] as string[], err: [] as string[] };
  return {
    lines,
    out: Object.assign((l: string) => lines.out.push(l), [] as string[]),
    err: Object.assign((l: string) => lines.err.push(l), [] as string[]),
  } as unknown as Io & { out: string[]; err: string[]; lines: { out: string[]; err: string[] } };
}

describe('convert command', () => {
  it('resolves presets from the repository root', () => {
    expect(existsSync(PRESETS_DIR)).toBe(true);
    expect(listPresets()).toContain('flat-long');
    expect(listPresets()).toContain('pathway');
    expect(loadPreset('flat-long').layout).toBe('long');
    expect(() => loadPreset('nope')).toThrow(/unknown preset "nope".*flat-long/);
  });

  it('converts the flat-long sample with --preset and writes the dataset', () => {
    const io = capture();
    const out = join(dir, 'nested', 'dataset.json');
    const code = convertCommand(
      [join(PRESETS_DIR, 'flat-long.sample.csv'), '--preset', 'flat-long', '--out', out],
      io,
    );
    expect(code).toBe(0);
    const dataset = JSON.parse(readFileSync(out, 'utf8'));
    const expected = JSON.parse(readFileSync(join(PRESETS_DIR, 'flat-long.expected.json'), 'utf8'));
    expect(dataset).toEqual(expected.dataset);
    expect(io.lines.out).toEqual([`dataset written to ${out}`]);
    const report = io.lines.err.join('\n');
    expect(report).toContain('convert (flat-long): 19 rows read, 18 converted, 1 skipped');
    expect(report).toContain('skipped 1 row(s) — unreadable firstclick answer:');
    expect(report).toContain('no screening answers → coherence (screening-vs-body) unavailable');
  });

  it('accepts --mapping with a user file', () => {
    const csv = join(dir, 'export.csv');
    writeFileSync(csv, 'who,q,a\nr1,Why?,Because\n');
    const mapping = join(dir, 'mapping.json');
    writeFileSync(
      mapping,
      JSON.stringify({ layout: 'long', responseId: 'who', question: 'q', answer: 'a' }),
    );
    const io = capture();
    const out = join(dir, 'min.json');
    expect(convertCommand([csv, '--mapping', mapping, '--out', out], io)).toBe(0);
    expect(JSON.parse(readFileSync(out, 'utf8'))[0].responses[0].id).toBe('r1');
    expect(io.lines.err.join('\n')).toContain('no duration column → pace unavailable');
  });

  it('converts the Pathway sample with --preset pathway; the survey id is the file name', () => {
    const io = capture();
    const out = join(dir, 'pathway.json');
    const code = convertCommand(
      [join(PRESETS_DIR, 'pathway.sample.csv'), '--preset', 'pathway', '--out', out],
      io,
    );
    expect(code).toBe(0);
    const dataset = JSON.parse(readFileSync(out, 'utf8'));
    const expected = JSON.parse(readFileSync(join(PRESETS_DIR, 'pathway.expected.json'), 'utf8'));
    expect(dataset).toEqual(expected.dataset);
    expect(dataset[0].id).toBe('pathway.sample');
    const report = io.lines.err.join('\n');
    expect(report).toContain('convert (pathway): 13 rows read, 12 converted, 1 skipped');
    expect(report).toContain('skipped 1 row(s) — status "Screened out" is not completed:');
    expect(report).toContain('warning: prototype click counts are not present');
  });

  it('auto-detects a Pathway export when neither --preset nor --mapping is given', () => {
    const io = capture();
    const out = join(dir, 'auto.json');
    const code = convertCommand(
      [join(PRESETS_DIR, 'pathway.sample.csv'), '--survey-id', 'larkspur-q1', '--out', out],
      io,
    );
    expect(code).toBe(0);
    expect(io.lines.err[0]).toContain('detected a Pathway report export');
    expect(JSON.parse(readFileSync(out, 'utf8'))[0].id).toBe('larkspur-q1');
  });

  it('explains the three options and returns 2 when the header is not recognised', () => {
    const csv = join(dir, 'plain.csv');
    writeFileSync(csv, 'who,q,a\nr1,Why?,Because\n');
    const io = capture();
    expect(convertCommand([csv], io)).toBe(2);
    const text = io.lines.err.join('\n');
    expect(text).toMatch(/^convert: the header of .*plain.csv is not one this command recognises/);
    expect(text).toContain('(who, q, a)');
    expect(text).toContain('--preset <name>');
    expect(text).toContain('flat-long, pathway');
    expect(text).toContain('--mapping <file>');
    expect(text).toContain('adapters/README.md');
    expect(io.lines.out).toEqual([]);
  });

  it('auto-detects the flat-long header and says so', () => {
    const io = capture();
    const out = join(dir, 'auto-flat.json');
    const code = convertCommand([join(PRESETS_DIR, 'flat-long.sample.csv'), '--out', out], io);
    expect(code).toBe(0);
    expect(io.lines.err[0]).toBe(
      'detected the flat-long header (survey_id,response_id,block_id,question_type,question,answer,duration_sec); using --preset flat-long',
    );
    expect(detectPreset(['who', 'q', 'a'])).toBeUndefined();
    expect(detectPreset(FLAT_LONG_HEADER.split(','))).toBe('flat-long');
  });

  it('returns 2 and prints usage without an input file', () => {
    const io = capture();
    expect(convertCommand([], io)).toBe(2);
    expect(io.lines.err[0]).toContain('the first argument must be the CSV');
    expect(io.lines.err[1]).toMatch(/^surveyquorum convert/);
  });

  it('formats an empty report without crashing', () => {
    const text = formatReport({
      rowsRead: 0,
      rowsConverted: 0,
      rowsSkipped: 0,
      skipped: [],
      surveys: 0,
      responses: 0,
      blocks: 0,
      blocksByType: {},
      screeningAnswers: 0,
      hasDuration: false,
      warnings: [],
      detectorsAvailable: [],
      detectorsUnavailable: [],
    });
    expect(text).toContain('0 rows read');
    expect(text).toContain('detectors available: (none)');
  });
});
