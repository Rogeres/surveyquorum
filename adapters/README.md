# Adapters — bringing your export into the input contract

`surveyquorum` reads one JSON format, the **input contract** (`packages/core/src/contract/types.ts`).
Nobody's export looks like it, so the `convert` command turns a CSV into the contract using a
small JSON file called a **mapping**:

```bash
surveyquorum convert export.csv --preset flat-long --out dataset.json
surveyquorum convert export.csv --mapping my-mapping.json --out dataset.json
surveyquorum run dataset.json
```

A preset is just a mapping somebody has already written and tested (`adapters/presets/`).
Two layouts are recognised by header alone, so `convert export.csv` with no flag works for them:
the flat-long layout below (`survey_id,response_id,block_id,question_type,question,answer,duration_sec`)
and the Pathway report export. For any other header `convert` stops and lists the three options.
`presets/<name>.expected.json` files are test fixtures of the shape `{dataset, report}`; `convert
--out` writes the bare dataset array, so do not diff the two directly (`CONTRIBUTING.md`).
This page explains the mapping format field by field so that a person — or an LLM reading the
CSV header — can write one without further help.

## Pathway

Pathway is a survey and UX-research platform (the author's; the only system with a built-in
importer today — `presets/pathway.md`). Its report export needs no mapping: its layout is fixed and one
question can span a variable number of columns, which a mapping cannot express. `convert`
recognises the header (`Answer ID` + `Completion time, s`) on its own:

```bash
surveyquorum convert report.csv --out dataset.json                  # auto-detected
surveyquorum convert report.csv --preset pathway --survey-id q1-2026 # explicit
```

`presets/pathway.md` says how to export, which block types come through, and what the CSV does
not contain (per-question time, click counts, first-click coordinates).

For full timing, click coordinates and option lists, import through the platform's public API
instead of the CSV — no mapping either, and the same report:

```bash
export PATHWAY_API_TOKEN=...          # from the platform's API settings; the API origin has a built-in default
# export PATHWAY_API_URL=https://...  # only if your team is served from another origin
surveyquorum import pathway --test <test-id> --out dataset.json
```

Screening answers and the recruiting target are not available through the API either; see
"Import via API" in `presets/pathway.md`.

## 1. What the engine needs to know

For every answer the engine wants to know **who** answered (a respondent id), **which question**
it was, **what kind** of question (open text, choice, matrix, …), **what the answer was**, and
ideally **how long** it took. Everything else is optional and unlocks one more check each.

### Minimum viable data

| Column        | Mapping field | Why                                                    |
|---------------|---------------|--------------------------------------------------------|
| respondent id | `responseId`  | groups rows into one respondent                        |
| question text | `question`    | shows reviewers what was asked; keys cohort statistics |
| answer        | `answer`      | the thing being checked                                |

With only these three columns every answer is treated as open text and the duplicate-open and
open-answer (LLM) detectors run. That is a legitimate start, but see §5 for what you lose.

### What each extra column unlocks

| Column / field                                     | Unlocks                                                                        |
|----------------------------------------------------|--------------------------------------------------------------------------------|
| question type (`questionType`, or `type` per question in wide layout) | the right parser per question: matrix-pattern, mass-select, cardsort-consensus, firstclick-offtarget, prototype-effort, website-bounce |
| seconds per question (`durationSec` / `durationMs`) | pace (per-question speed against the cohort); also required by prototype-effort and website-bounce |
| stable question id (`blockId`)                      | reliable grouping when question texts repeat or get edited                     |
| screening questions (`screening` rule, or `screening: true` per question) | coherence between the declared profile and body answers                        |
| recruiting target (`target`)                        | a reviewer can judge "does this respondent fit who we asked for"               |
| device (`device`)                                   | reported on the verdict; some speed norms differ by device                     |
| cross-survey key (`fingerprint`)                    | repeat offenders across surveys                                                |
| panel token (`panelToken`)                          | a ready-made id for the complaint sent to the panel                            |
| survey id (`surveyId`)                              | one CSV with several surveys → cohort statistics per survey                    |

