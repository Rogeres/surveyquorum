# Arbiter: a second opinion on verdicts

The arbiter is an optional LLM stage that re-reads every `block` (and, by default, `review`)
verdict after scoring and says whether the engine got it right. It never runs inside a
detector and never produces new evidence; it only moves outcomes.

```
surveyquorum run dataset.json --llm api --arbiter [--arbiter-strictness strict|balanced|lenient] [--lang en|ru]
surveyquorum run dataset.json --llm agent --arbiter                   # agent mode: cases land in judge-requests.jsonl
surveyquorum run dataset.json --llm-cache <dir> --arbiter             # replay recorded judgements only
```

Library: `arbitrate(survey, verdicts, evidence, llm, { strictness })` → `ArbiterDecision[]`,
then `applyArbiter(verdicts, decisions)`. Both live in `packages/core/src/arbiter/`.

## What the arbiter changes

The engine's `review` means "needs a second independent look". The arbiter is that look, so in
every strictness mode `applyArbiter` resolves each arbitrated verdict as:

| engine said | arbiter said | outcome | why |
|---|---|---|---|
| `review` | `confirm` | **`block`** | the quorum is reached: the engine's evidence plus an independent judge |
| `block` | `confirm` | `block` | unchanged |
| `block` or `review` | `overturn` | `keep` | a release needs a named cause, subject to the mode's gate below |
| `block` or `review` | `needs_human` | `review` | hesitation goes to a person |

After the arbiter, `review` therefore means exactly "a person must look"; before it, `review`
was a request for the look the arbiter has now given. The verdict keeps the pre-arbiter outcome
in `arbiter.originalOutcome`, so a `block` that began as a `review` is recognisable: its quorum
was completed by the judge, not by a second detector.

## Strictness

The engine exists to keep low-quality respondents out of the sample. The arbiter's job is to
catch the engine's mistakes when they have a clear cause — not to give the respondent the
benefit of the doubt. How much it may release is `--arbiter-strictness` (library:
`ArbitrateOptions.strictness`), and the default is **strict**.

| mode | judges | when an overturn stands | everything else |
|---|---|---|---|
| **strict** (default) | two, no tie-break | both say `overturn`, both with confidence ≥ 4, both naming the **same** cause | `confirm` only when both judges confirm; any other outcome → `needs_human` |
| balanced | two, blind tie-break on a split | the final decision is `overturn` with confidence ≥ 3 | a weaker overturn → `needs_human`; confirm and needs_human as decided |
| lenient | two, blind tie-break on a split | any `overturn` | as decided |

**Strict mode, exactly.** Decision table over the two judges:

- (a) both `confirm` → `confirm`; the respondent is blocked — an engine `block` stands, an engine
  `review` completes its quorum and becomes `block`.
- (b) both `overturn`, both confidence ≥ 4, the same `overturn_category` from the fixed list
  below → `overturn`; the verdict becomes `keep` and the cause is stored on it.
- (c) anything else — the judges split, one or both asked for a human, a unanimous overturn with
  confidence below 4, differing causes, or a cause of `none` → `needs_human`. The verdict becomes
  `review` with `arbiter.decision = "needs_human"` and a reason that starts with
  `arbiter unsure: <why>`, followed by both judges' reasons — regardless of whether the engine
  said `block` or `review`.

The core idea: **when the arbiter hesitates, a person looks.** An engine block is never silently
kept and never silently released; the arbiter's leniency turns into human review rather than
into a free pass. No tie-break call is made in strict mode, so a case costs exactly two calls.

The strict prompt adds a burden-of-proof section (`prompts/arbiter_strict_v1.txt`) to the shared
rubric: when two or more independent signals agree, the respondent is presumed low-quality and the
judge must point to a concrete fact in the answers to overturn; a single-signal case may be
overturned on the evidence alone; "the answer is short but could be genuine" is not a ground; and
every overturn must name its cause:

