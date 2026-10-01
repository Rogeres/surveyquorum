import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ConvertReport,
  type ConvertResult,
  convertCsv,
  convertPathwayReport,
  isPathwayReport,
  type Mapping,
  parseCsv,
  parseMapping,
} from 'surveyquorum';
import { arg, consoleIo, type Io, readJson, writeOut } from './shared.js';

export const CONVERT_USAGE =
  'surveyquorum convert <export.csv> [--preset <name> | --mapping <mapping.json>] ' +
  '[--survey-id <id>] [--out <dataset.json>]';

/**
 * Presets implemented in code rather than as a mapping file. `pathway` is the report export of
 * the Pathway platform (`adapters/presets/pathway.md`); its layout cannot be expressed as a
 * mapping because one question spans a variable number of columns.
 */
export const BUILTIN_PRESETS = ['pathway'] as const;

/** Header of the generic long layout (`adapters/presets/flat-long.json`), recognised without a flag. */
export const FLAT_LONG_HEADER =
  'survey_id,response_id,block_id,question_type,question,answer,duration_sec';

/** `adapters/presets/` at the repository root; works from `src/` and from `dist/`. */
export const PRESETS_DIR = fileURLToPath(new URL('../../../../adapters/presets/', import.meta.url));

export function listPresets(dir = PRESETS_DIR): string[] {
  const fromFiles = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.json') && !f.endsWith('.expected.json'))
        .map((f) => f.replace(/\.json$/, ''))
    : [];
  return [...new Set([...fromFiles, ...BUILTIN_PRESETS])].sort();
}

/** Load a mapping-file preset. Built-in presets (`pathway`) have no mapping and are routed in code. */
export function loadPreset(name: string, dir = PRESETS_DIR): Mapping {
  const path = join(dir, `${name}.json`);
  if (!existsSync(path)) {
    const known = listPresets(dir);
    throw new Error(
      `unknown preset "${name}". Known presets: ${known.length ? known.join(', ') : '(none)'}. ` +
        'Write a mapping.json and pass --mapping instead (see adapters/README.md).',
    );
  }
  return parseMapping(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * Preset a CSV header identifies on its own: the Pathway report export (`Answer ID` +
 * `Completion time, s`) or the generic flat-long layout. Anything else needs a flag.
 */
export function detectPreset(header: string[]): 'pathway' | 'flat-long' | undefined {
  if (isPathwayReport(header)) return 'pathway';
  if (header.map((h) => h.trim()).join(',') === FLAT_LONG_HEADER) return 'flat-long';
  return undefined;
}

/** Why `convert` cannot proceed without a flag, and the three ways to tell it how to read the file. */
export function explainNoMapping(input: string, header: string[], presets: string[]): string {
  const shown = header.slice(0, 6).join(', ') + (header.length > 6 ? ', …' : '');
  return [
    `convert: the header of ${input} is not one this command recognises on its own`,
    `  (${shown}). Tell it how to read the file in one of three ways:`,
    `  --preset <name>     a mapping that ships with the repository (adapters/presets/): ${presets.join(', ') || '(none)'}`,
    '  --mapping <file>    your own mapping JSON — adapters/README.md explains the format field by field',
    '  (no flag)           only for exports recognised by header: a Pathway report export',
    `                      ("Answer ID" + "Completion time, s") or the flat-long layout (${FLAT_LONG_HEADER})`,
  ].join('\n');
}

/** Human-readable report, one fact per line. */
export function formatReport(report: ConvertReport, mappingName?: string): string {
  const lines: string[] = [];
  lines.push(
    `convert${mappingName ? ` (${mappingName})` : ''}: ${report.rowsRead} rows read, ` +
      `${report.rowsConverted} converted, ${report.rowsSkipped} skipped`,
  );
  const types = Object.entries(report.blocksByType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n}`)
    .join(', ');
  lines.push(
    `  ${report.surveys} survey(s), ${report.responses} response(s), ${report.blocks} block(s)` +
      (types ? ` — ${types}` : ''),
  );
  if (report.screeningAnswers > 0) lines.push(`  ${report.screeningAnswers} screening answer(s)`);
  lines.push(`  duration: ${report.hasDuration ? 'present' : 'absent (every block gets 0)'}`);

  for (const s of report.skipped) {
    lines.push(`  skipped ${s.count} row(s) — ${s.reason}:`);
    for (const e of s.examples) lines.push(`    line ${e.line}: ${e.detail}`);
    if (s.count > s.examples.length) lines.push(`    … and ${s.count - s.examples.length} more`);
  }
  for (const w of report.warnings) lines.push(`  warning: ${w}`);

  lines.push(`  detectors available: ${report.detectorsAvailable.join(', ') || '(none)'}`);
  const byReason = new Map<string, string[]>();
  for (const u of report.detectorsUnavailable) {
    byReason.set(u.reason, [...(byReason.get(u.reason) ?? []), u.detector]);
  }
  for (const [reason, detectors] of byReason) {
    lines.push(`  ${reason} → ${detectors.join(', ')} unavailable`);
  }
  return lines.join('\n');
}

/** Default survey id for format-specific converters: the file name without its extension. */
export function surveyIdFromFile(input: string): string {
  const base = basename(input);
  return base.slice(0, base.length - extname(base).length) || base;
}

export function convertCommand(rest: string[], io: Io = consoleIo): number {
  const input = rest[0];
  let preset = arg(rest, '--preset');
  const mappingPath = arg(rest, '--mapping');
  const usage = (reason?: string) => {
    if (reason) io.err(`convert: ${reason}`);
    io.err(CONVERT_USAGE);
    io.err(`Presets: ${listPresets().join(', ') || '(none)'}`);
    return 2;
  };
  if (!input || input.startsWith('--'))
    return usage('the first argument must be the CSV to convert');
  if (preset && mappingPath) return usage('--preset and --mapping exclude each other');
  const text = readFileSync(resolve(input), 'utf8');

  if (!preset && !mappingPath) {
    const header = parseCsv(text).header;
    const detected = detectPreset(header);
    if (!detected) {
      io.err(explainNoMapping(input, header, listPresets()));
      return 2;
    }
    io.err(
      detected === 'pathway'
        ? 'detected a Pathway report export ("Answer ID" + "Completion time, s"); using --preset pathway'
        : `detected the flat-long header (${FLAT_LONG_HEADER}); using --preset flat-long`,
    );
    preset = detected;
  }

  let result: ConvertResult;
  let label: string | undefined;
  if (preset === 'pathway') {
    const surveyId = arg(rest, '--survey-id') ?? surveyIdFromFile(input);
    result = convertPathwayReport(text, { surveyId });
    label = 'pathway';
  } else {
    const mapping = preset ? loadPreset(preset) : parseMapping(readJson(mappingPath!));
    result = convertCsv(text, mapping);
    label = mapping.name ?? preset;
  }
  const { dataset, report } = result;
  const out = arg(rest, '--out') ?? '.surveyquorum/dataset.json';
  writeOut(out, dataset);
  io.err(formatReport(report, label));
  io.out(`dataset written to ${out}`);
  return report.responses > 0 ? 0 : 1;
}
