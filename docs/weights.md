# Weights: how a verdict is computed

Detectors never decide. Each one emits evidence — `detector.signal` with a strength — and
`packages/core/src/quorum/score.ts` turns the evidence about a respondent into `block`,
`review` or `keep`. This page explains the arithmetic and the numbers shipped as v1.

## The formula

Every signal carries a **log-likelihood ratio** (LLR): how much more often the signal is seen on
junk respondents than on honest ones.

```
LLR(signal) = ln( P(signal | junk) / P(signal | honest) )

score       = logit(prior) + Σ LLR(signal)        one term per distinct detector.signal
probability = sigmoid(score)                        posterior P(junk | evidence)

block   when probability ≥ 0.95
review  when probability ≥ 0.20
keep    otherwise
```

`prior` is the base rate of confirmed junk among all respondents — 2.25 % in the production data
behind v1 (`logit(0.0225) ≈ −3.77`). Positive evidence (a respondent who writes rich, specific
open answers) has a negative LLR and pulls the probability down.

The probability is an **estimate**: it assumes the signals are independent (naive Bayes), and
correlated signals make it optimistic. The empirical reference is the measured precision ladder by
number of agreeing signals — 1 → 23 %, 2 → 55 %, 3 → 80 %, 4+ → 91 % (`docs/numbers.md`) — and the
thresholds are chosen so that a `block` corresponds to the top of that ladder. The refit tool
reports the observed ladder on your data, so you can see how far it departs from the estimate.

In the verdict you get both numbers: `score` (log-odds) and `probability` (0–1, rounded to three
decimals). The probability is the one to show a reviewer.

## Why one signal never blocks

Every LLR is capped at ±4.5. With a prior of 2.25 % the strongest possible single signal reaches
a posterior of `sigmoid(−3.77 + 4.5) ≈ 0.67` — inside `review`, below `block`. Two agreeing
signals of ordinary strength (≈ +3.4 each) reach ≈ 0.95 and block; three or more land above 0.99.
That is the quorum principle written as arithmetic: a lone signal asks for a second look, a
consensus decides. The converse also holds: alone, a signal lands exactly at its measured
precision. With the review threshold at 0.20 almost every v1 signal alone produces `review` —
including `open-answer.gibberish` (0.24) and `bad_language` (0.28), which clear the threshold
narrowly and so ask for a second look on their own. Only the two signals measured near the base
rate, `pace.whole_survey_fast` (0.05) and `open-answer.off_topic` (0.04), stay `keep` until a
second signal joins them. The test `packages/core/test/weights-ladder.spec.ts` checks these
ladder steps against the shipped weights and fails if a refit breaks them.

## v1 weights (`packages/core/src/quorum/weights.json`, v1.1.0)

Derived from arbiter-confirmed production bans, July–September 2026, with a few hundred cases
double-reviewed by humans. v1.1.0 adds `matrix-pattern.straightline_full` (assumed) and widens
the `heavy_pattern` / `random_sort` routes so that a pattern spanning the whole survey — the
long-string / insufficient-effort index of Curran 2016 and Meade & Craig 2012 — counts as strong
evidence on its own; the LLRs of the existing signals are unchanged. Each LLR is `logit(precision) − logit(0.0225)`, capped at ±4.5, where
*precision* is the share of confirmed junk among the respondents the signal selected.
**Measured** numbers come from that data; **assumed** numbers are placeholders for signals that
had no production measurement yet — treat them as opinions until you refit.

