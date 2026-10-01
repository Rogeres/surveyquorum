/**
 * Mapping — how one CSV export maps onto the input contract (`contract/types.ts`).
 *
 * A mapping is plain JSON that a human or an LLM writes after looking at the CSV header. Two
 * layouts are supported:
 *
 * - `long`  — one row per (respondent, question). The classic export of panel and survey tools.
 * - `wide`  — one row per respondent, one column per question. Spreadsheet-style exports.
 *
 * Wherever a field says "column", the value is the exact column name from the CSV header.
 * Where a constant is allowed, write `{ "const": "..." }` instead.
 *
 * `adapters/README.md` at the repository root is the human/LLM-facing explanation of this file.
 */
import { z } from 'zod';

/** Exact column name from the header. */
export const columnRef = z.string().min(1);

/** A fixed value used for every row. */
export const constRef = z.object({ const: z.string().min(1) });

/**
 * Question type names accepted in a mapping. `multi` is a convenience alias: the contract has a
 * single `choice` type for single- and multiple-choice questions.
 */
export const mappingTypeName = z.enum([
  'open',
  'choice',
  'multi',
  'scale',
  'matrix',
  'cardsort',
  'firstclick',
  'prototype',
  'website',
  'other',
]);
export type MappingTypeName = z.infer<typeof mappingTypeName>;

/**
 * Where the question type comes from in a long layout:
 * - a column name (the cell holds a type name, matched case-insensitively);
 * - `{ const }` — every row has the same type;
 * - `{ byQuestion, default }` — look the type up by block id first, then by question text.
 */
export const questionTypeRule = z.union([
  columnRef,
  z.object({ const: mappingTypeName }),
  z.object({
    byQuestion: z.record(mappingTypeName),
    default: mappingTypeName.default('other'),
  }),
]);

/**
 * Which rows are screening questions (declared profile). Matching rows go to
 * `response.screening` instead of `response.blocks`.
 */
export const screeningRule = z.object({
  /** Block ids that are screening questions. */
  blockIds: z.array(z.string().min(1)).optional(),
  /** Exact question texts that are screening questions. */
  questions: z.array(z.string().min(1)).optional(),
  /** Question-text prefixes, e.g. "S1." or "[Screener]". */
  questionPrefixes: z.array(z.string().min(1)).optional(),
});

const sharedFields = {
  /** Free-form name of the mapping (file name of the preset by convention). */
  name: z.string().optional(),
  description: z.string().optional(),
  /** CSV field delimiter. Default ",". Use ";" for many European exports, "\t" for TSV. */
  delimiter: z.string().length(1).default(','),
  /**
   * Separator between selected options in a choice/multi cell. Default: ";" when the cell
   * contains one, otherwise "|".
   */
  separator: z.string().min(1).optional(),
  /** Column with the respondent's device family ("desktop", "mobile", …). */
  device: columnRef.optional(),
  /** Column with a cross-survey respondent key (device fingerprint, panel id). */
  fingerprint: columnRef.optional(),
  /** Column with the respondent's token in the panel's system (used in complaints). */
  panelToken: columnRef.optional(),
  /** Recruiting target as a constant: who was supposed to answer. */
  target: constRef.optional(),
  /** Where respondents came from, as a constant: a panel name, "link", "upload". */
  source: constRef.optional(),
};

export const longMappingSchema = z.object({
  layout: z.literal('long'),
  ...sharedFields,
  /** Survey id column, or a constant. Default: constant "survey". */
  surveyId: z.union([columnRef, constRef]).default({ const: 'survey' }),
  responseId: columnRef,
  /** Stable per-question id. Optional: flat exports often have none. */
  blockId: columnRef.optional(),
  question: columnRef,
  /** Default: every row is an open-text answer (see adapters/README.md before relying on it). */
  questionType: questionTypeRule.default({ const: 'open' }),
  answer: columnRef,
  /** Seconds spent on the block. */
  durationSec: columnRef.optional(),
  /** Milliseconds spent on the block (alternative to `durationSec`). */
  durationMs: columnRef.optional(),
  screening: screeningRule.optional(),
});

export const wideQuestionSchema = z.object({
  /** Column holding the answer. */
  column: columnRef,
  /** Question text shown to the respondent. Default: the column name. */
  question: z.string().min(1).optional(),
  type: mappingTypeName,
  blockId: z.string().min(1).optional(),
  /** Column with seconds spent on this question. */
  durationColumn: columnRef.optional(),
  /** Column with milliseconds spent on this question (alternative to `durationColumn`). */
  durationMsColumn: columnRef.optional(),
  /** True when this is a screening question (goes to `response.screening`). */
  screening: z.boolean().default(false),
});

export const wideMappingSchema = z.object({
  layout: z.literal('wide'),
  ...sharedFields,
  /** Survey id as a constant. Default "survey". */
  surveyId: constRef.default({ const: 'survey' }),
  responseId: columnRef,
  questions: z.array(wideQuestionSchema).min(1),
});

export const mappingSchema = z.discriminatedUnion('layout', [longMappingSchema, wideMappingSchema]);

/** Parsed mapping with defaults applied. */
export type Mapping = z.output<typeof mappingSchema>;
export type LongMapping = z.output<typeof longMappingSchema>;
export type WideMapping = z.output<typeof wideMappingSchema>;
export type WideQuestion = z.output<typeof wideQuestionSchema>;
/** Mapping as written in a JSON file, before defaults. */
export type MappingInput = z.input<typeof mappingSchema>;

/** Parse and validate a mapping; throws a ZodError with a precise path on failure. */
export function parseMapping(input: unknown): Mapping {
  return mappingSchema.parse(input);
}
