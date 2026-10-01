# Models and providers

The eight statistical detectors need no model. The two LLM detectors (open-answer, coherence)
and the arbiter need one, in one of three ways: an OpenAI-compatible endpoint, the Anthropic
API, or **agent mode**, where the coding agent you already pay for answers the judgements.

Two roles. `classifier` — one cheap call per open answer and per respondent pair check.
`arbiter` — a stronger model, called once per survey for coherence pair discovery and, with
`--arbiter`, twice per blocked or reviewed respondent. When no arbiter model is set, the
classifier model is used for both. The role names a model tier, not a stage: a request with
`role: arbiter` in agent mode may be a coherence pair discovery, not a verdict review — only
`--arbiter` runs the arbiter stage (`docs/arbiter.md`).

## Configuration

Environment variables win; `surveyquorum.config.json` in the working directory fills the rest.
Neither set → statistical mode, and `run` lists the skipped detectors.

| env variable | config key | meaning |
|---|---|---|
| `SURVEYQUORUM_LLM_PROVIDER` | `provider` | `openai-compatible` (default when a model is set), `anthropic`, `agent-file` |
| `SURVEYQUORUM_LLM_MODEL` | `model` | classifier model id |
| `SURVEYQUORUM_LLM_ARBITER_MODEL` | `arbiterModel` | arbiter model id; default = classifier |
| `SURVEYQUORUM_LLM_BASE_URL` | `baseUrl` | API root; defaults `https://api.openai.com/v1` / `https://api.anthropic.com` |
| `SURVEYQUORUM_LLM_API_KEY` | `apiKey` | the key |
| `SURVEYQUORUM_LLM_AUTH_SCHEME` | `authScheme` | `bearer` (default) or `api-key`; auto `api-key` for `*.cloud.yandex.net` |
| `SURVEYQUORUM_LLM_STRICT_JSON_SCHEMA` | `strictJsonSchema` | `1`/`true` sends OpenAI strict `response_format: json_schema` (OpenAI only) |
| `SURVEYQUORUM_LLM_CACHE_DIR` | `cacheDir` | file cache, default `.surveyquorum/llm-cache` |
| `SURVEYQUORUM_AGENT_DIR` | `agentDir` | agent mode files, default `.surveyquorum` |

CLI flags override both: `--llm api|agent|none`, `--llm-cache <dir>`, `--agent-dir <dir>`.
The config file is git-ignored. JSON is requested in the prompt and validated against a schema
with one retry, so prompts work unchanged on any provider; `json_object` is tried and dropped
if the server rejects it.

### OpenAI

```json
{ "provider": "openai-compatible", "apiKey": "...", "model": "gpt-4.1-mini", "arbiterModel": "gpt-4.1" }
```

### Yandex Cloud AI Studio

OpenAI-compatible endpoint with `Api-Key` auth and `gpt://<folder_id>/<model>/latest` ids.
Qwen models served there use the same id format. `authScheme` may be omitted for this host.

```json
{ "provider": "openai-compatible", "baseUrl": "https://llm.api.cloud.yandex.net/v1",
  "apiKey": "<Yandex Cloud API key>", "authScheme": "api-key",
  "model": "gpt://<folder_id>/yandexgpt/latest",
  "arbiterModel": "gpt://<folder_id>/qwen3-235b-a22b-fp8/latest" }
```

### OpenRouter

```json
{ "provider": "openai-compatible", "baseUrl": "https://openrouter.ai/api/v1", "apiKey": "...",
  "model": "<any model id OpenRouter lists>" }
```

### Ollama (local, nothing leaves the machine)

```json
{ "provider": "openai-compatible", "baseUrl": "http://localhost:11434/v1", "model": "<local model>" }
```

No key needed. Small local models often fail the JSON schema; the client retries once and logs
the failure, and the affected answer gets no evidence.

### Anthropic

```json
{ "provider": "anthropic", "apiKey": "...", "model": "<haiku-class>", "arbiterModel": "<sonnet-class>" }
```

### Agent mode

`surveyquorum run dataset.json --llm agent` (or `"provider": "agent-file"`). No network. The
CLI writes `.surveyquorum/judge-requests.jsonl` — one `{id, role, system?, prompt, schema}` per
judgement — and prints instructions. The agent appends `{"id", "json"}` lines to
`judge-responses.jsonl`; `npm run surveyquorum -- resume` (or `surveyquorum resume` when the
CLI is installed) validates them, rejects ids that were never requested, stores accepted answers
in the cache, removes them from the responses file and re-runs. Works with any agent that can read and write files. Volume: hundreds of
answers per run is comfortable, tens of thousands is not — use an API key for large fields.

## Tested models

"Tested" means run on the demo dataset against the shipped cache or reviewed by hand. Rows
marked **untested** are listed because the transport supports them, nothing more.

| model | provider | role | result | status |
|---|---|---|---|---|
| gpt-4.1-mini | OpenAI | classifier | produced `examples/llm-cache/`; demo expectations are built on it | tested (demo cache) |
| gpt-4.1 | OpenAI | arbiter role: pair discovery | proposes the coherence pairs in the demo cache | tested (demo cache) |
| Claude Haiku-class | Anthropic | classifier | — | **untested** |
| YandexGPT (`gpt://…/yandexgpt/latest`) | Yandex Cloud | classifier | — | **untested** |
| Qwen via Yandex Cloud (`gpt://…/qwen3-…/latest`) | Yandex Cloud | classifier / arbiter | — | **untested** |
| local models via Ollama | Ollama | classifier | — | **untested** |

Per-class agreement with the demo cache and cost per 1 000 answers are added as models are run; any prompt edit resets this table.

## Cost

Orders of magnitude from `packages/core/src/llm/prices.json` (**asOf 2026-10-01**, USD per
million tokens, filled in by hand from vendor pages; the CLI matches a model id to a price
class by regex and uses `generic` when nothing matches). Prices change often — **verify against
your provider** before trusting an estimate. `run` prints the estimate before spending; the
cache makes a re-run free.

| price class | input | output | one classifier call (~1 100 in / 60 out) | one arbiter call (~1 500 in / 400 out) |
|---|---:|---:|---:|---:|
| openai-mini | 0.4 | 1.6 | ≈ $0.0005 | — |
| openai-flagship | 2.5 | 10 | — | ≈ $0.008 |
| anthropic-haiku | 1 | 5 | ≈ $0.0014 | — |
| anthropic-sonnet | 3 | 15 | — | ≈ $0.011 |
| anthropic-opus | 15 | 75 | — | ≈ $0.05 |
| qwen | 0.3 | 1.2 | ≈ $0.0004 | ≈ $0.001 |
| local | 0 | 0 | 0 | 0 |
| generic (unknown id) | 1 | 4 | ≈ $0.0014 | ≈ $0.003 |

Rule of thumb: classifying 1 000 open answers with a mini-class model costs well under a
dollar; arbitrating 50 blocked respondents (two judges plus some tie-breaks) costs a few
dollars with a flagship-class model. Details per case in `docs/arbiter.md`.
