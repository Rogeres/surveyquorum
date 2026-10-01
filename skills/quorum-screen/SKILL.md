---
name: quorum-screen
description: >-
  Screens survey respondents with the surveyquorum engine and walks the results with the
  user: runs `surveyquorum run` (statistical detectors always; content detectors with `--llm
  agent`, where the agent answers the judge requests itself, or `--llm api` with a configured
  key), resumes after judging, presents block / review / keep with design artifacts and the
  no-content note, explains each verdict (signals, weights, estimated probability) with
  `surveyquorum explain`, and
  records human decisions in decisions.json. Use when a dataset.json exists; otherwise run
  quorum-import first.
when_to_use: >-
  Trigger phrases: "screen these respondents", "find bad respondents", "run quality control on
  the survey", "who should we block", "explain this verdict", "walk the review queue",
  "проверь респондентов", "найди недобросовестных", "прогони контроль качества", "кого
  банить", "объясни вердикт", "разбери спорных".
arguments: [dataset, llm]
argument-hint: "<dataset.json> [agent|api|none]"
---

# Screen respondents

The engine does the arithmetic; you drive it and explain. Do not re-derive a verdict in prose:
run the command, read the output, translate it. Signal names and what they mean are in
`${CLAUDE_SKILL_DIR}/reference.md`; the live weight table is `surveyquorum weights`.

Inputs: `$dataset` (a dataset.json in the input contract - from `quorum-import`) and `$llm`
(`agent`, `api` or `none`; default `agent` inside a coding agent).

The CLI runs as `npm run surveyquorum -- <cmd>` from a repository clone, or as
`surveyquorum <cmd>` when installed globally. This skill writes the short form. No dataset
yet? Run `quorum-import` first. Working in a clone and want to try the mechanics first? The
shipped demo replays from a cache with no model at all:
`surveyquorum run examples/demo-dataset.json --llm agent --llm-cache examples/llm-cache`
(every judgement is a cache hit, nothing pending, verdicts final).

## Step 1 - choose the LLM mode and say what it costs

| Mode | When | What happens |
|---|---|---|
| `--llm agent` | default inside a coding agent; hundreds of respondents | No network from the CLI. It writes judge requests to a file; you answer them (step 2). The open answers are read only by the model the user is already talking to - you; nothing is sent to a second provider. |
| `--llm api` | an API key is configured (`SURVEYQUORUM_LLM_PROVIDER` / `_MODEL` / `_API_KEY` or `surveyquorum.config.json`); thousands of respondents | The CLI calls the provider and prints a cost estimate before spending. Stop and ask the user when the estimate exceeds a few dollars. |
| `--llm none` | no model wanted | Statistical detectors only. `open-answer` and `coherence` are skipped and the summary says so. |

Before running, count open blocks (the convert report or the dataset): with none, say now that
content checks need at least one open question, so the verdicts will cover effort only.

Open answers are sent to the model provider you configured (or read by the agent you are already
using). If the answers can contain personal data, make sure your agreement with that provider
covers it, or run a local model.

**Volume rule for agent mode.** Agent mode at about 40 answers per step costs roughly N/40
steps for N pending judgements - say the number before you start. Above ~1,500 pending
judgements recommend `--llm api` and quote the estimate, or agree a subset (one survey, or one
open question) first.

## Step 2 - run, judge, resume

```bash
surveyquorum run dataset.json --llm agent --out .surveyquorum/verdicts.json
```

The run prints `agent mode: up to N judgement requests (...)`, computes everything it can,
writes verdicts **without** the pending judgements, and prints instructions. Then:

1. Read `.surveyquorum/judge-requests.jsonl` - one JSON object per line:
   `{id, role, system?, prompt, schema}`. `role` is `classifier` (open-answer labels, coherence
   pair checks) or `arbiter`.
2. For each line, answer the prompt **yourself**, following the instructions inside the
   prompt, and produce only a JSON value that satisfies `schema`. Judge the content, not the
   language; respect every guard the prompt states (e.g. a one-word answer to a yes/no question
   is not `fake`; an unknown brand is not `off_topic`). Do not skip, merge or reorder ids.
3. Append one line per answer to `.surveyquorum/judge-responses.jsonl`:
   `{"id": "<same id>", "json": <answer>}`. Batches of 20-50 per step are fine.
4. Run `surveyquorum resume` (`npm run surveyquorum -- resume` from a clone). It validates each
   answer against its schema, rejects ids that are not in the requests file, stores accepted
   ones in the cache (`.surveyquorum/llm-cache`) and removes them from the responses file,
   re-runs, and lists rejected lines with the reason - edit those in place and run `resume` again. The requests file is rewritten with whatever is
   still missing; repeat until it prints
   `agent mode: every judgement was answered from the cache; verdicts are final.`

The cache is keyed by content: a second run of the same dataset asks nothing. Answer each
request once; never re-judge an id that is already in the cache (see the reference). Pair
discovery in `coherence` sends one request per survey first and verification requests
afterwards, so expect a second, smaller round.

