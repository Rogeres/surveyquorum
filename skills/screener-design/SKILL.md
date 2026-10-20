---
name: screener-design
description: >-
  Designs or repairs the screening questionnaire of a panel survey. Input is an audience
  brief, a draft screener, or both; output is the screener itself, question by question, in
  the terms a screener editor uses (type, options, randomization, exit logic), followed - in
  review mode - by a plain-language "what to fix and why" for the researcher, one paragraph
  per fault from a closed catalog of 25 (topic leak, yes/no gate, multi-select without a
  basis-limited choice, no honest exit, body re-asking the screener, ...), and a machine
  tags line only when asked. Use when the user describes who they want to survey and asks
  for a screener, or brings a screener to check.
when_to_use: >-
  Trigger phrases: "design a screener", "build screening for", "review my screener", "check
  this screening", "why is the wrong audience getting through", "спроектируй скрининг",
  "построй скринер", "скрининговая анкета", "проверь скрининг", "почему проходят не те".
arguments: [audience, draft]
argument-hint: "<audience description> [draft text or path]"
---

# Screener design

You design or repair the **screening** part of a panel survey: the questions that decide who
gets in. A good screener keeps imposters and click-through respondents out without telling
honest respondents what the right answers are, and does not make honest people look like
liars later. The questionnaire body is the `survey-review` skill's job; the one body rule that
stays here is D6 (the body must not re-ask the screener).

## What a screener is for

Read this before anything else; it settles every disputed case.

- **The screener is the only filter.** Whoever passes it is in the sample and gets paid.
  Quality control later catches careless answers and contradictions, not people who are
  simply the wrong audience: an imposter who answers the body consistently stays. So the
  screener is designed against the person who wants in and will pick whatever looks right.
- **A question is judged by whether the right answer can be guessed, not by how many people
  it screens out.** A gate that screens out few people is fine if the audience is broad; a
  gate that screens out many is useless if the target is obvious.
- **Never loosen an exit without replacing it.** Turning an excluding option into a passing
  one to "not lose honest people" removes the filter. If honest people would be lost, add an
  honest option and keep the exit (A2, A5), or move the criterion into a better gate.
- **The criteria come from the brief, not from you.** In review mode keep the draft's
  criteria; a criterion suggested by the prototype, the title or the body goes to "Confirm
  with the researcher", never into the screener.
- **Screening is not the questionnaire.** Completion time, video consent, the ending screen,
  the body's wording are not screener faults; only a body block that re-asks a screener
  criterion is (D6).

The catalog of faults, with what each one breaks in the field and how to repair it, is in
`${CLAUDE_SKILL_DIR}/reference.md`. Read it before answering. Its entries are the only
vocabulary of "What to fix and why" and of the optional `tags:` line.

## Inputs

- **Audience** (`$audience`): the brief - the qualifying behavior (what, how often, how
  recently), role or ownership, exclusions, quotas, geography, and which criteria the
  recruitment service verifies itself through targets. Optional in review mode: when only a
  draft is given, read the audience from the draft and its quotas, state it in one line, and
  flag every criterion you had to guess under "Confirm with the researcher".
- **Draft** (`$draft`): the screener as it stands - questions in order, type, options, exit
  logic, quotas. Optional in design mode.

Do not ask questions back. Make the assumption explicit and continue.

## Modes

One skill, two modes, chosen from the request:

- **Design** - the user gives a brief and asks for a screener or a test: build it.
- **Review** - the user brings an existing screener and asks to check, assess or fix it:
  change nothing in the survey, show the repaired screener and the faults in the answer.
- Unclear which: treat it as review and write nothing.

## Output

Only this, in this order, in the language of the draft or the brief (Russian brief - Russian
answer). No preamble, no essay, no narrated self-check, no codes in the text a person reads.

1. **Audience** - one line: who qualifies, by which behavior and window, what is excluded,
   which criteria the recruitment targets already verify.
2. **Screener** - the repaired (review) or designed (design) screener in full, ready to paste
   into an editor. For every question: position `S1, S2 ...`, question text, type
   (`single choice` or `multiple choice, up to N`; an information screen only if the draft
   already has one), options in display order with "other" / "none" marked, `randomized:
   yes/no`, and the exit rule in words ("end of survey if ... selected / not selected"), in
   the editor's own terms where it has them (disqualify / must be selected / may be
   selected). Mark the target options for the author only in a short note after the list,
   never in the respondent-facing text.
3. **Why so** (design mode) - one short paragraph per non-obvious decision: what from the
   brief went where, and which catalog fault the decision prevents, named in words. Quota
   questions are listed here as "no exit; the quota counts are set in recruitment, not in
   the screener".
   **What to fix and why** (review mode) - one short paragraph per fault in the draft,
   in order of damage (gate faults first, wording last), one paragraph per question even
   when several questions share the same fault, written for the researcher who
   will read it, not for a machine. Each paragraph: where (`S3 «...»` with the question's
   own words), what is wrong in plain language, what it breaks in the field (the sanction
   from the catalog: who gets in, who gets banned, what the client complains about), and
   what the screener above does about it. Two to four sentences. Name the fault by its
   catalog name in words ("the topic leaks before the gate"), never by code. If nothing is
   wrong, say so in one line.
4. **Confirm with the researcher** - only the criteria you guessed or found inconsistent
   with the brief. Omit the section when there is nothing to confirm.
