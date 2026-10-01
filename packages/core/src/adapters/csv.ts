/**
 * CSV → contract converter. `convertCsv(text, mapping)` returns a validated `Dataset` and a
 * `ConvertReport` that says what was read, what was dropped and which detectors the resulting
 * data can feed.
 */
import { parseDataset } from '../contract/schema.js';
import type {
  Block,
  Dataset,
  InventoryItem,
  Response,
  ScreeningAnswer,
  Survey,
} from '../contract/types.js';
import { AnswerParseError, cellToBlock, cellToScreeningAnswer } from './answers.js';
import { parseCsv } from './csv-parser.js';
import {
  type LongMapping,
  type Mapping,
  type MappingTypeName,
  mappingTypeName,
  type WideMapping,
} from './mapping.js';

export class ConvertError extends Error {}

export interface SkippedRows {
  reason: string;
  count: number;
  /** First examples: 1-based CSV line number (header is line 1) and a short detail. */
  examples: { line: number; detail: string }[];
}

export interface DetectorUnavailable {
  detector: string;
  reason: string;
}

export interface ConvertReport {
  rowsRead: number;
  rowsConverted: number;
  rowsSkipped: number;
  skipped: SkippedRows[];
  surveys: number;
  responses: number;
  blocks: number;
  blocksByType: Record<string, number>;
  screeningAnswers: number;
  hasDuration: boolean;
  warnings: string[];
  detectorsAvailable: string[];
  detectorsUnavailable: DetectorUnavailable[];
}

export interface ConvertResult {
  dataset: Dataset;
  report: ConvertReport;
}

const MAX_EXAMPLES = 10;

/** Which data each detector needs. `coherence` is listed for its screening-vs-body half. */
const DETECTOR_NEEDS: { detector: string; needs: Need[] }[] = [
  { detector: 'pace', needs: ['duration'] },
  { detector: 'open-answer', needs: ['open'] },
  { detector: 'duplicate-open', needs: ['open'] },
  { detector: 'coherence (screening-vs-body)', needs: ['screening'] },
  { detector: 'matrix-pattern', needs: ['matrix'] },
  { detector: 'mass-select', needs: ['choice'] },
  { detector: 'prototype-effort', needs: ['prototype', 'duration'] },
  { detector: 'cardsort-consensus', needs: ['cardsort'] },
  { detector: 'firstclick-offtarget', needs: ['firstclick'] },
  { detector: 'website-bounce', needs: ['website', 'duration'] },
  { detector: 'positive', needs: [] },
];

type Need =
  | 'duration'
  | 'screening'
  | 'open'
  | 'matrix'
  | 'choice'
  | 'prototype'
  | 'cardsort'
  | 'firstclick'
  | 'website';

const NEED_REASON: Record<Need, string> = {
  duration: 'no duration column',
  screening: 'no screening answers',
  open: 'no open questions',
  matrix: 'no matrix questions',
  choice: 'no choice questions',
  prototype: 'no prototype tasks',
  cardsort: 'no card-sort tasks',
  firstclick: 'no first-click tasks',
  website: 'no website tasks',
};

/**
 * Which detectors the converted data can feed, from what the converter counted. Shared by the
 * mapping-driven converter and by format-specific converters (`pathway-report.ts`).
 */
export function detectorAvailability(have: {
  blocksByType: Record<string, number>;
  hasDuration: boolean;
  screeningAnswers: number;
}): { detectorsAvailable: string[]; detectorsUnavailable: DetectorUnavailable[] } {
  const got = new Set<Need>();
  if (have.hasDuration) got.add('duration');
  if (have.screeningAnswers > 0) got.add('screening');
  for (const t of ['open', 'matrix', 'choice', 'prototype', 'cardsort', 'firstclick', 'website']) {
    if ((have.blocksByType[t] ?? 0) > 0) got.add(t as Need);
  }
  const detectorsAvailable: string[] = [];
  const detectorsUnavailable: DetectorUnavailable[] = [];
  for (const { detector, needs } of DETECTOR_NEEDS) {
    const missing = needs.filter((n) => !got.has(n));
    if (missing.length === 0) detectorsAvailable.push(detector);
    else
      detectorsUnavailable.push({
        detector,
        reason: missing.map((n) => NEED_REASON[n]).join('; '),
      });
  }
  return { detectorsAvailable, detectorsUnavailable };
}

