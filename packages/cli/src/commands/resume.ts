import {
  createFileCache,
  DEFAULT_AGENT_DIR,
  ingestAgentResponses,
  loadLlmConfigFromEnv,
  RESPONSES_FILE,
} from 'surveyquorum';
import { executeRun, type RunArgs, readRunState } from './run.js';
import { arg, consoleIo, type Io } from './shared.js';

export const RESUME_USAGE =
  'surveyquorum resume [<dataset.json>] [--out <verdicts.json>] [--min-cohort <n>] ' +
  '[--weights <weights.json>] [--llm-cache <dir>] [--agent-dir <dir>]';

export const RESUME_HELP = `${RESUME_USAGE}

Second half of agent mode. Ingests <agent-dir>/${RESPONSES_FILE} into the LLM cache (each
answer validated against the schema of its request; ids that are not among the pending
requests are rejected), then re-runs with the arguments saved by the previous
"run --llm agent". Any flag given here overrides the saved one.`;

/**
 * Second half of agent mode: ingest `judge-responses.jsonl` into the LLM cache, then re-run
 * with the arguments saved by the previous `run --llm agent` (any flag given here overrides).
 */
export async function resumeCommand(rest: string[], io: Io = consoleIo): Promise<number> {
  const config = loadLlmConfigFromEnv();
  const agentDir = arg(rest, '--agent-dir') ?? config?.agentDir ?? DEFAULT_AGENT_DIR;
  const saved = readRunState(agentDir);
  const input = rest[0] && !rest[0].startsWith('--') ? rest[0] : saved?.input;
  if (!input) {
    io.err(
      `${RESUME_USAGE}\nno previous agent-mode run found in ${agentDir}; pass the dataset path.`,
    );
    return 2;
  }
  const weights = arg(rest, '--weights') ?? saved?.weights;
  const args: RunArgs = {
    input,
    out: arg(rest, '--out') ?? saved?.out ?? '.surveyquorum/verdicts.json',
    minCohort: Number(arg(rest, '--min-cohort') ?? saved?.minCohort ?? 30),
    ...(weights ? { weights } : {}),
    llm: 'agent',
    cacheDir: arg(rest, '--llm-cache') ?? saved?.cacheDir ?? '.surveyquorum/llm-cache',
    agentDir,
    arbiter: saved?.arbiter,
    lang: saved?.lang,
    arbiterStrictness: saved?.arbiterStrictness,
  };

  const ingest = ingestAgentResponses(createFileCache(args.cacheDir), agentDir);
  io.err(`resume: ${ingest.accepted} judgement(s) accepted into ${args.cacheDir}`);
  if (ingest.rejected.length > 0) {
    io.err(
      `resume: ${ingest.rejected.length} line(s) rejected and left in ${RESPONSES_FILE} — edit them in place:`,
    );
    for (const r of ingest.rejected.slice(0, 10)) io.err(`  line ${r.line}: ${r.reason}`);
    if (ingest.rejected.length > 10) io.err(`  ... and ${ingest.rejected.length - 10} more`);
  }
  return executeRun(args, io, config);
}
