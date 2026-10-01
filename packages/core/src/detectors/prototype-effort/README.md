# prototype-effort

Effort on interactive prototype tasks (`prototype` blocks). Pressing "give up" without a
single click within seconds is the clearest low-effort act a respondent can perform, unless
the prototype did not load for a share of the cohort, in which case it is the survey's fault.

## How

For every task key with at least `minCohort` prototype blocks the detector computes mean and
sd of `ln(clickCount + 1)` and log-time statistics of duration. Tasks below `minCohort` are
ignored for the respondent entirely (no artifact check is possible there).

Per respondent, over counted tasks:

- a **zero-click give-up** is `status = gave_up` and `clickCount = 0`; it is **instant** when
  `duration < 6 s`
- a **low-effort task** has click z <= -1.5 and duration z <= -1.5, whatever its status

| signal | strength | when |
| --- | --- | --- |
| `instant_give_up` | strong | >= 1 instant zero-click give-up, or >= 2 zero-click give-ups |
| `zero_click_give_up` | weak | exactly 1 zero-click give-up with `duration >= 6 s` |
| `low_effort` | weak | >= 2 low-effort tasks (checked only when no give-up signal fired) |
| `cohort_give_up_task` | weak, `designArtifact: true` | zero-click give-up on a task where >= 10% of the cohort did the same |

One non-artifact Evidence per respondent; `cohort_give_up_task` is emitted once and lists the
affected blocks, which never count toward the tally.

`stats`: `nGiveUps, nInstant, nTasks, fastestSec` / `durationSec` / `meanClickZ, meanDurationZ`.

## Blind spots

- **A single instant give-up is more often a technical failure than bad faith.** The embed
  did not render on that device, the respondent saw a blank frame and pressed the only button.
  The cohort check catches this only when enough respondents hit the same wall; one unlucky
  device is still flagged `instant_give_up`. Pair it with a pace or content signal before acting.
- `completed` tasks with a plausible click count are never questioned even if the respondent
  clicked randomly until the goal screen appeared; click paths are not in the contract.
- `clickCount` semantics differ between tools (clicks vs. screens visited); the z-score is
  within-task so the unit does not matter, but a tool that reports 0 for everyone makes every
  give-up zero-click.
- Durations of 0 are "unknown": such give-ups count toward `nGiveUps` but never as instant.

## Design artifacts

A task where >= 10% of the cohort gave up without clicking is treated as "the prototype did not
load" (an unpublished design file, a blocked embed, a mobile-only flow shown on desktop). It is
reported as `cohort_give_up_task` and removed from every respondent's tally.
