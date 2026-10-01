# Example: long export with a type column, no screening

## Input

`results.csv`, first four lines:

```
survey;respondent;qid;qtype;question_text;answer_text;seconds
w12;p-0001;s1;single;Which of these apps did you use last week?;Maps|Mail|Weather;11.4
w12;p-0001;s2;single;How old are you?;25-34;4.0
w12;p-0001;q1;text;What did you do last in the Weather app?;Checked the rain forecast before a hike;27.8
```

## Agent reasoning (shown briefly to the user)

Long layout: `question_text` holds question texts, one row per answer. Delimiter is `;`,
options inside a cell are separated by `|`. A type column exists (`qtype`), so no type
question. Seconds per question are present. Rows `s1`, `s2` look like a screener.

One question asked: "Are `s1`-`s2` the screening questions? Mapping them as screening enables
the coherence check between the declared profile and the body." User: yes, `s1` to `s3`.

## mapping.json

```json
{
  "name": "weekly-apps-long",
  "layout": "long",
  "delimiter": ";",
  "separator": "|",
  "surveyId": "survey",
  "responseId": "respondent",
  "blockId": "qid",
  "questionType": "qtype",
  "question": "question_text",
  "answer": "answer_text",
  "durationSec": "seconds",
  "screening": { "blockIds": ["s1", "s2", "s3"] },
  "target": { "const": "adults who used at least one weather app in the last week" }
}
```

## Command and report

```
$ surveyquorum convert results.csv --mapping mapping.json --out dataset.json
convert (weekly-apps-long): 4 812 rows read, 4 790 converted, 22 skipped
  1 survey(s), 312 response(s), 3 854 block(s) — choice 1 560, open 936, scale 936, matrix 312, other 110
  936 screening answer(s)
  duration: present
  skipped 22 row(s) — unknown question type "ranking" kept as other:
    line 88: qtype "ranking"
    … and 21 more
  warning: 110 block(s) of type "ranking" kept as other
  detectors available: pace, open-answer, duplicate-open, coherence, matrix-pattern, mass-select
  no prototype blocks → prototype-effort unavailable
  no firstclick blocks → firstclick-offtarget unavailable
  no website blocks → website-bounce unavailable
  no cardsort blocks → cardsort-consensus unavailable
dataset written to dataset.json
```

## Sanity checks

312 distinct `respondent` values in the file = 312 responses converted. Median `seconds`
value 9 - seconds, not milliseconds. 22 of 4 812 rows skipped (0.5%, all the `ranking`
type). Delimiter `;` as seen in step 1. Ids like `p-0001` are opaque panel ids - no hashing
needed.

## What the agent tells the user

- **Runs:** pace, open-answer, duplicate-open, coherence, matrix-pattern, mass-select on 312
  respondents, 3 854 / 3 854 blocks timed.
- **Does not run:** prototype-effort, firstclick-offtarget, website-bounce,
  cardsort-consensus - the survey has no such tasks - nothing to re-export; expected, not a
  loss.
- **Content:** three open questions per respondent; 0 respondents with no open answers.
  Content checks need an LLM (`--llm agent` or an API key in `quorum-screen`).

Also: three screening questions mapped, so coherence can compare the declared profile with
the body. The ranking question is kept as `other`: it counts toward time but is not analyzed.

Offer: save `weekly-apps-long` as a preset with an invented sample? Continue to screening?