| `overturn_category` | meaning |
|---|---|
| `technical_failure` | the prototype or site did not load, a timer glitch, a device that did not render the task |
| `design_artifact` | the question itself caused the answer: no fitting option, an instruction screen, a grid of identical rows |
| `substantive_content` | the open answers are specific and on topic, so content evidence is wrong — only for evidence built on open answers |
| `short_branch` | a fast total time explained by skip logic: fewer questions seen, ordinary per-question times |
| `none` | not an overturn, or an overturn that fits no cause (which in strict mode does not stand) |

Every judge in every mode returns `overturn_category` (the schema requires it), so the field is
available for calibration in balanced and lenient mode too; only strict mode makes the verdict
depend on it.

**Why strict is the default for a public tool.** The production measurements below were made in
what is now lenient mode, and they say the arbiter is softer than people: it lifted 42 % of the
bans human reviewers kept. For a tool that anyone can run against their own panel, a default that
quietly releases four in ten of the respondents a human would have blocked is the wrong default.
Strict mode keeps the arbiter's real value — catching engine mistakes with a nameable cause,
writing the panel text, telling you which detector is broken — while routing its doubt to a
person instead of into the sample. Choose `balanced` when you have a human queue and want fewer
cases in it; choose `lenient` when you are reproducing the production measurements or would
rather lose junk than wrong an honest respondent.

`surveyquorum run` prints the mode and the hesitations, then the post-arbiter split:

```
demo-ux: arbiter (strict) — 18 confirmed, 1 overturned (categories: design_artifact 1), 2 to a human (2 because the arbiter hesitated)
  after arbiter: block 18, to a person 2, keep 80
```

## Mechanism

1. **The case.** The arbiter sees what a human reviewer would see: every block the respondent
   answered, with the time spent and the cohort median for that question, the declared
   screening profile, the recruiting target, the engine's outcome and score, and each piece
   of evidence with its numbers. Nothing is summarised away (`render.ts`).
2. **Two judges.** The same prompt (`prompts/arbiter_v2.txt` rubric — plus
   `arbiter_strict_v1.txt` in strict mode — and `arbiter_case_v1.txt`) is sent twice with role
   `arbiter` and different cache salts. Each judge returns `decision` (`confirm` / `overturn` /
   `needs_human`), `confidence` 1–5, a one-line `reason` for your reviewer, a `panel_text` in the
   requested language, `overturn_category`, and `per_signal`: for every evidence item, whether
   it supports bad faith. Aggregated over many cases, `per_signal` is the calibration signal
   that says which detector is broken. Strict-mode answers are cached under their own key;
   balanced and lenient share answers and differ only in how they are applied.
3. **Resolution.** Strict: the decision table above, two calls, no tie-break. Balanced and
   lenient: when the judges agree, that is the decision; when they disagree, a blind tie-breaker
   (`prompts/tiebreak_v1.txt`) sees both opinions anonymised, in an order fixed per response id
   but uncorrelated with which judge wrote which, and names the reading that survives — or
   `human`. It is not a third vote; it answers the easier question "which of these two is
   grounded in the facts". Balanced then sends an overturn below confidence 3 to a human.
