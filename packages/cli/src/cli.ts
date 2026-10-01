#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { COMPLAINTS_USAGE, complaintsCommand, PANEL_HELP } from './commands/complaints.js';
import { CONVERT_USAGE, convertCommand, listPresets } from './commands/convert.js';
import { EXPLAIN_USAGE, explainCommand } from './commands/explain.js';
import { IMPORT_HELP, importCommand } from './commands/import.js';
import { RESUME_HELP, resumeCommand } from './commands/resume.js';
import { RUN_HELP, runCommand } from './commands/run.js';
import { consoleIo, type Io, wantsHelp } from './commands/shared.js';
import { WEIGHTS_USAGE, weightsCommand } from './commands/weights.js';

export const USAGE = `surveyquorum — consensus screening of survey respondents

Usage:
  surveyquorum run <dataset.json> [--out <verdicts.json>] [--min-cohort <n>] [--weights <weights.json>]
                   [--llm api|agent|none] [--llm-cache <dir>] [--agent-dir <dir>]
                   [--arbiter] [--arbiter-strictness strict|balanced|lenient] [--lang en|ru]
                                                    # second opinion on block/review verdicts (needs an LLM or a cache)
  surveyquorum resume [<dataset.json>]      # agent mode: ingest judge-responses.jsonl and re-run
  surveyquorum explain <verdicts.json> <responseId>
  surveyquorum convert <export.csv> [--preset <name> | --mapping <mapping.json>] [--survey-id <id>] [--out <dataset.json>]
  surveyquorum import pathway --test <id> [--token <t>] [--base-url <u>] [--survey-id <id>] [--out <dataset.json>] [--max-pages <n>]
  surveyquorum complaints <verdicts.json> [--panel generic | --panel-profile <profile.json>] [--lang en|ru]
                   [--out <complaints.csv>]        # profile files: adapters/panel-profiles/
                   [--dataset <dataset.json>]      # quote questions verbatim, fill panel tokens
                   [--decisions <decisions.json>]  # human keep/block decisions applied before eligibility
  surveyquorum weights [--file <weights.json>]   # print the active weights with their sources
  surveyquorum <command> --help                  # usage of one command
  surveyquorum --version

Statistical detectors run without any LLM. Set an LLM provider to enable open-answer and
coherence detectors (see docs/models.md), or use --llm agent inside a coding agent.
convert reads a CSV through a preset (adapters/presets/) or your own mapping (adapters/README.md);
two layouts are recognised by header alone. import reads from one survey platform's public API
(adapters/presets/pathway.md).
`;

/** Version of the CLI package, read from its package.json (works from src/ and dist/). */
export function cliVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Help text per command; printed by the shared `--help` check before anything runs. */
export function commandHelp(cmd: string): string | undefined {
  switch (cmd) {
    case 'run':
      return RUN_HELP;
    case 'resume':
      return RESUME_HELP;
    case 'convert':
      return `${CONVERT_USAGE}\n\nPresets: ${listPresets().join(', ') || '(none)'}. Without a flag the header must identify the layout (a Pathway report export or the flat-long layout).`;
    case 'import':
      return IMPORT_HELP;
    case 'explain':
      return EXPLAIN_USAGE;
    case 'weights':
      return WEIGHTS_USAGE;
    case 'complaints':
      return `${COMPLAINTS_USAGE}\n\n${PANEL_HELP}`;
    default:
      return undefined;
  }
}

export async function main(argv: string[], io: Io = consoleIo): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd === '--version' || cmd === '-v') {
    io.out(`surveyquorum ${cliVersion()}`);
    return 0;
  }
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    io.out(USAGE);
    return 0;
  }
  // `--help` never has side effects: it is answered here, before any command reads or writes.
  if (wantsHelp(rest)) {
    const help = commandHelp(cmd);
    if (help) {
      io.out(help);
      return 0;
    }
  }
  switch (cmd) {
    case 'run':
      return runCommand(rest, io);
    case 'resume':
      return resumeCommand(rest, io);
    case 'convert':
      return convertCommand(rest, io);
    case 'import':
      return importCommand(rest, io);
    case 'explain':
      return explainCommand(rest, io);
    case 'weights':
      return weightsCommand(rest, io);
    case 'complaints':
      return complaintsCommand(rest, io);
    default:
      io.err(`unknown command "${cmd}"`);
      io.err(USAGE);
      return 2;
  }
}

// Only run when executed as a program, not when imported by tests.
const entry = process.argv[1];
if (entry && /\/cli\.(ts|js)$/.test(entry)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    },
  );
}
