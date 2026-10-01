# matrix-pattern

Statistical detector, no LLM. Catches **straightlining**: a respondent who fills rating grids
with a pattern instead of reading the rows.

## What it looks at

- `matrix` blocks with at least 4 answered rows. The row value is the first element of the
  row's answer array; unanswered rows are dropped.
- Series of 5 or more consecutive `scale` blocks.

## Formula

Per matrix question with at least `minCohort` eligible answers:

| pattern    | rule                                                                                  |
|------------|---------------------------------------------------------------------------------------|
| `flat`     | every row has the same value                                                          |
| `zigzag`   | exactly two distinct values, strictly alternating row by row                          |
| `diagonal` | all rows distinct and strictly increasing or decreasing in option order; option order is derived from the cohort's observed values only when every value is numeric and there are at least three distinct values, otherwise `diagonal` is skipped |

A scale series is one **unit**; it is *patterned* when it contains a run of ≥ 5 identical
answers. A respondent's units are their eligible matrices plus their scale series. A matrix
duration z is `logZ` against the cohort of that question.

## Signals

| signal              | strength | when                                                                                     |
|---------------------|----------|------------------------------------------------------------------------------------------|
| `straightline`      | weak     | ≥ 2 patterned units and they are ≥ 50% of the respondent's units                        |
| `straightline_full` | strong   | ≥ 3 patterned units and they are ≥ 75% of the respondent's units — the pattern spans the whole survey |
| `straightline_fast` | strong   | `straightline` holds and the mean duration z over patterned matrices is ≤ −1.5          |
| `cohort_flat_matrix`| weak, `designArtifact: true` | the respondent is flat on a matrix where ≥ 40% of the cohort is flat     |

Only the strongest of `straightline` / `straightline_full` / `straightline_fast` is emitted per
respondent (`straightline_fast` first, then `straightline_full`); the design-artifact evidence is
emitted separately, once per respondent, listing all such blocks.

`stats`: `units`, `patternedUnits`, `patternedShare`, `patternedMatrices`, `patternedScaleRuns`,
`patterns` (comma-joined kinds), `meanDurationZ` (null when no matrix is patterned).

## Why a whole-survey pattern is strong on its own

A pattern on one block is weak evidence: without reverse-coded items a flat grid can be a
perfectly honest "I agree with all of it". The same pattern across the whole survey is a
different thing. It is the **long-string / insufficient-effort index** of the careless-responding
literature (Curran 2016, *Methods for the detection of carelessly invalid responses in survey
data*; Meade & Craig 2012, *Identifying careless responses in survey data*): a respondent whose
answers are patterned on nearly every rating unit is, with high probability, not reading the
items. That is why `straightline_full` is strong without needing speed, while `straightline`
(two units, half the survey) stays weak and waits for company.

## Design-artifact rule

A matrix where ≥ 40% of the cohort is flat is a legitimately uniform battery (everyone likes
everything, or the rows are near-synonyms). Such matrices are excluded from the respondent's
units and reported as `cohort_flat_matrix` so the author can fix the questionnaire; the scorer
gives them no weight.

## Blind spots

- Without reverse-coded items a flat matrix can be perfectly honest. That is why
  `straightline` alone is weak and needs company from other detectors; only when the pattern
  covers the whole survey (`straightline_full`) does it stand on its own.
- Matrices with fewer than 4 rows, and questions below `minCohort`, are never judged.
- `diagonal` needs a numeric option vocabulary; verbal Likert labels are not ordered.
- A patterned matrix answered slowly (reading, then agreeing with everything) looks identical
  to one answered fast; only `straightline_fast` separates them.
- A survey with a single matrix and no scale series has at most one unit, so
  `straightline_full` can never fire there; whole-survey evidence needs a whole survey.
