# screener-design: reference

The catalog of screener faults the skill checks for, the skeleton it builds from, and the
sources. Codes are stable identifiers of the entries; a person reads the entry's name in
words, the optional `tags:` line names it by slug (`multi-no-limit@S3`), and `evals/TAGS.md`
maps codes to slugs in one table.

Every code answers three questions: what the fault looks like, **what it breaks** in the
field (the sanction - a code without a sanction is not in the catalog), and how to repair it.
Examples are fictional; brand names stand for any market.

Vocabulary used below: *gate* = a question whose answer can end the screener; *exit* = the
option an honest non-fit picks plus the rule that routes it out; *target* = the option or
answer that qualifies; *list of the same kind* = options that are all brands, all activities,
all roles, so the target does not stand out.

## A. Gate design - who gets in

### A1 `no-screener` - no screener, and a brief criterion is not covered by a hire target

**What.** The survey has no screening questions while the brief names a criterion (role,
behavior, experience, ownership) that the recruitment targets do not verify.
**Breaks.** Non-fits reach the field; the client reports "not our audience" and asks for a
refund. Quality control cannot catch them: there is no criterion to check against.
**Fix.** Build the screener from the brief (skeleton below).
**Exception.** The audience is fully described by targets the recruitment service verifies
itself (demographics, catalog targets): no screener needed. Without such targets, "everyone
18+" is the only audience that needs no screener.

### A2 `no-exit` - a filtering question with no way out

