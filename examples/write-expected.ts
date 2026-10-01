/**
 * Regenerates `examples/expected-verdicts.json` from the demo dataset.
 *
 * The expected file is the regression baseline for `packages/core/test/demo-regression.spec.ts`.
 * LLM detectors run from the recorded answers in `examples/llm-cache/` (no network). Regenerate
 * only when a detector, a prompt or the weights changed on purpose, and say so in the commit
 * message. Run: `npx tsx examples/write-expected.ts`
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDataset, run } from '../packages/core/src/index.js';
import { cacheOnlyLlmClient, compactVerdicts } from './expected-format.js';

const here = new URL('.', import.meta.url);
const dataset = parseDataset(JSON.parse(readFileSync(new URL('demo-dataset.json', here), 'utf8')));
const llm = cacheOnlyLlmClient(fileURLToPath(new URL('llm-cache/', here)));
const results = await run(dataset, { minCohort: 30, llm });
const compact = compactVerdicts(results);
const outPath = fileURLToPath(new URL('expected-verdicts.json', here));
writeFileSync(outPath, `${JSON.stringify(compact, null, 2)}\n`);
// The repository formatter owns the layout of every JSON file, so apply it here too and the
// regenerated file is byte-identical to the committed one whenever the verdicts are unchanged.
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['biome', 'format', '--write', outPath],
  { stdio: 'inherit' },
);

let flagged = 0;
let total = 0;
for (const s of Object.values(compact)) {
  for (const v of Object.values(s)) {
    total++;
    if (v.outcome !== 'keep') flagged++;
  }
}
console.log(`expected-verdicts.json written: ${total} respondents, ${flagged} flagged`);
