# Skills

Five agent skills that take a survey from "who do we want to ask" to "which respondents do we
report to the panel". Each skill is a folder with `SKILL.md` (instructions for the agent, YAML
front matter with `description`, `when_to_use` trigger phrases in English and Russian,
`arguments` and `argument-hint`), an optional `reference.md`, and - for the three after-field
skills - `examples/` with invented inputs and expected output. Skills orchestrate the
`surveyquorum` CLI and explain its results; none of them re-implements detector logic. Every
skill is self-contained: it reads only files inside its own folder
(`${CLAUDE_SKILL_DIR}/reference.md`), so it works installed alone. Hosts other than Claude Code
may not expand `${CLAUDE_SKILL_DIR}`; when the variable is left literal, `reference.md` is the
file next to the `SKILL.md` being read.

## Install

**Claude Code** (plugin from GitHub):

```
/plugin marketplace add Rogeres/surveyquorum
/plugin install surveyquorum@surveyquorum
```

**Codex** - copy the `skills/` folder into the repository you work in and reference it from
`AGENTS.md` (`See skills/<name>/SKILL.md when the task matches its description`).

**Cursor** - copy each `skills/<name>/` into `.cursor/rules/` (one rule file per skill;
Cursor reads the Markdown as-is and the front matter `description` works as the rule's
trigger). Add `alwaysApply: false` to the front matter of each rule, otherwise Cursor loads
the rule into every conversation instead of on demand.

**Gemini CLI** - add a line to `GEMINI.md`: `Read skills/<name>/SKILL.md when the user asks
for <trigger phrases>`, or paste the SKILL.md contents into `GEMINI.md`.

**Any other agent** - the skills are plain Markdown; put the folder where the agent reads its
rules and point to it. The CLI they drive is `npm run surveyquorum -- <args>` in a repository
clone, or `surveyquorum` / `sq` when installed.

## The five skills

**`screener-design`** - from an audience description (and an optional draft) to an audience
difficulty score 1-10 with reasoning and a recruitment route, a 5-8 question screener on the
behavior-first funnel (no yes/no on the qualifying behavior, the target masked among ~10
options, non-overlapping options, a graceful exit everywhere, the realistic completion time
stated), three honeypots per brand or tool question with a two-or-more pass rule, and - for
difficulty 6 and above - a ready-to-paste open experience verifier that must go into the
questionnaire body. A self-check runs silently before the output.

**`survey-review`** (first, partial version; the full one follows shortly) - reviews the questionnaire body before field from the questionnaire plus
an audience description. One hard requirement: the questionnaire must not be empty for its
audience - there has to be something verifiable to judge quality on (an open experience question
for a narrow audience; for any audience, a block whose answer can be wrong, incoherent or
low-effort). Everything else is a suggestion: at most 12 findings ordered by severity, each
naming the detector that will misfire, why, and a ready-to-paste fix; then a section on what the
engine will not be able to check in this questionnaire and which design-artifact guards will
fire in `surveyquorum run`.

**`quorum-import`** - brings any export into the input contract. Looks at the header and the
first rows, decides long vs wide, asks at most three questions (time per question, screener,
matrices and tasks), hashes personal ids before anything else, writes `mapping.json`, runs
`surveyquorum convert` (or `surveyquorum import pathway` when the public API is available),
runs four sanity checks, reports in a fixed three-bullet template which detectors run and
which do not, and offers to save the mapping as a preset for others.

**`quorum-screen`** - runs `surveyquorum run` on a dataset. In agent mode the agent itself
answers the LLM judge requests the CLI writes to a file, then `surveyquorum resume` finishes
the scoring; with a configured key it uses `--llm api`. Presents block / review / keep with
design artifacts and the no-content note, walks the review queue with the user through
`surveyquorum explain` in estimated probabilities rather than raw scores - one fixed card per
respondent -
and records decisions in `decisions.json`.

**`panel-complaint`** - runs `surveyquorum complaints` with the panel profile, language and
the decisions file, quotes questions verbatim from the dataset, explains which blocked
respondents are eligible (one ground panels accept: nonsense text, identical text on three
questions, a template grid, the whole survey under half the median time) and which are not and
why, and files a complaint for a review respondent only after a human has confirmed it. Closes the
loop by recording what the panel accepted and rejected.

## Order of use

Before field: `screener-design` -> `survey-review`. After field: `quorum-import` ->
`quorum-screen` -> `panel-complaint`. Each skill tells you which one comes next.

## Evaluating a skill

The after-field skills' `examples/` folders hold the evaluation seeds: an invented input and
the expected output in the skill's own template (the three-bullet report, the card, the CSV
shape). To evaluate a change, run the skill on each example input with the model you ship for
and compare against the expected output - the headings and the rule numbers must match, the
prose may differ. Add a third example before changing a skill's rules, so that every rule
change is checked against at least three inputs; keep every example invented (no real
respondents, ids, panels or clients). The two before-field skills ship without examples in
v0.1 - the author does not want concrete target audiences in the repository; evaluate them on
invented audiences and questionnaires of your own, kept outside the repository.
