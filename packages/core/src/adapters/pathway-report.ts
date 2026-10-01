/**
 * Pathway report export (CSV) → contract. No mapping file: the export has a fixed layout that
 * this converter knows. `adapters/presets/pathway.md` is the human-facing description.
 *
 * Layout (wide, one row per respondent):
 *   Answer ID, <URL tags…>, Device, Device OS, Browser, Window size, Source, Status, Reward,
 *   Completion time, s, Answer Date, then block columns whose header is `<N>. <Type> – <question>`
 *   (several columns can share one `N`: multi-choice options, matrix rows, card-sort cards,
 *   Figma time/screen/status, ranking options, …).
 *
 * What the export does not carry — and therefore what the contract gets as "unknown":
 *   - per-question time for anything but Figma / Live website / Click (`duration: 0`);
 *   - prototype click counts (`clickCount: 0`);
 *   - first-click coordinates (the block becomes `other` with `sourceType: "firstclick"`);
 *   - option lists for single-choice questions and matrix columns;
 *   - block ids (`pw-<N>` is synthesised from the column number).
 */
import { parseDataset } from '../contract/schema.js';
import type {
  Block,
  Dataset,
  InventoryItem,
  OpenTurn,
  PanelMeta,
  Response,
  Survey,
} from '../contract/types.js';
import {
  ConvertError,
  type ConvertReport,
  type ConvertResult,
  detectorAvailability,
} from './csv.js';
import { parseCsv } from './csv-parser.js';

export interface PathwayConvertOptions {
  /** Survey id for the dataset. The CLI passes the file name; the default is "pathway". */
  surveyId?: string;
}

/** Fixed columns after the URL tags, in export order. */
const FIXED_AFTER_TAGS = [
  'Device',
  'Device OS',
  'Browser',
  'Window size',
  'Source',
  'Status',
  'Reward',
  'Completion time, s',
  'Answer Date',
] as const;

const ANSWER_ID = 'Answer ID';
const COMPLETION_TIME = 'Completion time, s';
const MAX_EXAMPLES = 10;

/** Cheap detection from the header alone: `Answer ID` plus `Completion time, s`. */
export function isPathwayReport(headers: string[]): boolean {
  const h = headers.map((x) => x.trim());
  return h.includes(ANSWER_ID) && h.includes(COMPLETION_TIME);
}

// ----------------------------------------------------------------------------
// Header parsing
// ----------------------------------------------------------------------------

/** One block column, parsed from its header. */
export interface PathwayColumn {
  index: number;
  header: string;
  /** Block number `N` from `N. …`. */
  n: number;
  /** Type name before the dash or comma: "Figma", "Choice", "Card sort", … */
  kind: string;
  /** Text between `<Type>, ` and ` – `: "response time (ms)", "other answers", a card, a row. */
  qualifier?: string;
  /** Text after ` – `: the question, possibly followed by `: <option>`. */
  rest?: string;
}

const BLOCK_HEADER = /^(\d+)\. (.+)$/;
/** Types whose "qualifier" is a card or a row and which carry no question text. */
const KEYED_KINDS = ['Card sort', 'Matrix'];

