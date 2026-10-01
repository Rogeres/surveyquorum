# quorum-screen: reference

## How a verdict is formed (one paragraph)

Each detector emits evidence `detector.signal` with a strength. Every signal has a
log-likelihood ratio (how much more often it is seen on junk than on honest respondents);
`score = logit(prior) + sum of LLRs over distinct signals`, `probability = sigmoid(score)`.
Block at p >= 0.95, review at p >= 0.20, keep otherwise. LLRs are capped at +4.5 so that one
signal alone reaches about 0.67 on the shipped 2.25% prior (log-odds -3.77 + 4.5 = 0.73) -
inside review. Two ordinary strong signals block (~0.95). Positive evidence (rich open answers)
pulls the probability down. Live table with provenance: `surveyquorum weights`.

## Signals in plain words

| Signal | Means | Strength |
|---|---|---|
| `pace.consistent` | fast on 3+ questions (z <= -2) or median z <= -1.5 across the questionnaire | strong |
| `pace.fast_cluster` | 1-2 very fast questions and total time under half the cohort median | weak |
| `pace.single_outlier` | one extremely fast question (z <= -3), nothing else | weak - often a skipped instruction |
| `pace.whole_survey_fast` | total time under a third of the median with no single fast question | weak - may be a short branch |
| `open-answer.fake` | a period, a lone letter, a copy of the question, "test" | strong |
| `open-answer.gibberish` | keyboard mash | strong (low precision alone) |
| `open-answer.wrong_language` | a full sentence in another language | strong |
| `open-answer.bad_language` | profanity without content | strong |
| `open-answer.off_topic` | does not answer what the question literally asks | weak - near base rate alone |
| `open-answer.rich_open_answers` | 2+ detailed, specific answers | positive (lowers p) |
| `duplicate-open.x3` / `x2` | the same substantive text on 3+ / exactly 2 distinct questions | strong / weak |
| `duplicate-open.empty_repeat` | placeholder ("no", "n/a") on 3+ questions | weak |
| `coherence.contradiction` / `possible_contradiction` | body answers contradict each other or the declared screening profile | strong / weak |
| `matrix-pattern.straightline_fast` / `straightline` | patterned grids (flat, zigzag, diagonal) fast / at normal speed | strong / weak |
| `mass-select.heavy_pattern` / `pattern` | ticks most options on 5+ / 3+ multi-selects, fast | strong / weak |
| `prototype-effort.instant_give_up` | gave up with zero clicks within 6 s, or twice | strong - check for a load failure first |
| `prototype-effort.zero_click_give_up` / `low_effort` | one slow zero-click give-up / 2+ low-effort tasks | weak |
| `website-bounce.repeated_bounce` / `bounce` | returned from a live site within seconds, twice / once | strong / weak |
| `firstclick-offtarget.same_spot` / `repeated_off_density` | identical coordinates on 3+ images / clicks where nobody clicks, fast | strong / weak |
| `cardsort-consensus.random_sort` | disagrees with the cohort's decided pairs and fast | strong |
| `cardsort-consensus.single_pile` / `low_consensus` / `unnamed_categories` | everything in one pile / disagreement alone / empty names | weak |

Design artifacts (`cohort_*` signals and `designArtifact: true` on open-answer labels) carry no
weight and name the question at fault.

## Blind spots to remember while walking the queue

- `pace` scores only questions with >= 30 timed answers; a respondent on a thin branch is
  invisible. Zero durations are unknown, not fast.
- `off_topic` on a question that refers to an image or screen the judge never saw is the single
  largest source of false flags; the arbiter's `needs_human` concentrates there.
- One instant give-up is more often a device that did not render the prototype than bad faith.
- Flat matrices are honest when nothing is reverse-coded; `straightline` is weak for that
  reason.
- `whole_survey_fast` cannot tell a speeder from a short branch.
- `duplicate-open.x2` happens to sincere people ("see above").
- Without open questions nothing about content is known: `noContentToCheck`.
- Fluent machine-written answers are `valid_*`; the judge reads fluency and relevance, not
  authorship.
- Identical text across respondents is not compared; `duplicate-open` works within one
  respondent only.
- Agreeing with everything is not a signal; an always-agree profile passes.

## Judging requests well (agent mode)

- Read the whole prompt each time; the guards differ by category. Where the prompt gives a
  decision test ("could this exact answer fit any other question?"), apply it literally.
- Answer in the schema exactly: labels from the enum, integers in range, booleans as booleans.
  A rejected line costs a second `resume`, nothing more.
- Do not look at the respondent's other answers when a request is about one answer; the
  cross-answer check is a separate request with its own prompt.
- When a question refers to an image you cannot see and the answer is plausibly about that
  image, prefer `valid_medium` over `off_topic`; the prompt says so.
- Batch 20-50 lines per step and append incrementally; `resume` can be run on a partial file.
- Answer each request once, from the cache afterwards: do not re-judge an id you already
  answered. Re-judging flips a few labels per thousand on the same config, and the resulting
  diff looks like a regression when it is only noise.

## Reading the review queue with a human

With `--arbiter` the queue is the post-arbiter `review` set: cases the arbiter handed to a person
(`arbiter.decision: needs_human`; `explain` prints its reason). Reviews the arbiter confirmed are
already `block`, reviews it released are `keep`. Without the arbiter, every single-signal case is
in the queue and the human is the second look.

Order the queue by probability descending. Mark the band **0.85-0.95** (one fact decides -
these become blocks or keeps on the first open answer you read) and the band **0.20-0.30**
(likely keep - a single weak signal), so the user can start with either end.

For each respondent, present one card in this fixed shape:

```
<responseId>  p = 0.67 (review)
Evidence:   pace.consistent [strong] - 4 of 11 timed blocks at z <= -2; median z -1.9
            (one line per evidence item, from `explain`)
Answers:    Q3 "What did you cook most recently?" -> "pasta"
            Q7 "What would you change?"          -> "ok"
            Q11 "Any other comments?"            -> "no"
            (up to three open answers, verbatim, from the dataset)
Fastest:    Q5 scale 1 s (cohort median 4 s); Q9 choice 2 s (cohort median 9 s)
            (the two fastest blocks with their cohort medians)
Keep or block, and why?
```

Decide on substance. Write the note as a reason that someone else can verify from the same
answers - a fact, a quote, a number - not an impression, and not a restatement of the signal.

Typical outcomes:

- Fast + specific open answers -> keep (speed with content is a fast reader).
- One strong content signal + a questionnaire artifact on the same block -> keep, fix the
  questionnaire.
- Two independent signals from different detectors -> block even at 0.7 if the texts confirm.
- `needs_human` from the arbiter -> this is exactly the case; read the image-related answers.
