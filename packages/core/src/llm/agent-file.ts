import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LlmClient, LlmRequest, LlmResponse } from '../detectors/types.js';
import type { LlmCache } from './cache.js';
import { validateJson } from './json-schema.js';

export const DEFAULT_AGENT_DIR = '.surveyquorum';
export const REQUESTS_FILE = 'judge-requests.jsonl';
export const RESPONSES_FILE = 'judge-responses.jsonl';

/** One line of `judge-requests.jsonl`. The agent answers each with `{id, json}`. */
export interface JudgeRequest {
  id: string;
  role: LlmRequest['role'];
  system?: string;
  prompt: string;
  schema: Record<string, unknown>;
}

/**
 * "Agent as provider" mode. Nothing goes over the network: every cache miss is appended to
 * `<agentDir>/judge-requests.jsonl` and answered with `pending: true`. The coding agent that
 * drives the CLI reads the file, answers each request as strict JSON into
 * `judge-responses.jsonl`, and runs `surveyquorum resume`, which ingests the answers into the
 * cache and re-runs. The requests file is truncated when the client is created so that it
 * always reflects what is still missing.
 */
export class AgentFileClient implements LlmClient {
  readonly requestsPath: string;
  private readonly seen = new Set<string>();

  constructor(readonly agentDir: string = DEFAULT_AGENT_DIR) {
    mkdirSync(agentDir, { recursive: true });
    this.requestsPath = join(agentDir, REQUESTS_FILE);
    writeFileSync(this.requestsPath, '');
  }

  /** Number of distinct requests written so far in this run. */
  get pendingCount(): number {
    return this.seen.size;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    if (!this.seen.has(request.cacheKey)) {
      this.seen.add(request.cacheKey);
      const line: JudgeRequest = {
        id: request.cacheKey,
        role: request.role,
        ...(request.system ? { system: request.system } : {}),
        prompt: request.prompt,
        schema: request.schema,
      };
      appendFileSync(this.requestsPath, `${JSON.stringify(line)}\n`);
    }
    return { json: null, pending: true };
  }
}

export interface IngestResult {
  accepted: number;
  /**
   * Lines that were not JSON, lacked an id/json, answered an id that is not among the pending
   * requests, or failed the request schema. They stay in the responses file for editing.
   */
  rejected: { line: number; reason: string }[];
}

/**
 * Read `<agentDir>/judge-responses.jsonl` and store every valid `{id, json}` in the cache.
 * The schema is looked up in the requests file so that a malformed answer is rejected here
 * rather than inside a detector; an id that is not in the requests file is rejected too, so
 * an answer to a request that was never asked cannot enter the cache. Accepted lines are
 * removed from the responses file; rejected lines are kept, in place, for the agent to fix.
 */
export function ingestAgentResponses(
  cache: LlmCache,
  agentDir: string = DEFAULT_AGENT_DIR,
): IngestResult {
  const result: IngestResult = { accepted: 0, rejected: [] };
  const responsesPath = join(agentDir, RESPONSES_FILE);
  if (!existsSync(responsesPath)) return result;

  const schemas = new Map<string, Record<string, unknown>>();
  const requestsPath = join(agentDir, REQUESTS_FILE);
  const haveRequests = existsSync(requestsPath);
  if (haveRequests) {
    for (const raw of readFileSync(requestsPath, 'utf8').split('\n')) {
      if (!raw.trim()) continue;
      try {
        const r = JSON.parse(raw) as JudgeRequest;
        if (r.id && r.schema) schemas.set(r.id, r.schema);
      } catch {
        // a damaged request line only costs the match for that id
      }
    }
  }

  const kept: string[] = [];
  const reject = (raw: string, line: number, reason: string) => {
    result.rejected.push({ line, reason });
    kept.push(raw);
  };
  const lines = readFileSync(responsesPath, 'utf8').split('\n');
  for (const [i, raw] of lines.entries()) {
    if (!raw.trim()) continue;
    let parsed: { id?: unknown; json?: unknown };
    try {
      parsed = JSON.parse(raw) as { id?: unknown; json?: unknown };
    } catch {
      reject(raw, i + 1, 'not JSON');
      continue;
    }
    if (typeof parsed.id !== 'string' || !('json' in parsed)) {
      reject(raw, i + 1, 'expected {id, json}');
      continue;
    }
    const schema = schemas.get(parsed.id);
    if (!schema) {
      reject(
        raw,
        i + 1,
        haveRequests
          ? `id "${parsed.id}" is not among the pending requests in ${REQUESTS_FILE}; not cached`
          : `no ${REQUESTS_FILE} to match the id against; run with --llm agent first`,
      );
      continue;
    }
    const errors = validateJson(parsed.json, schema);
    if (errors.length > 0) {
      reject(raw, i + 1, errors.join('; '));
      continue;
    }
    cache.set(parsed.id, {
      json: parsed.json,
      storedAt: new Date().toISOString(),
      model: 'agent',
    });
    result.accepted++;
  }
  if (result.accepted > 0) {
    writeFileSync(responsesPath, kept.length ? `${kept.join('\n')}\n` : '');
  }
  return result;
}

/** How to invoke the CLI again, in both forms a reader may be in. */
export const RESUME_COMMAND =
  '`npm run surveyquorum -- resume` (from a clone of the repository) or `surveyquorum resume` (when the CLI is installed)';

/** Instructions printed by the CLI after a run in agent mode left requests pending. */
export function agentInstructions(agentDir: string, pending: number): string {
  const req = join(agentDir, REQUESTS_FILE);
  const res = join(agentDir, RESPONSES_FILE);
  return [
    '────────────────────────────────────────────────────────────────────────',
    `LLM judgements pending: ${pending} — that many lines are waiting in ${req}`,
    '(identical answers share one request, so this is the only count that matters).',
    '',
    `1. Read ${req} — one JSON object per line: {id, role, system?, prompt, schema}.`,
    '   `role` is the model tier the request was meant for (classifier = cheap, arbiter =',
    '   stronger); it does not change what you do — answer every line the same way.',
    '2. For each line, answer the prompt yourself. Follow the instructions in the prompt and',
    '   produce ONLY a JSON value that satisfies `schema`. Do not skip, merge or reorder ids.',
    `3. Append one line per answer to ${res}: {"id": "<same id>", "json": <your answer>}.`,
    '   Batches of 20–50 requests per step are fine; the file may be written incrementally.',
    `4. Run ${RESUME_COMMAND}.`,
    '   It validates each answer against its schema, stores the accepted ones in the LLM cache',
    `   and re-runs the detectors. Accepted lines are removed from ${res}; rejected lines stay`,
    '   there and are listed with the reason — edit them in place and run resume again. An id',
    `   that is not in ${req} is rejected, never cached. Anything still missing is re-listed`,
    `   in ${req}.`,
    '────────────────────────────────────────────────────────────────────────',
  ].join('\n');
}