// ----------------------------------------------------------------------------

class Collector {
  private surveys = new Map<string, { survey: Survey; responses: Map<string, Response> }>();
  private skipped = new Map<string, SkippedRows>();
  readonly warnings: string[] = [];
  readonly blocksByType: Record<string, number> = {};
  screeningAnswers = 0;
  rowsConverted = 0;
  rowsSkipped = 0;

  constructor(private readonly mapping: Mapping) {}

  skip(line: number, reason: string, detail: string): void {
    this.rowsSkipped++;
    const entry = this.skipped.get(reason) ?? { reason, count: 0, examples: [] };
    entry.count++;
    if (entry.examples.length < MAX_EXAMPLES) entry.examples.push({ line, detail });
    this.skipped.set(reason, entry);
  }

  response(surveyId: string, responseId: string, meta: Partial<Response>): Response {
    let s = this.surveys.get(surveyId);
    if (!s) {
      const survey: Survey = { id: surveyId, responses: [] };
      if (this.mapping.source) survey.source = this.mapping.source.const;
      if (this.mapping.target) survey.target = this.mapping.target.const;
      s = { survey, responses: new Map() };
      this.surveys.set(surveyId, s);
    }
    let r = s.responses.get(responseId);
    if (!r) {
      r = { id: responseId, blocks: [] };
      if (meta.device) r.device = meta.device;
      if (meta.fingerprint) r.fingerprint = meta.fingerprint;
      if (meta.panel) r.panel = meta.panel;
      s.responses.set(responseId, r);
      s.survey.responses.push(r);
    }
    return r;
  }

  addBlock(r: Response, block: Block): void {
    r.blocks.push(block);
    this.blocksByType[block.type] = (this.blocksByType[block.type] ?? 0) + 1;
  }

  addScreening(r: Response, answer: ScreeningAnswer): void {
    r.screening ??= [];
    r.screening.push(answer);
    this.screeningAnswers++;
  }

  setInventory(surveyId: string, inventory: InventoryItem[]): void {
    const s = this.surveys.get(surveyId);
    if (s) s.survey.inventory = inventory;
  }

  dataset(): Survey[] {
    return [...this.surveys.values()].map((s) => s.survey);
  }

  skippedList(): SkippedRows[] {
    return [...this.skipped.values()].sort((a, b) => b.count - a.count);
  }

  finish(rowsRead: number, hasDuration: boolean): ConvertResult {
    const dataset = parseDataset(this.dataset());
    const responses = dataset.reduce((n, s) => n + s.responses.length, 0);
    const blocks = Object.values(this.blocksByType).reduce((a, b) => a + b, 0);
    const { detectorsAvailable, detectorsUnavailable } = detectorAvailability({
      blocksByType: this.blocksByType,
      hasDuration,
      screeningAnswers: this.screeningAnswers,
    });
    return {
      dataset,
      report: {
        rowsRead,
        rowsConverted: this.rowsConverted,
        rowsSkipped: this.rowsSkipped,
        skipped: this.skippedList(),
        surveys: dataset.length,
        responses,
        blocks,
        blocksByType: this.blocksByType,
        screeningAnswers: this.screeningAnswers,
        hasDuration,
        warnings: this.warnings,
        detectorsAvailable,
        detectorsUnavailable,
      },
    };
  }
}

// ----------------------------------------------------------------------------

function columnIndex(header: string[], mapping: Mapping): (name: string) => number {
  const index = new Map<string, number>();
  header.forEach((h, i) => {
    if (!index.has(h)) index.set(h, i);
  });
  const referenced = referencedColumns(mapping);
  const missing = referenced.filter((c) => !index.has(c));
  if (missing.length > 0) {
    throw new ConvertError(
      `mapping refers to column(s) not in the CSV header: ${missing.map((m) => `"${m}"`).join(', ')}. ` +
        `Header has: ${header.map((h) => `"${h}"`).join(', ')}`,
    );
  }
  return (name) => index.get(name)!;
}

