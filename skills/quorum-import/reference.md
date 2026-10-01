# quorum-import: reference

Self-contained copy of the mapping format and the preset recipe, so the skill works without a
repository clone. The authoritative definitions are `parseMapping` in the core package and the
adapters documentation in the repository (`adapters/README.md`, `adapters/CONTRIBUTING.md`);
when a field here and the CLI disagree, the CLI wins - its report names unknown fields.

## Contents

1. [Two layouts](#two-layouts)
2. [Mapping fields](#mapping-fields) - shared, long, wide
3. [Type names and answer formats](#type-names-and-answer-formats)
4. [What each column unlocks](#what-each-column-unlocks)
5. [Preset recipe](#preset-recipe)

## Two layouts

**Long** - one row per (respondent, question). Typical for panel and survey-tool exports:

```
survey_id,response_id,block_id,question_type,question,answer,duration_sec
demo-1,r-001,q1,choice,Which of these drinks do you buy at least monthly?,Tea;Coffee,14.2
demo-1,r-001,q2,scale,How satisfied are you with your usual brand?,4,6
```

**Wide** - one row per respondent, one column per question. Typical for spreadsheets:

```
Respondent,Age,Q1,Q1_sec,Q2,Q3,Q3_sec
a,25-34,"Mail, Maps",12,9,Love it,20
```

If the same question appears as a *column name*, it is wide; if there is a column whose *cells*
hold question texts, it is long.

## Mapping fields

Wherever a field says "column", write the exact header text. Where a constant is allowed,
write `{ "const": "..." }`.

### Shared fields (both layouts)

| Field | Type | Required | Default | Example / meaning |
|---|---|---|---|---|
| `layout` | `"long"` or `"wide"` | yes | - | `"long"` |
| `name` | string | no | - | free-form name; presets use the file name |
| `description` | string | no | - | free-form |
| `delimiter` | one character | no | `","` | `";"` for many European exports, `"\t"` for TSV |
| `separator` | string | no | auto | separator between selected options inside a choice cell; auto = `;` if the cell contains one, else `\|` |
| `responseId` | column | yes | - | `"respondent"` - groups rows into one respondent |
| `device` | column | no | - | `"desktop"`, `"mobile"`, ... |
| `fingerprint` | column | no | - | optional stable respondent key supplied by the source; not used by any detector in v0.1. If you fill it, make sure your legal basis covers linking a respondent's responses across surveys |
| `panelToken` | column | no | - | respondent id in the panel's system; fills `panel_token` in complaints |
| `target` | `{ const }` | no | - | who was supposed to answer, in words |
| `source` | `{ const }` | no | - | where respondents came from: a panel name, `"link"`, `"upload"` |

### Long layout

| Field | Type | Required | Default | Example / meaning |
|---|---|---|---|---|
| `surveyId` | column or `{ const }` | no | `{ "const": "survey" }` | survey the row belongs to |
| `blockId` | column | no | - | stable per-question id |
| `question` | column | yes | - | question text |
| `questionType` | column, `{ const }`, or `{ byQuestion, default }` | no | `{ "const": "open" }` | see below |
| `answer` | column | yes | - | the answer cell |
| `durationSec` | column | no | - | seconds on the question |
| `durationMs` | column | no | - | milliseconds on the question (alternative) |
| `screening` | `{ blockIds?, questions?, questionPrefixes? }` | no | - | which rows are screening questions |

`questionType` variants:

- **column** - the cell holds a type name. Matched case-insensitively; common synonyms are
  understood (`text` -> `open`, `single` -> `choice`, `multiple` -> `multi`, `rating` /
  `likert` -> `scale`, `grid` -> `matrix`, `figma` -> `prototype`). Anything else becomes
  `other` with the original name kept in `sourceType`, and the report lists it as a warning.
- **`{ "const": "scale" }`** - every row is the same type.
- **`{ "byQuestion": { "q2": "scale", "Which apps do you use?": "multi" }, "default": "open" }`**
  - look up by block id first, then by question text; fall back to `default`.

Rows matching the `screening` rule go to `response.screening` (declared profile) instead of
`response.blocks`; their answer is always a list of strings.

### Wide layout

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `surveyId` | `{ const }` | no | `{ "const": "survey" }` | one CSV = one survey |
| `questions` | array of question objects | yes (at least one) | - | see below |

Each question object:

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `column` | column | yes | - | cell holds the answer |
| `question` | string | no | the column name | question text shown to the respondent |
| `type` | type name | yes | - | see the type table |
| `blockId` | string | no | - | stable per-question id |
| `durationColumn` | column | no | - | seconds on this question |
| `durationMsColumn` | column | no | - | milliseconds (alternative) |
| `screening` | boolean | no | `false` | screening question -> `response.screening` |

An empty answer cell means "not reached / not shown": no block is produced for it. The
question list also becomes the survey inventory, so detectors can see questions a respondent
skipped.

## Type names and answer formats

| Type name | Contract type | Cell format accepted |
|---|---|---|
| `open` | `open` | free text -> one `user` turn. Empty text is kept (an empty answer is a signal) |
| `choice` | `choice` | options separated by `separator` (auto `;` / `\|`), or a JSON array |
| `multi` | `choice` | same as `choice`; the alias exists because many exports distinguish them |
| `scale` | `scale` | the value as text: `4`, `Strongly agree` |
| `matrix` | `matrix` | `row=value;row=v1\|v2` or compact JSON `{"row":["value"]}` |
| `cardsort` | `cardsort` | `category=card1\|card2;...` or `{"category":["card"]}` |
| `firstclick` | `firstclick` | `top,left` in 0-1 (values up to 100 are read as percent), or `{"top":..,"left":..}` |
| `prototype` | `prototype` | `status;clicks` with status `completed`, `gave_up` (also `gave up`, `abandoned`) or `partial`; clicks optional; or `{"status":..,"clickCount":..}` |
| `website` | `website` | did the respondent give up: `true`/`false`, `yes`/`no`, `1`/`0`, `gave_up`/`completed` |
| `other` | `other` | anything; kept as `rawAnswer`, counts toward total time, not analyzed |

Durations: a number; `1,5` is read as `1.5`; missing or unreadable -> `0` (unknown) with one
warning per file. A zero duration is "unknown", never "fast".

## What each column unlocks

| Column / field | Unlocks |
|---|---|
| question type (`questionType`, or `type` per question in wide layout) | the right parser per question: matrix-pattern, mass-select, cardsort-consensus, firstclick-offtarget, prototype-effort, website-bounce |
| seconds per question (`durationSec` / `durationMs`) | pace (per-question speed against the cohort); also required by prototype-effort and website-bounce |
| stable question id (`blockId`) | reliable grouping when question texts repeat or get edited |
| screening questions (`screening` rule, or `screening: true` per question) | coherence between the declared profile and body answers |
| recruiting target (`target`) | a reviewer can judge "does this respondent fit who we asked for" |
| device (`device`) | reported on the verdict; some speed norms differ by device |
| stable respondent key (`fingerprint`) | nothing in v0.1 - no detector reads it; stored only if the source supplies it and your legal basis covers linking responses across surveys |
| panel token (`panelToken`) | a ready-made id for the complaint sent to the panel |
| survey id (`surveyId`) | one CSV with several surveys -> cohort statistics per survey |

With only `responseId`, `question` and `answer` every answer is treated as open text and only
the duplicate-open and open-answer (LLM) detectors run.

## Preset recipe

A preset lets everyone who exports from the same system run
`surveyquorum convert export.csv --preset <system>` without writing a mapping. Three files,
all under `adapters/presets/` in the repository, all named after the system in lower-case
kebab-case:

| File | What it is |
|---|---|
| `<system>.json` | the mapping; `name` must equal `<system>` |
| `<system>.sample.csv` | an **invented** export: the real header, 20 data rows or fewer |
| `<system>.expected.json` | the converter output for the sample: `{ "dataset": [...], "report": {...} }` |

Steps:

1. Keep the **header verbatim** - that is the contract users rely on.
2. Replace every cell with invented content. No real answers, no real respondent ids, no
   panel or client names, no internal URLs. Keep the invented rows *shaped* like real ones: one
   quoted field with a comma, one escaped quote, one empty cell, one row that should be
   skipped.
3. Write `<system>.json`. Cover every column the system exports, even the ones the engine does
   not use yet (`device`, `fingerprint`, `panelToken`).
4. Generate the expected file from the repository root and read it:

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

   Check that every block has the type you intended and that the report's skipped rows are
   the ones planted on purpose.
5. `npm run check` must pass (the preset test loads every preset, converts its sample and
   deep-equals the expected file).
6. Open a pull request. Describe the system, where the export comes from in its UI, and which
   columns are missing compared with the contract. The user commits and signs.

Do not contribute: a preset for a system you cannot export from yourself; a mapping whose
sample is real data with ids replaced (invent the whole sample); converter changes disguised
as a preset.
