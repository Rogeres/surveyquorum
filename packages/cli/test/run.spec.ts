import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WEIGHTS, type SurveyResult } from 'surveyquorum';
import { afterAll, describe, expect, it } from 'vitest';
import { formatExplanation } from '../src/commands/explain.js';
import { parseRunArgs, readDatasetFile, runCommand } from '../src/commands/run.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-run-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const examples = fileURLToPath(new URL('../../../examples/', import.meta.url));
const demo = join(examples, 'demo-dataset.json');

function capture(): Io & { lines: { out: string[]; err: string[] } } {
  const lines = { out: [] as string[], err: [] as string[] };
  return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
}

describe('run command', () => {
  it('refuses a CSV and anything that is not JSON with a pointer to convert', () => {
    const io = capture();
    expect(readDatasetFile(join(examples, 'demo-answers.csv'), io)).toBeUndefined();
    expect(io.lines.err[0]).toMatch(/is a CSV.*surveyquorum convert/);
    const notJson = join(dir, 'export.txt');
    writeFileSync(notJson, 'survey_id,response_id\n');
    const io2 = capture();
    expect(readDatasetFile(notJson, io2)).toBeUndefined();
    expect(io2.lines.err[0]).toMatch(/not a dataset JSON.*convert/);
  });

  it('parses --weights and rejects a dangling flag', () => {
    const io = capture();
    expect(parseRunArgs(['d.json', '--weights', 'w.json'], io)?.weights).toBe('w.json');
    expect(parseRunArgs(['d.json'], io)?.weights).toBeUndefined();
    expect(parseRunArgs(['d.json', '--weights'], io)).toBeUndefined();
    expect(io.lines.err.at(-1)).toContain('--weights needs a file path');
  });

  it('runs the demo without an LLM, prints the design artifact per question, and explain shows it', async () => {
    const out = join(dir, 'verdicts.json');
    const io = capture();
    const code = await runCommand([demo, '--llm', 'none', '--out', out], io, undefined);
    expect(code).toBe(0);
    const summary = io.lines.out.find((l) => l.startsWith('demo-ux:'));
    expect(summary).toMatch(/^demo-ux: 100 respondents — block \d+, review \d+, keep \d+/);
    const artifact = io.lines.out.find((l) => l.startsWith('  design artifact:'));
    expect(artifact).toContain("prototype task 'Task 2:");
    expect(artifact).toContain('16 respondents (16% of the cohort) gave up with no clicks');
    expect(artifact).toContain('did not load');

    const results = JSON.parse(readFileSync(out, 'utf8')) as SurveyResult[];
    const ux = results.find((r) => r.surveyId === 'demo-ux')!;
    expect(ux.designArtifactSummary).toEqual([
      expect.objectContaining({
        detector: 'prototype-effort',
        signal: 'cohort_give_up_task',
        blockKey: 'ux-q07',
        respondents: 16,
        cohortShare: 0.16,
      }),
    ]);
    const withArtifact = ux.verdicts.find((v) => v.designArtifacts.length > 0)!;
    const text = formatExplanation(results, withArtifact.responseId)!;
    expect(text).toContain('design artifacts (1)');
    expect(text).toContain("survey-wide: prototype task 'Task 2:");
  });

  it('accepts --weights and reports the file; a malformed file is refused before the run', async () => {
    const weightsPath = join(dir, 'my-weights.json');
    writeFileSync(
      weightsPath,
      JSON.stringify({ ...DEFAULT_WEIGHTS, version: 'test-refit', provenance: 'unit test' }),
    );
    const out = join(dir, 'verdicts-w.json');
    const io = capture();
    const code = await runCommand(
      [demo, '--llm', 'none', '--weights', weightsPath, '--out', out],
      io,
      undefined,
    );
    expect(code).toBe(0);
    expect(io.lines.err[0]).toBe(`weights: test-refit from ${weightsPath}`);

    const bad = join(dir, 'bad-weights.json');
    writeFileSync(bad, JSON.stringify({ weights: {} }));
    const io2 = capture();
    expect(await runCommand([demo, '--llm', 'none', '--weights', bad], io2, undefined)).toBe(2);
    expect(io2.lines.err[0]).toContain('expected a weights file');
  });

  it('parses --arbiter-strictness, defaults to strict and rejects an unknown mode', () => {
    const io = capture();
    expect(parseRunArgs(['d.json', '--arbiter'], io)?.arbiterStrictness).toBe('strict');
    expect(
      parseRunArgs(['d.json', '--arbiter', '--arbiter-strictness', 'lenient'], io)
        ?.arbiterStrictness,
    ).toBe('lenient');
    expect(parseRunArgs(['d.json', '--arbiter-strictness', 'soft'], io)).toBeUndefined();
    expect(io.lines.err.at(-1)).toContain(
      '--arbiter-strictness must be strict, balanced or lenient',
    );
  });

  it('--arbiter without an LLM is refused, but a replay cache counts', async () => {
    const io = capture();
    expect(await runCommand([demo, '--llm', 'none', '--arbiter'], io, undefined)).toBe(2);
    expect(io.lines.err[0]).toContain('--arbiter needs an LLM');
    expect(io.lines.err[0]).toContain('--llm-cache');

    // An empty cache: every judgement is pending, nothing is refused, the counts are printed.
    const out = join(dir, 'verdicts-arb.json');
    const io2 = capture();
    const code = await runCommand(
      [demo, '--llm-cache', join(dir, 'empty-cache'), '--arbiter', '--out', out],
      io2,
      undefined,
    );
    expect(code).toBe(0);
    const line = io2.lines.out.find((l) => l.startsWith('demo-ux: arbiter'));
    expect(line).toMatch(/^demo-ux: arbiter \(strict\) — 0 confirmed, 0 overturned, 0 to a human/);
    expect(line).toMatch(/\d+ pending \(no judgement in the cache; verdicts unchanged\)/);
    const i = io2.lines.out.indexOf(line!);
    expect(io2.lines.out[i + 1]).toMatch(
      /^ {2}after arbiter: block \d+, to a person \d+, keep \d+$/,
    );
  });

  it('replaying the shipped arbiter cache: a confirmed review becomes a block, a hesitation goes to a person', async () => {
    const out = join(dir, 'verdicts-arb-demo.json');
    const io = capture();
    const code = await runCommand(
      [demo, '--llm-cache', join(examples, 'llm-cache'), '--arbiter', '--out', out],
      io,
      undefined,
    );
    expect(code).toBe(0);
    const arbiterLine = io.lines.out.find((l) => l.startsWith('demo-ux: arbiter (strict)'));
    expect(arbiterLine).not.toContain('pending');
    const after = io.lines.out[io.lines.out.indexOf(arbiterLine!) + 1];
    const results = JSON.parse(readFileSync(out, 'utf8')) as SurveyResult[];
    const ux = results.find((r) => r.surveyId === 'demo-ux')!;
    const by = (o: string) => ux.verdicts.filter((v) => v.outcome === o).length;
    expect(after).toBe(
      `  after arbiter: block ${by('block')}, to a person ${by('review')}, keep ${by('keep')}`,
    );
    const all = results.flatMap((r) => r.verdicts);
    const confirmedReview = all.filter(
      (v) => v.arbiter?.decision === 'confirm' && v.arbiter.originalOutcome === 'review',
    );
    expect(confirmedReview.length).toBeGreaterThan(0);
    expect(confirmedReview.every((v) => v.outcome === 'block')).toBe(true);
    const human = all.filter((v) => v.arbiter?.decision === 'needs_human');
    expect(human.every((v) => v.outcome === 'review')).toBe(true);
    // No pre-arbiter review verdict survives untouched: every one was confirmed, released or
    // handed to a person.
    expect(all.filter((v) => v.outcome === 'review' && !v.arbiter)).toHaveLength(0);
  });
});