function referencedColumns(m: Mapping): string[] {
  const cols: (string | undefined)[] = [m.responseId, m.device, m.fingerprint, m.panelToken];
  if (m.layout === 'long') {
    cols.push(m.question, m.answer, m.blockId, m.durationSec, m.durationMs);
    if (typeof m.surveyId === 'string') cols.push(m.surveyId);
    if (typeof m.questionType === 'string') cols.push(m.questionType);
  } else {
    for (const q of m.questions) cols.push(q.column, q.durationColumn, q.durationMsColumn);
  }
  return [...new Set(cols.filter((c): c is string => typeof c === 'string'))];
}

function parseDuration(
  sec: string | undefined,
  ms: string | undefined,
  warn: (msg: string) => void,
): number {
  const raw = sec ?? ms;
  if (raw === undefined || raw.trim() === '') return 0;
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n)) {
    warn(`duration "${raw}" is not a number; treated as unknown (0)`);
    return 0;
  }
  const value = sec !== undefined ? n : n / 1000;
  return value < 0 ? 0 : value;
}

function responseMeta(
  cell: (name: string | undefined) => string | undefined,
  m: Mapping,
): Partial<Response> {
  const meta: Partial<Response> = {};
  const device = cell(m.device)?.trim();
  const fingerprint = cell(m.fingerprint)?.trim();
  const token = cell(m.panelToken)?.trim();
  if (device) meta.device = device;
  if (fingerprint) meta.fingerprint = fingerprint;
  if (token) meta.panel = { token };
  return meta;
}

function normalizeType(raw: string): MappingTypeName | undefined {
  const v = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const alias: Record<string, MappingTypeName> = {
    text: 'open',
    open_text: 'open',
    opentext: 'open',
    single: 'choice',
    single_choice: 'choice',
    multiple: 'multi',
    multiple_choice: 'multi',
    multi_choice: 'multi',
    rating: 'scale',
    likert: 'scale',
    grid: 'matrix',
    card_sort: 'cardsort',
    first_click: 'firstclick',
    figma: 'prototype',
    live_website: 'website',
  };
  const t = alias[v] ?? v;
  return mappingTypeName.options.includes(t as MappingTypeName)
    ? (t as MappingTypeName)
    : undefined;
}

// ----------------------------------------------------------------------------

function convertLong(header: string[], rows: string[][], m: LongMapping): ConvertResult {
  const col = columnIndex(header, m);
  const c = new Collector(m);
  const hasDuration = Boolean(m.durationSec || m.durationMs);
  const unknownTypes = new Map<string, number>();
  const warnedDuration = { done: false };

  rows.forEach((row, i) => {
    const line = i + 2;
    if (row.length > header.length) {
      c.skip(
        line,
        'more cells than header columns',
        `${row.length} cells, header has ${header.length}`,
      );
      return;
    }
    const cell = (name: string | undefined) =>
      name === undefined ? undefined : (row[col(name)] ?? '');

    const responseId = cell(m.responseId)?.trim() ?? '';
    if (responseId === '') {
      c.skip(line, 'empty response id', `column "${m.responseId}" is empty`);
      return;
    }
    const question = cell(m.question)?.trim() ?? '';
    if (question === '') {
      c.skip(line, 'empty question', `column "${m.question}" is empty`);
      return;
    }
    const surveyId =
      typeof m.surveyId === 'string' ? cell(m.surveyId)?.trim() || 'survey' : m.surveyId.const;
    const blockId = cell(m.blockId)?.trim() || undefined;

    let type: MappingTypeName;
    let sourceType: string | undefined;
    if (typeof m.questionType === 'string') {
      const raw = cell(m.questionType) ?? '';
      const t = normalizeType(raw);
      if (t) type = t;
      else {
        type = 'other';
        sourceType = raw.trim() || undefined;
        if (raw.trim()) unknownTypes.set(raw.trim(), (unknownTypes.get(raw.trim()) ?? 0) + 1);
      }
    } else if ('const' in m.questionType) {
      type = m.questionType.const;
    } else {
      const by = m.questionType.byQuestion;
      type = (blockId ? by[blockId] : undefined) ?? by[question] ?? m.questionType.default;
    }

    const duration = parseDuration(cell(m.durationSec), cell(m.durationMs), (msg) => {
      if (!warnedDuration.done) {
        c.warnings.push(`line ${line}: ${msg} (further duration warnings suppressed)`);
        warnedDuration.done = true;
      }
    });
    const answer = cell(m.answer) ?? '';
    const r = c.response(surveyId, responseId, responseMeta(cell, m));

    if (isScreening(m, blockId, question)) {
      c.addScreening(r, { question, answer: cellToScreeningAnswer(type, answer, m.separator) });
      c.rowsConverted++;
      return;
    }
    try {
      c.addBlock(
        r,
        cellToBlock(type, answer, {
          question,
          blockId,
          duration,
          separator: m.separator,
          sourceType,
        }),
      );
      c.rowsConverted++;
    } catch (err) {
      if (err instanceof AnswerParseError) c.skip(line, `unreadable ${type} answer`, err.message);
      else throw err;
    }
  });

  for (const [t, n] of unknownTypes) {
    c.warnings.push(`unknown question type "${t}" on ${n} row(s): kept as "other"`);
  }
  if (
    typeof m.questionType === 'object' &&
    'const' in m.questionType &&
    m.questionType.const === 'open'
  ) {
    c.warnings.push(
      'questionType is the constant "open": every block is treated as free text. ' +
        'Map a type column or byQuestion to enable matrix, choice and timing detectors by type.',
    );
  }
  return c.finish(rows.length, hasDuration);
}

