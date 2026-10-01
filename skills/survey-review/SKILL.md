---
name: survey-review
description: >-
  First, partial version (the full one follows shortly). Reviews the body of a questionnaire before field and reports the constructions that will
  make honest respondents look like junk or leave the screening engine nothing to judge -
  skip logic that asks people about things they said they do not have, open questions about an
  unseen image, open fields used as yes/no or number inputs, near-duplicate open questions,
  memory quizzes read as contradictions. One hard requirement only: the questionnaire must not
  be empty for its audience - there has to be something verifiable to judge quality on.
  Everything else is a suggestion. Takes the questionnaire (text, JSON or an export) plus an
  audience description and returns at most 12 findings ordered by severity, each naming the
  detector that is affected and carrying a ready-to-paste fix, ending with what the engine will
  not be able to check.
when_to_use: >-
  Trigger phrases: "review my questionnaire", "check this survey before field", "will this
  survey give the engine something to check", "why are honest respondents getting flagged",
  "is there anything verifiable in this questionnaire", "проверь анкету", "ревью анкеты",
  "ошибки в анкете", "почему банят честных", "что движок не сможет проверить".
arguments: [questionnaire, audience]
argument-hint: "<questionnaire text or path> <audience description>"
---

# Survey review

You review the **body** of a questionnaire before it goes to field. The screener is the
`screener-design` skill's job; if the user gives you only a screener, hand over.

The point of view is narrow on purpose: you are not checking methodology in general, and you
are not asking the author to add checks. You look for constructions that produce **data that
looks like respondent junk** - the engine (`surveyquorum run`) or a human reviewer blames the
respondent when the questionnaire is at fault - and you confirm the one thing the author must
have: **the questionnaire is not empty for its audience.** For a narrow audience that means at
least one open question about personal experience; for any audience, at least one block whose
answer can be wrong, incoherent or low-effort. Everything else is optional, offered as a
suggestion the author may take or leave.

Full reference - the audience difficulty rubric, the 14 fault classes, detection rules
R1-R28, counter-examples C1-C7 and the detector map - is in
`${CLAUDE_SKILL_DIR}/reference.md`. Read it before reviewing. Do not re-implement detector
arithmetic in prose; name the detector and the signal.

## Inputs

- **Questionnaire** (`$questionnaire`, required): pasted text, a JSON export, or a file path.
  Ordered blocks with type, text, options, limits, skip logic and required flags, as far as
  they are known.
- **Audience** (`$audience`, required): who the survey is for, 1-3 sentences; needed for the
  "not empty" check and the targeting rules. If it is missing, ask for it once.

## Procedure

1. **Normalize the questionnaire.** Build an ordered list of blocks: index, type (`context`,
   `choice` single/multi, `scale`, `matrix`, `open`, `prototype`, `firstclick`, `website`,
   `cardsort`, `ranking`, other), text, options, choice limit, required flag, skip logic, and
   whether an image or screen is shown with it. When the input is prose, infer types and say so;
   when logic is not given, state the assumption "no branching" explicitly - it drives R1-R4.
2. **Rate the audience** on the rubric in `${CLAUDE_SKILL_DIR}/reference.md`, section
   "Audience difficulty" (1-10). Write the number down; R26-R28 depend on it.
3. **Check that the questionnaire is not empty for this audience.** Count verifiable content:
   open blocks that ask about personal experience with a minimum length, behavioral
   quantities (how many, how much, which), knowledge questions answerable only from
   experience, and any block whose answer can be wrong or incoherent. Difficulty >= 6 with no
   open experience question, or any audience with nothing judgeable at all, is the critical
   finding (R26, class 14).
4. **Walk the rules R1-R28** over the block list. For each hit, check the counter-examples
   C1-C7 first - a rule that fires on a guarded case is a false alarm, drop it.
5. **Write the report.**

## Report format

Order findings by severity: **critical** (the data cannot be judged, or honest respondents
will be read as contradicting themselves) -> **medium** (a detector will misfire on a visible
share of honest respondents, or a suggestion that would let one more detector work) ->
**low**. Within a severity, the earlier block comes first.

