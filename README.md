# surveyquorum

Consensus screening of survey respondents. Quorum runs independent checks over a survey's
answers and flags a respondent only when several of them agree. Every verdict comes with the
evidence behind it and, when wanted, a one-ground complaint text for the panel.

**Status: open beta, v0.1.** The mechanism behind this repository runs in production on one
survey platform. What is published here is its first platform-independent version: the engine,
the weights and five skills, ported and validated against a synthetic demo with regression tests.
A few production methods that still depend on one platform follow in later releases, and a
production re-measurement on this exact code is the next step. Corrections are welcome — open an
issue or a pull request. "Status" and "Not shipped yet" below list what is measured, what is
assumed and what comes next.

[Russian version — README.ru.md](README.ru.md)

## The quorum principle

Detectors do not decide. Each one emits evidence — a named signal with a strength — and a
weighted layer turns the evidence about a respondent into one of three outcomes:

| outcome | meaning |
|---|---|
| `block` | two or more strong independent signals agree, or several weaker ones add up to the same certainty — a call that needs no second look |
| `review` | one signal, or weaker ones — a second look by the arbiter or a person |
| `keep` | nothing, or positive evidence only |

Every signal's weight is a measured likelihood ratio, capped so that **a single signal always
stops at `review`**. The cap is the principle written as arithmetic; `docs/weights.md` has the
formula and the thresholds.

Signals that fire for a large share of the cohort on the same question are reported to the
survey author as *design artifacts* and carry no weight: the run summary prints one line per
affected question (`design artifact: prototype task '…' — 16 respondents (16% of the cohort) gave
up with no clicks; the prototype likely did not load`), and `verdicts.json` carries the same rows
as `designArtifactSummary`.

Ten detectors. Eight statistical, no LLM: per-question pace, duplicate open answers, matrix
straightlining, mass-select, prototype effort, website bounce, card-sort consensus, first-click
placement. Two LLM: open-answer classification and cross-answer coherence. Overview in
`docs/detectors.md`; the README next to each statistical detector is the detail, the LLM
detectors are specified by their prompts.

## Three ways in

Same engine, three ways to give it a model. Requirements: Node 20+, a clone of this repository
(not on npm yet — see Status).

**1. Inside a coding agent, with only a subscription.** The simplest start: paste the link to
this repository into your Claude Code, Codex, Cursor or Gemini CLI session and ask in plain words,
for example *"design a screener for my audience with the screener-design skill from
https://github.com/Rogeres/surveyquorum"* or *"screen the responses in answers.csv with
surveyquorum"*. The agent reads `AGENTS.md` and the skills, clones and installs what it needs,
and does the rest; you only answer its questions. Under the hood the agent is the model: the CLI writes its LLM judgements to a file,
the agent answers them, `resume` finishes the run.

```bash
git clone https://github.com/Rogeres/surveyquorum.git && cd surveyquorum && npm install
# try the mechanics first: every judgement replays from the shipped cache, nothing is pending
npm run surveyquorum -- run examples/demo-dataset.json --llm agent --llm-cache examples/llm-cache
# on your own data the agent is the model:
npm run surveyquorum -- run dataset.json --llm agent
#  → .surveyquorum/judge-requests.jsonl + instructions printed for the agent
#  the agent appends answers to .surveyquorum/judge-responses.jsonl, then:
npm run surveyquorum -- resume
```

