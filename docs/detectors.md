# Detectors

One section per detector: what it catches, its signals with the shipped weight, limits,
and the design-artifact rule. The README next to each statistical detector
(`packages/core/src/detectors/<name>/README.md`) holds the exact formulas; the two LLM detectors
(`open-answer`, `coherence`) are specified by their prompts in `prompts/` and by their sections
here. This page is the overview. LLRs are from `packages/core/src/quorum/weights.json` v1.1.0; **measured** = from
arbiter-confirmed production bans, Jul–Sep 2026; **assumed** = placeholder until refit. Signals
without a row fall back to the strength default (strong +3.418, weak +2.119, positive −1.400).
`alone` = posterior probability when only that signal fires (prior 2.25 %): ≥ 0.20 is `review`.

Common rules: every statistic is relative to the cohort on the same question; questions with
fewer than `--min-cohort` (default 30) answers are not judged; a duration of 0 means "unknown"
and is dropped; one non-artifact evidence per respondent per detector; artifact evidence
(`designArtifact: true`) is reported, never weighed.

## Statistical detectors (no LLM)

### pace — per-question speed profile

Catches respondents who are faster than the cohort on many questions, not just one. Per
question: z = (ln t − μ) / σ over the cohort; per respondent: the count of blocks at z ≤ −2
(`nFast2`), at z ≤ −3 (`nFast3`), the median z, and total time over the cohort median.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `consistent` — ≥ 3 blocks at z ≤ −2, or median z ≤ −1.5 | strong | +4.500 (capped from 5.16) | 0.67 | measured, precision 0.80 |
| `single_outlier` — one block at z ≤ −3, at most one at z ≤ −2 | weak | +3.571 | 0.45 | measured, 0.45 |
| `fast_cluster` — 1–2 fast blocks and total < ½ median | weak | +2.876 | 0.29 | measured, 0.29 |
| `whole_survey_fast` — no fast block, total < ⅓ median | weak | +0.827 | 0.05 | measured, 0.05 |

Limits: thin branches are never scored; `whole_survey_fast` cannot tell a speeder from a
short branch (hence weak); a source exporting zero durations silences it; a skimmed instruction
block looks like `single_outlier`; slow outliers are not used.
Design artifacts: none — a question quick for everyone has a low μ and produces no outliers.

### duplicate-open — the same text on several open questions

Normalized exact match (case, whitespace, trailing punctuation). Placeholders ("no", "n/a",
"don't know" and their Russian equivalents) are counted separately.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `x3` — one substantive text on ≥ 3 distinct questions | strong | +3.972 | 0.55 | measured, 0.55 |
| `x2` — on exactly 2 questions | weak | +2.924 | 0.30 | measured, 0.30 |
| `empty_repeat` — placeholders on ≥ 3 questions | weak | +2.385 | 0.20 | measured, 0.20 |
| `cohort_same_answer` | artifact | — | — | reported only |

