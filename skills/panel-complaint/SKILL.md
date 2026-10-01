---
name: panel-complaint
description: >-
  Drafts complaints to a respondent panel from surveyquorum verdicts: runs `surveyquorum
  complaints` with the panel's profile file, the language and the human decisions file, quotes
  questions verbatim from the dataset, explains which blocked respondents are eligible (one
  ground panels accept, 500 characters or less) and which are not and why, and files a
  complaint for a review respondent only after the arbiter or a human has confirmed it. Use after quorum-screen when the
  user wants to report low-quality respondents or request replacements.
when_to_use: >-
  Trigger phrases: "draft complaints to the panel", "report these respondents", "ask the panel
  for replacements", "which bans can we send", "panel complaint CSV", "составь жалобы в
  панель", "отправить жалобы", "запросить замену респондентов", "какие баны можно отправить",
  "жалоба на респондента".
arguments: [verdicts, dataset, decisions]
argument-hint: "<verdicts.json> [dataset.json] [decisions.json]"
---

# Complaints to the panel

A complaint is a short factual text the panel can verify: **one ground, 500 characters or
less**, with the numbers or the quote that prove it. Mixed texts ("a combination of signals")
are refused. The engine's verdict stands for the client's data whether or not a complaint is
filed; the complaint is a separate, narrower act.

Inputs: `$verdicts` (required - the file `surveyquorum run` or `resume` wrote), `$dataset`
(the dataset.json the verdicts came from; enables verbatim quotes and panel tokens) and
`$decisions` (decisions.json from `quorum-screen`).

The CLI runs as `npm run surveyquorum -- <cmd>` from a repository clone, or as
`surveyquorum <cmd>` when installed globally. This skill writes the short form.

## Step 1 - what goes in

- **Verdicts** - required. If the user has not run the arbiter, recommend it first
  (`surveyquorum run ... --arbiter`): a `review` it confirms becomes a `block` and so becomes
  eligible without a human decision, it releases the blocks that have a clear, nameable cause,
  and every released block is a complaint nobody has to defend. The arbiter's panel text is used in
  place of the template when it fits.
- **Dataset** - pass it with `--dataset` whenever it exists: the texts quote the question and
  answer verbatim and `panel_token` is filled from `response.panel.token`. Without it the CLI
  prints a tip and the quotes are generic.
- **Decisions** - `decisions.json` from `quorum-screen`, passed with `--decisions`. The CLI
  applies it before judging eligibility:
  - a `block` verdict the human decided to `keep` -> excluded, never filed;
  - a `review` verdict the human decided to `block` -> eligible as if the engine had blocked
    it, if it has an eligible ground;
  - a `review` verdict with no human decision -> **never filed**. After `--arbiter` these are
    exactly the cases the arbiter handed to a person. The CLI already excludes non-block
    verdicts; `--decisions` is how a human-confirmed block gets in and a human-kept one stays
    out.

  The CLI prints `decisions: N read; a changed to block (human confirmed), b changed to keep
  (human kept)` and lists ids it could not find. Repeat those numbers to the user. Do not
  edit the verdicts file by hand.
- **Not complaints.** Honeypot hits, attention-check failures and screening contradictions
  are screen-outs or internal grounds, not complaints - do not file them even when a human
  confirmed the block. The CLI's ground selection never picks them; do not work around it.

## Step 2 - run

```bash
# generic profile: one ground, 500 characters, no codes
surveyquorum complaints verdicts.json --lang en \
  --dataset dataset.json --decisions decisions.json --out .surveyquorum/complaints.csv

# the user's own panel: reason codes, token requirement, accepted grounds from a profile file
surveyquorum complaints verdicts.json --panel-profile my-panel.json --lang en \
  --dataset dataset.json --decisions decisions.json --out .surveyquorum/complaints.csv
```

- `--panel-profile <file.json>` - a profile file for your panel, see `adapters/panel-profiles`
  in the repository (field reference and two neutral examples: a panel with a complaint API
  that wants the respondent token and numeric reason codes, and a marketplace with no
  complaint channel). The skill ships `generic` only; the repository names no panel. Ask the
  user which panel recruited the respondents and whether they already have a profile file for
  it; if not, offer to write one from the panel's complaint form or API documentation
  (`adapters/panel-profiles/README.md` lists the fields) and name it after the panel.
- `--panel` - `generic` is the default and the only built-in value; `--help` says so and
  points to `--panel-profile`.
- `--lang en|ru` - the language the panel's moderators read. Numbers and quotes are identical.
  A profile's `language` is the default when the flag is omitted.
