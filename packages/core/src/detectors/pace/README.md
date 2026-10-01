# pace

Per-question speed profile. Catches respondents who move through the questionnaire
faster than the cohort on many questions, not just the one that bored them.

## How

For every question key (`blockKey`) with at least `minCohort` durations > 0 the detector
computes log-time statistics (`logStats`: mean and sd of ln(seconds)). Each of the
respondent's blocks on such a question gets `z = (ln t − μ) / σ`. Then per respondent:

- `nFast2` — blocks with z ≤ −2; `nFast3` — blocks with z ≤ −3
- `medZ` — median z over scored blocks (only with ≥ 5 scored blocks)
- `ratio` — total seconds / cohort median total, where the cohort median is taken over
  respondents with ≥ 5 scored blocks (and only when ≥ `minCohort` such totals exist)

The first matching rule wins; one Evidence per respondent.

| signal | strength | when |
| --- | --- | --- |
| `consistent` | strong | `nFast2 ≥ 3` or `medZ ≤ −1.5` |
| `fast_cluster` | weak | `nFast2` is 1–2 and `ratio < 0.5` |
| `single_outlier` | weak | `nFast3 ≥ 1` and `nFast2 ≤ 1` — one isolated extreme block |
| `whole_survey_fast` | weak | `nFast2 = 0` and `ratio < 1/3` — what panels usually check |

`stats`: `nScored, nFast2, nFast3, medZ, totalSec, cohortMedianSec, ratio, shareFast2`.
`blocks`: the fast block indexes (none for `whole_survey_fast`).

## Blind spots

- Questions below `minCohort` are never scored; a respondent who only reached thin
  branches is invisible here.
- `whole_survey_fast` cannot tell a speeder from a respondent routed down a short branch,
  which is why it is weak. Pair it with content signals.
- Durations of 0 mean "unknown" and are dropped; a source that exports zeros everywhere
  silences the detector.
- A respondent who skims one long instruction block produces `single_outlier` — this is a
  reading-speed signal, not a bad-faith one, hence weak.
- Slow outliers (z ≫ 0: idle tabs) are not used; they are not quality evidence.

## Design artifacts

None. Speed is measured relative to the cohort on the same question, so a question that is
quick for everyone simply has a low μ and produces no outliers.