## 2. Two layouts

**Long** — one row per (respondent, question). Typical for panel and survey-tool exports:

```
survey_id,response_id,block_id,question_type,question,answer,duration_sec
demo-1,r-001,q1,choice,Which of these drinks do you buy at least monthly?,Tea;Coffee,14.2
demo-1,r-001,q2,scale,How satisfied are you with your usual brand?,4,6
```

**Wide** — one row per respondent, one column per question. Typical for spreadsheets:

```
Respondent,Age,Q1,Q1_sec,Q2,Q3,Q3_sec
a,25-34,"Mail, Maps",12,9,Love it,20
```

Pick the layout by looking at the header: if the same question appears as a *column name*, it is
wide; if there is a column whose *cells* hold question texts, it is long.

## 3. Mapping fields

Wherever a field says "column", write the exact header text. Where a constant is allowed,
write `{ "const": "..." }`.

### 3.1 Shared fields (both layouts)

| Field         | Type                 | Default | Meaning |
|---------------|----------------------|---------|---------|
| `layout`      | `"long"` \| `"wide"` | —       | required |
| `name`        | string               | —       | free-form name; presets use the file name |
| `description` | string               | —       | free-form |
| `delimiter`   | one character        | `","`   | CSV field delimiter; `";"` for many European exports, `"\t"` for TSV |
| `separator`   | string               | auto    | separator between selected options inside a choice cell. Auto = `;` if the cell contains one, else `\|` |
| `responseId`  | column               | —       | required |
| `device`      | column               | —       | `"desktop"`, `"mobile"`, … |
| `fingerprint` | column               | —       | cross-survey respondent key |
| `panelToken`  | column               | —       | respondent id in the panel's system |
| `target`      | `{ const }`          | —       | who was supposed to answer, in words |
| `source`      | `{ const }`          | —       | where respondents came from: a panel name, `"link"`, `"upload"` |

### 3.2 Long layout

| Field          | Type | Default | Meaning |
|----------------|------|---------|---------|
| `surveyId`     | column or `{ const }` | `{ "const": "survey" }` | survey the row belongs to |
| `blockId`      | column | — | stable per-question id |
| `question`     | column | — | required; question text |
| `questionType` | column, `{ const }`, or `{ byQuestion, default }` | `{ "const": "open" }` | see below |
| `answer`       | column | — | required |
| `durationSec`  | column | — | seconds on the question |
| `durationMs`   | column | — | milliseconds on the question (alternative) |
| `screening`    | `{ blockIds?, questions?, questionPrefixes? }` | — | which rows are screening questions |

`questionType` variants:

- **column** — the cell holds a type name. Matched case-insensitively; common synonyms are
  understood (`text`→`open`, `single`→`choice`, `multiple`→`multi`, `rating`/`likert`→`scale`,
  `grid`→`matrix`, `figma`→`prototype`). Anything else becomes `other` with the original name
  kept in `sourceType`, and the report lists it as a warning.
- **`{ "const": "scale" }`** — every row is the same type.
- **`{ "byQuestion": { "q2": "scale", "Which apps do you use?": "multi" }, "default": "open" }`**
  — look up by block id first, then by question text; fall back to `default`.

Rows matching the `screening` rule go to `response.screening` (declared profile) instead of
`response.blocks`; their answer is always a list of strings.

### 3.3 Wide layout

| Field       | Type | Default | Meaning |
|-------------|------|---------|---------|
| `surveyId`  | `{ const }` | `{ "const": "survey" }` | one CSV = one survey |
| `questions` | array of question objects | — | required, at least one |

Each question object:

| Field              | Type | Default | Meaning |
|--------------------|------|---------|---------|
| `column`           | column | — | required; cell holds the answer |
| `question`         | string | the column name | question text shown to the respondent |
| `type`             | type name | — | required |
| `blockId`          | string | — | stable per-question id |
| `durationColumn`   | column | — | seconds on this question |
| `durationMsColumn` | column | — | milliseconds (alternative) |
| `screening`        | boolean | `false` | screening question → `response.screening` |

