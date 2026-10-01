import type { Block, Response, Survey } from '../contract/types.js';
import { blockKey, groupByQuestion } from '../detectors/shared/cohort.js';
import { median } from '../detectors/shared/stats.js';
import type { Evidence } from '../detectors/types.js';

/** Cohort median seconds per block key, for the per-block comparison the arbiter sees. */
export function cohortMedianDurations(survey: Survey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, blocks] of groupByQuestion(survey)) {
    const d = blocks.map((b) => b.block.duration).filter((x) => x > 0);
    if (d.length >= 2) out[key] = Math.round(median(d) * 10) / 10;
  }
  return out;
}

export function fmtSec(sec: number): string {
  if (!(sec > 0)) return 'time unknown';
  if (sec < 60) return `${Math.round(sec)} s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s === 0 ? `${m} min` : `${m} min ${s} s`;
}

function renderBody(b: Block): string[] {
  switch (b.type) {
    case 'choice':
      return [`-> ${b.answer.length ? b.answer.join(', ') : '(no answer)'}`];
    case 'scale':
      return [`-> ${b.answer || '(no answer)'}`];
    case 'matrix':
    case 'cardsort': {
      const rows = Object.entries(b.answer ?? {});
      if (rows.length === 0) return ['-> (no answer)'];
      return rows.map(([k, v]) => `* ${k} -> ${v.join(', ')}`);
    }
    case 'open': {
      if (b.answer.length === 0) return ['-> (no answer)'];
      // Keep the dialogue shape but drop an assistant turn that merely restates the question.
      return b.answer
        .filter((t) => !(t.role === 'assistant' && t.text.trim() === b.question.trim()))
        .map((t) => `-> ${t.role === 'user' ? 'answer' : 'follow-up'}: "${t.text}"`);
    }
    case 'prototype':
      return [`-> interactive task: ${b.status}, clicks: ${b.clickCount}`];
    case 'website':
      return [`-> website task: ${b.gaveUp ? 'gave up' : 'finished'}`];
    case 'firstclick':
      return [`-> click at (left ${b.answer.left}, top ${b.answer.top})`];
    default:
      return [`-> (${b.sourceType ?? 'other'} block; only the time is used)`];
  }
}

/**
 * Every block the respondent answered, numbered, with the time spent and the cohort median
 * when known. The arbiter must judge exactly what the respondent produced, not a summary.
 */
export function renderResponse(
  r: Response,
  cohortMedians: Record<string, number> = {},
  maxChars = 40_000,
): string {
  const lines: string[] = [];
  if (r.screening?.length) {
    lines.push('DECLARED AT SCREENING:');
    for (const s of r.screening) lines.push(`  * ${s.question} -> ${s.answer.join(', ')}`);
    lines.push('');
  }
  lines.push(`ANSWERS (${r.blocks.length} questions, device: ${r.device ?? 'unknown'}):`);
  r.blocks.forEach((b, i) => {
    const med = cohortMedians[blockKey(b)];
    const time = med ? `${fmtSec(b.duration)}, others about ${fmtSec(med)}` : fmtSec(b.duration);
    lines.push(`[${i + 1}] (${b.type}, ${time}) ${b.question || '-'}`);
    for (const l of renderBody(b)) lines.push(`    ${l}`);
  });
  const text = lines.join('\n');
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n... [truncated]`;
}

export function renderEvidence(evidence: Evidence[]): string {
  if (evidence.length === 0) return '(none)';
  return evidence
    .map(
      (e, i) =>
        `${i + 1}. [${e.detector}.${e.signal}, ${e.strength}] ${e.summary}` +
        (e.blocks?.length ? ` (questions ${e.blocks.map((b) => b + 1).join(', ')})` : '') +
        (e.stats ? `\n   numbers: ${JSON.stringify(e.stats)}` : ''),
    )
    .join('\n');
}
