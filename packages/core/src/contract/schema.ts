/**
 * Runtime validator for the input contract (`types.ts`).
 *
 * Fails fast with a path (`[2].responses[7].blocks[3].type`) instead of blowing up inside a
 * detector. `duration` defaults to 0 so that exports without timing still parse; the output
 * type stays `number`.
 *
 * The assertions at the bottom make `tsc` fail if this schema and the hand-written types
 * drift apart (a block type added to one but not the other).
 */
import { z } from 'zod';
import type { Block, BlockType, Dataset, Response, Survey } from './types.js';

const base = {
  blockId: z.string().optional(),
  question: z.string(),
  duration: z.number().nonnegative().default(0),
};

const openTurn = z.object({ role: z.enum(['assistant', 'user']), text: z.string() });

export const blockSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('choice'),
    answer: z.array(z.string()),
    options: z.array(z.string()).optional(),
  }),
  z.object({ ...base, type: z.literal('scale'), answer: z.string() }),
  z.object({ ...base, type: z.literal('matrix'), answer: z.record(z.array(z.string())) }),
  z.object({ ...base, type: z.literal('cardsort'), answer: z.record(z.array(z.string())) }),
  z.object({ ...base, type: z.literal('open'), answer: z.array(openTurn) }),
  z.object({
    ...base,
    type: z.literal('firstclick'),
    answer: z.object({ top: z.number(), left: z.number() }),
  }),
  z.object({
    ...base,
    type: z.literal('prototype'),
    status: z.enum(['gave_up', 'completed', 'partial']),
    clickCount: z.number().int().nonnegative(),
  }),
  z.object({ ...base, type: z.literal('website'), gaveUp: z.boolean() }),
  z.object({
    ...base,
    type: z.literal('other'),
    sourceType: z.string().optional(),
    rawAnswer: z.unknown().optional(),
  }),
]);

export const responseSchema = z.object({
  id: z.string().min(1),
  device: z.string().optional(),
  blocks: z.array(blockSchema),
  fingerprint: z.string().optional(),
  screening: z.array(z.object({ question: z.string(), answer: z.array(z.string()) })).optional(),
  panel: z
    .object({
      token: z.string().optional(),
      age: z.string().optional(),
      sex: z.string().optional(),
    })
    .optional(),
  label: z.enum(['good', 'bad_targeting', 'bad_content', 'bad_coherence']).nullable().optional(),
  labelSource: z.enum(['auto', 'human']).nullable().optional(),
});

export const surveySchema = z.object({
  id: z.string().min(1),
  source: z.string().optional(),
  target: z.string().optional(),
  inventory: z
    .array(
      z.object({
        scope: z.enum(['screening', 'body']),
        type: z.string(),
        question: z.string(),
        options: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  responses: z.array(responseSchema),
});

export const datasetSchema = z.array(surveySchema);

/** Parse and validate a dataset; throws a ZodError with a precise path on failure. */
export function parseDataset(input: unknown): Dataset {
  return datasetSchema.parse(input) as Dataset;
}

// ----------------------------------------------------------------------------
// Drift guard — compile-time only
// ----------------------------------------------------------------------------

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;

type SchemaBlockType = z.output<typeof blockSchema>['type'];
export type _BlockTypesInSync = Assert<Equals<SchemaBlockType, BlockType>>;

// Structural compatibility in both directions for the top-level shapes.
export type _SurveyAssignable = Assert<z.output<typeof surveySchema> extends Survey ? true : false>;
export type _ResponseAssignable = Assert<
  z.output<typeof responseSchema> extends Response ? true : false
>;
export type _BlockAssignable = Assert<z.output<typeof blockSchema> extends Block ? true : false>;