An empty answer cell means "not reached / not shown": no block is produced for it. The
question list also becomes the survey `inventory`, so detectors can see questions a
respondent skipped.

## 4. Type names and answer formats

| Type name    | Contract type | Cell format accepted |
|--------------|---------------|----------------------|
| `open`       | `open`        | free text → one `user` turn. Empty text is kept (an empty answer is a signal) |
| `choice`     | `choice`      | options separated by `separator` (auto `;` / `\|`), or a JSON array |
| `multi`      | `choice`      | same as `choice`; the alias exists because many exports distinguish them |
| `scale`      | `scale`       | the value as text: `4`, `Strongly agree` |
| `matrix`     | `matrix`      | `row=value;row=v1\|v2` or compact JSON `{"row":["value"]}` |
| `cardsort`   | `cardsort`    | same two forms: `category=card1\|card2;…` or `{"category":["card"]}` |
| `firstclick` | `firstclick`  | `top,left` in 0–1 (values up to 100 are read as percent), or `{"top":..,"left":..}` |
| `prototype`  | `prototype`   | `status;clicks` with status `completed`, `gave_up` (also `gave up`, `abandoned`) or `partial`; clicks optional; or `{"status":..,"clickCount":..}` |
| `website`    | `website`     | did the respondent give up: `true`/`false`, `yes`/`no`, `1`/`0`, `gave_up`/`completed` |
| `other`      | `other`       | anything; kept as `rawAnswer`, counts toward total time, not analysed |

Durations: a number; `1,5` is read as `1.5`; missing or unreadable → `0` (unknown) with one
warning per file.

## 5. Worked example: long CSV header → mapping.json

Header you were given:

```
survey_id,response_id,block_id,question_type,question,answer,duration_sec
```

Reasoning: a column whose cells hold question texts → long layout. Types are in a column.
Time is in seconds. No screening columns, so coherence between profile and body cannot run.

```json
{
  "name": "flat-long",
  "layout": "long",
  "surveyId": "survey_id",
  "responseId": "response_id",
  "blockId": "block_id",
  "questionType": "question_type",
  "question": "question",
  "answer": "answer",
  "durationSec": "duration_sec"
}
```

If the first three questions were a screener, add `"screening": { "blockIds": ["q1", "q2", "q3"] }`.
If the export had no type column, add
`"questionType": { "byQuestion": { "q3": "matrix", "q5": "firstclick" }, "default": "open" }`.

Run it:

```bash
surveyquorum convert export.csv --mapping mapping.json --out dataset.json
```

The report on stderr says how many rows were read, converted and skipped (with line numbers
and reasons), how many blocks of each type came out, and which detectors are available:

```
convert (flat-long): 19 rows read, 18 converted, 1 skipped
  1 survey(s), 3 response(s), 18 block(s) — choice 3, open 3, …
  duration: present
  skipped 1 row(s) — unreadable firstclick answer:
    line 20: firstclick coordinates "not sure" are not numbers
  detectors available: pace, open-answer, duplicate-open, matrix-pattern, …
  no screening answers → coherence (screening-vs-body) unavailable
```

## 6. Checklist for an LLM writing a mapping

1. Read the header and three rows. Decide long vs wide (§2).
2. Find the respondent id column. If none exists, stop and ask.
3. Long: find the question text column and the answer column. Wide: list every question column.
4. Find the type information. If absent, ask which questions are matrices / card sorts / tasks;
   everything else is `open`, `choice` or `scale` by inspection of the cells.
5. Find time per question. If only a total time per respondent exists, there is no per-question
   pace: leave duration unmapped and say so.
6. Find screening questions (usually the first few, or prefixed `S1`, `Scr`, `Q0`).
7. Write the mapping, run `convert`, read the report. Every "unavailable" line should be a
   conscious decision, not a surprise.
8. Offer to save the mapping as a preset (`adapters/CONTRIBUTING.md`).

## 7. Privacy

`convert` runs locally and sends nothing anywhere. The respondent id is whatever your export
contains; if it is personal, replace it before sharing a dataset or a preset sample.
