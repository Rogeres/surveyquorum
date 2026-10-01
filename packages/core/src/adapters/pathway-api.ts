/**
 * Pathway public API → contract. The richer sibling of `pathway-report.ts` (the CSV export):
 * the API carries per-question durations, first-click coordinates, prototype click counts,
 * option lists and matrix / card-sort labels, none of which the CSV has.
 *
 * Three pure pieces plus one composition:
 *   - `fetchPathwayTest`       — GET /api/public/v1/tests/:id          (the questionnaire)
 *   - `fetchPathwayResponses`  — GET /api/public/v1/tests/:id/responses (paginated answers)
 *   - `convertPathwayApi`      — test + answers → `Dataset` + `ConvertReport` (no I/O)
 *   - `importPathway`          — the three above, in order
 *
 * Network goes through the global `fetch` (or the one injected via options, for tests). The
 * API allows 100 requests per minute: a small limiter spaces requests and 429 / 5xx answers
 * are retried with backoff. The base URL is never hardcoded here — it comes from the caller.
 *
 * What the API does not expose, and therefore what the contract gets as "unknown":
 *   - screening questions and the respondent's answers to them (`response.screening` stays
 *     empty, the screening-vs-body half of coherence is unavailable);
 *   - the recruiting target (`survey.target` stays empty).
 */
import { z } from 'zod';
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
import { type ConvertReport, type ConvertResult, detectorAvailability } from './csv.js';

// ----------------------------------------------------------------------------
// API shapes — validated loosely (`passthrough`) so that new fields never break the import
// ----------------------------------------------------------------------------

const optionSchema = z
  .object({ id: z.coerce.string(), value: z.string().nullable().optional() })
  .passthrough();
/** Matrix rows / columns come either as `{id, value}` objects or as bare strings. */
const labelListSchema = z.array(z.union([optionSchema, z.string()]));

export const pathwayBlockSchema = z
  .object({
    id: z.coerce.string(),
    type: z.string(),
    text: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    options: z.array(optionSchema).nullable().optional(),
    rows: labelListSchema.nullable().optional(),
    columns: labelListSchema.nullable().optional(),
    replyType: z.string().nullable().optional(),
    other: z.boolean().nullable().optional(),
    noneOfTheAbove: z.boolean().nullable().optional(),
    noneOfTheAboveOptionText: z.string().nullable().optional(),
    from: z.union([z.number(), z.string()]).nullable().optional(),
    to: z.union([z.number(), z.string()]).nullable().optional(),
  })
  .passthrough();

export const pathwayTestSchema = z
  .object({
    id: z.coerce.string(),
    name: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    createdAt: z.string().nullable().optional(),
    blocks: z.array(pathwayBlockSchema),
  })
  .passthrough();

export const pathwayAnswerBlockSchema = z
  .object({
    id: z.coerce.string(),
    type: z.string(),
    data: z.unknown(),
    startedAt: z.string().nullable().optional(),
    completedAt: z.string().nullable().optional(),
    duration: z.number().nullable().optional(),
  })
  .passthrough();

export const pathwayAnswerSchema = z
  .object({
    id: z.coerce.string(),
    createdAt: z.string(),
    blocks: z.array(pathwayAnswerBlockSchema),
    userAgent: z.string().nullable().optional(),
    urlParams: z.record(z.string().nullable()).nullable().optional(),
    referrer: z.string().nullable().optional(),
    source: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
  })
  .passthrough();

