/**
 * Turn one CSV cell into a contract block of the requested type.
 *
 * Every parser is deterministic and throws `AnswerParseError` with a short reason when the cell
 * cannot be read as the requested type; the converter turns that into a skipped row.
 */
import type { Block } from '../contract/types.js';
import type { MappingTypeName } from './mapping.js';

export class AnswerParseError extends Error {}

export interface CellContext {
  question: string;
  blockId?: string;
  duration: number;
  /** Separator between selected options in a choice cell. Undefined → auto (";" then "|"). */
  separator?: string;
  /** Original type name from the source, kept on `other` blocks. */
  sourceType?: string;
}

/** Split a multi-value cell into trimmed, non-empty items. */
export function splitChoices(cell: string, separator?: string): string[] {
  const trimmed = cell.trim();
  if (trimmed === '') return [];
  if (trimmed.startsWith('[')) {
    const parsed = tryJson(trimmed);
    if (Array.isArray(parsed)) return parsed.map((v) => String(v).trim()).filter(Boolean);
  }
  const sep = separator ?? (trimmed.includes(';') ? ';' : '|');
  return trimmed
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Grid answer: compact JSON `{"row":["col"]}` / `{"row":"col"}` or `row=col;row=col1|col2`.
 * Row and column labels are trimmed. An empty cell is an empty grid.
 */
export function parseGrid(cell: string): Record<string, string[]> {
  const trimmed = cell.trim();
  const out: Record<string, string[]> = {};
  if (trimmed === '') return out;
  if (trimmed.startsWith('{')) {
    const parsed = tryJson(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AnswerParseError('grid cell starts with "{" but is not a JSON object');
    }
    for (const [row, value] of Object.entries(parsed as Record<string, unknown>)) {
      out[row.trim()] = Array.isArray(value)
        ? value.map((v) => String(v).trim()).filter(Boolean)
        : value === null || value === undefined
          ? []
          : [String(value).trim()];
    }
    return out;
  }
  for (const pair of trimmed.split(';')) {
    const p = pair.trim();
    if (p === '') continue;
    const eq = p.indexOf('=');
    if (eq < 0) throw new AnswerParseError(`grid pair "${p}" has no "="; expected row=value`);
    const row = p.slice(0, eq).trim();
    if (row === '') throw new AnswerParseError(`grid pair "${p}" has an empty row label`);
    out[row] = p
      .slice(eq + 1)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return out;
}

/** `top,left` as numbers in 0–1 (percent values 1–100 are divided by 100) or JSON `{top,left}`. */
export function parseFirstClick(cell: string): { top: number; left: number } {
  const trimmed = cell.trim();
  let top: number;
  let left: number;
  if (trimmed.startsWith('{')) {
    const parsed = tryJson(trimmed) as { top?: unknown; left?: unknown } | undefined;
    if (!parsed) throw new AnswerParseError('firstclick cell is not valid JSON');
    top = Number(parsed.top);
    left = Number(parsed.left);
  } else {
    const parts = trimmed.split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) {
      throw new AnswerParseError(`firstclick cell "${trimmed}" is not "top,left"`);
    }
    top = Number(parts[0]);
    left = Number(parts[1]);
  }
  if (!Number.isFinite(top) || !Number.isFinite(left)) {
    throw new AnswerParseError(`firstclick coordinates "${trimmed}" are not numbers`);
  }
  if ((top > 1 || left > 1) && top <= 100 && left <= 100) {
    top /= 100;
    left /= 100;
  }
  if (top < 0 || left < 0 || top > 1 || left > 1) {
    throw new AnswerParseError(`firstclick coordinates "${trimmed}" are outside 0–1`);
  }
  return { top, left };
}

const PROTOTYPE_STATUS: Record<string, 'gave_up' | 'completed' | 'partial'> = {
  gave_up: 'gave_up',
  gaveup: 'gave_up',
  give_up: 'gave_up',
  abandoned: 'gave_up',
  completed: 'completed',
  complete: 'completed',
  success: 'completed',
  partial: 'partial',
  incomplete: 'partial',
};

/** `status;clicks` (clicks optional) or JSON `{status, clickCount}`. */
export function parsePrototype(cell: string): {
  status: 'gave_up' | 'completed' | 'partial';
  clickCount: number;
} {
  const trimmed = cell.trim();
  let rawStatus: string;
  let rawClicks: unknown = 0;
  if (trimmed.startsWith('{')) {
    const parsed = tryJson(trimmed) as
      | { status?: unknown; clickCount?: unknown; clicks?: unknown }
      | undefined;
    if (!parsed) throw new AnswerParseError('prototype cell is not valid JSON');
    rawStatus = String(parsed.status ?? '');
    rawClicks = parsed.clickCount ?? parsed.clicks ?? 0;
  } else {
    const parts = trimmed.split(/[;,]/).map((s) => s.trim());
    rawStatus = parts[0] ?? '';
    rawClicks = parts[1] ?? 0;
  }
  const status = PROTOTYPE_STATUS[rawStatus.toLowerCase().replace(/[\s-]+/g, '_')];
  if (!status) {
    throw new AnswerParseError(
      `prototype status "${rawStatus}" is not one of gave_up, completed, partial`,
    );
  }
  const clickCount = rawClicks === '' ? 0 : Number(rawClicks);
  if (!Number.isInteger(clickCount) || clickCount < 0) {
    throw new AnswerParseError(
      `prototype click count "${String(rawClicks)}" is not a whole number`,
    );
  }
  return { status, clickCount };
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 'gave_up', 'gaveup', 'gave up', 'abandoned']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'completed', 'complete', 'success', '']);

/** Website task: the cell says whether the respondent gave up. */
export function parseGaveUp(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  throw new AnswerParseError(`website cell "${cell}" is not a true/false value`);
}

/** Build a contract block from a cell. */
export function cellToBlock(type: MappingTypeName, cell: string, ctx: CellContext): Block {
  const base = {
    ...(ctx.blockId ? { blockId: ctx.blockId } : {}),
    question: ctx.question,
    duration: ctx.duration,
  };
  switch (type) {
    case 'open':
      return { ...base, type: 'open', answer: [{ role: 'user', text: cell.trim() }] };
    case 'choice':
    case 'multi':
      return { ...base, type: 'choice', answer: splitChoices(cell, ctx.separator) };
    case 'scale':
      return { ...base, type: 'scale', answer: cell.trim() };
    case 'matrix':
      return { ...base, type: 'matrix', answer: parseGrid(cell) };
    case 'cardsort':
      return { ...base, type: 'cardsort', answer: parseGrid(cell) };
    case 'firstclick':
      return { ...base, type: 'firstclick', answer: parseFirstClick(cell) };
    case 'prototype':
      return { ...base, type: 'prototype', ...parsePrototype(cell) };
    case 'website':
      return { ...base, type: 'website', gaveUp: parseGaveUp(cell) };
    default:
      return {
        ...base,
        type: 'other',
        ...(ctx.sourceType ? { sourceType: ctx.sourceType } : {}),
        rawAnswer: cell,
      };
  }
}

/** Screening answers are always a list of strings, whatever the question type. */
export function cellToScreeningAnswer(
  type: MappingTypeName,
  cell: string,
  separator?: string,
): string[] {
  if (type === 'choice' || type === 'multi') return splitChoices(cell, separator);
  const t = cell.trim();
  return t === '' ? [] : [t];
}