**At most 12 findings.** Merge findings that share one fix (one skip rule that repairs three
dependent blocks is one finding listing all three). If more remain, keep the 12 highest and
say "N further low-severity findings omitted". **Report only what will change the data; skip
cosmetic notes.** A finding that does not alter what a detector reads, or what the author will
see in `surveyquorum run`, is not a finding.

For each finding, four lines. The header carries a confidence word: `certain` only when the
skip logic or block type that the rule depends on is given in the input, `likely` when it was
inferred or assumed.

```
[CRITICAL, likely] Class 1 - asked about something they said they do not have   blocks 4 -> 5
Where:  block 4 "Have you used <the feature> in the last month?" allows "No"; block 5 "Why do
        you prefer <the feature> over <the alternative>?" is shown to everyone (no skip logic
        given - assumed none).
Data:   respondents who said "No" write "I don't use it" -> open-answer flags off_topic;
        coherence pairs block 4 with block 5 as a contradiction; two such answers ->
        duplicate-open x2. Honest non-users become review/block cases.
Fix:    skip block 5 when block 4 = "No", or add the option "I don't use it" to block 5.
```

Non-critical findings keep the same four lines, but the "Fix" line is a suggestion and reads
like one: "Consider ..." or "If you want `<detector>` to work on this block, ...".

Then two closing sections:

**What the engine will NOT be able to check in this questionnaire.** Derive it from the block
types present. No open blocks -> content is invisible (`open-answer`, `duplicate-open` and the
body half of `coherence` have nothing to read; the verdict file will carry `noContentToCheck`).
No matrices -> no `matrix-pattern`. No multi-select with 5+ options -> no `mass-select`. No
prototype / first-click / website tasks -> those detectors are idle. No screening answers in
the export -> no screening-vs-body coherence. Fewer than ~30 respondents expected -> cohort
statistics (pace, consensus, design-artifact guards) do not run. State each as one line; it is
information, not a request to add blocks.
Then always add these four fixed lines, whatever the questionnaire contains:

- Fluent, on-topic machine-written answers pass `open-answer`.
- Identical text across different respondents (fraud farms) is not compared; `duplicate-open`
  works within one respondent.
- An always-agree profile is not a detector.
- Identity, geography, VPN and device are outside the contract.

And one closing line: *Out of scope here: double-barreled, leading or loaded wording and
unbalanced scales - run a general wording review separately.*

**Design-artifact guards that will fire.** Where a fault will affect 5-40% of the cohort on one
block, say so: the engine will report it as a design artifact (no weight, listed for the
author) and the verdict count will drop after the author fixes the block. This tells the user
which finding they will also see in `surveyquorum run` output.

## Severity rules

Only two things are ever **critical**:

- **Class 14 / R26** - nothing verifiable for the audience: difficulty >= 6 with no open
  question about personal experience, or any audience with no block whose answer can be wrong,
  incoherent or low-effort. The questionnaire is empty for the engine and for a human reviewer
  alike.
- **Class 1 / R1-R3** - skip logic that asks respondents about things they said they do not
  have. Honest answers become contradictions.

Everything else is **medium** or **low** and is phrased as a suggestion, never as a
requirement:

- **Medium**: R4a, R5-R17, R19-R22, R24, R27-R28.
- **Low**: R18, R23, R25.

Each finding carries the ready-to-paste fix: a rewritten question, an added option, a changed
block type, or a skip rule - one concrete change per finding, not a list of checks to add.
Authors fix things when the text is already written.

## Illustration

An audience defined by a recent behavior, rated 7/10, and a questionnaire of scales only with
no open question: one critical finding (R26 - nothing verifiable), a suggested wording for one
open experience question, and the "what the engine will NOT check" section saying the content
detectors are idle. A broad audience with the same scales-only questionnaire: no critical
finding; the same closing section, offered as information.

## Tone and limits

- Report only what the rules find. No general methodology advice, no praise, no "add more
  checks".
- When the questionnaire is good, say so in two lines and still produce the "what the engine
  will NOT be able to check" section - it is useful on its own.
- If the audience description is missing, ask for it once; R5 and R26 cannot run without it.
- Quote the questionnaire's own wording in "Where"; never invent respondent answers as if they
  were observed - the "Data" line describes what will happen, not what happened.
