import {
  DEFAULT_WEIGHTS,
  describeDesignArtifact,
  type Evidence,
  type SurveyResult,
  weightFor,
} from 'surveyquorum';
import { consoleIo, type Io, readJson } from './shared.js';

export const EXPLAIN_USAGE = 'surveyquorum explain <verdicts.json> <responseId>';

function evidenceLine(e: Evidence, weighed: boolean): string[] {
  const w = weightFor(e, DEFAULT_WEIGHTS);
  const head =
    `  - ${e.detector}.${e.signal} [${e.strength}` +
    (weighed ? `, weight ${w >= 0 ? '+' : ''}${w}` : ', not weighed') +
    ']';
  const lines = [head, `      ${e.summary}`];
  if (e.blocks?.length) lines.push(`      blocks: ${e.blocks.join(', ')}`);
  if (e.stats && Object.keys(e.stats).length) {
    lines.push(
      `      stats: ${Object.entries(e.stats)
        .map(([k, v]) => `${k}=${v === null ? 'null' : String(v)}`)
        .join(', ')}`,
    );
  }
  return lines;
}

/** Explanation of one respondent's verdict, or undefined when the id is not in the file. */
export function formatExplanation(results: SurveyResult[], responseId: string): string | undefined {
  for (const r of results) {
    const v = r.verdicts.find((x) => x.responseId === responseId);
    if (!v) continue;
    const t = DEFAULT_WEIGHTS.thresholds;
    const lines: string[] = [];
    lines.push(`${responseId} (survey ${r.surveyId}): ${v.outcome.toUpperCase()}`);
    lines.push(
      v.probability !== undefined
        ? `  estimated probability of junk ${v.probability} (log-odds ${v.score}) — block at ≥ ${t.block}, review at ≥ ${t.review}`
        : `  score ${v.score} — block at ≥ ${t.block}, review at ≥ ${t.review}`,
    );
    if (v.noContentToCheck) {
      lines.push(
        '  note: no open answers — the engine saw no free text from this respondent, so content checks did not apply',
      );
    }
    lines.push(v.evidence.length ? `  evidence (${v.evidence.length}):` : '  evidence: none');
    for (const e of v.evidence) lines.push(...evidenceLine(e, true));
    if (v.designArtifacts.length) {
      lines.push(
        `  design artifacts (${v.designArtifacts.length}) — fired for a large share of the cohort, reported to the survey author, not weighed:`,
      );
      for (const e of v.designArtifacts) {
        lines.push(...evidenceLine(e, false));
        // Files written before the summary existed have no per-question grouping.
        const groups = (r.designArtifactSummary ?? []).filter(
          (g) => g.detector === e.detector && g.signal === e.signal,
        );
        for (const g of groups) lines.push(`      survey-wide: ${describeDesignArtifact(g)}`);
      }
    }
    if (r.skippedDetectors.length) {
      lines.push(`  detectors skipped in this run (no LLM): ${r.skippedDetectors.join(', ')}`);
    }
    return lines.join('\n');
  }
  return undefined;
}

export function explainCommand(rest: string[], io: Io = consoleIo): number {
  const [path, responseId] = rest;
  if (!path || !responseId) {
    io.err(EXPLAIN_USAGE);
    return 2;
  }
  const results = readJson(path) as SurveyResult[];
  if (!Array.isArray(results)) {
    io.err(`${path}: expected the array written by "surveyquorum run"`);
    return 1;
  }
  const text = formatExplanation(results, responseId);
  if (!text) {
    const n = results.reduce((a, r) => a + r.verdicts.length, 0);
    io.err(`${responseId}: not found among ${n} verdict(s) in ${path}`);
    return 1;
  }
  io.out(text);
  return 0;
}
