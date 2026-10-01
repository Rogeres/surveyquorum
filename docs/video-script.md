# Walkthrough video — shooting script

Three parts, about five minutes each, one take per part. Terminal in a large font, light
theme, the repository cloned and `npm install` done before recording. The presenter may speak
Russian; the spoken points below are in English and are prompts, not a script to read. The
on-screen text (commands, file names, outputs) is English in every part. Link goes into
README.md in place of `VIDEO_URL_TBD`.

## Part 1 — Researcher, inside a coding agent (5 min)

Setting: Claude Code (or any agent that reads `AGENTS.md` / `SKILL.md`) open in the clone; no
API key anywhere. Only a subscription.

| time | screen | typed / said |
|---|---|---|
| 0:00 | title card: "Quorum — consensus screening of survey respondents" | Say: a respondent is flagged when independent checks agree; one signal never blocks. |
| 0:20 | agent prompt | Type to the agent: `Design a screener for this audience` and paste a short invented audience description plus a draft screener that opens with a yes/no question on the qualifying behavior. |
| 1:00 | agent's `screener-design` output | Say: audience difficulty → the behavior-first funnel → honeypots → the verifier for the body. The yes/no filter leaks the target; the repaired screener masks it among ten options. The body itself goes through `survey-review`, whose one requirement is that the questionnaire is not empty for its audience. |
| 2:00 | agent prompt | Type: `Screen examples/demo-dataset.json with Quorum`. |
| 2:15 | terminal inside the agent: `npm run surveyquorum -- run examples/demo-dataset.json --llm agent` | Say: the CLI computed the statistics and wrote the LLM judgements it needs to `.surveyquorum/judge-requests.jsonl`. The agent is the model — no key. |
| 2:45 | agent answering requests, appending to `judge-responses.jsonl`; then `npm run surveyquorum -- resume` | Say: same prompts as the API path, same schema, validated line by line; the cache makes a second run free. (If the cache is pre-warmed with `--llm-cache examples/llm-cache`, show that instead and say so.) |
| 3:30 | summary lines: `demo-ux: 100 respondents — block … review … keep …` | Say: three surveys, 300 invented respondents; 55 of 64 planted offenders flagged, 0 honest blocked, 5 honest sent to review. |
| 4:00 | `npm run surveyquorum -- explain .surveyquorum/verdicts.json ux-0NN` for one blocked respondent | Say: probability, each signal with its weight and numbers. Then one honest `review`: a single fast block — one signal, so review, never block. |
| 4:30 | the design-artifact line in `explain` for a `ux-0NN` from the broken prototype | Say: twelve people gave up on a prototype that did not load; reported to the author as one artifact, not twelve bans. |
| 4:50 | close | Say: the panel complaint comes in part 2. |

## Part 2 — Analyst, CLI with a key (5 min)

Setting: plain terminal; `surveyquorum.config.json` already written (show it, key redacted).

| time | screen | typed / said |
|---|---|---|
| 0:00 | `cat surveyquorum.config.json` | Say: provider, base URL, key, two models — classifier and arbiter. Any OpenAI-compatible endpoint, Anthropic, or Ollama locally. |
| 0:30 | `npm run surveyquorum -- convert examples/demo-answers.csv --preset flat-long --out .surveyquorum/dataset.json` | Say: a foreign CSV becomes the input contract through a mapping; the report says what was converted and which detectors this data cannot support. |
| 1:15 | `npm run surveyquorum -- run .surveyquorum/dataset.json --llm api --arbiter --out .surveyquorum/verdicts.json` | Say: cost estimate printed before any spending. Statistical detectors, then open-answer and coherence, then the arbiter re-reads every block and review. |
| 2:30 | arbiter summary line: `… arbiter (strict) — N confirmed, N overturned (categories: …), N to a human (N because the arbiter hesitated)` | Say: strict by default — a verdict is lifted only when both judges agree on the cause; when the arbiter hesitates, a person looks. The production numbers (66 % agreement with humans, 42 % of human-kept bans overturned) are for lenient mode. |
| 3:00 | `npm run surveyquorum -- explain .surveyquorum/verdicts.json <id>` on an overturned case | Say: evidence stays on the verdict; the arbiter only moved the outcome and left a reason. |
| 3:40 | `npm run surveyquorum -- complaints .surveyquorum/verdicts.json --dataset .surveyquorum/dataset.json --lang en --out .surveyquorum/complaints.csv`; open the CSV | Say: one ground per respondent, 500 characters or less, with the numbers — the form panels accept. Blocks with internal-only grounds (a contradiction, an abandoned prototype) stay blocked for your data but are not filed. |
| 4:30 | `npm run surveyquorum -- weights` | Say: every weight with its source — measured or assumed. Refit on your own labels with `npm run calibration:fit`; never edit numbers by hand. |
| 4:50 | close | Say: library next. |

## Part 3 — Developer, the library (5 min)

Setting: editor with a new file `screen.ts` in the clone; terminal split.

| time | screen | typed / said |
|---|---|---|
| 0:00 | `packages/core/src/contract/types.ts` scrolled to `Block` | Say: nine block types; every detector reads this contract and nothing else. No database, no network except the `LlmClient` you pass in. |
| 0:45 | write `screen.ts`: `import { parseDataset, run, createLlmClient, loadLlmConfigFromEnv } from 'surveyquorum'` … `const results = await run(dataset, { minCohort: 30, llm })` … print `responseId, outcome, probability` | Say: `run` is the whole engine; `runSurvey` for one cohort. The same code the CLI uses. |
| 1:45 | `npx tsx screen.ts` | Say: verdicts with `evidence`, `designArtifacts`, `noContentToCheck`. |
| 2:15 | `packages/core/src/detectors/types.ts` — `Detector`, `Evidence` | Say: a detector returns evidence and never decides; `needsLlm: true` means it is skipped without a client. Show `defaultDetectors()` in `registry.ts` and how to pass your own list. |
| 3:00 | `packages/core/src/quorum/score.ts` — `scoreResponse`, `LLR_CAP` | Say: score = logit(prior) + Σ LLR, one term per distinct signal, cap ±4.5. Point at the test `weights-ladder.spec.ts` that fails if a refit lets one signal block. |
| 3:45 | `packages/core/src/llm/config.ts` doc comment | Say: three clients behind one interface — OpenAI-compatible, Anthropic, agent-file. JSON is asked for in the prompt and validated with a schema, so prompts are portable. |
| 4:15 | `examples/generate.ts` top, then `npm run check` | Say: the demo is synthetic and seeded; `expected-verdicts.json` is the regression test; the leak scan refuses anything that looks like real data. |
| 4:50 | close | Say: Apache-2.0, `CITATION.cff`, issues and pull requests welcome. |

## Checklist before publishing

- No real respondent data, test ids, client or panel names on screen (this covers the
  repository, not your terminal history).
- The `.surveyquorum/` folder was cleaned before part 1 so that the agent flow is shown cold.
- Keys redacted in every shot of `surveyquorum.config.json` and the environment.
- Replace `VIDEO_URL_TBD` in `README.md` and `README.ru.md` with the link.
