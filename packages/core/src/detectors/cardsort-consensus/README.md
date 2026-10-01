# cardsort-consensus

Statistical detector, no LLM. Catches **card sorts that ignore the cards**: random drops,
one pile for everything, categories nobody bothered to name.

## What it looks at

`cardsort` blocks (`answer`: category → cards). Each task key needs at least `minCohort`
responses; smaller cohorts are skipped entirely.

## Formula

1. Cards = union of all cards the cohort placed on that task. A card belongs to the first
   category that lists it.
2. For every unordered card pair: share of respondents (among those who placed both cards)
   who put the pair in the **same** category. Pairs placed by fewer than half the cohort are
   ignored.
3. A pair is **decided** when that share is ≥ 0.6 (majority together) or ≤ 0.4 (majority
   apart). Undecided pairs are ignored.
4. Respondent **agreement** = share of decided pairs they placed where their choice matches the
   majority. Needs ≥ 5 such pairs, otherwise undefined.
5. Cohort mean and sd of agreement give the respondent's z. Duration z is `logZ` against the
   cohort of that task.

## Signals

| signal               | strength | when                                                                                  |
|----------------------|----------|---------------------------------------------------------------------------------------|
| `random_sort`        | strong   | agreement z ≤ −2 and duration log-z ≤ −1; **or** agreement z ≤ −2.5 regardless of duration |
| `single_pile`        | weak     | every card in one category and ≥ 6 cards                                              |
| `low_consensus`      | weak     | agreement z in (−2.5, −2] at normal speed                                             |
| `unnamed_categories` | weak     | ≥ 50% of the respondent's category names are empty, purely numeric or one character   |
| `cohort_single_pile` | weak, `designArtifact: true` | single pile on a task where ≥ 20% of the cohort did the same         |
| `cohort_unnamed_categories` | weak, `designArtifact: true` | unnamed categories shared by ≥ 50% of the cohort (a closed sort with given labels) |

One evidence per respondent: the strongest signal across their tasks, in the table order.
A single pile is excluded from the agreement signals on that task — it disagrees with every
"apart" pair by construction and `single_pile` describes it better.

`stats`: `agreement`, `cohortMeanAgreement`, `z`, `decidedPairs`, `cards`, `categories`, plus
`durationZ` / `cohortSinglePileShare` / `cohortUnnamedShare` where relevant.

## Why a far-off sort is strong on its own

Disagreeing with the room on a few pairs is a point of view; `low_consensus` is weak because a
thoughtful contrarian who groups by an unusual but real criterion lands there. A sort whose
agreement sits 2.5 standard deviations below the cohort disagrees with the majority on a large
share of *all* decided pairs of the task — a whole-task pattern, the card-sort analogue of the
**long-string / insufficient-effort index** of the careless-responding literature (Curran 2016;
Meade & Craig 2012). No single criterion produces that; cards dropped without reading them do.
That is why `random_sort` has two routes: moderately off and fast, or far off at any speed.

## Design-artifact rule

When ≥ 20% of the cohort put everything in one pile, the cards or the instructions invite it;
when ≥ 50% share unnamed categories, the labels were most likely given by the task. Both are
emitted with `designArtifact: true`, carry no weight, and are reported to the survey author.

## Blind spots

- Consensus is only as good as the cohort: a cohort of mostly random sorters decides few pairs
  and everyone looks average. `decidedPairs` in `stats` shows how much ground truth there was.
- A thoughtful contrarian who groups by an unusual but real criterion looks like
  `low_consensus`; that is why it is weak and `random_sort` demands either speed or a sort that
  is far off the room (z ≤ −2.5).
- Open sorts with meaningful one-word numeric labels ("1", "2" as priority tiers) are read as
  unnamed.
- Tasks with few cards decide few pairs; below 5 decided pairs no agreement is computed.
