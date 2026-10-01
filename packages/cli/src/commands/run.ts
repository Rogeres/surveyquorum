import { existsSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  AgentFileClient,
  type ArbiterLang,
  type ArbiterStrictness,
  agentInstructions,
  applyArbiter,
  arbitrateDetailed,
  type CachedLlmClient,
  cohortMedianDurations,
  createCacheOnlyClient,
  createLlmClient,
  type Dataset,
  DEFAULT_AGENT_DIR,
  DEFAULT_CACHE_DIR,
  describeDesignArtifact,
  estimateCost,
  formatCost,
  type LlmConfig,
  loadLlmConfigFromEnv,
  parseDataset,
  RESUME_COMMAND,
  run,
  type Weights,
  withCache,
} from 'surveyquorum';
import { arg, consoleIo, type Io, readJson, writeOut } from './shared.js';
import { loadWeightsFile } from './weights.js';

export const RUN_USAGE =
  'surveyquorum run <dataset.json> [--out <verdicts.json>] [--min-cohort <n>] ' +
  '[--weights <weights.json>] [--llm api|agent|none] [--llm-cache <dir>] [--agent-dir <dir>] ' +
  '[--arbiter] [--arbiter-strictness strict|balanced|lenient] [--lang en|ru]';

export const RUN_HELP = `${RUN_USAGE}

  <dataset.json>  a dataset in the input contract — from "surveyquorum convert" or "import"
  --out           where to write the verdicts; default .surveyquorum/verdicts.json
  --min-cohort    respondents needed before cohort statistics are trusted; default 30
  --weights       a weights file (e.g. from "npm run calibration:fit") instead of the shipped v1
  --llm           api (configured provider), agent (judgements answered by a coding agent), none
  --llm-cache     LLM cache directory; with no provider the run replays from it (the demo case)
  --agent-dir     where agent mode writes judge-requests.jsonl; default .surveyquorum
  --arbiter       second opinion on block/review verdicts; a confirmed review becomes a block,
                  a hesitation goes to a person; needs --llm api, --llm agent or a cache
  --arbiter-strictness
                  strict (default): an overturn needs both judges, confidence >= 4 and the same
                  named cause, everything else goes to a human; balanced: tie-break, overturn at
                  confidence >= 3; lenient: any overturn stands (docs/arbiter.md)
  --lang          language of the arbiter's panel-facing text; default en`;

export type LlmMode = 'api' | 'agent' | 'none';

export interface RunArgs {
  input: string;
  out: string;
  minCohort: number;
  /** Path of a weights file passed with `--weights`; the shipped v1 weights when absent. */
  weights?: string;
  llm: LlmMode;
  /** LLM cache directory; `--llm-cache examples/llm-cache` replays the shipped demo answers. */
  cacheDir: string;
  /** True when `--llm-cache` was given explicitly: without a provider the run replays from it. */
  cacheGiven?: boolean;
  agentDir: string;
  /** Run the LLM arbiter over block/review verdicts after scoring. Needs an LLM client. */
  arbiter?: boolean;
  /** Language of the arbiter's panel-facing text. Default en. */
  lang?: ArbiterLang;
  /** How much the arbiter may release. Default strict. */
  arbiterStrictness?: ArbiterStrictness;
}

const STRICTNESS: ArbiterStrictness[] = ['strict', 'balanced', 'lenient'];

/** Written in agent mode so that `surveyquorum resume` knows what to re-run. */
export const STATE_FILE = 'run-state.json';

/** Rough token sizes per request kind, for the estimate only. */
const TOKENS = {
  classifier: { input: 1100, output: 60 },
  arbiter: { input: 1500, output: 400 },
};

export function parseRunArgs(rest: string[], io: Io, config?: LlmConfig): RunArgs | undefined {
  const input = rest[0];
  if (!input || input.startsWith('--')) {
    io.err(RUN_USAGE);
    return undefined;
  }
  const llmFlag = arg(rest, '--llm') ?? (config ? 'api' : 'none');
  if (llmFlag !== 'api' && llmFlag !== 'agent' && llmFlag !== 'none') {
    io.err(`--llm must be api, agent or none (got "${llmFlag}")`);
    return undefined;
  }
  const lang = arg(rest, '--lang') ?? 'en';
  if (lang !== 'en' && lang !== 'ru') {
    io.err(`--lang must be en or ru (got "${lang}")`);
    return undefined;
  }
  const strictness = arg(rest, '--arbiter-strictness') ?? 'strict';
  if (!STRICTNESS.includes(strictness as ArbiterStrictness)) {
    io.err(`--arbiter-strictness must be strict, balanced or lenient (got "${strictness}")`);
    return undefined;
  }
  const weights = arg(rest, '--weights');
  if (rest.includes('--weights') && !weights) {
    io.err('--weights needs a file path (a weights JSON, e.g. from npm run calibration:fit)');
    return undefined;
  }
  return {
    input,
    out: arg(rest, '--out') ?? '.surveyquorum/verdicts.json',
    minCohort: Number(arg(rest, '--min-cohort') ?? 30),
    ...(weights ? { weights } : {}),
    llm: llmFlag,
    cacheDir: arg(rest, '--llm-cache') ?? config?.cacheDir ?? DEFAULT_CACHE_DIR,
    cacheGiven: arg(rest, '--llm-cache') !== undefined,
    agentDir: arg(rest, '--agent-dir') ?? config?.agentDir ?? DEFAULT_AGENT_DIR,
    arbiter: rest.includes('--arbiter'),
    lang,
    arbiterStrictness: strictness as ArbiterStrictness,
  };
}

