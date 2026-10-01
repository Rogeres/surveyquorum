# screener-design: reference

## Audience difficulty rubric (1-10)

| Score | Audience | Typical screening conversion (assumed, not measured) | Recruitment route |
|---|---|---|---|
| 1-3 broad | General population, common demographics, widespread behaviors | 15-30% | Any general panel |
| 4-6 medium | A common occupational group, regular users of a specific but widespread service, a common life-stage group | 8-15% | General panel with a custom screener; expect quota imbalance between segments |
| 7-8 narrow | A specialist role, a specific budget authority, owners of an uncommon device or contract | 2-7% | Specialist panels, professional communities, referral recruitment; a general panel will reject 90%+ |
| 9-10 rare | Senior decision makers, exclusive specializations, very low-incidence behaviors | < 2% | Manual recruitment through networks and agencies only |

Raise the score by one when: the brief needs several segments with different incidence (the
rarest segment sets the pace); the geography is restricted to a few cities; the behavior must
be recent (last month) rather than ever.

Lower it by one when: the qualifying behavior is common and recent recall is easy (<the
qualifying behavior> in the last 30 days).

The conversion bands are working assumptions; panels quote feasibility in their own incidence
terms. The value of the role drives the fraud incentive: the narrower and better paid the
audience, the more imposters per honest respondent, and the more a small population suffers
from each one.

For 6 and above, the score has one direct consequence: the questionnaire body must carry an
open experience verifier (see the "Difficulty >= 6" section of `SKILL.md`).

## Standard funnel

| Position | Purpose | Notes |
|---|---|---|
| S1 | Welcome and context | Realistic completion time stated; topic described generically ("everyday habits") |
| S2 | Gender | Only when quotas need it and the panel profile does not already hold it |
| S3 | Age | Always, unless the panel profile holds it; ordered bands, not randomized; under-age band exits |
| S4 | Geography | Only when the brief restricts it; excluded regions are listed among others so that the exclusion itself does not become a hint - this is about not leaking the criterion, not about the people in those regions; "Other city" with a text field |
| S5 | Topic-masked context, multi, limit 2-3 | Target is one of 8-10 neutral categories; pass on either of two adjacent targets; exit option present |
| S6 | Direct behavior, single | Four time windows (last 30 days / last 3 months / longer ago / never); pass the windows the brief names; never "primary channel" |
| S7 | Tools or platforms, multi with limit (or a yes/no grid) | ~10 real options + 3 honeypots + "Other" + exit; two or more honeypots -> out, one -> pass and tag `honeypot_1` |
| S8 | Most recent of the above, single | Same real list, no honeypots needed; asked only after S7 collected the full set |

Five to eight questions in total, one per page. Drop a row when the brief does not need it;
never add a question that neither filters nor segments.

## Honeypot naming rule

A honeypot is of the same kind as the real options around it: a fake tool in a list of tools, a
fake provider in a list of providers, a fake product line in a list of product lines. Its name
follows the naming conventions of that market so that it does not stand out, and it is checked
against the real market before use. Vary the three naming styles: an enterprise line extension
("<known vendor> <product-line word>"), a startup-style coinage ("<coined word>"), a sub-brand
of a known name ("<known brand> <suffix>"). Make them sound native to the market and language
of the audience. Mixing real options into the same list lowers false claims on the fake ones.

## Self-check (run silently before output)

1. Demographics first, in ordered bands, under-age band exits; nothing the panel profile
   already holds is re-asked?
2. Before every "how often / how long / which exactly" there is a general behavior question
   that establishes the behavior and has an exit?
3. No yes/no on the qualifying behavior or on attitudes; yes/no only for eligibility facts;
   frequency as time windows, not adverbs?
4. Target options masked among ~10 of the same kind; "Other" and "None of the above" present;
   targets not first; order randomized on non-scale lists?
5. No question whose wording reveals the right answer; no question that neither filters nor
   segments?
6. Every exit option has an explicit routing rule; exclusion rules ("not X, Y or Z") spelled out?
7. Every multi-choice carries a hard limit of 2-3 and the instruction "choose up to N", or is
   a yes/no grid?
8. Options non-overlapping and exhaustive; logic does not contradict the brief?
9. Three honeypots per brand/tool question, varied in style, verified not real, in randomized
   positions; pass rule "two or more -> out, one -> pass and tag `honeypot_1`"?
10. Realistic completion time stated, not padded; one question per page?
11. Difficulty >= 6 -> the body requirement section is present with one verifier wording that
    asks for specifics?
12. All respondent-facing text in the respondent's language; no jargon?

Fix every discrepancy before writing the answer. Do not describe the check in the output.

## Anti-patterns (never produce)

- A first filter that lists the target profession or platform directly.
- A multi-choice filter without a limit ("pick everything to pass").
- "What is your primary channel / tool / platform?"
- A yes/no question on the qualifying behavior ("Do you use X?").
- One honeypot, or a honeypot that is a negative option, or a pass rule that screens out on a
  single honeypot.
- A filter without an exit option.
- A stated duration padded above the realistic completion time.
- A screener for a difficulty >= 6 audience with no verifier required in the body.

## Sources (brief)

- Stated length and participation: Crawford, Couper & Lamias 2001; Galesic & Bosnjak 2009 -
  a longer stated duration lowers starts and raises break-offs.
- Forced-choice (yes/no per item) vs check-all: Smyth, Dillman, Christian & Stern 2006 -
  more endorsements and deeper processing per item; Callegaro et al. 2015 review.
- Yes/no and agree/disagree on attitudes invite acquiescence: Krosnick & Presser 2010; Pew
  Research Center, "Writing survey questions".
- Honest false claims on fake brands: Quirk's, "When fake brands are used to get real data"
  (1-3% per fake name; 9-13% of respondents claim four or more) - hence the two-or-more rule.
- Panelists learn attention checks over waves: Hauser & Schwarz 2016.
- Screener practice (<= 10 questions, concrete recall windows, "none of the above", one
  question per page, do not re-ask profile variables): User Interviews screener field guide;
  Kantar, "Mastering screening questions".
- Open-ended non sequiturs as the strongest marker of bogus respondents: Pew Research Center
  2020, "Assessing the risks to online polls from bogus respondents".
- Machine-written answers pass fluency checks: arXiv 2508.01390 (2025); "A Penny for
  Your Prompts" 2025.
