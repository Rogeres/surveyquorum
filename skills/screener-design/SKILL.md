---
name: screener-design
description: >-
  Designs or repairs the screening questionnaire of a panel survey from an audience
  description: audience difficulty 1-10 with reasoning, a 5-8 question screener on the
  behavior-first funnel (target masked among ~10 options, non-overlapping options, a graceful
  exit everywhere), three honeypots per brand or tool question, and - for difficulty 6 and
  above - an open experience verifier for the questionnaire body. Use when the user describes
  who they want to survey and asks for a screener, honeypots, or an estimate of how hard the
  audience is to reach.
when_to_use: >-
  Trigger phrases: "design a screener", "build screening for", "how hard is this audience",
  "honeypots for", "review my screener", "спроектируй скрининг", "построй скринер",
  "скрининговая анкета", "какие ханипоты", "оцени сложность аудитории", "проверь скрининг".
arguments: [audience, draft]
argument-hint: "<audience description> [draft text or path]"
---

# Screener design

You design the **screening** part of a panel survey: the questions that decide who gets in.
A good screener keeps imposters and click-through respondents out without telling honest
respondents what the right answers are. Everything below is universal; nothing depends on a
particular survey tool or panel.

The review of the questionnaire body is the `survey-review` skill; hand over to it when the
user brings the whole questionnaire. The one rule about the body that stays here is in the
verifier section below: the body must contain something verifiable for the audience - at least
one open experience question for a narrow audience.

## Inputs

- **Audience** (`$audience`, required). Extract: the qualifying behavior (what they do, how
  often, how recently), identity (role, employer type, ownership), demographics and quotas,
  geography, exclusions, and the research topic. If the qualifying behavior is missing, ask one
  question before designing - you cannot write a behavior funnel without it.
- **Draft** (`$draft`, optional). Review it against the same rules; output the repaired
  screener plus a list of what changed and why.

## Output (in this order, nothing else)

1. **Audience reading** - one sentence: who, where, which behavior qualifies, which topic must
   stay hidden.
2. **Audience difficulty: N/10** - two or three sentences of reasoning on the rubric in
   `${CLAUDE_SKILL_DIR}/reference.md` and the recommended recruitment route.
3. **Screener** - 5-8 questions. For every question: position (S1...), type (`context`,
   `choice single`, `choice multi` with a hard limit of 2-3, or `grid yes/no per item`),
   question text, options with the target(s) and honeypots marked, pass/fail logic in words,
   randomization yes/no, and the exit option. Write question and option text in the language
   the respondent will read (default: the language of the audience description).
4. **Honeypots** - the fake options you inserted, one line each: name, why it sounds plausible,
   why it is fake. Three per filtering question about brands, tools or platforms.
5. **Body requirement** (only when difficulty >= 6) - the ready-to-paste open experience
   verifier, see below.
6. **What to confirm with the client** - only if the brief left a criterion undefined.

Run the self-check in `${CLAUDE_SKILL_DIR}/reference.md` silently before producing the
output. Do not narrate it.

## Rules

**Behavior first, then depth.** Establish the behavior itself in a general question with the
target hidden among distractors before asking frequency, recency or details. Never open with
"How long have you been using X?" - the respondent learns the topic and the right answer at once.
Order: demographics -> general behavior with exit -> qualifiers for those who passed ->
quota and segmentation questions.

**No yes/no on the qualifying behavior or on attitudes** - it reveals the criterion and
invites acquiescence. Yes/no is allowed for eligibility facts (legal age, consent, willingness
to be recontacted). A frequency or recency question has at least four levels, written as time
windows (`in the last 30 days / in the last 3 months / longer ago / never`), not as vague
adverbs ("regularly", "sometimes"). A filter on brands or tools is a multi-choice with a hard
limit; where a limit would fail honest multi-role respondents, a forced-choice grid (yes/no per
item) is an acceptable alternative - it is processed more deeply than check-all-that-apply.