/** How many LLM requests the two LLM detectors would make on a cold cache. */
export function countLlmRequests(dataset: Dataset): {
  openAnswers: number;
  pairChecks: number;
  pairDiscoveries: number;
} {
  let openAnswers = 0;
  let pairChecks = 0;
  for (const s of dataset) {
    for (const r of s.responses) {
      pairChecks++;
      for (const b of r.blocks) {
        if (b.type === 'open' && b.answer.some((t) => t.role === 'user' && t.text.trim())) {
          openAnswers++;
        }
      }
    }
  }
  return { openAnswers, pairChecks, pairDiscoveries: dataset.length };
}

/**
 * Read and validate the dataset file. A CSV, or anything that is not JSON, gets a plain
 * explanation instead of a parser stack trace: the usual slip is running `run` on an export
 * that still needs `convert`.
 */
export function readDatasetFile(path: string, io: Io): Dataset | undefined {
  if (extname(path).toLowerCase() === '.csv') {
    io.err(
      `${path} is a CSV, not a dataset JSON. Run "surveyquorum convert ${path} --out dataset.json" ` +
        'first (adapters/README.md), then run on the dataset.',
    );
    return undefined;
  }
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (err) {
    if (err instanceof SyntaxError) {
      io.err(
        `${path} is not a dataset JSON (${err.message}). If it is an export, run "surveyquorum convert" first.`,
      );
      return undefined;
    }
    throw err;
  }
  return parseDataset(raw);
}

