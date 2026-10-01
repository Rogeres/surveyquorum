# Methodology

Quorum screens survey respondents the way a review board does: several independent checks
look at the same person, and a decision needs agreement. This page explains the levels, the
vocabulary, and what the method needs in the data to see.

## Four levels

| level | what it is | status in v0.1 |
|---|---|---|
| 1. History | the respondent's record across surveys: repeat offences, panel token, fingerprint | **roadmap** — the contract carries `fingerprint` and `panel.token`, no detector reads them yet |
| 2. Detectors | ten independent checks, each emitting evidence about a respondent | shipped (`docs/detectors.md`) |
| 3. Weighted quorum | evidence → posterior probability → `block` / `review` / `keep` | shipped (`docs/weights.md`) |
| 4. Second opinion | an LLM arbiter re-reads each `block` and `review`: confirms (a confirmed `review` becomes `block`), releases with a named cause, or hands the case to a person | arbiter shipped (`docs/arbiter.md`); the human step is yours |

Level 1 matters because junk tends to repeat within a respondent across surveys. It is not in
v0.1 because it needs storage across runs, and the core has none by design.

### Level 2 — detectors

A detector sees one survey (the cohort) and returns `Evidence` items: `detector.signal`,
strength (`strong` / `weak` / `positive`), a one-sentence summary with the numbers, the blocks
involved. Two things a detector never does: decide, and look at a respondent in isolation.
Every statistic is relative to the cohort on the same question — speed is "faster than the
others on this question", a flat matrix is "flat where the others were not".

