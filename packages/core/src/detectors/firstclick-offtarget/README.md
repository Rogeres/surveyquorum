# firstclick-offtarget

Statistical detector, no LLM. Catches **first-click tests answered without looking**: the same
spot on every image, or repeated clicks where nobody else clicked, made at speed.

## What it looks at

`firstclick` blocks with `answer.top` / `answer.left` in 0–1. Density statistics need at least
`minCohort` valid clicks per task key; `same_spot` needs no cohort.

## Formula

- Each task's clicks are binned on a 10 × 10 grid. Density is **leave-one-out**: the
  respondent's own click is removed before shares are computed, so a lone click can never be its
  own hotspot (with a cohort of 40 a single click is already 2.5% of the task).
- A click is **off-density** when its cell holds < 1% of the other clicks and no 8-neighbour
  cell holds ≥ 2%.
- Pairwise distance between a respondent's clicks is Euclidean in the 0–1 image space.
- Duration z is `logZ` against the cohort of that task.

## Signals

| signal                     | strength | when                                                                                   |
|----------------------------|----------|----------------------------------------------------------------------------------------|
| `same_spot`                | strong   | ≥ 3 first-click tasks and every pairwise distance between the clicks is < 0.03         |
| `repeated_off_density`     | weak     | ≥ 2 off-density tasks (artifact tasks excluded) and mean duration z on them ≤ −1       |
| `cohort_scattered_clicks`  | weak, `designArtifact: true` | off-density on a task where ≥ 30% of the cohort is off-density        |

One evidence per respondent, `same_spot` preferred. A single off-density click, or several
slow ones, emit nothing: first-click tests exist to let people disagree with the designer.

`stats`: `tasks`, `offDensityTasks`, `maxPairDistance`, `meanZ` (null when no off-density
task).

## Design-artifact rule

When ≥ 30% of the cohort clicks away from every hotspot, the image or the task text was
unclear. Those clicks are excluded from `repeated_off_density` and reported once per respondent
as `cohort_scattered_clicks` with no weight, so the author learns which task to fix.

## Blind spots

- With very large cohorts the 1% / 2% shares become several clicks; a genuinely rare but
  reasonable target may be read as off-density. `repeated_off_density` therefore also demands
  speed and stays weak.
- `same_spot` cannot see a respondent who alternates between two fixed spots; with only two
  tasks it never fires.
- Images where the correct target really is in the same place every time (a persistent
  header button) make honest respondents look like `same_spot`; pair this detector with the
  task design, not alone.
- Clicks outside 0–1 are ignored, not punished.
