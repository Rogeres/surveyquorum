# Complaints to panels

After a respondent is blocked, the survey owner may file a complaint with the panel that
recruited them. `surveyquorum complaints` writes one text per blocked respondent, on one
ground, 500 characters or less:

```
surveyquorum complaints verdicts.json [--panel generic | --panel-profile profile.json]
                        [--lang en|ru] [--out complaints.csv] [--dataset dataset.json]
                        [--decisions decisions.json]
```

Output: CSV `response_id,panel_token,ground,code,text,chars` with eligible rows only, and a
stderr summary of why the other blocked respondents got no complaint. `--dataset` lets the
text quote questions verbatim and fills `panel_token` from `response.panel.token`. `--decisions`
takes the human decisions file (`{ "<responseId>": { "decision": "keep" | "block", "note" } }`,
or the short form `{ "<responseId>": "keep" | "block" }`) and applies it before eligibility:
`block` makes a `review` verdict eligible as if the engine had blocked it, `keep` excludes a
block; the summary says how many verdicts changed in each direction.

## What panels accept

Measured on 279 complaints filed over eight weeks in 2026 from the production system this port
is based on, to the one panel that offers a complaint API:

| ground | accepted |
|---|---|
| explicit nonsense in an open answer (gibberish, a dot, wrong language) | ~75% |
| the same rating down a whole grid (template) | ~91% |
| speed, stub answers in every open question (one-word templates), or "a combination of signals" | 36–48% |
| the same text on exactly two questions | ~31% |
| texts of 500 characters or less | ~80% |
| longer texts (the field truncates at 500 and the tail is lost) | ~50% |

Panels recognise **three grounds** and need exactly one per complaint: the whole survey done
far faster than the others (with both times), one non-informative open answer (quote question
and answer), or identical or template answers (list the questions or the grid). A mixed text
reads as "unclear what to check" and is refused. An abandoned prototype task, a mass-select,
a contradiction, a single fast block, a repeat on two questions are not grounds: such
verdicts stand for the client's data but are not filed.

The other source we worked with, a crowdsourcing marketplace, has no complaint channel at
all: nothing filed there was ever refunded, and the only use of the text is the client's own
records. Both situations are covered by profile files (below); the repository names neither.

## The one-ground rule, in code

`packages/core/src/complaint/complaint.ts` picks the single strongest eligible ground:

1. `nonsense_text` — open-answer `gibberish`, `fake`, `wrong_language`, `bad_language`
2. `duplicate_text` — duplicate-open `x3` (three or more questions)
3. `template_pattern` — matrix-pattern `straightline` / `straightline_fast`
4. `speed_whole_survey` — pace evidence with `totalSec` and `cohortMedianSec` and a ratio
   under 0.5 (the panel's own yardstick is the whole-survey time)

Otherwise the result is `null` with a reason (`speed_not_whole_survey`, `internal_only`,
`no_evidence`, `not_blocked`, or `ground_not_accepted` when the chosen profile leaves the
ground out). Texts are templates per ground and language with the numbers filled in ("Whole
survey completed in 48 s; cohort median 310 s"; «Анкета пройдена за 48 с при медиане других
участников 310 с»), never "a combination of weak signals". Quotes shrink before anything else;
the cap cuts at a word boundary. When the arbiter produced a `panelText` that fits, it is used
instead of the template.

## Panel profiles

The repository ships **one** built-in profile, `generic`: one ground per respondent, 500
characters or less, no reason codes, no token requirement. It is what `--panel generic` (the
default) selects, and the only value `--panel` accepts.

Everything specific to a panel is a JSON file passed with `--panel-profile`
(`packages/core/src/complaint/panels.ts` holds the schema; `adapters/panel-profiles/README.md`
explains it field by field):

```json
{
  "id": "my-panel",
  "name": "My panel",
  "maxChars": 500,
  "requiresToken": true,
  "codes": { "nonsense_text": 1, "duplicate_text": 1, "template_pattern": 3, "speed_whole_survey": 4 },
  "acceptedGrounds": ["nonsense_text", "duplicate_text", "template_pattern", "speed_whole_survey"],
  "note": "The API wants the respondent token, one numeric reason code and a comment of 500 characters or less.",
  "language": "en"
}
```

- `codes` fills the CSV `code` column; grounds without a code get an empty cell.
- `requiresToken: true` leaves out eligible rows whose response carries no `panel.token` and
  reports them as `skipped: profile requires a respondent token` — run with `--dataset`.
- `acceptedGrounds` narrows eligibility; a ground not listed is reported as `ground not
  accepted by this profile`. `acceptedGrounds: []` describes a panel with no complaint channel:
  every row is ineligible and the CLI says the file is for your own records.
- `language` is the default for `--lang`; `maxChars` defaults to 500.

Two example files ship under `adapters/panel-profiles/`: `coded-api.example.json` (a panel whose
complaint API wants the token and numeric reason codes; repeats fall under the nonsense code
because the panel has no separate one) and `records-only.example.json` (a marketplace with no
complaint channel). Name your own file after your panel and keep it outside this repository;
the repository ships no vendor-specific profile.

## Before filing

Run the arbiter first (`docs/arbiter.md`): in lenient mode about half of the engine's bans did
not survive a careful read; in the default strict mode fewer are lifted and each lifted ban names
the cause both judges agreed on. Every lifted ban is a complaint you do not have to defend. Check the
Russian texts if your panel reads Russian (`--lang ru`); numbers and quotes are the same.
