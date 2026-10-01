# mass-select

Cross-question "ticks everything" pattern on multi-select choice questions. One crowded
answer is a preference; the same crowd on several questions, answered fast, is a respondent
who is not reading the options.

## How

A choice block counts as multi-select when `answer.length >= 2` or `options.length >= 5`.
It is **mass** when `answer.length >= max(5, ceil(0.7 * options.length))` if the option list is
known, else when `answer.length >= 6`.

Only questions with at least `minCohort` choice blocks in the cohort are considered. For those,
log-time pace statistics are computed (when at least `minCohort` durations > 0 exist) and each
of the respondent's mass blocks gets a pace z. `meanZ` is the mean z over the respondent's
counted mass blocks that have a pace measurement.

A question is **multi-select at cohort level** when at least 10% of its cohort selected two or
more options. `nMulti` is the respondent's number of blocks on such questions (artifact
questions excluded) and `multiShare = nMass / nMulti` is how much of the respondent's
multi-select survey the crowd covers. Single-select questions with a long option list look
multi-select on one block but never at cohort level, so they stay out of the denominator.

| signal | strength | when |
| --- | --- | --- |
| `heavy_pattern` | strong | route A: >= 5 counted mass blocks and `meanZ <= -1.5`; **or** route B (whole survey): >= 3 counted mass blocks, `multiShare >= 0.75` and `meanZ <= -1` |
| `pattern` | weak | >= 3 counted mass blocks and `meanZ <= -1` |
| `cohort_mass_block` | weak, `designArtifact: true` | the respondent is mass on a question where >= 30% of the cohort is mass |

Only the strongest of `heavy_pattern` / `pattern` is emitted. `cohort_mass_block` is emitted
once per respondent and lists every artifact block; such blocks count toward neither `nMass` nor
`nMulti`.

`stats`: `nMass, nMulti, multiShare, meanZ, nWithPace, nArtifactBlocks`.

## Why a whole-survey pattern is strong on its own

One crowded answer is a preference, and three crowded answers out of eight are a weak hint
(`pattern`). The same crowd on nearly every multi-select question in the survey is the
**long-string / insufficient-effort index** of the careless-responding literature (Curran 2016;
Meade & Craig 2012): the respondent is applying one rule to every list instead of reading the
options. Route B therefore grants `heavy_pattern` at a moderate pace (`meanZ <= -1`) when the
pattern covers >= 75% of the respondent's multi-select blocks, where route A needs five blocks
and a clearly rushed pace. Speed stays a requirement on both routes: ticking everything slowly is
a legitimate opinion.

## Blind spots

- Without durations there is no pace z, so a slow "select all" respondent is never flagged.
  This is deliberate: ticking everything slowly is a legitimate opinion.
- Single-select questions with a long option list are treated as multi-select because the
  contract does not say which mode the question was in; they cannot be mass (one answer), so
  this only costs a little pace noise.
- "None of the above" exclusive options are not understood; a respondent who ticks all items
  plus "none" is still mass.
- Thin cohorts (< `minCohort`) are skipped entirely.

## Design artifacts

A question where >= 30% of the cohort selects most options is usually a list of things
that genuinely apply to everyone ("Which devices do you own?") or a "select all that apply"
list the author expected to be crowded. It is reported as `cohort_mass_block` and excluded
from every respondent's tally.