| signal | precision | LLR | status |
| --- | --- | --- | --- |
| pace.consistent | 0.80 | +4.500 (capped from 5.16) | measured |
| duplicate-open.x3 | 0.55 | +3.972 | measured |
| cardsort-consensus.random_sort | 0.50 | +3.771 | assumed |
| firstclick-offtarget.same_spot | 0.50 | +3.771 | assumed |
| matrix-pattern.straightline_full | 0.50 | +3.771 | assumed (whole-survey long-string index; to be measured) |
| pace.single_outlier | 0.45 | +3.571 | measured |
| coherence.contradiction | 0.45 | +3.571 | measured |
| matrix-pattern.straightline_fast | 0.45 | +3.571 | measured |
| open-answer.fake | 0.42 | +3.449 | measured |
| prototype-effort.instant_give_up | 0.35 | +3.152 | measured |
| website-bounce.repeated_bounce | 0.35 | +3.152 | assumed |
| mass-select.heavy_pattern | 0.35 | +3.152 | assumed |
| duplicate-open.x2 | 0.30 | +2.924 | measured |
| open-answer.wrong_language | 0.30 | +2.924 | measured |
| pace.fast_cluster | 0.29 | +2.876 | measured |
| open-answer.bad_language | 0.28 | +2.827 | measured (pre-semantics change; expected higher) |
| prototype-effort.low_effort | 0.25 | +2.673 | measured |
| open-answer.gibberish | 0.24 | +2.619 | measured |
| coherence.possible_contradiction | 0.23 | +2.563 | measured |
| duplicate-open.empty_repeat | 0.20 | +2.385 | measured |
| cardsort-consensus.low_consensus | 0.20 | +2.385 | assumed |
| prototype-effort.zero_click_give_up | 0.19 | +2.321 | measured |
| website-bounce.bounce | 0.15 | +2.037 | assumed |
| cardsort-consensus.single_pile | 0.15 | +2.037 | measured |
| firstclick-offtarget.repeated_off_density | 0.15 | +2.037 | assumed |
| mass-select.pattern | 0.12 | +1.779 | measured |
| matrix-pattern.straightline | 0.10 | +1.574 | measured |
| cardsort-consensus.unnamed_categories | 0.08 | +1.329 | measured |
| pace.whole_survey_fast | 0.05 | +0.827 | measured |
| open-answer.off_topic | 0.04 | +0.593 | measured (near base rate) |
| open-answer.rich_open_answers | — | −1.400 | measured (confirm rate 0.068 vs 0.23 among flagged) |

Signals without an entry fall back to the mean LLR of their strength class: strong +3.418,
weak +2.119, positive −1.400. `surveyquorum weights` prints this table from the live file,
sorted by LLR, with the full source text and the probability each signal would reach alone.

## Refitting on your own labels

Do not edit numbers by hand. Label respondents (`good` or `bad_*`), run the engine, then fit:

```bash
npm run surveyquorum -- run my-dataset.json --out .surveyquorum/verdicts.json
npm run calibration:fit -- --verdicts .surveyquorum/verdicts.json --labels my-labels.json \
    --out my-weights.json
```

Or feed a plain table `response_id,label,signals` (signals `;`-separated):

```bash
npm run calibration:fit -- --csv my-table.csv --out my-weights.json
```

The script computes each LLR with Laplace (+1) smoothing, takes the prior from the labels (override
with `--prior`), caps at ±4.5 (`--cap`), and prints per-signal counts, precision and LLR plus the
ladder — for k = 0, 1, 2, 3, 4+ signals, how many respondents, what share were junk, and the mean
fitted probability. A good fit has the observed share rising with k and tracking the fitted mean.
The script defaults to the shipped thresholds (block 0.95, review 0.20; `--block`, `--review`).

Then close the loop from the CLI — inspect the file and run with it:

```bash
npm run surveyquorum -- weights --file my-weights.json
npm run surveyquorum -- run my-dataset.json --weights my-weights.json --out .surveyquorum/verdicts.json
```

`--weights` accepts any file that passes the same shape check as `weights --file` (`weights`,
`thresholds`, `defaults`); `resume` keeps the flag of the run it continues. In the library pass
the object: `runSurvey(survey, { weights })`.

## File forms

A weights file with a `prior` is read in the Bayesian form above. A file without one is read in
the legacy additive form (`score = Σ weight`, thresholds as raw scores, no probability), so older
user files keep working. In both forms an entry may be a bare number or `{ "llr", "source" }`.
