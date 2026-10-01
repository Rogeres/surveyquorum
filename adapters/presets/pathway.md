# pathway — the Pathway platform

Pathway is a survey and UX-research platform; the author's platform, and the only system with a
built-in importer today (other exports come in through `convert` with a mapping —
`adapters/README.md`). Two ways in, both built in: the **public API** (recommended) and the
**report export** (CSV). Both produce the same contract; the API carries much more of it.

## Import via API (recommended)

```bash
export PATHWAY_API_TOKEN=...            # from the platform: Settings → API → create token
export PATHWAY_API_URL=https://api.pthwy.ru   # default; override if your team uses another origin
surveyquorum import pathway --test <test-id> --out dataset.json
surveyquorum run dataset.json
```

`--token` and `--base-url` override the two variables; `--survey-id` renames the survey
(default: the test id); `--max-pages` stops after N pages of 100 responses, handy while trying
things out. Progress goes to stderr — one line per page, then the usual conversion report.
The importer is `packages/core/src/adapters/pathway-api.ts`; the CLI command is
`packages/cli/src/commands/import.ts`. The default API origin is `https://api.pthwy.ru` (the
platform's public API); set `PATHWAY_API_URL` or pass `--base-url` only if your team is served
from another origin.

### How it works

1. `GET /api/public/v1/tests/:id` — the questionnaire. Every block becomes an inventory item
   in survey order (question text with the HTML stripped, option lists where the block has
   them). Non-question blocks (`context`, `fiveseconds`, `shuffle`, `split`, `page`) are
   dropped.
2. `GET /api/public/v1/tests/:id/responses?limit=100&lastCreatedAt=…` — the answers, paged by
   creation time until the API says there is no next page. Requests are spaced to stay under
   the 100-per-minute limit; `429` and `5xx` answers are retried with backoff (`Retry-After`
   is honoured).
3. Responses whose `status` is `completed` or empty are converted; others (screened out, in
   progress, …) are counted in the report, grouped by status. The response id is the answer
   id. `device` is classified from the user agent (`mobile` / `tablet` / `desktop`),
   `panel.token` comes from the `token` URL parameter, `panel.age` / `panel.sex` from any
   URL parameter whose name contains `age` / `sex` (or `gender`). `survey.source` is the
   answer source when it is the same for every respondent.

### What the API adds over the CSV

| | CSV export | API |
|---|---|---|
| Per-question duration | Figma / Live website / Click only | every block (`duration` ms, else `completedAt − startedAt`) — `pace` sees the whole questionnaire |
| First-click coordinates | absent (`other`) | `firstclick` with normalized `top` / `left` — `firstclick-offtarget` runs |
| Prototype click count | `0` | summed from the Figma node events |
| Option lists | multi-choice only | single and multi choice, ranking |
| Matrix | row labels, no question text or columns | question text, row and column labels (ids are mapped through the test definition; unknown ids are kept as ids) |
| Card sort | card → category, no question text | question text, category names (falls back to the category id) |
| Block ids | synthesised `pw-<N>` | the platform's block ids, stable across edits of the questionnaire |
| Chat transcripts (`question`, `ai`) | parsed from `AI: …; User: …;` text | structured turns |

### What it still lacks

- **Screening answers.** The public API does not expose screening questions or the
  respondent's answers to them. `response.screening` stays empty and the screening-vs-body
  half of the coherence detector is unavailable; the report says so.
- **Recruiting target.** Not exposed either; `survey.target` stays empty.
- **Whole-survey completion time** is not a contract field; per-block durations sum to it.
- Blocks whose answer carries nothing usable (empty text, nothing selected, no click) are
  dropped and counted in a warning, as the CSV converter does. Prototype and website tasks
  are always kept, including gave-up ones.
- `agreement`, `preference`, `kanomodel`, `treetesting`, `maxdiff` become `other` with the raw
  answer attached; they count toward time and are not analysed further.

## Convert the report export (CSV)

A built-in preset: no `pathway.json` mapping exists because the export's layout cannot be
expressed as one (a single question spans a variable number of columns). The converter is
`packages/core/src/adapters/pathway-report.ts`; the rest of this page describes it.

```bash
surveyquorum convert report.csv --out dataset.json                      # auto-detected by header
surveyquorum convert report.csv --preset pathway --survey-id q1-2026     # explicit
surveyquorum run dataset.json
```

Files next to this page: `pathway.sample.csv` (an invented export, 12 completed respondents and
one screened-out row) and `pathway.expected.json` (what the converter must produce for it; CI
compares the two).

## How to export

In Pathway open the test, go to **Report → Export**, choose **CSV** (UTF-8, comma-separated).
XLSX is also offered; the converter reads CSV only — save the XLSX as CSV first if you have one.
One file is one test, so one file becomes one survey. The survey id is the file name without
its extension unless `--survey-id` says otherwise.

## What the export looks like

One row per respondent. Fixed leading columns, then one group of columns per question:

```
Answer ID, <URL tags…>, Device, Device OS, Browser, Window size, Source, Status, Reward,
Completion time, s, Answer Date, 1. Choice – …, 2. Choice – …: option, 3. Scale – …, …
```

- Every column between `Answer ID` and `Device` is a URL tag. `token`, `age` and `sex` go to
  `response.panel`; any other tag is dropped with a warning.
- Only rows whose `Status` is `Completed` are converted. Other statuses (screened out, in
  progress, …) are counted in the report, grouped by status.
- `Source` becomes `survey.source` when it is the same for every converted row.
- Block headers are `<N>. <Type> – <question>`; several columns can share one `N`. The
  converter uses `pw-<N>` as the block id — the export carries no question ids.

## Block types: what comes through, what is lost

| Export columns | Contract block | What is lost |
|---|---|---|
| `Choice – Q` + `Choice, other answers – Q` | `choice`, answer split on `;`; `Other` becomes `Other: <text>` when text exists | the option list (not exported for single choice) |
| `Choice – Q: <option>` (one column per option, `TRUE`/`FALSE`) | `choice` with `options` = all labels except `Other (text)`; answer = labels that are `TRUE` | nothing |
| `Scale – Q`, `NPS – Q` | `scale`, the value as text | the scale range |
| `Open question – Q` | `open`, one user turn | nothing |
| `Question – Q` | `open`; plain text → one user turn, `AI: …; User: …;` → turns | nothing |
| `AI – Q` (+ `AI – Q: tags` and similar siblings) | `open`, transcript parsed into turns; sibling tag columns ignored | the tags |
| `Matrix, <row>` (one column per row, columns joined by `;`) | `matrix`, question `Matrix N` | the question text and the column list |
| `Card sort, <card>` (one column per card, value = category) | `cardsort`, question `Card sort N`; empty = card not placed | the question text and the category list |
| `Figma, response time (ms)` / `final screen` / `status` | `prototype`: duration = ms/1000; `Gave up` → `gave_up`, `Succeeded` → `completed`, empty → `partial`; `clickCount: 0` | click count, final screen |
| `Live website, response time (ms)` / `result` | `website`: duration = ms/1000, `gaveUp` = result is `Gave up` | nothing |
| `Click, response time (ms)` | `other` with `sourceType: "firstclick"` and the duration | the click coordinates — `firstclick-offtarget` cannot run |
| `Ranking – Q: <option>` (rank numbers) | `other`, `sourceType: "ranking"`, `rawAnswer: { option: rank }` | not analysed |
| `Tree testing – Q: status` / `selected node`, `Kano model – …`, `MaxDiff – …`, `Preference - …` | `other` with the export's type name and the sibling cells as `rawAnswer` | not analysed |
| `Agreement` | skipped | — |
| `Device` | `response.device` | OS, browser and window size |
| `Reward`, `Answer Date`, `Completion time, s` | not in the contract | see below |

### Timing

The export has per-question time only for Figma, Live website and Click tasks. Every other
block gets `duration: 0` ("unknown"), so the `pace` detector sees only the task blocks; the
`prototype-effort` and `website-bounce` detectors work as usual. The respondent's total time
is in `Completion time, s`; the report quotes its median, but the contract has no field for a
whole-survey time and the value is not carried into the dataset.

If you need per-question pace, do not go through the CSV: produce the JSON contract directly
(`packages/core/src/contract/types.ts`) from the platform's data, where every block has its own
duration and every prototype task its click count.

### Screening

The export does not mark screening questions. Nothing goes to `response.screening`, so the
screening-vs-body half of the coherence detector is unavailable. If you know which blocks
were the screener, convert via the JSON contract instead.

## Report

Besides the usual counts, `convert` prints one warning per limitation that applies to the
file: missing per-question durations, missing click counts, missing first-click coordinates,
ignored AI tag columns, dropped URL tags, block types kept as `other`, and a differing
`Source`. Every "unavailable" detector line should match a row of the table above.