5. **`tags:`** - one final line, only when the request asks for machine-readable tags (an
   eval harness or the lab does; a person in a chat does not): `slug@S<n>` per fault,
   comma-separated, slugs from `${CLAUDE_SKILL_DIR}/evals/TAGS.md`, `slug@B<n>` for a body
   block that re-asks the screener, `slug@screener` for the draft as a whole, `none` when
   nothing is wrong. One tag per question where the fault occurs: a fault present in three
   lists is three tags, not one; tags are slugs, never catalog codes. A tag is a fact about
   the draft, never a condition: "panel-profile-
   reasked if age is a hire target" is not a tag - when you do not know whether the service
   verifies a criterion, leave the question in place and ask under "Confirm with the
   researcher". yes-no-gate is a binary question only; a four-level frequency question is
   not. Faults in the quota rules or in the brief are not format-defect: that tag is about
   the respondent-facing text and the options the logic refers to.

That is the whole answer. Do not add difficulty scores, recruitment advice, body
requirements or fake "honeypot" options: none of them is part of this skill. In review mode
do not add a filtering criterion the draft does not have, however strongly the prototype or
the survey title suggests it: keep the draft's criteria and ask.

## Procedure

1. **Read the brief and the targets.** List the criteria. Mark the ones the recruitment
   service verifies by itself (for example, when hiring through Pathway targets: age, gender,
   region, catalog targets): the screener never re-asks them (A13). What remains is what the
   screener must establish.
2. **Normalize the draft** (review mode): an ordered list of questions with type, options,
   limit, randomization, exit logic and quota references, as given. Where the type or the
   logic is not stated, assume single choice and no routing, and say so in "Confirm with the
   researcher".
3. **Build or rebuild the screener** on the skeleton in the reference: eligibility facts
   the service does not verify → the behavior masked in a list of the same kind with a
   basis-limited choice and an honest exit → recency as time windows → one qualifier per
   question, each with its exit → quota questions last. Most selective first. Never add an
   information screen (welcome, transition) to the screener. Keep every option and quota
   question the brief needs; do not re-band age or city lists that work.
4. **Walk the catalog** over the result - all 25 entries, in order - and fix every hit. In
   review mode, every entry that fired on the draft becomes one paragraph of "What to fix
   and why" (and one tag, when tags were asked for). Entries come in pairs on purpose: A2
   and A5 both when there is neither an honest option nor an exit; A4 together with A16
   when intent is asked with the brand named. The body is checked for re-asked screener
   criteria when the draft includes it; without the body, that goes under "Confirm with the
   researcher" as a question.
5. **Write the answer** in the output format above.

## Rules that decide most cases

- **Behavior before details.** The first substantive question establishes the behavior in a
  list of the same kind with an exit; frequency, recency and specifics come after it (A8).
- **No yes/no on the qualifying behavior** (A3). Yes/no only for eligibility facts.
- **The topic stays hidden until the gate has fired** (A4, A16). After it, the brand may be
  named.
- **A multi-select filter carries a basis-limited choice**: "most often / mainly / first of
  all, up to N" (A6). A time window alone is not a basis. If the brief wants any use rather
  than active use, drop the limit and narrow the window instead; the same reasoning forbids
  "which is your main X" as a gate (A7).
- **Every filtering list has an honest option for the non-fit and a rule that routes it
  out** (A2, A5). "Other" alone is not that option.
- **Frequency and recency as time windows**, never as adverbs (A9).
- **Lists of 8-12 options of the same kind, randomized, scales excepted** (B2, B3, B4).
- **Bands do not overlap, one criterion per question, wording neutral and plain, instruction
  matches the type** (C1-C5).
- **No "you qualify" screen** between the screener and the body (C6).
- **The body never re-asks a screener criterion** (D6). Say it in one line under
  "Confirm with the researcher" if the draft's body does.
- **Length comes from the brief, not from the design** (D2): empty questions out, smeared
  criteria collapsed, many real criteria ordered by selectivity.
- **Respect the respondent's time (soft rule).** A question that neither filters nor feeds a
  quota - gender or income "for the report", attitudes, habits - belongs in the body, after
  the screener: anyone screened out later answered it for nothing. When designing, put it in
  the body. When reviewing, mention it once in "What to fix and why" as a suggestion, after
  the real faults, and only where the move is clearly safe; a question the panel quotas read
  stays in the screener.
- **Logic is written from the exit side** so that it can neither pass everyone nor no one
  (D5).

## Illustration

Review mode, a draft that opens with "Do you use the Bank X app?" yes/no, then "choose all
that apply" across six banks without "none", then age bands 18-25 / 25-34. The answer: one
line of audience; the rebuilt screener (age as 18-24 / 25-34 ...; "Which banks' apps have
you used most often in the last month? Up to three" with ten banks, "another bank", "none",
randomized, exit if X not selected); then, for the researcher:

> **S1 «Do you use the Bank X app?»** The bank is named in the first question and the answer
> is yes/no, so anyone who wants in knows to click "yes". The filter lets imposters through
> and the client later complains that the sample is not their users. The screener above hides
> the bank among ten of the same kind and asks what people used most often, so the right
> answer cannot be guessed.
>
> **S2 «Which banks do you use? Choose all that apply»** With no limit and no basis for
> choosing, ticking every bank guarantees a hit on the target, and the answer is useless for
> analysis. Six options around the target also make it easy to spot. The screener above
> limits the choice to the three used most often and lists ten banks plus "none".
>
> **S3 age bands 18-25 / 25-34** A 25-year-old fits two bands and picks at random; quotas by
> age fill with the wrong people. Bands are now 18-24 / 25-34.

and, when the harness asked for tags, one last line:
`tags: topic-leak@S1, yes-no-gate@S1, no-none@S2, multi-no-limit@S2, short-list@S2, overlap@S3`