4. **Apply.** `confirm` → outcome `block` (a `review` completes its quorum, a `block` stands);
   `overturn` → `keep`; `needs_human` → `review`, now meaning a person must look ("What the
   arbiter changes" above). The verdict carries `arbiter { decision, confidence, reason, tiebreak, originalOutcome,
   strictness, overturnCategory }` and `panelText`, which `surveyquorum complaints` prefers over
   its own template. On a `needs_human` the panel text of the confirming judge is kept, so a
   human who upholds the block has a complaint text ready.

Pending answers (agent-file mode) leave the verdict untouched; the CLI reports the count and
`surveyquorum resume` picks them up, with the strictness saved in `run-state.json`. Failed calls
are logged and also leave the verdict as is.

The same holds offline: with `--llm-cache <dir>` and no provider, the arbiter runs through the
replay cache and every case the cache does not hold is reported as pending
(`demo-ux: arbiter (strict) — 0 confirmed, 0 overturned, 0 to a human, 21 pending`), verdicts
unchanged. The shipped demo cache covers the detectors and every arbiter case of the demo (strict
mode), so the demo run reports 0 pending; on your own data the pending count is the measure of
what the cache does not hold yet. The rubric version is part of the cache key: `arbiter_v2`
added the required `overturn_category` field, so judgements recorded under `arbiter_v1` are not
reused.

## What the rubric does

The rubric asks for a judgement on substance — did the person fill the survey in bad faith —
relative to the engine's verdict, and lists nine measured weaknesses of cheap detectors it
must test for first: speed on thin cohorts, speed on one-click questions, off-topic calls on
questions that refer to an image the classifier never saw, very short answers to questions
that invite them, profanity with content, short natural repeats, foreign words that are not a
language switch, faults of the questionnaire, and piles of weak signals that are one event
counted several times. "Formally true but proves no bad faith" is an overturn by design in the
shared rubric; strict mode's burden-of-proof section narrows that to overturns with a concrete
fact and a named cause, and tells the judge to answer `needs_human` when it doubts without one.

## Measured context (be honest about this)

Numbers below come from the production system this port is based on, mid-2026, on
production bans, **in what is now lenient mode** — two judges, blind tie-break, any overturn
applied, no burden-of-proof section. They have not been re-measured on this repository's
detectors, and the strict and balanced modes have not been measured against humans at all.

- Against **120 human decisions** from one badly designed questionnaire: raw agreement 58%,
  Cohen's kappa 0.21. Against a **small cross-survey sample**, kappa 0.68–0.78 depending
  on the model; two strong judges agreed with each other at kappa 0.70–0.74.
- On **a few hundred bans reviewed independently by both** the human QA team and the arbiter (the same
  sample as `docs/numbers.md`), raw agreement was 66% and **the arbiter overturned 42% of the
  bans humans kept**. The lenient arbiter is softer than people: humans are stricter about text
  quality and softer about speed; the arbiter is the reverse. Treat a lenient `overturn` as
  "not provable from the data", not as "the respondent is fine". This gap is the reason strict
  is the default.
- The biggest blind spot is images: in about 40% of cases the question referred to a visual
  the arbiter cannot see; that is the main source of `needs_human`.
- A two-judge split sends 13–25% of cases to a human with 0–1 errors on the sample; a blind
  tie-break brings that down to about 5%. Strict mode forgoes the tie-break on purpose, so
  expect its human share to sit at the upper end of that range plus the weak and uncategorised
  overturns it refuses to apply. One judge alone is half the price and has no uncertainty
  detector.

## Cost

Two flagship-class calls per case, plus — in balanced and lenient mode — a tie-break on 10–25%
of cases: roughly 1 500 input and 400 output tokens each. At the prices in
`packages/core/src/llm/prices.json` (see `docs/models.md`) that is on the order of $0.03–0.07
per arbitrated verdict, so a survey with 50 blocked respondents costs a few dollars. Strict mode
is the cheapest of the three: exactly two calls per case. `run` prints an estimate before
spending; the file cache makes a re-run free.

## When to run it

- As the normal way to run whenever a model is configured: the engine's `review` verdicts are
  requests for exactly this second look, and without it every single-signal case waits for a
  person.
- Before filing complaints with a panel: every lifted ban is a complaint you do not have to
  defend, and the panel text it writes is already in the one-ground form panels accept. In strict
  mode every lifted ban also carries a cause both judges agreed on.
- When calibrating: `per_signal` tells you which detector's evidence does not survive a read, and
  the distribution of `overturn_category` tells you what kind of mistake the engine makes.
- Not as ground truth. For that you need human labels; the arbiter is a cheap reviewer whose
  doubt, in strict mode, is handed to you.