/** Parse one block header; `undefined` for a header that is not a block column. */
export function parsePathwayHeader(header: string, index = 0): PathwayColumn | undefined {
  const m = BLOCK_HEADER.exec(header.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const remainder = m[2];
  for (const kind of KEYED_KINDS) {
    if (remainder.startsWith(`${kind}, `)) {
      return { index, header, n, kind, qualifier: remainder.slice(kind.length + 2) };
    }
  }
  if (/^Agreement\b/.test(remainder)) return { index, header, n, kind: 'Agreement' };
  // `<Type>[, qualifier] – <rest>`; the export uses an en dash, one legacy type a hyphen.
  const dash = remainder.includes(' – ') ? remainder.indexOf(' – ') : remainder.indexOf(' - ');
  if (dash < 0) return { index, header, n, kind: remainder };
  const typePart = remainder.slice(0, dash);
  const rest = remainder.slice(dash + 3);
  const comma = typePart.indexOf(', ');
  if (comma < 0) return { index, header, n, kind: typePart, rest };
  return {
    index,
    header,
    n,
    kind: typePart.slice(0, comma),
    qualifier: typePart.slice(comma + 2),
    rest,
  };
}

/**
 * Common question text of several `<question>: <option>` headers. The longest common prefix
 * is cut at its last `: ` so that options sharing a prefix ("Meal plans", "Meal reminders") do
 * not leak into the question.
 */
export function splitQuestionAndOptions(rests: string[]): { question: string; options: string[] } {
  if (rests.length === 1) {
    const i = rests[0].lastIndexOf(': ');
    return i < 0
      ? { question: rests[0], options: [] }
      : { question: rests[0].slice(0, i), options: [rests[0].slice(i + 2)] };
  }
  let prefix = rests[0];
  for (const r of rests.slice(1)) {
    let k = 0;
    while (k < prefix.length && k < r.length && prefix[k] === r[k]) k++;
    prefix = prefix.slice(0, k);
  }
  const cut = prefix.lastIndexOf(': ');
  if (cut < 0)
    return { question: prefix.trim(), options: rests.map((r) => r.slice(prefix.length)) };
  const question = prefix.slice(0, cut);
  return { question, options: rests.map((r) => r.slice(cut + 2)) };
}

// ----------------------------------------------------------------------------
// Answer parsing
// ----------------------------------------------------------------------------

const TURN = /(AI|User): ([\s\S]*?);\s*(?=(?:AI|User): |$)/g;

/**
 * `AI: …;` / `User: …;` transcript → turns. Plain text (no leading role marker) → one `user`
 * turn. An empty string → one empty user turn (the caller decides whether to emit the block).
 */
export function parseChatTranscript(text: string): OpenTurn[] {
  const t = text.trim();
  if (!/^(AI|User): /.test(t)) return [{ role: 'user', text: t }];
  const turns: OpenTurn[] = [];
  let consumed = 0;
  for (const m of t.matchAll(TURN)) {
    turns.push({ role: m[1] === 'AI' ? 'assistant' : 'user', text: m[2].trim() });
    consumed = (m.index ?? 0) + m[0].length;
  }
  if (turns.length === 0) return [{ role: 'user', text: t }];
  const tail = t.slice(consumed).trim();
  if (tail) {
    // A last turn without the closing `;`.
    const r = /^(AI|User): ([\s\S]*)$/.exec(tail);
    if (r) turns.push({ role: r[1] === 'AI' ? 'assistant' : 'user', text: r[2].trim() });
    else turns.push({ role: 'user', text: tail });
  }
  return turns;
}

function msToSec(cell: string | undefined): number {
  if (!cell || cell.trim() === '') return 0;
  const n = Number(cell.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n / 1000 : 0;
}

function splitSemicolon(cell: string): string[] {
  return cell
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function isTrue(cell: string | undefined): boolean {
  return (cell ?? '').trim().toUpperCase() === 'TRUE';
}

function isBoolCell(cell: string | undefined): boolean {
  const v = (cell ?? '').trim().toUpperCase();
  return v === 'TRUE' || v === 'FALSE';
}

/**
 * `Other` with a free text → one entry `Other: <text>` instead of the bare label, so that the
 * selection count stays what the respondent did.
 */
function withOtherText(labels: string[], otherText: string): string[] {
  const text = otherText.trim();
  if (!text) return labels;
  const i = labels.findIndex((l) => l.toLowerCase() === 'other');
  const entry = `Other: ${text}`;
  if (i < 0) return [...labels, entry];
  return labels.map((l, k) => (k === i ? entry : l));
}

// ----------------------------------------------------------------------------
// Block specs — one per `N`
// ----------------------------------------------------------------------------

interface BlockSpec {
  n: number;
  blockId: string;
  kind: string;
  columns: PathwayColumn[];
  /** Contract block type this spec produces, for the inventory. */
  type: Block['type'];
  question: string;
  options?: string[];
  /** Multi choice only: the option label of every main column, `Other (text)` included. */
  columnLabels?: string[];
  sourceType?: string;
  /** Headers with the same `N` that are deliberately not read (AI tag columns). */
  ignored: string[];
}

function lower(kind: string): string {
  return kind.trim().toLowerCase();
}

function buildSpec(n: number, columns: PathwayColumn[]): BlockSpec {
  const kind = columns[0].kind;
  const blockId = `pw-${n}`;
  const base = { n, blockId, kind, columns, ignored: [] as string[] };
  const rests = columns.map((c) => c.rest ?? '');
  switch (kind) {
    case 'Figma':
      return { ...base, type: 'prototype', question: rests.find(Boolean) ?? `Figma ${n}` };
    case 'Live website':
      return { ...base, type: 'website', question: rests.find(Boolean) ?? `Live website ${n}` };
    case 'Click':
      return {
        ...base,
        type: 'other',
        sourceType: 'firstclick',
        question: rests.find(Boolean) ?? `Click ${n}`,
      };
    case 'Choice': {
      const main = columns.filter((c) => c.qualifier === undefined);
      if (main.length <= 1) {
        return { ...base, type: 'choice', question: main[0]?.rest ?? rests[0] };
      }
      const { question, options } = splitQuestionAndOptions(main.map((c) => c.rest ?? ''));
      return {
        ...base,
        type: 'choice',
        question,
        options: options.filter((o) => o !== 'Other (text)'),
        columnLabels: options,
      };
    }
    case 'Card sort':
      return { ...base, type: 'cardsort', question: `Card sort ${n}` };
    case 'Matrix':
      return { ...base, type: 'matrix', question: `Matrix ${n}` };
    case 'Scale':
    case 'NPS':
      return { ...base, type: 'scale', question: rests[0] };
    case 'Open question':
    case 'Question':
      return { ...base, type: 'open', question: rests[0] };
    case 'AI': {
      // The shortest header is the question; longer siblings are tag columns.
      const sorted = [...columns].sort((a, b) => (a.rest ?? '').length - (b.rest ?? '').length);
      return {
        ...base,
        columns: [sorted[0]],
        ignored: sorted.slice(1).map((c) => c.header),
        type: 'open',
        question: sorted[0].rest ?? `AI ${n}`,
      };
    }
    case 'Ranking': {
      const { question, options } = splitQuestionAndOptions(rests);
      return { ...base, type: 'other', sourceType: 'ranking', question, options };
    }
    default: {
      // Tree testing, Kano model, MaxDiff, Preference and anything new: keep the raw cells.
      const { question, options } = splitQuestionAndOptions(rests);
      return {
        ...base,
        type: 'other',
        sourceType: lower(kind),
        question: question || `${kind} ${n}`,
        options: options.length > 0 ? options : undefined,
      };
    }
  }
}

/** Build the block for one respondent; `undefined` when the respondent never reached it. */
function blockFor(spec: BlockSpec, row: string[]): Block | undefined {
  const cell = (c: PathwayColumn) => row[c.index] ?? '';
  const base = { blockId: spec.blockId, question: spec.question, duration: 0 };
  const byQualifier = (q: string) => spec.columns.find((c) => c.qualifier === q);
  const allEmpty = spec.columns.every((c) => cell(c).trim() === '');

  switch (spec.type) {
    case 'prototype': {
      if (allEmpty) return undefined;
      const time = byQualifier('response time (ms)');
      const status = (byQualifier('status') ? cell(byQualifier('status')!) : '').trim();
      return {
        ...base,
        type: 'prototype',
        duration: time ? msToSec(cell(time)) : 0,
        status: status === 'Gave up' ? 'gave_up' : status === 'Succeeded' ? 'completed' : 'partial',
        clickCount: 0,
      };
    }
    case 'website': {
      if (allEmpty) return undefined;
      const time = byQualifier('response time (ms)');
      const result = byQualifier('result');
      return {
        ...base,
        type: 'website',
        duration: time ? msToSec(cell(time)) : 0,
        gaveUp: result ? cell(result).trim() === 'Gave up' : false,
      };
    }
    case 'choice': {
      const main = spec.columns.filter((c) => c.qualifier === undefined);
      const otherCol = byQualifier('other answers');
      const otherText = otherCol ? cell(otherCol) : '';
      if (spec.options === undefined) {
        // Single choice: one cell with `;`-separated labels.
        const raw = main[0] ? cell(main[0]) : '';
        if (raw.trim() === '' && otherText.trim() === '') return undefined;
        return { ...base, type: 'choice', answer: withOtherText(splitSemicolon(raw), otherText) };
      }
      // Multi choice: one TRUE/FALSE cell per option.
      const options = spec.columnLabels ?? [];
      let textCell = otherText;
      const selected: string[] = [];
      let touched = false;
      main.forEach((c, i) => {
        const label = options[i];
        const v = cell(c);
        if (label === 'Other (text)') {
          if (v.trim()) textCell = v;
          return;
        }
        if (isBoolCell(v)) touched = true;
        if (isTrue(v)) selected.push(label);
      });
      if (!touched) return undefined;
      return {
        ...base,
        type: 'choice',
        answer: withOtherText(selected, textCell),
        options: spec.options,
      };
    }
    case 'cardsort': {
      if (allEmpty) return undefined;
      const answer: Record<string, string[]> = {};
      for (const c of spec.columns) {
        const category = cell(c).trim();
        if (!category || c.qualifier === undefined) continue;
        answer[category] ??= [];
        answer[category].push(c.qualifier);
      }
      return { ...base, type: 'cardsort', answer };
    }
    case 'matrix': {
      if (allEmpty) return undefined;
      const answer: Record<string, string[]> = {};
      for (const c of spec.columns) {
        const v = cell(c);
        if (v.trim() === '' || c.qualifier === undefined) continue;
        answer[c.qualifier] = splitSemicolon(v);
      }
      return { ...base, type: 'matrix', answer };
    }
    case 'scale': {
      const v = cell(spec.columns[0]).trim();
      if (v === '') return undefined;
      return { ...base, type: 'scale', answer: v };
    }
    case 'open': {
      const v = cell(spec.columns[0]);
      if (v.trim() === '') return undefined;
      return { ...base, type: 'open', answer: parseChatTranscript(v) };
    }
    case 'other': {
      if (allEmpty) return undefined;
      if (spec.sourceType === 'firstclick') {
        const time = byQualifier('response time (ms)') ?? spec.columns[0];
        return { ...base, type: 'other', sourceType: 'firstclick', duration: msToSec(cell(time)) };
      }
      if (spec.options && spec.options.length > 0) {
        const raw: Record<string, string | number> = {};
        spec.columns.forEach((c, i) => {
          const v = cell(c).trim();
          if (v === '') return;
          const key = spec.options?.[i] ?? c.rest ?? c.header;
          const num = Number(v);
          raw[key] = spec.sourceType === 'ranking' && Number.isFinite(num) ? num : v;
        });
        return { ...base, type: 'other', sourceType: spec.sourceType, rawAnswer: raw };
      }
      return {
        ...base,
        type: 'other',
        sourceType: spec.sourceType,
        rawAnswer: cell(spec.columns[0]).trim(),
      };
    }
    default:
      return undefined;
  }
}

// ----------------------------------------------------------------------------
// Converter
// ----------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Convert a Pathway report CSV into a validated dataset plus a report. */
export function convertPathwayReport(
  csvText: string,
  opts: PathwayConvertOptions = {},
): ConvertResult {
  const { header, rows } = parseCsv(csvText);
  if (header.length === 0) throw new ConvertError('CSV is empty: no header row');
  if (!isPathwayReport(header)) {
    throw new ConvertError(
      `not a Pathway report export: expected columns "${ANSWER_ID}" and "${COMPLETION_TIME}" in the header`,
    );
  }
  const col = new Map<string, number>();
  header.forEach((h, i) => {
    if (!col.has(h)) col.set(h, i);
  });
  const idIdx = col.get(ANSWER_ID)!;
  const deviceIdx = col.get('Device');
  const firstFixed = deviceIdx ?? col.get(COMPLETION_TIME)!;
  const urlTags = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i < firstFixed && h !== ANSWER_ID && h.trim() !== '');
  const panelTagNames = new Set(['token', 'age', 'sex']);
  const droppedTags = urlTags.filter((t) => !panelTagNames.has(t.h.toLowerCase())).map((t) => t.h);
  const fixedNames = new Set<string>([ANSWER_ID, ...FIXED_AFTER_TAGS]);

  // Block columns, grouped by N in column order.
  const specsByN = new Map<number, PathwayColumn[]>();
  const unrecognised: string[] = [];
  header.forEach((h, i) => {
    if (i < firstFixed || fixedNames.has(h)) return;
    const c = parsePathwayHeader(h, i);
    if (!c) {
      if (h.trim() !== '') unrecognised.push(h);
      return;
    }
    if (c.kind === 'Agreement') return;
    (specsByN.get(c.n) ?? specsByN.set(c.n, []).get(c.n)!).push(c);
  });
  const specs = [...specsByN.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([n, cs]) => buildSpec(n, cs));

  const warnings: string[] = [];
  const skipped = new Map<
    string,
    { reason: string; count: number; examples: { line: number; detail: string }[] }
  >();
  const skip = (line: number, reason: string, detail: string) => {
    const e = skipped.get(reason) ?? { reason, count: 0, examples: [] };
    e.count++;
    if (e.examples.length < MAX_EXAMPLES) e.examples.push({ line, detail });
    skipped.set(reason, e);
  };

  const survey: Survey = { id: opts.surveyId?.trim() || 'pathway', responses: [] };
  const blocksByType: Record<string, number> = {};
  const sources = new Set<string>();
  const completionTimes: number[] = [];
  let timedBlocks = 0;
  let rowsConverted = 0;
  let rowsSkipped = 0;

  rows.forEach((row, i) => {
    const line = i + 2;
    if (row.length > header.length) {
      rowsSkipped++;
      skip(
        line,
        'more cells than header columns',
        `${row.length} cells, header has ${header.length}`,
      );
      return;
    }
    const get = (name: string) => {
      const k = col.get(name);
      return k === undefined ? '' : (row[k] ?? '');
    };
    const id = (row[idIdx] ?? '').trim();
    if (id === '') {
      rowsSkipped++;
      skip(line, 'empty response id', `column "${ANSWER_ID}" is empty`);
      return;
    }
    const status = get('Status').trim();
    if (status.toLowerCase() !== 'completed') {
      rowsSkipped++;
      skip(line, `status "${status || '(empty)'}" is not completed`, `answer ${id}`);
      return;
    }

    const r: Response = { id, blocks: [] };
    const device = get('Device').trim();
    if (device) r.device = device;
    const panel: PanelMeta = {};
    for (const t of urlTags) {
      const v = (row[t.i] ?? '').trim();
      if (!v) continue;
      const key = t.h.toLowerCase();
      if (key === 'token') panel.token = v;
      else if (key === 'age') panel.age = v;
      else if (key === 'sex') panel.sex = v;
    }
    if (Object.keys(panel).length > 0) r.panel = panel;
    const source = get('Source').trim();
    if (source) sources.add(source);
    const ct = Number(get(COMPLETION_TIME).trim().replace(',', '.'));
    if (Number.isFinite(ct) && ct > 0) completionTimes.push(ct);

    for (const spec of specs) {
      const block = blockFor(spec, row);
      if (!block) continue;
      r.blocks.push(block);
      blocksByType[block.type] = (blocksByType[block.type] ?? 0) + 1;
      if (block.duration > 0) timedBlocks++;
    }
    survey.responses.push(r);
    rowsConverted++;
  });

  if (sources.size === 1) survey.source = [...sources][0];
  else if (sources.size > 1) {
    warnings.push(
      `"Source" differs between respondents (${[...sources].join(', ')}); survey.source left empty`,
    );
  }
  survey.inventory = specs.map((s): InventoryItem => {
    const item: InventoryItem = { scope: 'body', type: s.type, question: s.question };
    if (s.type === 'choice' && s.options) item.options = s.options;
    return item;
  });

  // Standing limitations of the export, worded once per file.
  const hasDuration = timedBlocks > 0;
  warnings.push(
    'per-question durations are not present in Pathway exports except Figma/Live website/Click; ' +
      'pace is unavailable for the other blocks, whole-survey time is available as Completion time' +
      (completionTimes.length > 0
        ? ` (median ${median(completionTimes)} s over ${completionTimes.length} response(s))`
        : ''),
  );
  if ((blocksByType.prototype ?? 0) > 0) {
    warnings.push(
      'prototype click counts are not present in Pathway exports; prototype-effort uses time and status only',
    );
  }
  if (specs.some((s) => s.sourceType === 'firstclick')) {
    warnings.push(
      'first-click coordinates are not present in Pathway exports; firstclick-offtarget unavailable',
    );
  }
  const ignored = specs.flatMap((s) => s.ignored);
  if (ignored.length > 0) {
    warnings.push(
      `ignored ${ignored.length} AI tag column(s): ${ignored.map((h) => `"${h}"`).join(', ')}`,
    );
  }
  if (droppedTags.length > 0) {
    warnings.push(
      `URL-tag column(s) ${droppedTags.map((h) => `"${h}"`).join(', ')} have no place in the contract and were dropped`,
    );
  }
  if (unrecognised.length > 0) {
    warnings.push(
      `unrecognised column(s) ignored: ${unrecognised.map((h) => `"${h}"`).join(', ')}`,
    );
  }
  const unknownKinds = [
    ...new Set(
      specs
        .filter(
          (s) => s.type === 'other' && s.sourceType !== 'firstclick' && s.sourceType !== 'ranking',
        )
        .map((s) => s.kind),
    ),
  ];
  if (unknownKinds.length > 0) {
    warnings.push(`block type(s) kept as "other": ${unknownKinds.join(', ')}`);
  }

  const dataset: Dataset = parseDataset([survey]);
  const blocks = Object.values(blocksByType).reduce((a, b) => a + b, 0);
  const report: ConvertReport = {
    rowsRead: rows.length,
    rowsConverted,
    rowsSkipped,
    skipped: [...skipped.values()].sort((a, b) => b.count - a.count),
    surveys: 1,
    responses: survey.responses.length,
    blocks,
    blocksByType,
    screeningAnswers: 0,
    hasDuration,
    warnings,
    ...detectorAvailability({ blocksByType, hasDuration, screeningAnswers: 0 }),
  };
  return { dataset, report };
}