Limits: paraphrases and typos are not caught (the LLM detector's job); two related
questions legitimately share a text (hence `x2` weak); only the last turn of a transcript is
compared; the placeholder list is finite.
Design artifact: a question where ≥ 30 % of the cohort type the same text invites one answer;
those blocks are excluded from the counts.

### matrix-pattern — straightlining in rating grids

Matrices with ≥ 4 answered rows and runs of ≥ 5 consecutive scale questions. Patterns: flat,
zigzag, diagonal (numeric scales only).

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `straightline_fast` — patterned units ≥ 50 % of units and mean duration z ≤ −1.5 | strong | +3.571 | 0.45 | measured, 0.45 |
| `straightline_full` — ≥ 3 patterned units, ≥ 75 % of units (whole survey) | strong | +3.771 | 0.50 | assumed (whole-survey long-string index) |
| `straightline` — ≥ 2 patterned units, ≥ 50 % of units | weak | +1.574 | 0.10 | measured, 0.10 |
| `cohort_flat_matrix` | artifact | — | — | reported only |

Why the split: a pattern on one block is weak, but the same pattern across the whole survey is
the long-string / insufficient-effort index of the careless-responding literature (Curran 2016;
Meade & Craig 2012) and is strong on its own — hence `straightline_full` without a speed
condition.
Limits: without reverse-coded items a flat matrix can be honest (hence `straightline` is weak);
small matrices and thin cohorts are skipped; verbal Likert labels have no order for `diagonal`;
a patterned matrix answered slowly is indistinguishable from a careful one unless the pattern
covers the whole survey.
Design artifact: a matrix where ≥ 40 % of the cohort is flat is a uniform battery; excluded.

### mass-select — ticks everything, fast, on several questions

A multi-select block is *mass* when the respondent picks ≥ max(5, 70 % of options). Only the
cross-question pattern with speed counts. A question is multi-select at cohort level when ≥ 10 %
of its cohort picked two or more options; `multiShare` is the share of the respondent's blocks
on such questions that are mass.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `heavy_pattern` — ≥ 5 mass blocks, mean pace z ≤ −1.5; or ≥ 3 mass blocks covering ≥ 75 % of the respondent's multi-select blocks, mean pace z ≤ −1 | strong | +3.152 | 0.35 | assumed (third-judge review) |
| `pattern` — ≥ 3 mass blocks, mean pace z ≤ −1 | weak | +1.779 | 0.12 | measured, 0.12 |
| `cohort_mass_block` | artifact | — | — | reported only |

Why two routes: the same crowd on nearly every multi-select question is the long-string /
insufficient-effort index (Curran 2016; Meade & Craig 2012) and is strong at a moderate pace;
three crowded answers out of eight are only `pattern`.
Limits: no durations → no signal (a slow "select all" is an opinion); single-select with
long lists is treated as multi on one block (but not at cohort level); exclusive "none of the
above" options are not understood.
Design artifact: a question where ≥ 30 % of the cohort is mass applies to everyone; excluded.

### prototype-effort — giving up on interactive tasks

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `instant_give_up` — gave up with 0 clicks in < 6 s, or ≥ 2 zero-click give-ups | strong | +3.152 | 0.35 | measured, 0.35 |
| `low_effort` — ≥ 2 tasks with click z ≤ −1.5 and duration z ≤ −1.5 | weak | +2.673 | 0.25 | measured, 0.25 |
| `zero_click_give_up` — one zero-click give-up, ≥ 6 s | weak | +2.321 | 0.19 | measured, 0.19 |
| `cohort_give_up_task` | artifact | — | — | reported only |

Limits: **a single instant give-up is more often a technical failure than bad faith**
(the embed did not render); click paths are not in the contract, so random clicking to the goal
screen passes; click semantics differ between tools.
Design artifact: a task where ≥ 10 % of the cohort gave up without clicking did not load;
excluded for everyone. (The demo plants exactly this: 12 honest respondents, one artifact.)

### website-bounce — leaving a live-website task at once

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `repeated_bounce` — ≥ 2 tasks with z ≤ −2 or gave up in < 5 s | strong | +3.152 | 0.35 | assumed (prototype analogue) |
| `bounce` — one such task, cohort median ≥ 20 s | weak | +2.037 | 0.15 | assumed |
| `cohort_bounce_task` | artifact | — | — | reported only |

Limits: time is measured by the survey tool, not the site; short tasks cannot produce a
meaningful bounce; an idle tab is invisible.
Design artifact: ≥ 10 % of the cohort bouncing on one task means the site was down or blocked.

### cardsort-consensus — card sorts that ignore the cards

Cohort consensus per card pair (together / apart); the respondent's agreement with decided
pairs gives a z-score.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `random_sort` — agreement z ≤ −2 and duration z ≤ −1; or agreement z ≤ −2.5 at any speed | strong | +3.771 | 0.50 | assumed |
| `low_consensus` — agreement z in (−2.5, −2] at normal speed | weak | +2.385 | 0.20 | assumed |
| `single_pile` — every card in one category, ≥ 6 cards | weak | +2.037 | 0.15 | measured, 0.15 |
| `unnamed_categories` — ≥ 50 % of category names empty / numeric / one character | weak | +1.329 | 0.08 | measured, 0.08 |
| `cohort_single_pile`, `cohort_unnamed_categories` | artifact | — | — | reported only |

Why two routes: disagreeing with the room on a few pairs is a point of view, but a sort 2.5 sd
below the cohort disagrees on a large share of all decided pairs of the task — a whole-task
pattern (Curran 2016; Meade & Craig 2012), strong without a speed condition.
Limits: a cohort of random sorters decides few pairs and everyone looks average; a
thoughtful contrarian looks like `low_consensus`; numeric priority labels read as unnamed.
Design artifacts: ≥ 20 % single piles → the cards invite it; ≥ 50 % unnamed → labels were given.

### firstclick-offtarget — first-click tests answered without looking

Leave-one-out click density on a 10 × 10 grid per task.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `same_spot` — ≥ 3 tasks, every pairwise click distance < 0.03 | strong | +3.771 | 0.50 | assumed |
| `repeated_off_density` — ≥ 2 off-density tasks, mean duration z ≤ −1 | weak | +2.037 | 0.15 | assumed |
| `cohort_scattered_clicks` | artifact | — | — | reported only |

Limits: with large cohorts a rare but reasonable target reads as off-density (hence speed
required, weak); alternating between two fixed spots is not seen; a target that really sits in
the same place every time makes honest respondents look like `same_spot`.
Design artifact: ≥ 30 % of the cohort off-density → the image or task text was unclear.

## LLM detectors

### open-answer — classifying each free-text answer

One classifier call per answer (`prompts/open_answer_v1.txt`), any language. Labels:
`valid_high`, `valid_medium`, `valid_low`, `no_answer` (no signal); `off_topic` (weak);
`gibberish`, `fake`, `wrong_language`, `bad_language` (strong). Profanity with a substantive
point is `valid_*` with `profanity: true` — not a signal. Numeric-only answers are never sent
to the model.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `fake` — invented or evasive non-answer | strong | +3.449 | 0.42 | measured, 0.42 |
| `wrong_language` | strong | +2.924 | 0.30 | measured, 0.30 |
| `bad_language` — profanity without content | strong | +2.827 | 0.28 | measured before the semantics changed; expected higher |
| `gibberish` | strong | +2.619 | 0.24 | measured, 0.24 |
| `off_topic` | weak | +0.593 | 0.04 | measured, near base rate — corroborating only |
| `rich_open_answers` — ≥ 2 `valid_high` answers | positive | −1.400 | — | measured: confirm rate 0.068 vs 0.23 |
| `numeric_open_question`, hard label as artifact | artifact | — | — | reported only |

Limits: the model never sees images — "what do you see here?" is judged blind, the main
source of false `off_topic`; very short answers to questions that invite them; fluent
AI-written answers are `valid_*`; `off_topic` alone was wrong 96 % of the time in production.
Design artifacts: the same hard label on the same question for ≥ 5 % of the cohort (and ≥ 3
answers) is the question's fault; numeric-only answers on ≥ 30 % of a question mark a number
field miscast as open text.

### coherence — contradictions within one respondent

Three stages: a stronger model proposes up to 12 comparable question pairs for the survey
(`coherence_pairs_v1.txt`, once per survey); the classifier verifies each pair per respondent
(`coherence_verify_v1.txt`); a contradiction counts at confidence ≥ 4. A screening-vs-body
contradiction weighs 2, body-vs-body 1.

| signal | strength | LLR | alone | status |
|---|---|---:|---:|---|
| `contradiction` — weighted count ≥ 2 | strong | +3.571 | 0.45 | measured, 0.45 |
| `possible_contradiction` — weighted count 1 | weak | +2.563 | 0.23 | measured, 0.23 |
| `cohort_pair_fires` | artifact | — | — | reported only |

Limits: needs screening answers in the contract for the strongest half (CSV exports
rarely carry them); only pairs the discovery stage proposed are checked; an imposter who keeps
the story straight is invisible — this is the targeting blind spot (`docs/methodology.md`).
Design artifact: a pair that contradicts for ≥ 20 % of respondents who answered both (and ≥ 3)
is an ambiguous pair; suppressed for everyone.