Add `--arbiter` (with `--lang ru` when the panel reads Russian) whenever a model is available -
it is the normal way to run, not an extra. The engine's `review` means "needs a second
independent look", and the arbiter is that look: a `review` it confirms becomes `block` (the
quorum is complete - engine evidence plus an independent judge), a `block` it confirms stands, an
overturn with a named cause becomes `keep`, and a hesitation leaves the respondent in `review`,
which after the arbiter means "a person must look". In agent mode the arbiter cases arrive as
`role: arbiter` requests in the same file. The default strictness is `strict`: a verdict is
lifted only when both judges overturn with confidence >= 4 and the same `overturn_category`, and
any hesitation sends the respondent to a human instead of releasing them; pass
`--arbiter-strictness balanced` or `lenient` only when the user asks for a softer arbiter. When
answering `role: arbiter` requests yourself, follow the burden-of-proof section in the prompt
and always fill `overturn_category` (`none` unless you overturn). Note that `role` names the model tier, not the stage: coherence pair discovery
also uses `role: arbiter`, so that role alone does not mean the arbiter is running. It is recommended before `panel-complaint`; the repository's `docs/arbiter.md`
describes it.

## Step 3 - present the summary

The run prints per survey: `<id>: N respondents - block B, review R, keep K` plus
`(skipped without LLM: ...)` when content detectors did not run. With `--arbiter` it first prints
`<id>: arbiter (strict) - c confirmed, o overturned (categories: ...), h to a human` and
`after arbiter: block B, to a person R, keep K`; the per-survey counts that follow are the same
post-arbiter numbers. Present:

- **Counts and rates.** B/N and R/N as percentages. The shipped prior is 2.25% junk. As a
  heuristic from one platform's production (Jul-Sep 2026), a block rate far above 5% or a
  review rate above 15% usually means a questionnaire fault, not a bad cohort - look at the
  design artifacts before anything else.
- **Design artifacts.** The run summary prints one line per affected question (`design
  artifact: prototype task '…' - 16 respondents (16% of the cohort) gave up with no clicks; …`);
  the same rows are in `verdicts.json` under `designArtifactSummary`, and `explain` shows the
  line next to each respondent's artifact. These are reported to the author and carry no weight. Hand them over
  in question-first wording: "block 4 draws off_topic from 18% of the cohort - the question, not
  the respondent". Before the next wave, the `survey-review` skill finds the same faults from the
  questionnaire text alone.
- **`noContentToCheck`.** Count verdicts with this flag. Say plainly: "for these respondents the
  engine saw no free text; the verdicts cover speed and patterns only, imposters are invisible."
- **Skipped detectors.** From the summary line - usually `open-answer, coherence` without an LLM.

## Step 4 - walk the review queue

When the run used `--arbiter`, the `review` verdicts are the post-arbiter set: the cases the
arbiter handed to a person (`arbiter.decision: needs_human`, with its reason starting `arbiter
unsure:`). The reviews it confirmed are already `block`, the ones it released are `keep`; both
carry `arbiter.originalOutcome` so the user can see which blocks the judge completed. Without the
arbiter the queue is every single-signal case and you are the second look.

For every `review` verdict (and any `block` the user questions):

```bash
surveyquorum explain .surveyquorum/verdicts.json <responseId>
```

It prints the outcome, `estimated probability of junk p (log-odds s) - block at >= 0.95, review
at >= 0.20`, each piece of evidence with detector, signal, strength, weight, summary, blocks and
stats, then design artifacts and skipped detectors.

Explain in probabilities rather than scores: "0.67 - about two-to-one odds of junk; one strong
signal (pace consistent: 4 blocks faster than 2 sd below the cohort) and nothing else. One
signal alone stops at review by design; a second agreeing signal would block." Then show the user the
respondent's actual answers from the dataset using the per-respondent card in the reference
(evidence, up to three open answers verbatim, the two fastest blocks against their cohort
medians) so the decision is made on substance. Ask: keep or block, and why.

Record decisions in `decisions.json` next to the verdicts:

```json
{
  "r-0412": { "decision": "block", "note": "three pasted answers, confirmed by reading them" },
  "r-0077": { "decision": "keep",  "note": "fast on scales only; open answers specific" }
}
```

One entry per responseId, `decision` is `keep` or `block`, `note` is one sentence a colleague
can audit. Do not edit the verdicts file; `panel-complaint` passes both to the CLI
(`--decisions`).

## Guard rails

- A `block` with a single evidence item does not happen from the engine alone (one signal caps
  at `review`). After `--arbiter` such a block carries `arbiter.decision: confirm` and
  `arbiter.originalOutcome: review` - the judge was the second voice. A single-evidence block
  with no `arbiter` record means the weights file is not the shipped one - run
  `surveyquorum weights`.
- Thin cohorts (`--min-cohort`, default 30) silence pace, consensus and artifact guards. Below
  30 respondents per survey say so before interpreting silence as cleanliness.
- Durations of 0 are "unknown", not fast. An export without times does not make anyone fast.
- Do not describe an overturned or `keep` respondent as "fine" - the engine says "not provable",
  not "honest".
- Budget: in `api` mode ask before any run whose estimate exceeds a few dollars; in `agent` mode
  tell the user how many judgements you are about to produce.
