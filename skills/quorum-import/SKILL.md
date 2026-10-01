---
name: quorum-import
description: >-
  Turns any survey export (CSV/TSV, a spreadsheet saved as CSV) into the surveyquorum input
  contract; also imports from the Pathway API when a token is configured. Inspects the header
  and first rows, decides long vs wide, asks at most three questions, writes mapping.json, runs
  `surveyquorum convert`, reports which detectors the data enables and which it does not, and
  offers to save the mapping as a preset - use before quorum-screen whenever the data is not
  already a dataset.json.
when_to_use: >-
  Trigger phrases: "import this export", "convert my CSV for surveyquorum", "write a mapping",
  "which detectors will work on this data", "load survey results", "импортируй выгрузку",
  "сконвертируй CSV", "напиши маппинг", "подготовь данные для проверки", "загрузи результаты
  опроса".
arguments: [export]
argument-hint: "<export.csv | test-id>"
---

# Import an export into the contract

`surveyquorum` reads one JSON format - the input contract. Your job is to get a foreign export
(`$export`) into it with the least loss and to tell the user plainly which detectors the data
supports. The mapping format is documented field by field in
`${CLAUDE_SKILL_DIR}/reference.md`; read it once, then follow the steps below. Do not parse
the CSV yourself beyond looking at it - `convert` does the work and reports what it did.

The CLI runs as `npm run surveyquorum -- <cmd>` from a repository clone, or as
`surveyquorum <cmd>` when installed globally (`sq` is an alias). This skill writes the short
form.

## Step 0 - which route

| The user has | Route |
|---|---|
| A Pathway test id and `PATHWAY_API_TOKEN` | `surveyquorum import pathway --test <id> --out dataset.json` - no mapping, per-block durations, click counts, first-click coordinates, option lists. Default API origin is built in; `PATHWAY_API_URL` or `--base-url` overrides it. `--max-pages 1` for a quick look. |
| A Pathway report CSV | `surveyquorum convert report.csv --out dataset.json` - the header (`Answer ID` + `Completion time, s`) is recognized automatically, `--preset pathway` makes it explicit. Warn: the CSV has per-question time only for prototype, website and click tasks, no first-click coordinates, no screening answers. If per-question pace matters, ask for the API token instead. |
| Any other CSV/TSV | Steps 1-5 below. |
| XLSX | Ask the user to save it as CSV (UTF-8) first; the converter reads CSV only. |
| A dataset.json already | Nothing to import; go to `quorum-screen`. |

## Step 1 - look at the file

Print the header and the first three data rows (`head -4 file.csv`). Note the delimiter
(`,` `;` `\t`), the quoting, and whether one row is one respondent or one answer. Write the
delimiter and quoting down - the sanity checks in step 4 compare against them.

Decide the layout:

- **Long** - one row per (respondent, question); a column whose cells hold question texts.
- **Wide** - one row per respondent; questions are column names.

## Step 2 - ask at most three questions

Ask only what the header does not tell you, in one message:

1. **Time.** Is there a seconds (or milliseconds) column per question? If only a total time per
   respondent exists, say that per-question pace will not be available and leave duration
   unmapped - do not fake it.
2. **Screening.** Were the first N questions (or columns prefixed `S`, `Scr`, `Q0`) the
   screener? Mapping them to `screening` enables coherence between the declared profile and the
   body.
3. **Types.** Which questions are matrices, card sorts, prototype / first-click / website tasks?
   Everything else is `open`, `choice` or `scale` by inspection of the cells. Skip this question
   when a type column exists.

If the respondent id column cannot be found, stop and ask - nothing works without it.

## Privacy - before writing the mapping

`convert` and `import` run locally and send nothing anywhere, but the respondent id is copied
into every verdict, complaint and preset sample downstream. **If `responseId` looks like an
email, a phone number or a name, map it through a hash or a lookup table before `convert`**
(for example, add a column with `sha1(id)` in the spreadsheet, or keep a two-column
`id-map.csv` outside the project and point `responseId` at the hashed column). Never put a
real id into a preset sample. Say what you did in one line.

## Step 3 - write mapping.json

Follow `${CLAUDE_SKILL_DIR}/reference.md`, section "Mapping fields". Minimum: `layout`,
`responseId`, and for long `question` + `answer`, for wide the `questions` array with `column`
and `type`. Add every column you can identify: `blockId`, `questionType`, `durationSec` /
`durationMs`, `screening`, `device`, `fingerprint`, `panelToken`, `surveyId`; constants as
`{ "const": "..." }`, including `target` when the user described the audience. Set
`delimiter` for `;` or tab files. Write the file next to the export as `mapping.json`.

## Step 4 - convert and read the report

```bash
surveyquorum convert export.csv --mapping mapping.json --out dataset.json
```

The report is on stderr: rows read / converted / skipped (with line numbers and reasons),
blocks by type, screening answers, duration present or absent, warnings, then
`detectors available: ...` and one `<reason> -> <detectors> unavailable` line per gap. Exit code
1 means zero responses came out - the mapping is wrong, fix it before anything else.

**Sanity checks before handing over** (all four, every time):

1. Respondents converted = distinct ids in the file (`cut`/`awk` on the id column, or the
   spreadsheet's row count for a wide file). A mismatch means the id column or the layout is
   wrong - stop and fix.
2. Duration unit sniff: if the median per-block value is above 600, the column is probably
   milliseconds - ask, and switch to `durationMs`.
3. More than 5% of rows skipped -> fix the mapping; do not continue with a partial dataset.
4. Delimiter and quoting in the report match what you saw in step 1 (a `;` file read with `,`
   produces one column and a confident-looking failure).

Skipped rows deserve a look: a type column with an unknown value becomes `other` with a
warning; unreadable coordinates or durations are skipped per row. Fix the mapping, re-run.

## Step 4b - report to the user (fixed template)

Three bullets, always in this order, then the "unavailable" translations:

- **Runs:** `<detectors>` on `<N>` respondents, `<blocks timed / total>` blocks timed.
- **Does not run:** `<detector>` - `<reason in one clause>` - `<what to re-export or map>`.
  One bullet per unavailable detector group.
- **Content:** `<open blocks per respondent>`; `<k>` respondents with no open answers (they
  will carry `noContentToCheck` in `quorum-screen`; `survey-review` checks for this before field).

Translate every "unavailable" line into a sentence the user can act on, for example:

- "duration absent -> pace, prototype-effort, website-bounce unavailable: the export has no time
  per question. Pace is the strongest single signal; if the platform can export it, re-export."
- "no screening answers -> coherence (screening-vs-body) unavailable: mapping the first three
  questions as screening would enable it."
- "no open blocks -> open-answer, duplicate-open unavailable: content checks need an open
  question; the verdicts will cover effort only."

## Step 5 - offer two follow-ups

1. **Save as a preset.** If the export comes from a system others use, offer to turn the
   mapping into a preset: three files named after the system, with an **invented** sample
   (same header, 20 rows or fewer, no real cells). The recipe is in
   `${CLAUDE_SKILL_DIR}/reference.md`, section "Preset recipe". Then offer to open a pull
   request against `github.com/Rogeres/surveyquorum`; the user commits and signs - do not
   commit on their behalf.
2. **Continue to screening.** `quorum-screen` with the dataset you wrote.
