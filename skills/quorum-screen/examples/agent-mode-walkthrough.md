# Example: agent-mode run on a 280-respondent dataset

## Input

> "Screen `data/kitchen-survey.json`, we have no API key."

The dataset came from `quorum-import`: one survey, 280 respondents, per-question durations,
three open questions, one 6-row matrix, two multi-selects, two screening questions mapped.

## Run

```
$ surveyquorum run data/kitchen-survey.json --llm agent --out .surveyquorum/verdicts.json
agent mode: up to 1 121 judgement requests (840 open answers, 280 respondent pair checks,
1 pair discoveries); answers already in .surveyquorum/llm-cache are reused.
kitchen-2026: 280 respondents — block 9, review 31, keep 240
verdicts written to .surveyquorum/verdicts.json
LLM cache: 0 hit(s), 0 new answer(s), 841 pending
────────────────────────────────────────────────────────────────────────
LLM judgements pending: 841
1. Read .surveyquorum/judge-requests.jsonl — one JSON object per line: {id, role, system?, prompt, schema}.
2. For each line, answer the prompt yourself. ...
3. Append one line per answer to .surveyquorum/judge-responses.jsonl: {"id": "<same id>", "json": <your answer>}.
4. Run `surveyquorum resume`. ...
────────────────────────────────────────────────────────────────────────
Verdicts above were computed WITHOUT the pending judgements; run `surveyquorum resume` after answering.
```

The agent tells the user: "841 judgements to produce (840 open answers + 1 pair discovery);
I will answer them in batches of 40, about 21 steps, then resume. The open answers are read
only by the model you are already talking to; nothing is sent to a second provider."

## Judging

A request line (abridged):

```json
{"id":"3f9c…","role":"classifier","prompt":"You are a survey data-quality expert. Classify ONE open-ended answer …\n\nQuestion: What did you cook most recently with the appliance?\nAnswer: pasta with the sauce from the jar, took 20 minutes because the pot is small\n…","schema":{"type":"object","required":["label","confidence","profanity","reason"],…}}
```

Response line appended:

```json
{"id":"3f9c…","json":{"label":"valid_high","confidence":5,"profanity":false,"reason":"Specific dish, time and a concrete observation about the pot size."}}
```

Another request: question "Was the manual helpful?", answer "yes". The prompt's guard says a
question that genuinely accepts a brief answer makes one word `valid_low`, not `fake`:

```json
{"id":"a71d…","json":{"label":"valid_low","confidence":4,"profanity":false,"reason":"One word, but the question invites yes/no."}}
```

## Resume (two rounds)

```
$ surveyquorum resume
resume: 841 judgement(s) accepted into .surveyquorum/llm-cache
open-answer: 2 (question, label) pattern(s) suppressed as design artifacts
kitchen-2026: 280 respondents — block 14, review 23, keep 243
verdicts written to .surveyquorum/verdicts.json
LLM cache: 841 hit(s), 0 new answer(s), 38 pending
LLM judgements pending: 38
…
```

The pair discovery produced 38 verification requests (coherence). Agent answers them, runs
`resume` again:

```
kitchen-2026: 280 respondents — block 15, review 21, keep 244
agent mode: every judgement was answered from the cache; verdicts are final.
```

## Summary presented

- 280 respondents: **15 block (5.4%)**, **21 review (7.5%)**, 244 keep. Block rate is above the
  2.25% prior and at the edge of the "far above 5%" heuristic - check the artifacts before
  trusting it.
- **Design artifacts:** question 7 "Why did you choose that color?" (asked after an image)
  draws `off_topic` from 12% of the cohort; question 11 "Any other comments?" draws `fake` from
  6%. Both are the questionnaire's fault; the affected evidence carries no weight. Suggest
  rewording these two blocks before the next wave.
- **No-content respondents:** 0 - every respondent answered at least one open question.
- **Skipped detectors:** none; coherence ran because screening was mapped.

## Walking the queue

```
$ surveyquorum explain .surveyquorum/verdicts.json k-0192
k-0192 (survey kitchen-2026): REVIEW
  estimated probability of junk 0.675 (log-odds 0.73) — block at ≥ 0.95, review at ≥ 0.2
  evidence (1):
  - pace.consistent [strong, weight +4.5]
      4 of 11 timed blocks at z ≤ −2; median z −1.9
      blocks: 2, 4, 5, 9
      stats: nScored=11, nFast2=4, nFast3=1, medZ=-1.9, totalSec=96, cohortMedianSec=310, ratio=0.31
```

Agent: "0.67 - about two-to-one odds of junk (a 2.25% prior at log-odds -3.77 plus the capped
+4.5 of one strong signal), and one signal only, which by design stops at review.

```
k-0192  p = 0.67 (review)
Evidence:   pace.consistent [strong] - 4 of 11 timed blocks at z <= -2; median z -1.9
Answers:    Q3 "What did you cook most recently with the appliance?" -> "pasta"
            Q7 "What would you change about it?"                    -> "ok"
            Q11 "Any other comments?"                                -> "no"
Fastest:    Q5 scale 1 s (cohort median 4 s); Q9 choice 2 s (cohort median 9 s)
```

k-0192 finished in 96 s against a 310 s median. Short answers but not nonsense, and none were
flagged. The matrix is not flat. My read: a speeder with minimal effort; the whole-survey time is
a verifiable ground for a complaint (96 s vs 310 s, ratio 0.31). Keep or block?" User: block.

`decisions.json`:

```json
{
  "k-0192": { "decision": "block", "note": "whole survey in 96 s vs 310 s median; three one-word answers" },
  "k-0047": { "decision": "keep",  "note": "fast on scales only; two detailed open answers about the appliance" }
}
```

Next: `panel-complaint` with the verdicts, the dataset and decisions.json (passed to the CLI
as `--decisions`).