- `--decisions` - the human decisions file (step 1).
- `--out` - default `.surveyquorum/complaints.csv`.

Output: CSV `response_id,panel_token,ground,code,text,chars` with eligible rows only, and a
stderr summary:

```
decisions: 6 read; 4 changed to block (human confirmed), 2 changed to keep (human kept)
complaints: 11 eligible (4 with arbiter text); not eligible: 3 speed without whole-survey time,
5 internal-only grounds, 0 without evidence, 21 not blocked
panel generic (Generic panel): One ground per respondent, 500 characters or less; no reason codes, no token required.
```

With a profile file the summary gains two more lines when they apply: `skipped: profile
requires a respondent token; N eligible row(s) without one: ...` (the profile has
`requiresToken` and the dataset carries no `panel.token` for those respondents) and
`N ground not accepted by this profile` inside the not-eligible list (the profile's
`acceptedGrounds` leaves the ground out).

## Step 3 - explain eligibility

Translate the summary for the user, respondent by respondent where it matters:

| Ground (in order of how directly the panel can verify the ground from the respondent's own answers) | What it needs | Verifiable from the answer alone? |
|---|---|---|
| `nonsense_text` | an open-answer `gibberish`, `fake`, `wrong_language` or `bad_language` signal; the text quotes question and answer | yes |
| `duplicate_text` | `duplicate-open.x3` - the same text on three or more distinct questions | yes, when all three texts are quoted; two questions only (`x2`) is not a ground |
| `template_pattern` | `matrix-pattern.straightline` or `straightline_fast`; the text names the grid | yes |
| `speed_whole_survey` | pace evidence with the respondent's total time and the cohort median, ratio under 0.5; both numbers go into the text | partly - the panel has to trust the cohort median we report |

Panel policies differ. For context, the repository's `docs/panels.md` records how one panel with a
complaint API answered each ground in 2026 - a description of that panel, not a target to steer
by. Some panels accept speed only
when "exceptionally fast" and require two failed attention checks before exclusion on studies
over five minutes; trick questions and memory questions are never grounds anywhere. Check the
profile file and the panel's published policy before promising an outcome.

**Not eligible, and why** (say it in these words):

- *speed without whole-survey time* - the respondent was fast on single questions, but the
  panel's yardstick is the whole survey and either the total is not under half the median or
  the dataset has no per-question durations to sum. The block stands for the client; no
  complaint.
- *internal-only grounds* - the evidence is an abandoned prototype, a mass-select, a
  contradiction, an off-target click, a bounce or a repeat on two questions. The panel cannot
  verify these from the respondent's answers, so they are internal rejections, not complaints.
- *without evidence* - a block with no weighed evidence of its own (should not happen with the
  shipped weights; check `surveyquorum weights`).
- *not blocked* - review and keep verdicts, including arbiter overturns and human keeps
  (after `--arbiter`, review means the arbiter handed the case to a person).
  Review respondents a human did not confirm are never filed; say so explicitly when the user
  asks why a "suspicious" respondent is missing.
- *ground not accepted by this profile* - the profile file's `acceptedGrounds` leaves this
  ground out. The block stands for the client; a different panel might take it.
- *skipped: profile requires a respondent token* - the profile wants the respondent id from
  the survey link and the dataset has none for this respondent. Re-run with `--dataset`, or
  check the import mapping's `panelToken` column.

If the profile has no complaint channel (`acceptedGrounds: []`), the CLI says so; the file is
then for the client's own records and replacement negotiations, not for submission.

## Step 4 - hand over

Show the user the CSV (or its first rows), the count per ground, and the longest text's
`chars` (all must be <= 500 - the CLI guarantees it, say so). Remind them:

- one complaint per respondent, one ground; do not append extra reasons by hand;
- include the whole-survey time with every speed complaint and a link to the answer where the
  form has a field for it;
- the CSV carries `panel_token` only; never add names, emails or free text beyond the quoted
  answer;
- keep `decisions.json` and the verdicts file - the panel may dispute, and the note explains
  what was seen.

Do not send anything yourself. Filing is the user's action with the panel.

## Step 5 - after the panel answers

Record the outcome per `response_id` in `complaints.result.csv` next to the complaints file
(`response_id,ground,result,panel_note` with `result` = `accepted` | `rejected` | `pending`).
The log is the team's own record and the input for improving the complaint texts and
`docs/panels.md` (and the `note` and `acceptedGrounds` of the user's profile file), so the
one-sentence summary of why a panel rejected a ground is worth keeping. It does not feed the
weights: those are calibrated on labelled respondents, not on panel decisions.