Skills in `skills/` wrap this flow (install as a Claude Code plugin from `.claude-plugin/`, or
copy a skill folder into another agent's rules directory).

**2. CLI with an API key or a local model.** OpenAI-compatible endpoints (OpenAI, Yandex Cloud,
OpenRouter, Ollama), Anthropic. Without a key the eight statistical detectors still run.

```bash
export SURVEYQUORUM_LLM_PROVIDER=openai-compatible SURVEYQUORUM_LLM_API_KEY=... \
       SURVEYQUORUM_LLM_MODEL=gpt-4.1-mini SURVEYQUORUM_LLM_ARBITER_MODEL=gpt-4.1
npm run surveyquorum -- convert export.csv --mapping my-mapping.json --out dataset.json
npm run surveyquorum -- run dataset.json --arbiter --out verdicts.json   # --weights my-weights.json after a refit
npm run surveyquorum -- explain verdicts.json <responseId>
npm run surveyquorum -- complaints verdicts.json --dataset dataset.json --lang en
# reason codes / token rule of your panel: --panel-profile my-panel.json (adapters/panel-profiles/)
```

**3. As a library** (`packages/core`, package name `surveyquorum`). The package resolves to
`packages/core/dist`, which `npm install` builds through the root `prepare` script; if `dist/`
is missing (an install with `--ignore-scripts`, a fresh checkout without install), build it first:

```bash
npm run build          # compiles packages/core/dist and packages/cli/dist
```

```ts
// screen.mjs in the repository root; run with: node screen.mjs
import { readFileSync } from 'node:fs';
import { parseDataset, run } from 'surveyquorum';
const dataset = parseDataset(JSON.parse(readFileSync('examples/demo-dataset.json', 'utf8')));
const results = await run(dataset, { minCohort: 30 }); // add `llm: createLlmClient(cfg)` for the LLM detectors
for (const v of results[0].verdicts) console.log(v.responseId, v.outcome, v.probability);
```

Provider setup, env variables and the config file: `docs/models.md`. Bringing a foreign CSV
into the input contract: `adapters/README.md`.

### Importing from Pathway

Pathway is a survey and UX-research platform; the author's platform, and the only system with a
built-in importer today. Everything else comes in through `convert` with a preset or a mapping.

```bash
PATHWAY_API_TOKEN=... npm run surveyquorum -- import pathway --test <test-id> --out dataset.json
```

A Pathway report CSV is recognised by its header and converts without a mapping
(`npm run surveyquorum -- convert report.csv`), as is the generic flat-long layout
(`adapters/presets/flat-long.json`). Details: `adapters/presets/pathway.md`.

## What the demo shows

`examples/` holds three synthetic surveys, 300 invented respondents, each with a known persona.
LLM judgements — the detectors' and the arbiter's — replay from `examples/llm-cache/`, so the
full pipeline runs without a key:

```bash
npm run surveyquorum -- run examples/demo-dataset.json --llm-cache examples/llm-cache --arbiter
```

| | respondents | blocked | to a person | kept |
|---|---:|---:|---:|---:|
| planted offenders (10 personas) | 64 | 54 | 4 | 6 |
| honest (4 personas, incl. profane, "don't know", one-off fast click) | 236 | 0 | 3 | 233 |

54 of 64 planted offenders blocked; no honest respondent blocked; 7 respondents handed to a
person because the judges hesitated — 4 planted offenders and 3 honest ones. Of the 6 offenders
kept, 3 were released by the arbiter with a named cause (their open answers read as genuine) and
3 never reached it: a mass-selector at near-normal pace and two random sorters whose sort sits
within two standard deviations of the room show only a weak pattern or none, and the engine keeps
them by design.

Before the arbiter the engine itself blocks 18 of the offenders and asks for a second look on 43
of them — plus 5 honest respondents, the one-off fast click persona: one signal, so a second look
rather than a block. The arbiter is that second look. It confirms 36 of the 43 and completes
their quorum, releases 3 with a cause and hands 4 to a person; of the 5 honest it releases 2 and
hands 3 to a person. Slow straightliners and mass-selectors reach it as single-signal cases
because their pattern spans the whole survey — the long-string index of the careless-responding
literature, strong on its own — but one signal is not a quorum until an independent judge agrees.
The 12 honest respondents whose prototype did not load are reported as one design-artifact line
for the survey author (16 respondents on that task, counting the 4 planted give-uppers), not as
twelve bans. When the arbiter hesitates, a person looks; nothing it is unsure about is released
silently. Without `--arbiter` the run stops at the engine's split (block 18, review 48, keep
234); the measured behaviour of the lenient mode is documented in `docs/arbiter.md`.