function isScreening(m: LongMapping, blockId: string | undefined, question: string): boolean {
  const s = m.screening;
  if (!s) return false;
  if (blockId && s.blockIds?.includes(blockId)) return true;
  if (s.questions?.includes(question)) return true;
  if (s.questionPrefixes?.some((p) => question.startsWith(p))) return true;
  return false;
}

function convertWide(header: string[], rows: string[][], m: WideMapping): ConvertResult {
  const col = columnIndex(header, m);
  const c = new Collector(m);
  const hasDuration = m.questions.some((q) => q.durationColumn || q.durationMsColumn);
  const surveyId = m.surveyId.const;
  const warnedDuration = { done: false };

  rows.forEach((row, i) => {
    const line = i + 2;
    if (row.length > header.length) {
      c.skip(
        line,
        'more cells than header columns',
        `${row.length} cells, header has ${header.length}`,
      );
      return;
    }
    const cell = (name: string | undefined) =>
      name === undefined ? undefined : (row[col(name)] ?? '');
    const responseId = cell(m.responseId)?.trim() ?? '';
    if (responseId === '') {
      c.skip(line, 'empty response id', `column "${m.responseId}" is empty`);
      return;
    }
    const r = c.response(surveyId, responseId, responseMeta(cell, m));
    let converted = 0;
    const problems: string[] = [];
    for (const q of m.questions) {
      const answer = cell(q.column) ?? '';
      if (answer.trim() === '') continue; // not reached / not shown
      const question = q.question ?? q.column;
      const duration = parseDuration(cell(q.durationColumn), cell(q.durationMsColumn), (msg) => {
        if (!warnedDuration.done) {
          c.warnings.push(`line ${line}: ${msg} (further duration warnings suppressed)`);
          warnedDuration.done = true;
        }
      });
      if (q.screening) {
        c.addScreening(r, { question, answer: cellToScreeningAnswer(q.type, answer, m.separator) });
        converted++;
        continue;
      }
      try {
        c.addBlock(
          r,
          cellToBlock(q.type, answer, {
            question,
            blockId: q.blockId,
            duration,
            separator: m.separator,
          }),
        );
        converted++;
      } catch (err) {
        if (err instanceof AnswerParseError) problems.push(`"${q.column}": ${err.message}`);
        else throw err;
      }
    }
    if (problems.length > 0) {
      for (const p of problems) c.skip(line, 'unreadable answer cell', p);
      c.rowsSkipped -= problems.length - 1; // one row, several cells
    }
    if (converted > 0 || problems.length === 0) c.rowsConverted++;
  });

  c.setInventory(
    surveyId,
    m.questions.map((q) => ({
      scope: q.screening ? 'screening' : 'body',
      type: q.type === 'multi' ? 'choice' : q.type,
      question: q.question ?? q.column,
    })),
  );
  return c.finish(rows.length, hasDuration);
}

/** Convert CSV text with a mapping into a validated dataset plus a report. */
export function convertCsv(text: string, mapping: Mapping): ConvertResult {
  const { header, rows } = parseCsv(text, mapping.delimiter);
  if (header.length === 0) throw new ConvertError('CSV is empty: no header row');
  return mapping.layout === 'long'
    ? convertLong(header, rows, mapping)
    : convertWide(header, rows, mapping);
}
