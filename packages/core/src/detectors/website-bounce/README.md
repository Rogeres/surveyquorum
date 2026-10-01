# website-bounce

Live-website tasks (`website` blocks). A respondent sent to a real site with a task who
returns within seconds did not do the task. Two such bounces are strong; one is weak and only
counts when the cohort actually spent time on that task.

## How

For every task key with at least `minCohort` durations > 0 the detector computes log-time
statistics (`logStats`). A block **bounces** when

- `z = (ln t - mu) / sigma <= -2`, or
- `gaveUp` and `duration < 5 s`.

Blocks with `duration = 0` (unknown) are never scored.

| signal | strength | when |
| --- | --- | --- |
| `repeated_bounce` | strong | >= 2 counted website tasks bounce |
| `bounce` | weak | exactly 1 bounces and the cohort median for that task is >= 20 s |
| `cohort_bounce_task` | weak, `designArtifact: true` | bounce on a task where >= 10% of the cohort bounces |

One non-artifact Evidence per respondent; `cohort_bounce_task` is emitted once and lists the
affected blocks, which never count toward the tally.

`stats`: `nBounced, nTasks, nGaveUp` / `durationSec, cohortMedianSec, z, gaveUp`.

## Blind spots

- Time on the site is measured by the survey tool, not by the site; a respondent who opened
  the site in another tab and came back after a minute looks fine.
- A task the cohort finishes in 15 s (median < 20 s) cannot produce a single `bounce` by
  construction: short tasks have no room for a fast outlier that means anything.
- A respondent who stays long but does nothing (idle tab) is invisible; the contract carries no
  interaction data for website tasks.
- Thin cohorts (< `minCohort` measured durations) are skipped.

## Design artifacts

When >= 10% of the cohort bounces on the same task the site was down, geo-blocked, behind a
cookie wall the embed could not pass, or the task text was unclear. The task is reported as
`cohort_bounce_task` and removed from every respondent's tally.
