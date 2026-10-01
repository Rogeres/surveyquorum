# Contributing an adapter preset

A preset lets everyone who exports from the same system run
`surveyquorum convert export.csv --preset <system>` without writing a mapping.
Three files, all under `adapters/presets/`, all named after the system in lower-case kebab-case:

| File                        | What it is |
|-----------------------------|------------|
| `<system>.json`             | the mapping (`adapters/README.md` §3). `name` must equal `<system>` |
| `<system>.sample.csv`       | an **invented** export: the real header, 20 data rows or fewer |
| `<system>.expected.json`    | the converter output for the sample: `{ "dataset": [...], "report": {...} }` |

CI (`packages/core/test/adapters-presets.spec.ts`) loads every preset, converts its sample and
deep-equals the expected file. A preset without a sample or an expected file fails the build.

One preset is implemented in code instead of a mapping: `pathway` (`presets/pathway.md`), whose
export spans a variable number of columns per question. It ships the same sample and expected
files and an explicit test case. Prefer a mapping whenever the layout allows one.

## Steps

1. Export a few rows from the system you are adding. Keep the **header verbatim** — that is the
   contract users rely on.
2. Replace every cell with invented content. No real answers, no real respondent ids, no
   panel or client names, no internal URLs; you are responsible for the rest. Keep the invented rows *shaped* like real ones: one quoted
   field with a comma, one escaped quote, one empty cell, one row that should be skipped.
3. Write `<system>.json`. Cover every column the system exports, even the ones the engine does
   not use yet (`device`, `fingerprint`, `panelToken`), so users get the full report.
4. Generate the expected file and read it:

   ```bash
   npm run surveyquorum -- convert adapters/presets/<system>.sample.csv \
     --preset <system> --out /tmp/<system>.json
   ```

   `convert` writes only the dataset. For the expected file (dataset + report), run this
   one-liner from the repository root:

   ```bash
   npx tsx -e "
   import { readFileSync, writeFileSync } from 'node:fs';
   import { convertCsv, parseMapping } from './packages/core/src/adapters/index.ts';
   const n = '<system>', d = 'adapters/presets/';
   const m = parseMapping(JSON.parse(readFileSync(d + n + '.json', 'utf8')));
   const out = convertCsv(readFileSync(d + n + '.sample.csv', 'utf8'), m);
   writeFileSync(d + n + '.expected.json', JSON.stringify(out, null, 2) + '\n');
   "
   ```

   Check that every block has the type you intended and that the report's skipped rows are the
   ones you planted on purpose.
5. `npm run check` must pass.
6. Open a pull request. Describe the system, where the export comes from in its UI, and which
   columns are missing compared with the contract (no per-question time, no types, …).

## When the converter changes

If a converter change alters the output for existing samples, regenerate every
`*.expected.json`, read the diff, and say in the commit message why the change is correct.
Expected files are regression tests, not fixtures to be overwritten blindly.

## What not to contribute

- A preset for a system you cannot export from yourself. We cannot verify it.
- A mapping whose sample is real data with ids replaced. Invent the whole sample.
- Behaviour changes to the converter disguised as a preset. Open an issue first.