Eight detectors are pure statistics and need no model: pace, duplicate-open, matrix-pattern,
mass-select, prototype-effort, website-bounce, cardsort-consensus, firstclick-offtarget. Two
need an LLM: open-answer (classifies each free-text answer) and coherence (finds contradictions
between a respondent's own answers, including the declared screening profile). Without a model
the two are skipped and the run says so.

### Level 3 — weighted quorum

Each `detector.signal` carries a log-likelihood ratio: how much more often it is seen on
confirmed junk than on honest respondents. The score is the prior log-odds of junk plus the sum
of the LLRs (one term per distinct signal); the posterior probability is `sigmoid(score)`.
`block` at ≥ 0.95, `review` at ≥ 0.20; everything in between goes to level 4 for a second look. Positive evidence (rich open answers) has a negative LLR.

### Level 4 — arbiter and human

The arbiter is a strong model that reads the full case — every answer, times against the
cohort median, the screening profile, the target, the evidence — and returns `confirm`,
`overturn` or `needs_human`, plus a one-ground panel text. It only moves outcomes
(`confirm` → block, also for a `review`, whose quorum the judge completes; `overturn` → keep;
`needs_human` → review, which after the arbiter means a person must look); it never adds
evidence. How much it may release
is a setting (`docs/arbiter.md`, "Strictness"). The default, strict, lifts a verdict only when
both judges agree on an overturn with a named cause and sends every hesitation to a human. In
lenient mode — the one measured in production — it agreed with humans 66 % of the time on a
few hundred double-reviewed bans and overturned 42 % of the bans humans kept. Treat a lenient `overturn` as
"not provable from the data", not "the respondent is fine".

## Vocabulary

| term | definition |
|---|---|
| **flagged** | the engine's outcome is `block` or `review` |
| **review, before the arbiter** | the engine's outcome `review`: one signal, or weak ones — the respondent needs a second independent look, from the arbiter or a person |
| **review, after the arbiter** | the arbiter's `needs_human`: a person must look. Reviews the arbiter confirmed have become `block`, reviews it overturned `keep` |
| **blocked** | the engine's outcome is `block`: posterior ≥ 0.95, which needs at least two agreeing strong signals; after the arbiter, also a `review` the arbiter confirmed (`arbiter.originalOutcome: "review"`) |
| **reviewed** | a flagged respondent was read by the arbiter or a person |
| **confirmed** | the reviewer agreed the respondent acted in bad faith. In every production number on these pages the reviewer is the LLM arbiter, which is softer than humans; human confirmation would be higher on text, lower on speed |
| **design artifact** | evidence suppressed because the same signal fired on the same question for a large share of the cohort |
| **precision** of a signal | share of confirmed junk among the respondents the signal selected |

## Why one signal never blocks

Alone, a signal lands at its measured precision. The best single signal in production
(`pace.consistent`) was right 80 % of the time; the median single signal, 23 %. Banning on one
signal means being wrong three times out of four on average. Two agreeing, independent signals
reached 55 %, three 80 %, four or more 91 % (`docs/numbers.md`). The weights encode exactly
this: every LLR is capped at ±4.5, so the strongest lone signal reaches a posterior of about
0.67 — `review`, not `block`. A lone signal asks for a second look; a consensus decides.

The converse is cheap: a reviewed-and-kept respondent costs one read. A wrongly blocked one
costs a complaint the panel rejects and a respondent who leaves.

## Design artifacts

When many respondents produce the same "bad" signal on the same question, the question is the
likely cause: an open question that invites "yes" (duplicate-open), a prototype that did not
load (prototype-effort), a battery everyone agrees with (matrix-pattern), a pair of questions
that contradict each other for a fifth of the cohort (coherence), an open-answer class that a
twentieth of the cohort "earns" on one question (open-answer). Each detector has its own share
threshold, listed in `docs/detectors.md`.

Such evidence is kept on the verdict under `designArtifacts`, carries no weight, and is
grouped per question for the author: the run summary prints one line per affected question
("prototype task … — 16 respondents gave up with no clicks; the prototype likely did not load")
and `verdicts.json` carries the same rows as `designArtifactSummary`. In production this guard
would have suppressed thousands of bans across hundreds of surveys; on review of per-class samples 95–100 % of
those bans were overturned (sample sizes are not recorded here). The guard runs before
scoring, so a design fault never becomes a ban in the first place. The before-field skills
(`screener-design` for the screener, `survey-review` for the body) exist to catch the same
faults before any respondent sees them.

## Limits and what the method needs

- **Targeting mismatch and experience imitation.** A respondent who is not who the screener
  asked for, but answers with ordinary effort, produces no effort signal. Only the coherence
  detector sees it, and only when the body contains a question that contradicts the screening
  profile. A targeting-fit axis is on the roadmap; until then the defence is screener design
  (verifier questions about personal experience) rather than detection.
- **No open questions → effort signals only.** 42 % of production responses contained no open
  question at all. There the engine judges effort only: pace, patterns, tasks; a careful
  imposter is then a matter for screener design, not detection. The verdict carries
  `noContentToCheck: true` so the report can say so.
- **Thin cohorts.** Cohort statistics need `--min-cohort` (default 30) answers on a question;
  questions below it are not judged. Small surveys get fewer detectors, not worse ones.
- **Missing durations.** A source that exports no per-question time silences pace,
  prototype-effort, website-bounce and the speed half of matrix-pattern and mass-select.
- **Images.** The open-answer classifier and the arbiter work from the text alone and do not see
  the stimulus; a short answer to "what do you see here?" is judged on the text. In production
  this was the main source of arbiter `needs_human` decisions — which is where such cases
  belong.
- **Paraphrase and AI-written answers.** duplicate-open matches normalized text exactly; a
  fluent, on-topic, machine-written answer is `valid_*`. Input-event detection needs client
  data the contract does not carry yet.

## What is measured and what is assumed

Every number on these pages comes from one platform's production, Jul–Sep 2026, with an LLM
arbiter as the judge, and was measured on the predecessor of this code, not on this
repository. Weights marked `assumed` in `weights.json` are placeholders. The demo dataset is
synthetic and shows mechanics, not performance. To know how Quorum performs on your data, label
a sample and refit (`docs/weights.md`, "Refitting on your own labels").