**What.** The question filters by meaning ("do you use", "have you bought", "which apps are
installed"), the honest non-fit has an option that describes them, but nothing follows: no
rule routes that option out of the screener. The non-fit continues as a fit.
**Breaks.** The non-fit answers the body about an experience they do not have. The client gets
junk; quality control then bans an honest person as "contradictory", who loses the payment
and complains about the platform.
**Fix.** Every option an honest non-fit would pick routes to the end of the survey.
**Exception.** Profiling questions that do not filter (gender, city for segmentation) need no
exit. Boundary with A5: here the honest option exists but has no rule; in A5 there is no
honest option at all. When both are missing, both codes apply.

Bad: "Which of these apps are installed on your phone?" - options: bank app, taxi, food
delivery, maps, fitness tracker, none - no rule on "none" → next question.
Good: same question, rule: "none" selected, or the target not selected → end of survey.

### A3 `yes-no-gate` - yes/no on the qualifying behavior

**What.** The qualifying behavior is asked as a binary: "Do you use the voice recorder on your
phone?" yes/no, and "yes" passes.
**Breaks.** An imposter passes with one click. The share of non-fits in the data grows,
complaints and refunds follow.
**Fix.** A list of the same kind with the target hidden in it, a limit with a ranking basis
(A6) and an honest exit (A5): "Which phone features have you used most often in the last
month? Up to three" - calculator, voice recorder, document scanner, flashlight, pedometer,
notes, compass, translator, none of these; exit if the recorder is not selected.
**Exception.** Yes/no is fine for eligibility facts: 18+, consent, owning a computer.

### A4 `topic-leak` - the topic is revealed before the gate

**What.** The target brand, the client or the research topic is named before the behavior is
established: in the welcome text, in the question wording, or the target stands alone among
options of a different kind.
**Breaks.** The imposter knows what to answer; the filter stops filtering. Professional
respondents memorize the criterion for the next waves.
**Fix.** Remove the brand and the topic from the welcome text and from every question before
the gate; hide the target among options of the same kind. If the topic still shows through
(the brand is in the survey title, the category is narrow), add a question on field of work
with an exit for people who work in research, marketing or the client's industry: it cuts off
those who know how to pass. That is good practice, not a separate code.
**Exception.** After the gate the brand may be named: "How often do you use the X app" is
correct once X was selected in a list with an exit. If the preceding list has no exit (nobody
was screened out on it), the brand is still named to everyone and it is A4. Sensitive criteria (religion, health,
income) have no separate code: asking them openly is the same leak, and they hide in the same
kind of list with an honest exit.

Bad: welcome "Bank X is improving its mobile app. Your opinion matters!" then "Do you use the
Bank X app?" yes/no.
Good: no brand anywhere before the gate; the first question is "Which banks'
apps have you used most often in the last month? Up to three" - ten banks, "another bank",
"none"; exit if X is not selected; order randomized.

### A5 `no-none` - no honest option for the non-fit

**What.** A list where a person who fits none of the options has nothing to pick: no "none of
these", "I don't use any", "another city". The question cannot be skipped. An exit rule may
exist, but nothing triggers it.
**Breaks.** As in A2: the non-fit picks something at random, often the target, passes,
contradicts themselves in the body, and the honest person gets banned instead of the
questionnaire.
**Fix.** Add "none of these" (and "other" where the list is not exhaustive) and route it out.
A city list is the common case: twenty cities with no "another city" / "outside the country"
is A5 even when the list looks long.
**Exception.** Exhaustive lists (gender, yes/no/don't know) need no "none". A single "Other" in
a brand list is not an honest exit for a non-user: it implies that something is used.

### A6 `multi-no-limit` - multi-select without a limit and without a ranking basis

**What.** A filtering multi-select with "choose all that apply". No limit in the text or in
the settings, and no basis on which the respondent should choose.
**Breaks.** The imposter ticks everything and is guaranteed to hit the target. The "what do
you use" answer of those who passed is useless for analysis: everything is ticked.
**Fix.** A limit alone does not work: "up to 3" without a criterion reads as an arbitrary cap
and people still tick the first three. The limit must rest on a ranking basis: most often
("which you use most often"), main ("what you mainly do at work"), most important. A time
window ("in the last month") is not a basis: it bounds recency, not count, and in a month one
can honestly tick everything. With a basis, ticking everything becomes impossible by meaning,
not just by the counter, and the target's answer becomes checkable against what they say in
the body. The basis follows the brief. Active users wanted: limit + "most often". Any use
wanted: no limit, otherwise a rare but honest user does not make the top three and drops out
(as in A7); narrow the window instead ("in the last 7 days"), which shortens the list by
itself and makes "ticked everything" implausible and visible in the export.
**Exception.** Platforms differ: some store the limit, some only in the question text. Fake
"honeypot" options in the list are not required (a limit with a basis is enough).

Bad: "Which grocery chains do you shop at? Choose all that apply."
Good: "Which grocery chains did you shop at most often in the last month? Up to three" - ten
chains, "another", "I don't buy groceries myself"; exit if the target is not selected.

### A7 `primary-question` - "main" instead of "uses"

**What.** The brief asks for users or clients of X, and the gate is "which is your main
operator / bank / service" with one answer. Second form of the same fault: "which do you use"
with a single answer and no basis for choosing.
**Breaks.** False screen-out: the client asked for users of X and got only those for whom X
is the main one. Recruitment is longer and more expensive, the sample is biased, a narrow
audience cannot be filled.
**Fix.** Multi-select of what they use; "which one is the main one" afterwards, for
segmentation. For sets that are naturally small (SIM cards in use) no limit is needed.
**Exception.** The brief itself asks for "main" or "most often": no code. "Main" as a
segmentation question after the "which do you use" gate: normal. If the text says "choose all"
and the type is single-choice, that is C5.

### A8 `bad-order` - details before behavior

**What.** Frequency, recency or specifics are asked before a general question has established
the behavior itself.
**Breaks.** The first question reveals the topic and the right answer; from there as in A4.
The most common reason a screener gets rebuilt.
**Fix.** First "which of these did you use in the last 3 months, up to three", with an exit;
then "how long ago" for those who passed.

### A9 `vague-frequency` - frequency as adverbs

**What.** Frequency or recency given as "regularly / sometimes / rarely" instead of time
windows.
**Breaks.** The filter is not reproducible: "regularly" means something different to everyone,
waves are not comparable, the client gets "regulars" by self-perception.
**Fix.** Four windows: in the last 7 days / last 30 days / last 3 months / longer ago or never.
**Exception.** A frequency ladder with a unit ("several times a week / about once a week /
several times a month / less often") is not A9: it is countable and reproducible. A9 is a
quantifier with no unit: "regularly", "sometimes", "rarely", "often", "usually".

### A10 `criterion-mismatch` - the screener condition differs from the brief

**What.** The condition in the screener is not what the client asked: a different time window,
"has now" vs "had in the last year", a different exclusion.
**Breaks.** The client gets people they did not ask for and demands a refund; the survey is
rebuilt and re-fielded at the provider's expense.
**Fix.** Copy the window and the exclusion from the brief verbatim into the gate.
**Exception.** Without a brief the code is a hypothesis, flagged under "Confirm with the researcher".

### A13 `panel-profile-reasked` - re-asking what the recruitment target verifies

**What.** Gender, age, city or another criterion already set as a hire target is asked again
in the screener.
**Breaks.** Extra length. Two answers to one criterion (age as a target range and as
questionnaire bands) diverge in the report. The screener may drop someone the target already
admitted, and recruitment gets more expensive for nothing.
**Fix.** Drop it. The service that verifies the target asks and checks it itself.
**Exception.** Recruitment without verified targets: the service checks nothing and the
demographic block is the only check. Also: geography finer than the target knows, or age
groups needed for the report, stay in the questionnaire.

### A16 `unmasked-intent` - intent asked head-on

**What.** Selection by intent, interest or readiness is asked openly with an obvious "right"
answer: "how likely are you to open a card", "would you try", "do you know the brand". The
respondent sees who is wanted and answers to pass.
**Breaks.** The imposter picks the desired answer; nothing can be checked. The sample of
"ready" people is collected by guessing what the author wants to hear and does not reproduce
between waves.
**Fix.** The respondent must not be able to guess. Hide the intent in a multi-directional list
with a limit: "What are you planning to do first in the next 3 months? Up to three" - open a
deposit, get a credit card, change mobile operator, take a car loan, apply for a mortgage, buy
insurance, none of these; exit if the target is not selected; order randomized. Then "Which
banks are you considering first? Up to three" with "haven't decided yet".
**Exception.** If the intent is masked by a list with a limit, no code, even when the brief is
entirely about intent. If the topic is revealed in the wording, that is also A4. A likelihood
scale is fine in the body as a measurement, not as a gate.

## B. Option lists

### B2 `no-randomization` - a fixed-order list

**What.** An unordered list of four or more options shown in a fixed order. Scales (age,
frequency, city size, income, education) and binary questions are excluded.
**Breaks.** Top options are over-selected (position effect). If the target stands first, it is
a hint. Waves with a different order are not comparable.
**Fix.** Randomize; pin "other" and "none" at the bottom.

### B3 `short-list` - too few options around the target

**What.** Fewer than six options of the same kind around the target.
**Breaks.** The target is read at a glance; the imposter passes, as in A3.
**Fix.** Eight to twelve options of the same kind plus "other" and "none".

### B4 `huge-list` - thirty or more options

**What.** Thirty or more options in one question: regions, industries.
**Breaks.** Fatigue and random clicks: honest people drop out, non-fits pass, incidence is
distorted. Break-offs on this question.
**Fix.** Two levels (macro-region, then region), or "other city" with a text field, or the
criterion moved to a verified target.

## C. Wording and format

### C1 `overlap` - overlapping or gapped ranges

**What.** Age, income or frequency bands overlap or leave a gap ("18-25, 25-34"; "30-40,
41-58, 58-65").
**Breaks.** A person on the boundary picks arbitrarily: quotas fill with the wrong people, the
exit rule fires in the wrong place, report groups are shifted.
**Fix.** Mutually exclusive, jointly exhaustive bands: 18-24, 25-34, 35-44 ...
**Exception.** Not C1: bands written as "from 500k to 1M / from 1M" (the convention is clear
to respondents); a named city next to a size band ("Moscow / another city over 1M"); a
standard frequency ladder ("about once a week / several times a month") - its steps are
ordinal, not numeric. C1 needs the same number explicitly in two bands (18-25 / 25-34) or a
value no band covers (45-54 / 56+).

### C2 `leading` - a presumption or a hint in the wording

**What.** The question presumes or hints: "as an active user, you ...", "in which real-estate
segment do you work".
**Breaks.** The respondent cannot say "that is not about me", adapts to the presumption and
passes as a non-fit. Answers are suggested by the wording.
**Fix.** Neutral wording with the non-fit option present: "What is your field of work?" with
a list of the same kind and "other".

### C3 `jargon` - jargon or a preamble

**What.** Professional terms, panel-internal terms or a long definition inside the question.
**Breaks.** Random answers: honest people are screened out for not understanding, non-fits
pass. "Did not understand the question" grows in complaints.
**Fix.** Everyday words; a definition becomes options ("tools for mailing clients: X, Y, Z").

### C4 `double-barrelled` - two criteria in one

**What.** One option or one question carries two conditions at once ("I work in sales and
take part in choosing software").
**Breaks.** Someone who meets one condition of two cannot answer honestly. It is unclear who
was selected; the filter is not reproducible.
**Fix.** Two questions, each with its own exit.
**Exception.** A list of fields of work with "I don't work" in it, or a geography list that
mixes named regions with city-size bands, is one criterion with a non-fit option, not C4. C4
needs an option that is true only when two conditions both hold ("I work in sales and choose
the software").

### C5 `instruction-mismatch` - instruction contradicts the type

**What.** The text says "choose all that apply" and the question is single-choice, or the
reverse.
**Breaks.** Only the last click is stored: selection data is wrong, the logic fires
differently from what the author meant, honest people are screened out.
**Fix.** Align the type with the instruction (multi-select with a limit, or rewrite the
instruction).

### C6 `success-message` - a "you qualify" screen

**What.** A screen between the screener and the body tells the respondent they passed: "you
are exactly who we were looking for", "the check is over, on to the survey".
**Breaks.** The respondent hears "checks are over" and relaxes: attention drops, they stop
keeping their answers consistent. But checks are not over: quality control runs over the
whole questionnaire and can still screen them out later on traps and contradictions. A relaxed
honest respondent gives more random answers and gets banned more often; a professional one
stops trying and is caught less. Second, the screen promises a payment that quality control
or a quota can still withhold, and the complaint "you promised" follows.
**Fix.** Remove the screen; the next question follows directly. If a transition is needed
(new topic, a task), a neutral line without evaluation: "Now a few questions about ...".

### C7 `format-defect` - broken layout

**What.** Split options, empty lines, typos that change meaning, an option referenced by the
logic that is not in the list.
**Breaks.** The logic breaks (the option is not the one shown), trust drops, break-offs.
**Fix.** Clean the list; make sure every option named in a rule exists verbatim.

## D. Structure and logic

### D2 `long-screener` - a long screener without a reason

**What.** More than about ten screening questions, and the length comes from the design, not
from the brief. Length by itself is not a fault: the code always carries a cause, and the
cause decides what the skill can do.
**Causes.** (1) Empty questions: they neither filter nor feed a quota (gender, education,
employment, income, phone brand), including re-asking what a target verified (A13). Fix:
remove or move to the body. In real corpora this is the main cause: more than half of the
questions in a long screener are often empty. (2) One criterion smeared over several
questions: "do you use", then "how often", then "when last", where one list with a time
window and a basis-limited choice is enough (A6, A8). Fix: collapse into one question. (3) The
brief really has many criteria: cannot be shortened, not a fault. The skill puts the most
selective questions first so a non-fit leaves on the second question, not the tenth, and
checks whether some criteria are covered by verified targets.
**Breaks.** Break-offs, falling incidence, rising recruitment cost. Honest people leave
together with imposters, and they leave on questions that decided nothing.
**Fix.** Causes 1 and 2: remove or move the empty questions, collapse the smeared criterion
into one list with a window and a basis-limited choice. Cause 3: keep the questions, order
them by selectivity, move what a verified target covers out of the screener.
**Exception.** Only causes 1 and 2 are faults; cause 3 gets a recommendation on order, not a
code.

### D5 `logic-contradiction` - a rule that passes everyone or no one

**What.** A rule that admits everyone or no one, or contradicts the quotas: "continue if NOT
'none' selected OR the target selected"; "continue if 'under 18' not selected OR 'over 65'
not selected"; an exit on people a quota is waiting for.
**Breaks.** The screener formally exists but does not work: either everyone passes (non-fits
in the field) or nobody does (zero recruitment and a burnt invitation budget).
**Fix.** Write the rule from the exit side: "end of survey if 'none' selected OR the target
not selected"; "end if 'under 18' selected OR 'over 65' selected".

### D6 `body-contradiction` - the body re-asks the screener

**What.** The body asks a screener criterion again, in other words or in another form: age as
bands in the screener and as a number in the body; "used in the last 3 months" and "how often
do you use"; a masked list in the screener and a direct "are you a client of bank X" in the
body. The author believes this catches imposters on a contradiction.
**Breaks.** Honest people get banned by quality control for a "contradiction" the
questionnaire created: the respondent completed the whole survey and is left unpaid, a
complaint against the platform, one less in the sample and a top-up at the provider's cost,
while the client has already seen that answer in the data. In one real survey, re-asking age
produced 28 "contradictions" among 903 checked answers; in seven of them the number was one year
off the band edge, and those people were banned together with the ones who really gave two ages.
**Fix.** Remove the duplicate from the body. A check in the body does not screen anyone out:
if the criterion matters, the screener catches it. An open question about personal experience
in the body is a research-design decision for a specific hypothesis, not a substitute for
screening.

## Skeleton of a screener built from a brief

| Position | Purpose | Notes |
|---|---|---|
| S1 | Eligibility facts the service does not verify | Yes/no allowed here only (18+, consent); skip everything a verified target covers (A13) |
| S2 | Topic-masked behavior, multi with a basis-limited choice | Target among 8-12 options of the same kind, "other", "none"; exit if none or target not selected; randomized |
| S3 | Recency or frequency as time windows | Only for those who passed S2; four windows; exit on the windows the brief excludes |
| S4 | Qualifiers from the brief | Role, ownership, exclusions - each with its own exit; one criterion per question (C4) |
| S5 | Quota questions | No exit; only what a quota reads. Profiling the report needs but no quota reads (gender, income, habits) goes to the body: a respondent screened out later should not have answered it |

No information screens in the screener: the skill never adds a welcome or transition
screen, in either mode. A welcome the draft already has is judged only for a topic leak (A4)
or a "you qualify" message (C6). Four to seven questions. Most selective first. Drop a row
the brief does not need; never add a question that neither filters nor feeds a quota. Quotas
themselves are not screener logic: a quota question has no exit, and the quota counts are set
in the recruitment settings, not in the screener.

Question types a screener editor normally has: single choice, multiple choice (a limit in
the text, sometimes in settings), randomization, "none of the above", "other" with a text
field, exit logic per option; an information screen exists too, but the skill never adds one.
Do not design with grids, scales, rankings or open fields in the screener: write them for the
body if the brief needs them.

## Self-check (silent, before output)

Walk the codes in order - A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A13, A16, B2, B3, B4, C1,
C2, C3, C4, C5, C6, C7, D2, D5, D6 - over your own screener. Fix every hit before writing the
answer. In review mode, every entry that fired on the draft becomes one paragraph of "What
to fix and why" and, when tags were asked for, one tag.

## Sources

- Position effects and randomization: Krosnick & Alwin 1987; Tourangeau, Rips & Rasinski 2000.
- Check-all vs limited and forced-choice formats: Smyth, Dillman, Christian & Stern 2006;
  Callegaro et al. 2015.
- Yes/no and agree/disagree invite acquiescence: Krosnick & Presser 2010; Pew Research Center,
  "Writing survey questions".
- Vague quantifiers vs time windows: Bradburn, Sudman & Wansink 2004, "Asking Questions".
- Panelists learn screening criteria over waves: Hauser & Schwarz 2016.
- Screener practice (<= 10 questions, concrete recall windows, "none of the above", do not
  re-ask profile variables): User Interviews screener field guide; Kantar, "Mastering
  screening questions".
- Stated length and break-offs: Galesic & Bosnjak 2009.
