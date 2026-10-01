import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cacheOnlyLlmClient, compactVerdicts } from '../../../examples/expected-format.js';
import { parseDataset, run } from '../src/index.js';

const examples = new URL('../../../examples/', import.meta.url);

function loadDemo() {
  return parseDataset(JSON.parse(readFileSync(new URL('demo-dataset.json', examples), 'utf8')));
}

function llm() {
  return cacheOnlyLlmClient(fileURLToPath(new URL('llm-cache/', examples)));
}

function loadTruth(): Record<string, { persona: string }> {
  return JSON.parse(readFileSync(new URL('demo-ground-truth.json', examples), 'utf8'));
}

describe('demo dataset regression (statistical + LLM detectors from the recorded cache)', () => {
  it('reproduces examples/expected-verdicts.json exactly', async () => {
    const expected = JSON.parse(readFileSync(new URL('expected-verdicts.json', examples), 'utf8'));
    const actual = compactVerdicts(await run(loadDemo(), { minCohort: 30, llm: llm() }));
    expect(actual).toEqual(expected);
  });

  it('never blocks an honest persona, and sends at most 3% of honest respondents to review', async () => {
    const truth = loadTruth();
    const verdicts = (await run(loadDemo(), { minCohort: 30, llm: llm() })).flatMap(
      (r) => r.verdicts,
    );
    const honest = verdicts.filter((v) => truth[v.responseId].persona.startsWith('honest'));
    const blocked = honest.filter((v) => v.outcome === 'block').map((v) => v.responseId);
    const reviewed = honest.filter((v) => v.outcome === 'review');
    expect(blocked).toEqual([]);
    expect(reviewed.length / honest.length).toBeLessThanOrEqual(0.03);
  });

  it('flags at least 80% of planted offenders (block or review)', async () => {
    const truth = loadTruth();
    const verdicts = (await run(loadDemo(), { minCohort: 30, llm: llm() })).flatMap(
      (r) => r.verdicts,
    );
    const bad = verdicts.filter((v) => !truth[v.responseId].persona.startsWith('honest'));
    const flagged = bad.filter((v) => v.outcome !== 'keep');
    expect(flagged.length / bad.length).toBeGreaterThanOrEqual(0.8);
  });
});