## Documentation

| page | what |
|---|---|
| [docs/methodology.md](docs/methodology.md) | the four levels, flagged / reviewed / confirmed / blocked, what each check needs in the data |
| [docs/numbers.md](docs/numbers.md) | every production number with definition, base, period, judge |
| [docs/detectors.md](docs/detectors.md) | one section per detector: signals, weights, limits and what each one needs |
| [docs/weights.md](docs/weights.md) | the scoring formula and the v1 weights with provenance |
| [docs/arbiter.md](docs/arbiter.md) | the LLM second opinion: strictness modes, mechanism, measured agreement, cost |
| [docs/panels.md](docs/panels.md) | one-ground complaints and what panels accept |
| [docs/models.md](docs/models.md) | providers, env variables, tested models, cost |
| [docs/faq.md](docs/faq.md) | short answers to the usual questions |
| [docs/video-script.md](docs/video-script.md) | shooting script for the walkthrough video |
| [adapters/README.md](adapters/README.md) | the input contract and how to write a mapping |
| [examples/README.md](examples/README.md) | the demo dataset and its personas |
| [AGENTS.md](AGENTS.md) | rules for coding agents working in this repository |

Skills (`skills/<name>/SKILL.md`): `screener-design`, `survey-review` (before field; `survey-review` ships as a first, partial version — the full one follows shortly),
`quorum-import`, `quorum-screen`, `panel-complaint` (after field).

## Status

v0.1, open beta. The first public version of a production mechanism; the interface may still
change between releases. Clone and run; the npm packages `surveyquorum` / `surveyquorum-cli` are
reserved for v0.2.

Measured (production, Jul–Sep 2026, one panel-research platform, a stream of several hundred
thousand responses; confirmation by an LLM arbiter, whose agreement with human reviewers is
documented in `docs/arbiter.md`): the weights of 23 signals, the precision ladder by number of
agreeing signals (1 → 23 %, 2 → 55 %, 3 → 80 %, 4+ → 91 %), the pace ladder, the arbiter's
agreement with humans. Assumed, pending refit: 7 signals of the card-sort, first-click, website
and mass-select detectors, marked `assumed` in `weights.json` so that a refit replaces them
first. The weights and ladders come from production measurements; this port is validated against
the synthetic demo and its regression tests, and a production re-measurement on this exact code
is the next step. See `docs/numbers.md` for each number and `docs/weights.md` for the refit
procedure. Roadmap: respondent history across surveys, a fit-to-audience axis, a service without installation for
the no-code path.

## Not shipped yet

Some methods from the production system are deliberately not in v0.1 because they still depend on
one platform and need a platform-independent design before they can be published:

| method | what it does | why it waits |
|---|---|---|
| respondent history | repeat offences across surveys by device fingerprint or panel id | needs a stable respondent key every source can provide, and a place to store history; the contract already has the fields, a `ReputationStore` interface is the plan |
| fit to the intended audience | checks whether the answers match who was supposed to be surveyed: the profile declared at screening against the answers in the questionnaire body | needs the recruiting order and screening answers, which most exports do not carry |
| answers made with AI | spots answers produced with an AI assistant | needs a mechanism in the survey front end that records how the answer was entered (typing, paste, dictation) |
| service without installation | the statistical detectors as a hosted page, nothing to install | after the CLI stabilises |

None of these is implied by the published numbers: every figure in `docs/numbers.md` was produced by
detectors that are in this repository.

## License and citation

Apache-2.0 — see [LICENSE](LICENSE). To cite, use [CITATION.cff](CITATION.cff):
Strunin, G. (2026). *surveyquorum: consensus screening of survey respondents* (v0.1.0).
https://github.com/Rogeres/surveyquorum
