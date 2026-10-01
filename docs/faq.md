# FAQ

**Why not block on one signal?**
Because alone, a signal is right as often as its measured precision — 23 % for the median
single signal in production, 80 % for the best one. Two agreeing independent signals reached
55 %, three 80 %, four or more 91 % (`docs/numbers.md`). The weights encode this: every LLR is
capped at ±4.5, so the strongest lone signal reaches a posterior of about 0.67, which is
`review`, never `block` (`docs/weights.md`).

**Why is there a `review` outcome at all?**
A lone signal is wrong most of the time but far above the base rate. Dropping it loses real
junk; blocking on it wrongs honest people. `review` is cheap: an arbiter read costs cents, a
human read a minute. Review is where a single strong signal, a weak pair, or an arbiter
`needs_human` lands.

**The run reports design artifacts. What do I do with them?**
Fix the questionnaire, not the respondents. An artifact means the same signal fired on the same
question for a large share of the cohort — an open question that invites "yes", a prototype that
did not load, a battery everyone agrees with. The evidence is kept under `designArtifacts` on
the verdict, and the run summary prints one line per affected question (also in `verdicts.json` as
`designArtifactSummary`); it carries no weight. The `survey-review` skill catches the same
faults before the next field; `screener-design` covers the screener and the verifier requirement
(`docs/methodology.md`).

**Can I run without any LLM?**
Yes. `surveyquorum run dataset.json --llm none` (or just no configuration) runs the eight
statistical detectors: pace, duplicate-open, matrix-pattern, mass-select, prototype-effort,
website-bounce, cardsort-consensus, firstclick-offtarget. Open-answer and coherence are
skipped and the run says so. Complaints on speed, repeats and templates still work.

**Is my data sent anywhere?**
Statistical detectors send nothing, ever. The LLM detectors send question texts and open
answers to the provider you configured — and only to that provider. Agent mode sends them to
the agent you already use; Ollama sends them nowhere. The core has no telemetry, no database,
no calls to any vendor other than your LLM endpoint (`AGENTS.md`, "Hard rules"). Respondent ids
are whatever your export contains; replace them before sharing a dataset.

**My export is not Pathway. How do I get it in?**
Write a mapping — a small JSON file naming which column is the respondent, the question, the
answer, the type, the time — and run `surveyquorum convert export.csv --mapping my-mapping.json`.
`adapters/README.md` describes every field with a worked example; the `quorum-import` skill
writes the mapping for you from the header. The conversion report lists which detectors the
data cannot support.

**How do I add a preset for my survey tool?**
Put a tested mapping in `adapters/presets/<name>.json` with a small anonymised sample export and
the expected conversion result next to it (`adapters/CONTRIBUTING.md`); CI compares the two.
Then `surveyquorum convert export.csv --preset <name>` works for everyone.

**How do I refit the weights on my own data?**
Label respondents (`good` / `bad_*`), run the engine, then
`npm run calibration:fit -- --verdicts verdicts.json --labels labels.json --out my-weights.json`.
The script prints per-signal precision and LLR plus the ladder by number of signals. Inspect
with `surveyquorum weights --file my-weights.json`; use it with `surveyquorum run dataset.json --weights my-weights.json`
(library: `runSurvey(survey, { weights })`).
Never edit the numbers by hand (`docs/weights.md`, `docs/numbers.md`).

**What is the arbiter, and how strict is it?**
An optional LLM stage (`--arbiter`) that re-reads every block and review verdict with the full
case and returns `confirm` / `overturn` / `needs_human`, plus a panel-ready text. Two judges read
each case. How much they may release is `--arbiter-strictness`, and the default is **strict**:
an engine verdict is lifted only when both judges overturn with confidence 4 or more and name the
same cause (`technical_failure`, `design_artifact`, `substantive_content`, `short_branch`);
both confirming confirms; anything else — a split, a weak or uncategorised overturn — sends the
respondent to a human as `review`. When the arbiter hesitates, a person looks; a block is never
silently released. `balanced` adds a blind tie-break on disagreement and lifts at confidence 3;
`lenient` lifts any overturn. The production numbers (66 % agreement with humans, 42 % of
human-kept bans overturned) were measured in what is now lenient mode, whose rubric treats
"formally true but proves no bad faith" as an overturn (`docs/arbiter.md`).

**Why is speed measured per question instead of whole-survey time?**
Because whole-survey time is mostly branch length. In production, respondents who finished
in under half the median time but had no single fast question were confirmed junk 2.6 % of the
time — the base rate. Respondents with 3 questions each faster than 98 % of the cohort: 30 %;
with 5 or more: 65 % (`docs/numbers.md`). Speed is a pattern across questions, not a total.

**What can the engine not see?**
A respondent who is not who the screener asked for but answers with ordinary effort; a careful
imposter in a questionnaire with no open questions (42 % of production responses had none);
images the classifier was never shown; paraphrased duplicates; fluent AI-written text; thin
cohorts; sources without per-question durations. Full list in `docs/methodology.md`.

**Why does the demo flag only 55 of 64 planted offenders?**
The nine missed are slow straightliners and mass-selectors with no second signal. One pattern
is not a quorum; they sit in `keep` at their single signal's precision. That is the trade the
method makes: 0 honest respondents blocked.

**Does the panel accept these complaints?**
One ground per complaint, 500 characters or less, with the numbers: that form was accepted
about 75 % of the time for nonsense text and about 91 % for grid templates, against 36–48 % for
speed or "a combination of signals". `surveyquorum complaints` writes exactly that form
(`docs/panels.md`). Run the arbiter first — a lifted ban is a complaint you do not have to defend,
and in strict mode every lifted ban carries a named cause both judges agreed on.

**Which model should I use?**
A mini-class model for the classifier, a flagship-class model for the arbiter. gpt-4.1-mini
produced the demo cache; other models are listed as untested until run (`docs/models.md`).

**How do I cite this project?**
Use `CITATION.cff` at the repository root: Strunin, G. (2026). *surveyquorum: consensus
screening of survey respondents* (v0.1.0). https://github.com/Rogeres/surveyquorum. Apache-2.0.

**Does Quorum track respondents across surveys (fingerprint, panel id)?**

Not in v0.1. The input contract has `fingerprint` and `panel.token` fields, but no detector reads
them yet: not every source exposes a stable respondent key, and a history store needs a place to
live. The roadmap item is a `ReputationStore` interface with an in-memory default, so a platform
can plug its own. Until then every verdict is per survey.
