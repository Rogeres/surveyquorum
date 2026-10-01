# surveyquorum — instructions for AI coding agents

This file is the canonical set of rules for any agent working in this repository
(Claude Code, Codex, Cursor, Gemini CLI, Qwen Code, Copilot and others).
`CLAUDE.md`, `GEMINI.md` and `.cursorrules` only point here.

## What this project is

Consensus screening of survey respondents. A respondent is flagged only when a quorum of
independent checks agrees. Three artifacts:

1. **Before field** — two skills: one designs or repairs the screener, the other reviews the
   questionnaire body and requires only that it is not empty for its audience (something
   verifiable to judge quality on); everything else it reports is a suggestion.
2. **After field** — an engine that finds low-quality respondents and explains every verdict.
3. **To the panel** — one human-readable reason per respondent, 500 characters or less.

Layout: `packages/core` (library: contract, detectors, weighted scoring, arbiter, complaint
text), `packages/cli` (`surveyquorum` command), `skills/` (agent skills), `adapters/` (how to
bring foreign exports into the input contract), `docs/`, `examples/` (synthetic demo data).

## Hard rules

- **English only** in code, comments, docs, skills, CLI output. `README.ru.md` is the one
  exception.
- **Never commit real respondent data.** No survey answers from production, no test ids,
  no client or panel names beyond what `docs/panels.md` already states, no internal
  hostnames, no API keys. Check your diff for these before every commit.
- **Reproducibility.** Statistical detectors are deterministic. LLM detectors replay from
  `examples/llm-cache/` when run on the demo dataset; `examples/expected-verdicts.json` is a
  regression test. If you change a detector, regenerate expected verdicts deliberately and
  say so in the commit message.
- **No network in the core except LLM calls** through the `LlmClient` interface. No database,
  no telemetry, no calls to any vendor infrastructure.
- **Commits** are authored by the repository owner and signed. Do not add co-author
  trailers or tool attributions of any kind.
- **TypeScript, Node 20+, ESM.** No Python on the main path.

## How to work

```bash
npm install
npm run check          # lint + typecheck + tests
npm run surveyquorum -- run examples/demo-dataset.json --llm-cache examples/llm-cache --out .surveyquorum/verdicts.json
# a CSV export goes through convert first: npm run surveyquorum -- convert export.csv --out dataset.json
```

- Detectors never decide. They emit `Evidence` (strong / weak / positive); `quorum/score.ts`
  turns evidence into one of three outcomes: `block`, `review`, `keep`.
- Weights live in `packages/core/src/quorum/weights.json` with provenance. Do not edit
  numbers by hand; refit with `calibration/fit-weights.ts` and bump the version.
- Every detector has a README section in `docs/detectors.md` with a "limits" paragraph.
- Prompts are plain text in `packages/core/src/detectors/*/prompts/`. They must stay
  provider-agnostic: ask for JSON in the prompt, validate with the Zod schema, retry once.

## Skills

`skills/<name>/SKILL.md` are installable as a Claude Code plugin (`.claude-plugin/`) or by
copying the folder into another agent's rules directory. A skill orchestrates the CLI and
explains results; it must not re-implement detector logic in prose.

## Before you finish

Run `npm run check`. Confirm no file under `examples/` contains anything that looks like a
real answer. Keep `docs/numbers.md` consistent with the code: if a ladder or a threshold
changed, update the document in the same commit.
