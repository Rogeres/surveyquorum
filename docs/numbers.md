# Numbers

Every figure Quorum quotes, with its definition, base, period and judge. All production numbers
share one source and one caveat:

- **Source.** One panel-research platform, production, July–September 2026. The code measured
  was the production predecessor of this repository's engine; a re-measurement on this exact
  code is the next step.
- **Judge.** "Confirmed" means confirmed by an LLM arbiter (`docs/arbiter.md`) that re-read the
  case. The arbiter is more lenient than human reviewers on text quality and stricter on speed
  (see "Arbiter vs humans" below), so human confirmation would be higher on text quality and
  lower on speed.
- **Flagged** = the production engine marked the response for rejection. **Confirmed** =
  flagged and the arbiter said `confirm`.

## Base rates

| population | responses | flagged | confirmed |
|---|---:|---:|---:|
| all completed responses | several hundred thousand (exact volume not published) | 4.5 % | 1.8 % |
| responses in questionnaires with ≥ 1 open question | n not broken out (≈ 58 % of all) | 6.8 % | 2.6 % |
| responses in questionnaires with no open question | 42 % of all | effort signals only (no open question to check) | |

The prior in `weights.json` is 2.25 %: the confirmed share in the calibration subset the
weights were fitted on, not the 1.8 % over all responses. When you refit, the prior comes from
your labels (`--prior` overrides it).

## By survey length

Length = the questionnaire's typical completion time in minutes (a property of the survey,
not of the respondent). Longer questionnaires carry more open questions and more blocks per
respondent, so more signals can fire.

| survey length | flagged | confirmed |
|---|---:|---:|
| < 1 min | 2.0 % | 0.9 % |
| 1–3 min | 5.4 % | 2.1 % |
| 3–7 min | 7.7 % | 3.0 % |
| 7–15 min | 11.7 % | 5.0 % |

## Precision by number of agreeing signals

Precision = share of confirmed junk among flagged respondents with exactly *k* distinct
signals. This ladder is what the weights reproduce (`docs/weights.md`); the refit script prints
the same ladder for your data.

| distinct signals | precision |
|---:|---:|
| 1 | 23 % |
| 2 | 55 % |
| 3 | 80 % |
| 4+ | 91 % |

## Pace ladder

Per-question speed. A question is **fast** for a respondent when its log-time z-score against
the cohort on that question is ≤ −2 — faster than about 98 % of the cohort. Share of confirmed
junk among respondents by the number of fast questions:

| fast questions | confirmed junk |
|---:|---:|
| 0 | 0.7 % |
| 1 | 8 % |
| 2 | 19 % |
| 3 | 30 % |
| 4 | 45 % |
| 5+ | 65 % |

Two reference points from the same data:

| criterion | confirmed junk | reading |
|---|---:|---|
| whole-survey time < ½ of the cohort median, **no** fast question | 2.6 % | ≈ base rate: short branches, not speeders — why panels' usual yardstick is weak alone |
| ≥ 3 questions at z ≤ −3 | 92 % | the `pace.consistent` signal's upper range |

The detector's rules (`pace.consistent` at ≥ 3 fast questions or median z ≤ −1.5;
`whole_survey_fast` weak) follow this table; see `packages/core/src/detectors/pace/README.md`.

## Arbiter vs humans

A few hundred bans reviewed independently by both the human QA team and the LLM arbiter — in what this
repository now calls **lenient** mode (two judges, blind tie-break, any overturn applied). The
default strict mode (`docs/arbiter.md`) has not been measured against humans.

| measure | value |
|---|---:|
| raw agreement | 66 % |
| bans kept by humans that the arbiter overturned | 42 % |

Direction of disagreement: humans are stricter about text quality and softer about speed; the
arbiter is the reverse. Further arbiter measurements (kappa on smaller samples, image blind
spot, two-judge split rates) are in `docs/arbiter.md`.

## Design artifacts

Rule measured: the same open-answer class fired on the same question for ≥ 5 % of the cohort.

| measure | value |
|---|---:|
| responses whose ban the rule would suppress | thousands (exact count not published) |
| surveys affected | hundreds |
| of those bans, overturned on review | 95–100 % (per-class samples; sizes not recorded here) |

The guard in this engine runs before scoring (per detector, with per-detector thresholds —
`docs/detectors.md`), so these never become bans.

## Demo dataset (synthetic)

`examples/demo-dataset.json`: 3 invented surveys, 300 respondents, 64 planted offenders in 10
personas, 236 honest in 4 personas. LLM judgements replay from `examples/llm-cache/`
(classifier gpt-4.1-mini). Checked by `examples/expected-verdicts.json` in CI.

Engine only (before the arbiter):

| | n | blocked | review | kept |
|---|---:|---:|---:|---:|
| planted offenders | 64 | 18 | 43 | 3 |
| honest | 236 | 0 | 5 | 231 |

61 of 64 offenders flagged; 0 honest blocked; 5 of 236 honest to review. With the shipped strict
arbiter replayed from the same cache (`--arbiter`): offenders 54 blocked / 4 to a person / 6
kept, honest 0 / 3 / 233 (README, "What the demo shows"). This shows that the mechanics work on
known personas; it says nothing about performance on real data.

## How to reproduce on your data

1. **Run** the engine over your dataset and keep the verdicts:
   ```bash
   surveyquorum run my-dataset.json --out .surveyquorum/verdicts.json [--llm api] [--arbiter]
   ```
2. **Label** a sample. A JSON object `{"<responseId>": "good" | "bad_content" | "bad_coherence" | "bad_targeting"}`
   (or `{ "label": ... }` per id, as `examples/demo-ground-truth.json`). Label flagged and
   unflagged respondents alike; precision needs the former, the prior and recall need both.
   Record who labelled (people, an arbiter run, both) — it changes every number.
3. **Fit weights** and read the report — per-signal counts, precision and LLR, then the ladder
   for k = 0, 1, 2, 3, 4+ signals (observed junk share vs the fitted mean probability):
   ```bash
   npm run calibration:fit -- --verdicts .surveyquorum/verdicts.json --labels my-labels.json \
       --out my-weights.json [--prior <p>] [--cap 4.5] [--block 0.95] [--review 0.2] [--version <name>]
   ```
   Or from a flat table `response_id,label,signals` (signals `;`-separated):
   `npm run calibration:fit -- --csv my-table.csv --out my-weights.json`.
4. **Inspect** with `surveyquorum weights --file my-weights.json`, then run with it:
   `surveyquorum run my-dataset.json --weights my-weights.json` (library:
   `runSurvey(survey, { weights })`). A good fit has the observed share rising with k
   and tracking the fitted mean; a signal whose precision sits at the base rate should get an
   LLR near zero.
5. **Re-measure after any prompt change.** Editing a prompt invalidates the LLM cache and the
   comparison baseline; run the old and new prompt on the same sample and compare class mixes
   before trusting a difference.
