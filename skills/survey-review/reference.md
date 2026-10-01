# survey-review: reference

Fourteen classes of questionnaire faults that produce data indistinguishable from respondent
junk, the detection rules for a pre-field review (by text and structure only, no response data),
the counter-examples that must not be flagged, and the map from fault to affected detector.

The stance: the author owes the audience exactly one thing - a questionnaire that is not empty
for it, with something verifiable to judge quality on. Every other rule here is a suggestion;
its "Fix" is what the author can do **if** they want a given detector to work, not a
requirement.

## Contents

1. [Audience difficulty](#audience-difficulty) - the 1-10 rubric R26-R28 depend on
2. [The 14 classes](#the-14-classes)
3. [Rules R1-R28](#rules-r1-r28)
4. [Counter-examples C1-C7](#counter-examples-do-not-flag)
5. [How each fault shows up in `surveyquorum` output](#how-each-fault-shows-up-in-surveyquorum-output)
6. [Sources](#sources-brief)

Detector names are those of `surveyquorum`: `open-answer`, `coherence`, `duplicate-open`,
`pace`, `matrix-pattern`, `mass-select`, `prototype-effort`, `website-bounce`,
`firstclick-offtarget`, `cardsort-consensus`.

## Audience difficulty

The same rubric the `screener-design` skill uses; copied here so this skill works when
installed alone.

| Score | Audience | Typical screening conversion (assumed, not measured) | Recruitment route |
|---|---|---|---|
| 1-3 broad | General population, common demographics, widespread behaviors | 15-30% | Any general panel |
| 4-6 medium | A common occupational group, regular users of a specific but widespread service, a common life-stage group | 8-15% | General panel with a custom screener; expect quota imbalance between segments |
| 7-8 narrow | A specialist role, a specific budget authority, owners of an uncommon device or contract | 2-7% | Specialist panels, professional communities, referral recruitment; a general panel will reject 90%+ |
| 9-10 rare | Senior decision makers, exclusive specializations, very low-incidence behaviors | < 2% | Manual recruitment through networks and agencies only |

Raise the score by one when: the brief needs several segments with different incidence (the
rarest segment sets the pace); the geography is restricted to a few cities; the behavior must
be recent (last month) rather than ever. Lower it by one when: the qualifying behavior is
common and recent recall is easy. Difficulty >= 6 turns on R26-R28.

## The 14 classes

| # | Class | Which detector is confused | What the author can change |
|---|---|---|---|
| 1 | Asked about something they said they do not have: a question shown to someone who answered "I don't use it"; no "not applicable" option | `coherence` (contradiction), `open-answer` off_topic, `duplicate-open` ("No" x2) | Skip logic or an exit option - **critical** |
| 2 | Wrong audience: the recruiting target is not confirmed by any question | nothing fires; the client deletes by hand | A qualifying question with an exit |
| 3 | Open question that cannot be answered without the image; instruction typed into an open block | `open-answer` off_topic on honest answers; design-artifact guard fires | Restate the context in words or change the block type |
| 4 | Attention check with an ambiguous instruction; duplicated option | not a detector - the client; `pace` and `mass-select` as side effects | Rewrite the instruction, dedupe the options |
| 5 | Open question without a minimum length / inviting a one-word answer | `open-answer` fake, `duplicate-open` empty_repeat | Minimum length, format hint, or a closed block |
| 6 | Batteries of scales and matrices; long multi-selects without a limit | `pace` (1 s on a scale after a series), `matrix-pattern`, `mass-select` | Shorten, interleave, reverse-phrase one row |
| 7 | Prototype does not load / unclear start -> "gave up" with zero clicks | `prototype-effort` + `pace` as one event counted twice | A load check, an explicit first action |
| 8 | Near-duplicate open questions (ladders, "what did you notice / what was the main thing") | `duplicate-open` on natural repeats, `pace` on the third similar question | Merge, or separate and reword |
| 9 | Screener that leaks the topic or passes on any click | nothing; shows as implausibly good data | `screener-design` |
| 10 | A number (age, count) collected in an open block | `open-answer` fake on "31" | Numeric or banded choice |
| 11 | Open block used as yes/no or as a quiz with one right number | `duplicate-open` on identical short answers, `open-answer`, `coherence` on wrong quiz answers | Change the block type |
| 12 | Memory quiz disguised as self-report | `coherence` reads wrong recall as contradiction; `duplicate-open` on honest "don't remember" x5 | Mark as a check, add "don't remember" |
| 13 | Trivial one-click question right after a task on the same topic | `pace` (1 s against a 3-4 s median) | One confidence block per series |
| 14 | Nothing verifiable in the body for the audience | nothing fires - the engine is blind; only client complaints afterwards | One open experience question - **critical** |

## Rules R1-R28

Each rule: condition -> class, severity -> what to propose. "Filter" means a choice block with
an exit-type option ("I don't use", "never", "haven't tried", "no", "did not manage").

Only R1-R3 and R26 are **critical** and worded as requirements. Every other rule is medium or
low; write its proposal as "Consider ..." or "If you want `<detector>` to work here, ...". One
concrete change per rule - never "add N checks".

**R1 Filter without an outgoing branch.** A filter whose exit option has no skip logic, followed
within 3 blocks by a question about experience or reasons. -> Class 1, **critical**. Fix: route
the exit to the end or skip the dependent block.

**R2 Demonstrative premise after a filter.** A question containing "this / that / the one you
chose" + a noun from a preceding filter that allowed a negative answer ("this <service>", "that
<product>"). -> Class 1, **critical**. Fix: skip the block for the negative answer, or add
"I did not choose any" as an option.

**R3 "Why didn't you..." without a condition.** Question starts with "Why did you not / Why
couldn't you" and the previous block is a yes/no "did you manage" without branching. -> Class 1,
**critical**. Fix: show the block only to those who answered "did not manage".

**R4a No applicability option.** A question about personal experience, usage or price ("how
much would you pay", "would you buy", "rate your last visit") without "did not use / not
applicable / would not buy at any price". -> Class 1, medium. Consider adding the applicability
option and routing it past the dependent blocks.

**R4b (do not flag) Required attitude matrix without "don't know".** A required matrix or
scale battery of attitude items without a "don't know" column is **not** a fault:
discouraging "don't know" on attitude items yields more valid data. Flag only when the rows
ask about facts the respondent may genuinely not know (prices, dates, features they may not
have used) - then it is R4a.

**R5 Target not confirmed by a question.** Extract conditions from the audience (customer of a
named provider, device, behavior, city size, age); if none of the first 5 blocks asks about a
condition with an exit option -> Class 2, medium. Consider one qualifying question with an
exit; panels do not guarantee strict conditions.

**R6 No "none of the above".** A filtering choice (position <= 5 with an exit) lacking "none of
the above / other". -> Class 2/9, medium. Consider adding the option.

**R7 Open question pointing at an invisible visual.** An `open` block right after a
prototype / first-click / image context that contains "this spot / this icon / highlighted in
red / circled / on this screen / this element / the label / the button" without naming the
object in words. -> Class 3, medium. If you want `open-answer` to read these answers fairly,
name the object: "On the <named> screen you tapped <the named element> - why?", or use a closed
question with options. (Engine-specific: the text judge never sees images.)

**R8 Instruction in an open block.** An `open` block whose text has no question word or question
mark and starts with "Now you will see / Imagine / Next / Study / Tap". -> Class 3, medium.
Consider block type `context`.

**R9 "Describe what you saw".** An `open` block with "describe the image / what did you see /
what was shown" when the stimulus was in the previous block and is no longer visible. -> Class
3, medium. Consider showing the stimulus on the same screen or using closed recall.

**R10 Attention check with an ambiguous instruction.** Text contains "select the option X" /
"to show you are paying attention, choose...": (a) option X is missing or appears more than
once; (b) the instruction follows more than 150 characters of other text; (c) the question
also demands a substantive answer. -> Class 4, medium. Consider one short instruction with one
unambiguous target option and no substantive load. (d) The author plans to exclude respondents
on a single failed check -> low: consider treating a failed check as a review signal rather
than an exclusion rule.

**R11 Duplicate options.** Any `choice` or `matrix` with two options of identical normalized
text. -> Class 4 and a technical defect, medium. Fix: dedupe.

**R12 Binary open question.** An `open` block starting with "Is there / Was it / Was it clear /
Was it convenient / Do you agree / Would you like / Would you use" or ending in a yes/no
construction. -> Class 11 (and 5), medium. Consider `choice` yes/no + optional `open` "why".

**R13 Series of "why this rating".** 3+ `open` blocks reading "Why did you give this rating /
Explain your rating / Comments" with no minimum length; or a required `open` "If you have any
comments...". -> Class 5, medium. If you want `open-answer` to work here, consider a minimum of
15 characters, optional, at most one per 3 scales.

**R14 Battery of scales.** 8+ consecutive `scale` blocks sharing a prefix of 20+ characters or
about one stimulus. -> Class 6/13, medium. Consider <= 6 per stimulus with a substantive
question interleaved.

**R15 Matrix or multi-select without a counterweight.** A `matrix` of 5+ rows all phrased in
one direction (no row with "not / hard / inconvenient"); a multi-select with 12+ options and no
limit. -> Class 6, medium. If you want `matrix-pattern` to separate straightlining from honest
agreement, consider one reverse-phrased row worded plainly (a negation that reads naturally,
not a double negative); for the multi-select, a limit of 2-3 or a split.

**R16 Prototype without a load check.** A `prototype` or `firstclick` block: (a) with no
`context` before it; (b) with task text over 300 characters or 3+ steps; (c) followed by
nothing that lets the respondent report a problem (no "did not load" option, no hint in the
open block). -> Class 7, medium. If you want `prototype-effort` to tell a give-up from a
technical failure, consider a "did the prototype open?" screen with branching and a task of <= 2
sentences with an explicit first action.

**R17 Repeated open question.** Two `open` blocks sharing a prefix of 30+ characters, or the same
set of keywords, or both about "what you remember / what was the main thing / what you noticed".
-> Class 8, medium. Consider merging, or separating and rewording around different objects.

**R18 Ladder of identical closed questions.** 3+ consecutive `choice` blocks with the identical
option set and question texts differing by under 20%. -> Class 8/13, low. Consider one
`matrix` (<= 5 rows) or one block with sub-items.

**R19 Topic leak in the screener.** In the first 4 blocks, choice options name the target
profession / brand / platform from the research brief and the targets stand first without
randomization. -> Class 9, medium. Consider a topic-masked question of 8-10 neutral options
(`screener-design`).

**R20 Screener passed by clicking.** A filtering multi-select without a limit where any option
except "no" passes; no honeypots among brands or platforms. -> Class 9, medium. Consider a hard
limit (`screener-design`).

**R21 Number in an open block.** An `open` block asking for age / year / quantity / amount
("How old are you", "How many people"), or with an empty question text (a screening field). ->
Class 10, medium. Consider a numeric field or a banded `choice`.

**R22 Quiz in an open block.** An `open` block "What is the ... equal to / How much does ...
cost / On what date / How much is / In which city" referring to a shown stimulus (one right
answer). -> Class 11, medium. Consider `choice` with distractors + "don't remember".

**R23 Arithmetic or fact as a check.** An `open` block "What is N + M". -> Class 4/11, low.
Consider `choice`.

**R24 Memory series without "don't remember".** 3+ consecutive questions about facts from a
shown stimulus (prices, dates, contents of what was shown) with no "don't remember / didn't
notice" option. -> Class 12, medium. Consider adding the option and marking the block as a
check, not a quality criterion.

**R25 Confidence scale after every click.** A `scale` or `choice` of <= 3 options reading "how
confident / how easy / was it convenient" directly after a `prototype` or `firstclick`,
repeated 2+ times. -> Class 13, low. Consider one block after the series.

**R26 Nothing verifiable for the audience.** Audience difficulty >= 6 AND no open question
about personal experience with a minimum length in the body; OR, for any difficulty, no block
at all whose answer can be wrong, incoherent or low-effort -> **critical**. This is the one hard
requirement of the review. Message: "The questionnaire is empty for this audience: no question
requires real experience, so an imposter who passed the screener is indistinguishable inside,
to the engine and to a human alike." Propose one verifier on the spot: "Tell us about the last
time you <the qualifying behavior>: what, where, when, outcome; at least two sentences." Note
that fluent, generic answers can be machine-written, so the question asks for specifics.

**R27 Verifier only at the start.** The only experience verifier sits in the first 2 blocks ->
medium. Imposters try hardest at the start; consider moving it later, after the matrices.

**R28 Ratings without behavioral specifics.** Difficulty >= 6 and every body question is an
agreement or satisfaction scale, nothing asks "how many / which / when" -> medium. Nothing to
check for consistency; if you want `coherence` to have a pair to compare, consider replacing one
scale with a behavioral fact.

## Counter-examples: do not flag

**C1 Open question after a stimulus with the context restored.** "On the <named> screen you
tapped the button '<its label>'. What did you expect to see next?" - a demonstrative word is
present, but the object is named. R7 stays silent when the question names the object (quotes, a
proper name).

**C2 Filter with a correct branch.** "Do you use <the service>?" -> "No" routes to the end;
then "How often do you use it?". R1/R2 stay silent because the branch exists. Read the skip
logic, not only the text.

**C3 Two open questions about different things with a similar start.** "What did you like on
this screen?" and "What did you NOT like on this screen?" - long shared prefix, opposite
polarity. R17 must exclude pairs with negation or antonyms (like / dislike, convenient /
inconvenient, pros / cons).

**C4 Short battery with a reverse row.** 5 scales about one stimulus, one of them reverse-phrased
("<the stimulus> feels intrusive"), an open "What do you remember?" in between. R14/R15 stay
silent: under 8 scales, a counterweight, an interleaved question.

**C5 Correct attention check.** "This is an attention question. Select 'Blue'." with options
[Green, Blue, Red, Yellow], instruction first, one target option, no substantive load. R10
stays silent. An open "8 + 5 =" with near-universal correct answers also works; R23 only
suggests `choice`, severity low.

**C6 Quiz with "don't remember".** "How many steps on the way? - 0 / 1 / 2 / don't remember"
x3. R24 stays silent; the option removes the coherence and duplicate risk.

**C7 Broad audience, scales only.** Difficulty <= 3, a questionnaire of scales about an everyday
service. R26 stays silent as long as at least one block can be answered wrongly or lazily
(a scale battery with a pace or pattern signal counts): imitation is cheap and there is nothing
worth verifying. The "what the engine will NOT check" section still says the content detectors
are idle.

## How each fault shows up in `surveyquorum` output

| Fault | What the user will see after `surveyquorum run` |
|---|---|
| 1, 11, 12 | `coherence.contradiction` / `possible_contradiction` on honest respondents; `coherence.cohort_pair_fires` as a design artifact when the same pair fires across the cohort |
| 3, 5, 10 | `open-answer.off_topic` / `fake` on honest answers; when >= 5% of the cohort (and >= 3 people) get the same label on the same question it is emitted with `designArtifact: true` and carries no weight; numeric-only answers on >= 30% of a question are treated as a number field miscast as open text |
| 5, 8, 11 | `duplicate-open.x2` / `empty_repeat` on natural repeats; `cohort_same_answer` artifact when >= 30% of the cohort gives the same text on a question |
| 6 | `matrix-pattern.straightline`, `cohort_flat_matrix` artifact when >= 40% of the cohort is flat; `mass-select.pattern`, `cohort_mass_block` artifact at >= 30% |
| 6, 13 | `pace.single_outlier` on one-second scales; `pace` has no artifact rule because it is relative to the cohort on the same question - a question that is quick for everyone produces no outliers, but a one-click question after a task does |
| 7 | `prototype-effort.instant_give_up`; `cohort_give_up_task` artifact when >= 10% of the cohort gave up with zero clicks on the same task; `website-bounce.cohort_bounce_task` likewise |
| 14 | nothing: the verdict carries `noContentToCheck: true` and `explain` prints "no open answers - the engine saw no free text from this respondent" |

Design artifacts are reported to the author and never weighed, but the guard needs a cohort
(>= 30 respondents by default) and a share threshold - below that, honest respondents pay for the
fault. Fixing the questionnaire before field is the only complete remedy.

## Sources (brief)

- "Don't know" on attitude items (R4b): Krosnick & Fabrigar 1997; Krosnick 1991 on
  satisficing - offering DK by default invites it without improving validity.
- Attention checks (R10): Oppenheimer, Meyvis & Davidenko 2009 (a long instructional
  manipulation check fails 35-46%, a short one 7%); Curran 2016 (instructed-response items with
  one unambiguous answer); Kung, Kwok & Brown 2018 (checks do not harm scale validity).
- Check-all vs forced-choice and grid satisficing (R15): Smyth, Dillman, Christian & Stern
  2006; Krosnick & Presser 2010.
- Open-item nonresponse (R12, R13, R21): Pew Research Center, "Writing survey questions".
- Blind spots: Pew Research Center 2020 found bogus respondents through text-similarity
  duplicates across respondents and always-approve answer patterns, not through IP or speed;
  machine-written answers pass fluency-based judges (arXiv 2508.01390, 2025).