export async function executeRun(
  args: RunArgs,
  io: Io = consoleIo,
  config: LlmConfig | undefined = loadLlmConfigFromEnv(),
): Promise<number> {
  const dataset = readDatasetFile(args.input, io);
  if (!dataset) return 2;
  let weights: Weights | undefined;
  if (args.weights) {
    try {
      weights = loadWeightsFile(args.weights);
    } catch (err) {
      io.err(err instanceof Error ? err.message : String(err));
      return 2;
    }
    io.err(`weights: ${weights.version} from ${args.weights}`);
  }
  const counts = countLlmRequests(dataset);

  let llm: CachedLlmClient | undefined;
  let agent: AgentFileClient | undefined;
  let mode = args.llm;
  if (mode === 'api' && config?.provider === 'agent-file') mode = 'agent';

  if (args.arbiter && mode === 'none' && !args.cacheGiven) {
    io.err(
      '--arbiter needs an LLM: run with --llm api (configured provider), --llm agent, or ' +
        '--llm-cache <dir> to replay recorded judgements.',
    );
    return 2;
  }
  if (mode === 'none' && args.cacheGiven) {
    // No provider, but a cache was named: replay recorded judgements (the shipped demo case).
    llm = createCacheOnlyClient(args.cacheDir);
    io.err(
      `LLM detectors${args.arbiter ? ' and the arbiter' : ''} replay from ${args.cacheDir}; ` +
        'judgements missing from the cache are skipped and counted as pending.',
    );
  }
  if (mode === 'api') {
    if (!config) {
      io.err(
        'no LLM configuration found: set SURVEYQUORUM_LLM_PROVIDER / _MODEL / _API_KEY (or ' +
          'surveyquorum.config.json), or run with --llm agent inside a coding agent, or --llm none.',
      );
      return 2;
    }
    llm = createLlmClient({ ...config, cacheDir: args.cacheDir });
    const classifier = estimateCost({
      requests: counts.openAnswers + counts.pairChecks,
      avgInputTokens: TOKENS.classifier.input,
      avgOutputTokens: TOKENS.classifier.output,
      model: config.models.classifier,
    });
    const arbiter = estimateCost({
      requests: counts.pairDiscoveries,
      avgInputTokens: TOKENS.arbiter.input,
      avgOutputTokens: TOKENS.arbiter.output,
      model: config.models.arbiter,
    });
    io.err(`LLM cost estimate on a cold cache (cache: ${args.cacheDir}):`);
    io.err(`  classifier: ${formatCost(classifier, config.models.classifier)}`);
    io.err(`  arbiter:    ${formatCost(arbiter, config.models.arbiter)}`);
  } else if (mode === 'agent') {
    agent = new AgentFileClient(args.agentDir);
    llm = withCache(agent, args.cacheDir);
    writeOut(join(args.agentDir, STATE_FILE), { ...args, llm: 'agent' });
    io.err(
      `agent mode: the LLM detectors may ask up to ${counts.openAnswers + counts.pairChecks + counts.pairDiscoveries} ` +
        `judgements (${counts.openAnswers} open answers, ${counts.pairChecks} respondent pair checks, ` +
        `${counts.pairDiscoveries} pair discoveries). Identical answers share one request and answers ` +
        `already in ${args.cacheDir} are reused; the number actually pending is printed at the end.`,
    );
  }

  const results = await run(dataset, {
    minCohort: args.minCohort,
    llm,
    ...(weights ? { weights } : {}),
    log: (m) => io.err(m),
  });
  if (args.arbiter && llm) {
    for (const r of results) {
      const survey = dataset.find((s) => s.id === r.surveyId);
      if (!survey) continue;
      const evidence = r.verdicts.flatMap((v) => v.evidence);
      const strictness = args.arbiterStrictness ?? 'strict';
      const a = await arbitrateDetailed(survey, r.verdicts, evidence, llm, {
        lang: args.lang ?? 'en',
        strictness,
        cohortMedians: cohortMedianDurations(survey),
        log: (m) => io.err(m),
      });
      r.verdicts = applyArbiter(r.verdicts, a.decisions);
      const by = (d: string) => a.decisions.filter((x) => x.decision === d).length;
      const unsure = a.decisions.filter((x) => x.decision === 'needs_human' && x.unsure).length;
      io.out(
        `${r.surveyId}: arbiter (${strictness}) — ${by('confirm')} confirmed, ` +
          `${by('overturn')} overturned${overturnCategories(a.decisions)}, ` +
          `${by('needs_human')} to a human` +
          (unsure ? ` (${unsure} because the arbiter hesitated)` : '') +
          (a.pending.length
            ? `, ${a.pending.length} pending` +
              (mode === 'none' ? ' (no judgement in the cache; verdicts unchanged)' : '')
            : '') +
          (a.failed.length ? `, ${a.failed.length} failed` : ''),
      );
      const after = (o: string) => r.verdicts.filter((v) => v.outcome === o).length;
      io.out(
        `  after arbiter: block ${after('block')}, to a person ${after('review')}, keep ${after('keep')}`,
      );
    }
  }
  writeOut(args.out, results);
  for (const r of results) {
    const n = r.verdicts.length;
    const by = (o: string) => r.verdicts.filter((v) => v.outcome === o).length;
    io.out(
      `${r.surveyId}: ${n} respondents — block ${by('block')}, review ${by('review')}, keep ${by('keep')}` +
        (r.skippedDetectors.length
          ? ` (skipped without LLM: ${r.skippedDetectors.join(', ')})`
          : ''),
    );
    for (const g of r.designArtifactSummary ?? []) {
      io.out(`  design artifact: ${describeDesignArtifact(g)}`);
    }
  }
  if (llm) {
    const s = llm.stats;
    io.err(
      `LLM cache: ${s.hits} hit(s), ${s.misses} new answer(s)` +
        (agent
          ? ''
          : `, ${s.pending} pending${mode === 'none' && s.pending ? ' (not in the cache)' : ''}`),
    );
  }
  io.out(`verdicts written to ${args.out}`);

  if (agent) {
    if (agent.pendingCount > 0) {
      io.out(agentInstructions(args.agentDir, agent.pendingCount));
      io.out(
        `Verdicts above were computed WITHOUT the pending judgements; run ${RESUME_COMMAND} after answering.`,
      );
    } else {
      io.out('agent mode: every judgement was answered from the cache; verdicts are final.');
    }
  }
  return 0;
}

/** ` (categories: technical_failure 3, short_branch 1)` for the overturns, or empty. */
function overturnCategories(decisions: { decision: string; overturnCategory: string }[]): string {
  const counts = new Map<string, number>();
  for (const d of decisions) {
    if (d.decision !== 'overturn') continue;
    counts.set(d.overturnCategory, (counts.get(d.overturnCategory) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  const parts = [...counts.entries()].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`);
  return ` (categories: ${parts.join(', ')})`;
}

/** Saved arguments of the last agent-mode run, if any. */
export function readRunState(agentDir: string): RunArgs | undefined {
  const p = join(agentDir, STATE_FILE);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as RunArgs;
  } catch {
    return undefined;
  }
}

export async function runCommand(rest: string[], io: Io = consoleIo): Promise<number> {
  const config = loadLlmConfigFromEnv();
  const args = parseRunArgs(rest, io, config);
  if (!args) return 2;
  return executeRun(args, io, config);
}