**Mask the target.** Target brands, actions and platforms sit among roughly ten options of the
same kind, plus "Other" and "None of the above". Two targets and "Other" is self-selection.
Target options never stand first; randomize option order on every list that is not a scale.

**Never ask for the "primary" channel or tool.** Multi-channel professionals fail it. Ask
whether they do the thing, with time windows; ask which tools in a limited multi-choice; ask
"which one most recently" only after the full list has been collected.

**Allow multiple identities.** The topic-masked question passes on two adjacent target options
(a respondent whose role spans two adjacent categories may pick either one).

**Every filtering question has a graceful exit** that routes to the end of the survey. Without
it an honest non-fit must lie to continue, and lies propagate into the body.

**Options do not overlap.** Age bands, budgets, frequencies and categories are mutually
exclusive and jointly exhaustive.

**No escape clauses.** Avoid "if you can remember", "what frustrates you", "what do you like" -
anyone can answer them. Verify through factual recall or universal experience.

**Everyday language.** No industry jargon, no panel-internal terms in question text.

**State the realistic completion time** in the welcome text. Overstating lowers starts and is
dishonest to the panel; speed is judged against the cohort, not against the stated time.

**Only questions that filter or segment.** A question that does neither is removed.

## Honeypots

A honeypot is a plausible but non-existent option in a question about brands, tools, platforms,
products or services. **Two or more honeypots selected -> screen out. Exactly one -> pass, and
tag the respondent `honeypot_1` in the export for post-field review** - a small share of honest
respondents claims a fake name, so one hit alone is not proof.

- Three per filtering question, never one - one is learned after a few waves.
- Names sound native to the market and vary in style: one corporate line extension, one
  startup-style brand, one sub-brand of a well-known company.
- Check that none is a real product. If unsure, replace it.
- Never make the honeypot a negative option ("I don't use any") - that is a legitimate exit.
- Place honeypots in randomized positions.
- In the field, monitor hits per fake name; replace any name that more than 3 % of
  respondents select.
- A honeypot hit is a screen-out, not a ground for a panel complaint; `panel-complaint` never
  files one.

The naming rule (fake options of the same kind as the real ones, three styles) is in
`${CLAUDE_SKILL_DIR}/reference.md`.

## Difficulty >= 6: the body must contain a verifier

A narrow or expensive audience (a rare role, a specific budget authority, a low-incidence
behavior) passed through a screener of closed questions is still a screener of closed
questions: an imposter who guessed right is indistinguishable inside the survey, to a human and
to the engine alike. Require at least one **open experience verifier** in the body, with a
minimum length. This is the only requirement this skill places on the body. Formula:

> "Describe the last time you <qualifying behavior>: what exactly, where, when, and what came
> of it. At least two sentences."

Give the user the wording adapted to the audience and tell them where to put it (not among the
first two blocks; imposters try hardest at the start). Fluent, generic answers can be
machine-written, so the verifier asks for specifics (where, when, how much, outcome) rather
than opinions. For difficulty <= 3 say nothing - the cost of imitation is low and verification
is not worth the respondent's time. The full review of the body is `survey-review`'s job.

## Illustration

An audience defined by a recent behavior, with no named tools or brands in the brief: the
screener opens with demographics, then a topic-masked context question with the behavior hidden
among ~10 of the same kind and an exit, then recency as four time windows. No honeypots, because
there is no brand or tool question to put them in. Difficulty is read from the recency window and
the incidence of the behavior; at 6 or above the output ends with one open experience question
for the body.

## Reviewing a draft

Walk the draft question by question against the rules above. Report in this order: topic
leaks, yes/no filters on the qualifying behavior or unlimited multi-select filters, missing
exits, "primary"-type questions, overlapping options, missing honeypots or a pass rule that
screens out on a single honeypot, padded duration, missing verifier for difficulty >= 6. Then
output the repaired screener in full - authors apply fixes when the text is ready to paste.