export const pathwayResponsesPageSchema = z
  .object({
    answers: z.array(pathwayAnswerSchema),
    totalCount: z.number().nullable().optional(),
    pagination: z
      .object({
        limit: z.number().nullable().optional(),
        hasNextPage: z.boolean(),
        lastCreatedAt: z.string().nullable().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type PathwayBlock = z.infer<typeof pathwayBlockSchema>;
export type PathwayTest = z.infer<typeof pathwayTestSchema>;
export type PathwayAnswerBlock = z.infer<typeof pathwayAnswerBlockSchema>;
export type PathwayAnswer = z.infer<typeof pathwayAnswerSchema>;
export type PathwayResponsesPage = z.infer<typeof pathwayResponsesPageSchema>;

// ----------------------------------------------------------------------------
// HTTP client: auth, rate limit, retries
// ----------------------------------------------------------------------------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response_>;
/** The slice of the WHATWG `Response` the client uses; lets tests return plain objects. */
export interface Response_ {
  ok: boolean;
  status: number;
  headers?: { get(name: string): string | null };
  json(): Promise<unknown>;
  text?(): Promise<string>;
}

export interface PathwayApiOptions {
  /** API origin, e.g. the URL shown in the platform's API settings. Required. */
  baseUrl: string;
  /** Bearer token. Required. */
  token: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Minimum spacing between requests. Default 600 ms = 100 requests per minute. */
  minIntervalMs?: number;
  /** Retries for 429 / 5xx / network errors. Default 4. */
  maxRetries?: number;
  /** Page size for `/responses`. Default 100 (the API maximum). */
  pageSize?: number;
  /** Stop after this many pages (debugging aid). Default unlimited. */
  maxPages?: number;
  /** Progress callback, one call per fetched page. */
  onPage?: (info: PathwayPageInfo) => void;
}

export interface PathwayPageInfo {
  page: number;
  received: number;
  /** Total reported by the API, when it reports one. */
  totalCount: number | null;
  hasNextPage: boolean;
}

export class PathwayApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'PathwayApiError';
  }
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryDelayMs(attempt: number, response?: Response_): number {
  const header = response?.headers?.get('retry-after');
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return Math.min(30_000, 500 * 2 ** attempt);
}

/** Rate-limited, retrying GET client bound to one base URL and token. */
export class PathwayClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minIntervalMs: number;
  private readonly maxRetries: number;
  private readonly baseUrl: string;
  private lastRequestAt = 0;

  constructor(private readonly opts: PathwayApiOptions) {
    if (!opts.baseUrl?.trim()) throw new PathwayApiError('Pathway API base URL is required');
    if (!opts.token?.trim()) throw new PathwayApiError('Pathway API token is required');
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.fetchImpl = opts.fetch ?? ((input, init) => fetch(input, init) as Promise<Response_>);
    this.sleep = opts.sleep ?? defaultSleep;
    this.minIntervalMs = opts.minIntervalMs ?? 600;
    this.maxRetries = opts.maxRetries ?? 4;
  }

  url(path: string, query: Record<string, string | number | undefined> = {}): string {
    const u = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query))
      if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async get(path: string, query?: Record<string, string | number | undefined>): Promise<unknown> {
    const url = this.url(path, query);
    for (let attempt = 0; ; attempt++) {
      await this.throttle();
      let response: Response_ | undefined;
      let failure: unknown;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.opts.token}`, Accept: 'application/json' },
        });
      } catch (err) {
        failure = err;
      }
      if (response?.ok) return response.json();
      const status = response?.status ?? null;
      const retryable = status === null || status === 429 || status >= 500;
      if (retryable && attempt < this.maxRetries) {
        await this.sleep(retryDelayMs(attempt, response));
        continue;
      }
      if (status === 401 || status === 403) {
        throw new PathwayApiError(
          `Pathway API answered ${status} for ${path}: check the token (PATHWAY_API_TOKEN)`,
          status,
        );
      }
      if (status === 404) throw new PathwayApiError(`Pathway API: ${path} not found`, status);
      if (status !== null) {
        throw new PathwayApiError(
          `Pathway API answered ${status} for ${path} after ${attempt + 1} attempt(s)`,
          status,
        );
      }
      throw new PathwayApiError(
        `Pathway API request failed for ${path}: ${failure instanceof Error ? failure.message : String(failure)}`,
      );
    }
  }

  private async throttle(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + this.minIntervalMs - now;
    if (this.lastRequestAt > 0 && wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }
}

const TESTS = '/api/public/v1/tests';

/** The questionnaire: block definitions in survey order. */
export async function fetchPathwayTest(
  testId: string,
  opts: PathwayApiOptions,
  client: PathwayClient = new PathwayClient(opts),
): Promise<PathwayTest> {
  const raw = await client.get(`${TESTS}/${encodeURIComponent(testId)}`);
  const parsed = pathwayTestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new PathwayApiError(
      `Pathway API: unexpected test payload — ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`,
    );
  }
  return parsed.data;
}

/**
 * Pages of answers, oldest first, until the API says there is no next page (or `maxPages`
 * is reached). Yields each page as it arrives so that callers can report progress.
 */
export async function* fetchPathwayResponses(
  testId: string,
  opts: PathwayApiOptions,
  client: PathwayClient = new PathwayClient(opts),
): AsyncGenerator<PathwayResponsesPage, void, undefined> {
  const limit = opts.pageSize ?? 100;
  const maxPages = opts.maxPages ?? Number.POSITIVE_INFINITY;
  let lastCreatedAt: string | undefined;
  for (let page = 1; page <= maxPages; page++) {
    const raw = await client.get(`${TESTS}/${encodeURIComponent(testId)}/responses`, {
      limit,
      lastCreatedAt,
    });
    const parsed = pathwayResponsesPageSchema.safeParse(raw);
    if (!parsed.success) {
      throw new PathwayApiError(
        `Pathway API: unexpected responses payload on page ${page} — ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`,
      );
    }
    const data = parsed.data;
    opts.onPage?.({
      page,
      received: data.answers.length,
      totalCount: data.totalCount ?? null,
      hasNextPage: data.pagination.hasNextPage,
    });
    yield data;
    const next = data.pagination.lastCreatedAt ?? data.answers.at(-1)?.createdAt;
    // Stop on the API's word, on an empty page, or when the cursor would not move.
    if (
      !data.pagination.hasNextPage ||
      data.answers.length === 0 ||
      !next ||
      next === lastCreatedAt
    )
      return;
    lastCreatedAt = next;
  }
}

// ----------------------------------------------------------------------------
// Conversion — pure
// ----------------------------------------------------------------------------

export interface PathwayApiConvertOptions {
  /** Survey id for the dataset. Default: the test id. */
  surveyId?: string;
}

/** Pathway block type → contract block type (`undefined` = not a question, skipped). */
const TYPE_MAP: Record<string, Block['type'] | undefined> = {
  choice: 'choice',
  openquestion: 'open',
  question: 'open',
  ai: 'open',
  matrix: 'matrix',
  scale: 'scale',
  nps: 'scale',
  ranking: 'other',
  firstclick: 'firstclick',
  figma: 'prototype',
  livetesting: 'website',
  cardsort: 'cardsort',
  agreement: 'other',
  preference: 'other',
  kanomodel: 'other',
  treetesting: 'other',
  maxdiff: 'other',
};
const SKIPPED_TYPES = new Set(['context', 'fiveseconds', 'shuffle', 'split', 'page']);
const MAX_EXAMPLES = 10;

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Question text comes as HTML; keep the words only. */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n =
          code[1]?.toLowerCase() === 'x'
            ? Number.parseInt(code.slice(2), 16)
            : Number(code.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

/** "mobile" / "tablet" / "desktop" from a user-agent string; `undefined` when there is none. */
export function classifyDevice(userAgent: string | null | undefined): string | undefined {
  if (!userAgent?.trim()) return undefined;
  const ua = userAgent;
  if (/iPad|Tablet|PlayBook|Silk|Kindle|Nexus (7|9|10)/i.test(ua)) return 'tablet';
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua))
    return 'mobile';
  return 'desktop';
}

/** `token`, `*age*`, `*sex*`/`*gender*` URL parameters → panel metadata. */
export function panelFromUrlParams(
  params: Record<string, string | null> | null | undefined,
): PanelMeta | undefined {
  if (!params) return undefined;
  const panel: PanelMeta = {};
  for (const [key, raw] of Object.entries(params)) {
    const v = raw?.trim();
    if (!v) continue;
    const k = key.toLowerCase();
    if (k === 'token' && panel.token === undefined) panel.token = v;
    else if (k.includes('age') && panel.age === undefined) panel.age = v;
    else if ((k.includes('sex') || k.includes('gender')) && panel.sex === undefined) panel.sex = v;
  }
  return Object.keys(panel).length > 0 ? panel : undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function labelOf(o: unknown): string {
  if (typeof o === 'string') return o;
  if (isRecord(o)) {
    if (typeof o.value === 'string' && o.value.trim() !== '') return o.value;
    if (o.id !== undefined) return String(o.id);
  }
  return String(o ?? '');
}

function labelMap(list: PathwayBlock['rows']): Map<string, string> {
  const m = new Map<string, string>();
  for (const item of list ?? []) {
    if (typeof item === 'string') m.set(item, item);
    else m.set(item.id, item.value?.trim() ? item.value : item.id);
  }
  return m;
}

/** Block duration in seconds: `duration` (ms), else `completedAt − startedAt`, else 0. */
export function blockDurationSec(b: PathwayAnswerBlock): number {
  if (typeof b.duration === 'number' && Number.isFinite(b.duration) && b.duration > 0)
    return b.duration / 1000;
  if (b.startedAt && b.completedAt) {
    const ms = Date.parse(b.completedAt) - Date.parse(b.startedAt);
    if (Number.isFinite(ms) && ms > 0) return ms / 1000;
  }
  return 0;
}

/** Prototype click count: sum of `clicks` (number or array) over `nodeEventData` values. */
export function figmaClickCount(nodeEventData: unknown): number {
  if (!isRecord(nodeEventData)) return 0;
  let n = 0;
  for (const v of Object.values(nodeEventData)) {
    if (!isRecord(v)) continue;
    const clicks = v.clicks;
    if (typeof clicks === 'number' && Number.isFinite(clicks)) n += clicks;
    else if (Array.isArray(clicks)) n += clicks.length;
  }
  return Math.max(0, Math.round(n));
}

function inventoryItem(b: PathwayBlock, type: Block['type']): InventoryItem {
  const question = stripHtml(b.text) || `${b.type} ${b.id}`;
  const item: InventoryItem = { scope: 'body', type, question };
  if (b.type === 'choice' || b.type === 'ranking') {
    const options = (b.options ?? []).map(labelOf);
    if (b.type === 'choice' && b.other) options.push('Other');
    if (b.type === 'choice' && b.noneOfTheAbove)
      options.push(b.noneOfTheAboveOptionText?.trim() || 'None of the above');
    if (options.length > 0) item.options = options;
  } else if (b.type === 'matrix' && b.columns?.length) {
    item.options = b.columns.map(labelOf);
  }
  return item;
}

interface BlockOutcome {
  block?: Block;
  /** The answer block carried nothing usable (empty text, nothing selected, no click). */
  empty?: boolean;
}

/** One answer block → one contract block. `def` is the test's definition, when the id is known. */
function toBlock(
  ab: PathwayAnswerBlock,
  def: PathwayBlock | undefined,
  inventory: InventoryItem | undefined,
): BlockOutcome {
  const sourceType = (def?.type ?? ab.type).toLowerCase();
  const type = TYPE_MAP[sourceType];
  if (SKIPPED_TYPES.has(sourceType)) return {};
  const question = inventory?.question ?? stripHtml(def?.text) ?? '';
  const base = {
    blockId: ab.id,
    question: question || `${sourceType} ${ab.id}`,
    duration: blockDurationSec(ab),
  };
  const data = isRecord(ab.data) ? ab.data : {};

  switch (type) {
    case 'choice': {
      const selected = Array.isArray(data.selectedOptions) ? data.selectedOptions : [];
      const answer = selected.map(labelOf).filter((s) => s !== '');
      if (answer.length === 0) return { empty: true };
      const block: Block = { ...base, type: 'choice', answer };
      if (inventory?.options) block.options = inventory.options;
      return { block };
    }
    case 'open': {
      const turns: OpenTurn[] = [];
      if (Array.isArray(data.messages)) {
        for (const m of data.messages) {
          if (!isRecord(m) || typeof m.content !== 'string') continue;
          turns.push({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            text: m.content.trim(),
          });
        }
      } else if (typeof data.text === 'string') {
        turns.push({ role: 'user', text: data.text.trim() });
      }
      if (!turns.some((t) => t.role === 'user' && t.text !== '')) return { empty: true };
      return { block: { ...base, type: 'open', answer: turns } };
    }
    case 'matrix': {
      const rows = labelMap(def?.rows);
      const cols = labelMap(def?.columns);
      const answer: Record<string, string[]> = {};
      if (isRecord(data.selectedOptions)) {
        for (const [rowId, picked] of Object.entries(data.selectedOptions)) {
          const list = Array.isArray(picked) ? picked : picked === null ? [] : [picked];
          const labels = list
            .map((c) => cols.get(labelOf(c)) ?? labelOf(c))
            .filter((s) => s !== '');
          if (labels.length > 0) answer[rows.get(rowId) ?? rowId] = labels;
        }
      }
      if (Object.keys(answer).length === 0) return { empty: true };
      return { block: { ...base, type: 'matrix', answer } };
    }
    case 'scale': {
      const v = data.selectedOption;
      if (v === undefined || v === null || v === '') return { empty: true };
      return { block: { ...base, type: 'scale', answer: labelOf(v) } };
    }
    case 'firstclick': {
      const click = data.clickData;
      if (!isRecord(click) || typeof click.left !== 'number' || typeof click.top !== 'number')
        return { empty: true };
      return {
        block: { ...base, type: 'firstclick', answer: { top: click.top, left: click.left } },
      };
    }
    case 'prototype': {
      const givenUp = data.givenUp === true;
      const path = Array.isArray(data.path) ? data.path : [];
      return {
        block: {
          ...base,
          type: 'prototype',
          status: givenUp ? 'gave_up' : path.length > 0 ? 'completed' : 'partial',
          clickCount: figmaClickCount(data.nodeEventData),
        },
      };
    }
    case 'website':
      return { block: { ...base, type: 'website', gaveUp: data.givenUp === true } };
    case 'cardsort': {
      const answer: Record<string, string[]> = {};
      if (Array.isArray(data.sorting)) {
        for (const cat of data.sorting) {
          if (!isRecord(cat)) continue;
          const name =
            typeof cat.categoryName === 'string' && cat.categoryName.trim()
              ? cat.categoryName
              : String(cat.categoryId ?? '');
          if (!name) continue;
          const cards = Array.isArray(cat.cards) ? cat.cards : [];
          answer[name] = cards.map((c) =>
            isRecord(c) ? labelOf({ id: c.cardId, value: c.cardValue }) : labelOf(c),
          );
        }
      }
      if (Object.keys(answer).length === 0) return { empty: true };
      return { block: { ...base, type: 'cardsort', answer } };
    }
    case 'other': {
      if (sourceType === 'ranking') {
        const ordered = Array.isArray(data.orderedOptions) ? data.orderedOptions.map(labelOf) : [];
        if (ordered.length === 0) return { empty: true };
        return { block: { ...base, type: 'other', sourceType, rawAnswer: ordered } };
      }
      return { block: { ...base, type: 'other', sourceType, rawAnswer: ab.data } };
    }
    default:
      // A type this adapter has never seen: keep it so that its time counts.
      return { block: { ...base, type: 'other', sourceType, rawAnswer: ab.data } };
  }
}

/** Test definition + fetched answers → validated dataset plus a report. Pure. */
export function convertPathwayApi(
  test: PathwayTest,
  answers: PathwayAnswer[],
  opts: PathwayApiConvertOptions = {},
): ConvertResult {
  const defs = new Map<string, PathwayBlock>();
  const inventoryById = new Map<string, InventoryItem>();
  const inventory: InventoryItem[] = [];
  const unknownTypes = new Map<string, number>();
  for (const b of test.blocks) {
    defs.set(b.id, b);
    const t = b.type.toLowerCase();
    if (SKIPPED_TYPES.has(t)) continue;
    let type = TYPE_MAP[t];
    if (type === undefined) {
      unknownTypes.set(b.type, (unknownTypes.get(b.type) ?? 0) + 1);
      type = 'other';
    }
    const item = inventoryItem(b, type);
    inventory.push(item);
    inventoryById.set(b.id, item);
  }

  const survey: Survey = { id: opts.surveyId?.trim() || test.id, responses: [], inventory };
  const blocksByType: Record<string, number> = {};
  const skipped = new Map<string, ConvertReport['skipped'][number]>();
  const skip = (line: number, reason: string, detail: string) => {
    const e = skipped.get(reason) ?? { reason, count: 0, examples: [] };
    e.count++;
    if (e.examples.length < MAX_EXAMPLES) e.examples.push({ line, detail });
    skipped.set(reason, e);
  };
  const sources = new Set<string>();
  const orphanBlocks = new Set<string>();
  let emptyBlocks = 0;
  let timedBlocks = 0;
  let rowsConverted = 0;
  let rowsSkipped = 0;

  answers.forEach((a, i) => {
    const line = i + 1; // 1-based position in the fetched list (the report calls it "line")
    const status = a.status?.trim() ?? '';
    if (status !== '' && status.toLowerCase() !== 'completed') {
      rowsSkipped++;
      skip(line, `status "${status}" is not completed`, `answer ${a.id}`);
      return;
    }
    const r: Response = { id: a.id, blocks: [] };
    const device = classifyDevice(a.userAgent);
    if (device) r.device = device;
    const panel = panelFromUrlParams(a.urlParams);
    if (panel) r.panel = panel;
    if (a.source?.trim()) sources.add(a.source.trim());

    for (const ab of a.blocks) {
      const def = defs.get(ab.id);
      if (!def) orphanBlocks.add(ab.id);
      const { block, empty } = toBlock(ab, def, inventoryById.get(ab.id));
      if (empty) emptyBlocks++;
      if (!block) continue;
      r.blocks.push(block);
      blocksByType[block.type] = (blocksByType[block.type] ?? 0) + 1;
      if (block.duration > 0) timedBlocks++;
    }
    survey.responses.push(r);
    rowsConverted++;
  });

  const warnings: string[] = [];
  if (sources.size === 1) survey.source = [...sources][0];
  else if (sources.size > 1) {
    warnings.push(
      `"source" differs between respondents (${[...sources].join(', ')}); survey.source left empty`,
    );
  }
  warnings.push(
    'screening questions and answers are not exposed by the Pathway public API; ' +
      'coherence (screening-vs-body) is unavailable',
  );
  warnings.push(
    'the recruiting target is not exposed by the Pathway public API; survey.target left empty',
  );
  if (emptyBlocks > 0) {
    warnings.push(
      `${emptyBlocks} answer block(s) carried no usable answer (empty text, nothing selected, no click) and were dropped`,
    );
  }
  if (orphanBlocks.size > 0) {
    warnings.push(
      `${orphanBlocks.size} block id(s) in answers are missing from the test definition (edited questionnaire?); ` +
        'their type was taken from the answer and their question text is unknown',
    );
  }
  for (const [t, n] of unknownTypes) {
    warnings.push(`unknown block type "${t}" on ${n} question(s): kept as "other"`);
  }
  const otherKinds = [
    ...new Set(
      test.blocks
        .map((b) => b.type.toLowerCase())
        .filter((t) => TYPE_MAP[t] === 'other' && t !== 'ranking'),
    ),
  ];
  if (otherKinds.length > 0)
    warnings.push(`block type(s) kept as "other": ${otherKinds.join(', ')}`);

  const hasDuration = timedBlocks > 0;
  const dataset: Dataset = parseDataset([survey]);
  const blocks = Object.values(blocksByType).reduce((a, b) => a + b, 0);
  const report: ConvertReport = {
    rowsRead: answers.length,
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

// ----------------------------------------------------------------------------
// Composition
// ----------------------------------------------------------------------------

export interface PathwayImportResult extends ConvertResult {
  test: PathwayTest;
  pagesFetched: number;
  answersFetched: number;
}

/** Fetch the test and every page of answers, then convert. */
export async function importPathway(
  testId: string,
  opts: PathwayApiOptions & PathwayApiConvertOptions,
): Promise<PathwayImportResult> {
  const client = new PathwayClient(opts); // one client = one rate limiter for every request
  const test = await fetchPathwayTest(testId, opts, client);
  const answers: PathwayAnswer[] = [];
  let pagesFetched = 0;
  for await (const page of fetchPathwayResponses(testId, opts, client)) {
    pagesFetched++;
    answers.push(...page.answers);
  }
  const { dataset, report } = convertPathwayApi(test, answers, { surveyId: opts.surveyId });
  return { dataset, report, test, pagesFetched, answersFetched: answers.length };
}
