# Example: wide spreadsheet, no per-question time

## Input

`responses.csv` exported from a spreadsheet, first three lines:

```
ID,Age,Region,Q1 Which devices do you own,Q2 Rate the setup process,Q3 Describe the setup,Q4 Satisfaction grid,Total minutes
a1f3,35-44,North,"Phone, Laptop, Smart speaker",4,"Plugged it in, app found it in a minute, had to retype the wifi password twice",Speed=4;Clarity=4;Design=5;Price=3,9
b7c2,18-24,South,Phone,5,fine,Speed=5;Clarity=5;Design=5;Price=5,3
```

## Agent reasoning

Wide layout: questions are column names, one row per respondent. Comma delimiter, options
inside Q1 separated by `, `. No type column, no per-question time - only `Total minutes`.
`Q4` cells look like `row=value;row=value` - a matrix in the compact text form the converter
accepts.

Questions asked (two):

1. "There is only a total time per respondent. Per-question pace cannot be computed from it;
   I will leave duration unmapped. Does the tool export time per question anywhere?" User: no.
2. "Are `Age` and `Region` screening questions, and is `Q4` a matrix (rows Speed / Clarity /
   Design / Price)?" User: yes to both.

## mapping.json

```json
{
  "name": "device-setup-wide",
  "layout": "wide",
  "surveyId": { "const": "device-setup-2026" },
  "responseId": "ID",
  "questions": [
    { "column": "Age", "type": "choice", "blockId": "age", "screening": true },
    { "column": "Region", "type": "choice", "blockId": "region", "screening": true },
    { "column": "Q1 Which devices do you own", "question": "Which devices do you own?", "type": "multi", "blockId": "q1" },
    { "column": "Q2 Rate the setup process", "question": "Rate the setup process", "type": "scale", "blockId": "q2" },
    { "column": "Q3 Describe the setup", "question": "Describe how the setup went", "type": "open", "blockId": "q3" },
    { "column": "Q4 Satisfaction grid", "question": "How satisfied are you with…", "type": "matrix", "blockId": "q4" }
  ]
}
```

`Total minutes` is left out: the contract has no whole-survey time field, and inventing
per-question durations would corrupt pace.

## Report (abridged)

```
convert (device-setup-wide): 241 rows read, 241 converted, 0 skipped
  1 survey(s), 241 response(s), 964 block(s) — choice 241, scale 241, open 241, matrix 241
  482 screening answer(s)
  duration: absent (every block gets 0)
  detectors available: open-answer, duplicate-open, coherence, matrix-pattern, mass-select
  no durations → pace, prototype-effort, website-bounce unavailable
  …
```

## Sanity checks

241 rows = 241 distinct `ID` values = 241 responses converted. No duration column, so no unit
sniff. 0 rows skipped. Delimiter `,` as seen in step 1. Ids like `a1f3` are opaque - no
hashing needed (had the `ID` column held emails, a hashed column would have been added first).

## What the agent tells the user

- **Runs:** open-answer, duplicate-open, coherence, matrix-pattern, mass-select on 241
  respondents, 0 / 964 blocks timed.
- **Does not run:** pace, prototype-effort, website-bounce - the export has no time per
  question - re-export with per-question seconds if the survey tool offers it; pace is the
  strongest cheap signal.
- **Content:** one open question per respondent; 0 respondents with no open answers.

Also:

- The matrix has four rows - `matrix-pattern` judges matrices of at least four answered rows,
  so it will run, but with one matrix per respondent the straightlining signal needs company
  from other detectors to matter.
- `duplicate-open` needs at least two open questions to find a repeat; expect it to stay
  quiet.
- Whole-survey speed (`Total minutes`) is not carried into the dataset; a speed complaint to a
  panel will therefore not be possible from this data.

Offer: continue to `quorum-screen`; this export shape is probably specific to one spreadsheet,
so no preset is suggested.
