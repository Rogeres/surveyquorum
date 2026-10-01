import type { Block, InventoryItem, Response, Survey } from '../../contract/types.js';
import { sha256 } from '../../llm/hash.js';
import { mapPool } from '../../llm/pool.js';
import { fillPrompt, loadPrompt } from '../../llm/prompt.js';
import { openText } from '../shared/cohort.js';
import { round } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence, LlmClient } from '../types.js';

const NAME = 'coherence';

export const PAIRS_PROMPT_VERSION = 'coherence_pairs_v1';
export const VERIFY_PROMPT_VERSION = 'coherence_verify_v1';

/** Stage 1 may propose at most this many pairs; extras are dropped in order. */
export const MAX_PAIRS = 12;
/** A contradiction counts only from this verifier confidence (1–5). */
export const MIN_CONFIDENCE = 4;
/** Weighted contradictions (screening↔body counts 2) from which the signal is strong. */
export const STRONG_MIN = 2;
/** A pair that contradicts for this share of respondents who answered both (and ≥ COHORT_PAIR_MIN) is a bad pair. */
export const COHORT_PAIR_SHARE = 0.2;
export const COHORT_PAIR_MIN = 3;
export const CONCURRENCY = 8;

export const RELATIONS = ['must_match', 'subset', 'mutually_exclusive', 'semantic'] as const;

export const PAIRS_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['pairs'],
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        required: ['a', 'b', 'relation', 'rule'],
        properties: {
          a: { type: 'integer', minimum: 1 },
          b: { type: 'integer', minimum: 1 },
          relation: { type: 'string', enum: [...RELATIONS] },
          rule: { type: 'string' },
        },
      },
    },
  },
};

export const VERIFY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['i', 'contradicts', 'confidence', 'explanation'],
        properties: {
          i: { type: 'integer', minimum: 1 },
          contradicts: { type: 'boolean' },
          confidence: { type: 'integer', minimum: 1, maximum: 5 },
          explanation: { type: 'string' },
        },
      },
    },
  },
};

export interface InventoryQuestion extends InventoryItem {
  /** Normalized question text, the join key between inventory and answers. */
  key: string;
}

export interface CandidatePair {
  /** 0-based indices into the inventory. */
  a: number;
  b: number;
  relation: (typeof RELATIONS)[number];
  rule: string;
}

export interface PairJudgement {
  i: number;
  contradicts: boolean;
  confidence: number;
  explanation: string;
}

export function questionKey(q: string): string {
  return q.replace(/\s+/g, ' ').trim().toLowerCase();
}

const COMPARABLE: ReadonlySet<Block['type']> = new Set([
  'choice',
  'scale',
  'matrix',
  'open',
  'cardsort',
  'other',
]);

/**
 * Inventory for the pair prompt: the survey's own when present, else rebuilt from answers —
 * screening questions first, then body blocks whose answers can be compared.
 */
export function buildInventory(survey: Survey): InventoryQuestion[] {
  const items: InventoryQuestion[] = [];
  const seen = new Set<string>();
  const push = (item: InventoryItem) => {
    const key = `${item.scope}:${questionKey(item.question)}`;
    if (seen.has(key) || !questionKey(item.question)) return;
    seen.add(key);
    items.push({ ...item, key: questionKey(item.question) });
  };
  if (survey.inventory?.length) {
    for (const it of survey.inventory) push(it);
    return items;
  }
  for (const r of survey.responses) {
    for (const s of r.screening ?? [])
      push({ scope: 'screening', type: 'screening', question: s.question });
  }
  for (const r of survey.responses) {
    for (const b of r.blocks) {
      if (!COMPARABLE.has(b.type)) continue;
      push({
        scope: 'body',
        type: b.type,
        question: b.question,
        ...(b.type === 'choice' && b.options ? { options: b.options } : {}),
      });
    }
  }
  return items;
}

export function renderInventory(inv: InventoryQuestion[]): string {
  return inv
    .map((q, i) => {
      const opts = q.options?.length ? ` — options: ${q.options.join(' | ')}` : '';
      return `${i + 1}. [${q.scope}] (${q.type}) ${q.question}${opts}`;
    })
    .join('\n');
}

/** Compact one-line rendering of an answer, or undefined when there is nothing to compare. */
export function renderAnswer(b: Block): string | undefined {
  switch (b.type) {
    case 'choice':
      return b.answer.length ? b.answer.join(', ') : undefined;
    case 'scale':
      return b.answer.trim() || undefined;
    case 'open':
      return openText(b) || undefined;
    case 'matrix':
    case 'cardsort': {
      const rows = Object.entries(b.answer)
        .filter(([, v]) => v.length)
        .map(([k, v]) => `${k}: ${v.join(', ')}`);
      return rows.length ? rows.join('; ') : undefined;
    }
    case 'other':
      return b.rawAnswer === undefined || b.rawAnswer === null
        ? undefined
        : typeof b.rawAnswer === 'string'
          ? b.rawAnswer
          : JSON.stringify(b.rawAnswer);
    default:
      return undefined;
  }
}

/** The respondent's answer to an inventory question plus the body block index when it is one. */
export function answerFor(
  r: Response,
  q: InventoryQuestion,
): { text: string; block?: number } | undefined {
  if (q.scope === 'screening') {
    const s = r.screening?.find((x) => questionKey(x.question) === q.key);
    const text = s?.answer
      .map((a) => a.trim())
      .filter(Boolean)
      .join(', ');
    return text ? { text } : undefined;
  }
  const idx = r.blocks.findIndex((b) => questionKey(b.question) === q.key);
  if (idx < 0) return undefined;
  const text = renderAnswer(r.blocks[idx]);
  return text ? { text, block: idx } : undefined;
}

interface Item {
  pair: number;
  a: { text: string; block?: number };
  b: { text: string; block?: number };
}

export function renderItems(
  inv: InventoryQuestion[],
  pairs: CandidatePair[],
  items: Item[],
): string {
  return items
    .map((it, i) => {
      const p = pairs[it.pair];
      const qa = inv[p.a];
      const qb = inv[p.b];
      return [
        `### Item ${i + 1}`,
        `Q1 [${qa.scope}]: ${qa.question}`,
        `A1: ${it.a.text}`,
        `Q2 [${qb.scope}]: ${qb.question}`,
        `A2: ${it.b.text}`,
        `Relation: ${p.relation}. Hint: ${p.rule}`,
      ].join('\n');
    })
    .join('\n\n');
}

let pairsTemplate: string | undefined;
let verifyTemplate: string | undefined;

/** Normalise stage-1 output: 1-based → 0-based, in range, distinct, a<b, capped. */
export function normalizePairs(raw: unknown, n: number): CandidatePair[] {
  const list = ((raw as { pairs?: unknown[] })?.pairs ?? []) as {
    a: number;
    b: number;
    relation: CandidatePair['relation'];
    rule: string;
  }[];
  const seen = new Set<string>();
  const out: CandidatePair[] = [];
  for (const p of list) {
    const a = Math.min(p.a, p.b) - 1;
    const b = Math.max(p.a, p.b) - 1;
    if (a < 0 || b >= n || a === b || seen.has(`${a}-${b}`)) continue;
    seen.add(`${a}-${b}`);
    out.push({ a, b, relation: p.relation, rule: p.rule });
    if (out.length >= MAX_PAIRS) break;
  }
  return out;
}

async function discoverPairs(
  llm: LlmClient,
  inv: InventoryQuestion[],
  log: (m: string) => void,
): Promise<CandidatePair[] | 'pending'> {
  pairsTemplate ??= loadPrompt(import.meta.url, `${PAIRS_PROMPT_VERSION}.txt`);
  const rendered = renderInventory(inv);
  const res = await llm.complete({
    role: 'arbiter',
    prompt: fillPrompt(pairsTemplate, { questions: rendered }),
    schema: PAIRS_SCHEMA,
    cacheKey: sha256(PAIRS_PROMPT_VERSION, rendered),
  });
  if (res.pending) return 'pending';
  const pairs = normalizePairs(res.json, inv.length);
  log(`${NAME}: stage 1 proposed ${pairs.length} candidate pair(s) for ${inv.length} questions`);
  return pairs;
}

/**
 * Three-stage pairwise coherence, ported minimally. Stage 1 asks a strong model once per survey
 * which question pairs could contradict; stage 2 asks a cheap model per respondent whether the
 * two actual answers do. Two confident contradictions are strong (`contradiction`), one is weak
 * (`possible_contradiction`); a screening↔body contradiction counts double because a declared
 * profile the body refutes is an imposter signal. A pair that fires for a fifth of the cohort is
 * an ambiguous question, not fraud, and is reported as a design artifact.
 */
export const coherenceDetector: Detector = {
  name: NAME,
  needsLlm: true,
  async detect(survey: Survey, ctx: DetectorContext): Promise<Evidence[]> {
    const llm = ctx.llm;
    if (!llm) return [];
    const inv = buildInventory(survey);
    if (inv.length < 2) {
      ctx.log(`${NAME}: fewer than two comparable questions; skipped`);
      return [];
    }

    const pairs = await discoverPairs(llm, inv, ctx.log);
    if (pairs === 'pending') {
      ctx.log(`${NAME}: pair discovery pending LLM judgement; skipped for now`);
      return [];
    }
    if (pairs.length === 0) return [];

    verifyTemplate ??= loadPrompt(import.meta.url, `${VERIFY_PROMPT_VERSION}.txt`);
    const template = verifyTemplate;

    interface Verified {
      response: Response;
      items: Item[];
      judgements: PairJudgement[];
    }

    const answeredBoth = new Map<number, number>();
    const work: { response: Response; items: Item[] }[] = [];
    for (const r of survey.responses) {
      const items: Item[] = [];
      pairs.forEach((p, pi) => {
        const a = answerFor(r, inv[p.a]);
        const b = answerFor(r, inv[p.b]);
        if (!a || !b) return;
        items.push({ pair: pi, a, b });
        answeredBoth.set(pi, (answeredBoth.get(pi) ?? 0) + 1);
      });
      if (items.length) work.push({ response: r, items });
    }

    let pending = 0;
    const verified = (
      await mapPool(work, CONCURRENCY, async (w): Promise<Verified | undefined> => {
        const rendered = renderItems(inv, pairs, w.items);
        try {
          const res = await llm.complete({
            role: 'classifier',
            prompt: fillPrompt(template, { pairs: rendered }),
            schema: VERIFY_SCHEMA,
            cacheKey: sha256(VERIFY_PROMPT_VERSION, rendered),
          });
          if (res.pending) {
            pending++;
            return undefined;
          }
          const judgements = ((res.json as { results: PairJudgement[] }).results ?? []).filter(
            (j) => j.i >= 1 && j.i <= w.items.length,
          );
          return { response: w.response, items: w.items, judgements };
        } catch (e) {
          ctx.log(`${NAME}: ${w.response.id}: ${e instanceof Error ? e.message : String(e)}`);
          return undefined;
        }
      })
    ).filter((v): v is Verified => v !== undefined);
    if (pending > 0)
      ctx.log(`${NAME}: ${pending} respondent(s) pending LLM judgement; skipped for now`);

    interface Hit {
      pair: number;
      item: Item;
      judgement: PairJudgement;
    }
    const hitsByResponse: { response: Response; hits: Hit[] }[] = [];
    const firedBy = new Map<number, number>();
    for (const v of verified) {
      const hits: Hit[] = [];
      for (const j of v.judgements) {
        if (!j.contradicts || j.confidence < MIN_CONFIDENCE) continue;
        const item = v.items[j.i - 1];
        hits.push({ pair: item.pair, item, judgement: j });
        firedBy.set(item.pair, (firedBy.get(item.pair) ?? 0) + 1);
      }
      if (hits.length) hitsByResponse.push({ response: v.response, hits });
    }

    const badPairs = new Map<number, number>();
    for (const [pi, fired] of firedBy) {
      const n = answeredBoth.get(pi) ?? 0;
      const share = n > 0 ? fired / n : 0;
      if (fired >= COHORT_PAIR_MIN && share >= COHORT_PAIR_SHARE) badPairs.set(pi, share);
    }
    if (badPairs.size > 0)
      ctx.log(
        `${NAME}: ${badPairs.size} pair(s) fire for ≥${COHORT_PAIR_SHARE * 100}% of the cohort; suppressed`,
      );

    const out: Evidence[] = [];
    const blocksOf = (hits: Hit[]) =>
      [...new Set(hits.flatMap((h) => [h.item.a.block, h.item.b.block]))].filter(
        (b): b is number => b !== undefined,
      );
    for (const { response, hits } of hitsByResponse) {
      const real = hits.filter((h) => !badPairs.has(h.pair));
      const artifact = hits.filter((h) => badPairs.has(h.pair));
      if (artifact.length) {
        const share = Math.max(...artifact.map((h) => badPairs.get(h.pair) ?? 0));
        out.push({
          responseId: response.id,
          detector: NAME,
          signal: 'cohort_pair_fires',
          strength: 'weak',
          designArtifact: true,
          blocks: blocksOf(artifact),
          summary:
            `${artifact.length} contradiction(s) on question pair(s) that contradict for ` +
            `${round(share * 100, 0)}% of the cohort; the questions are ambiguous.`,
          stats: { nPairs: artifact.length, maxCohortShare: round(share, 3) },
        });
      }
      if (real.length === 0) continue;
      const crossScope = (h: Hit) => inv[pairs[h.pair].a].scope !== inv[pairs[h.pair].b].scope;
      const weight = real.reduce((s, h) => s + (crossScope(h) ? 2 : 1), 0);
      const strong = weight >= STRONG_MIN;
      const lead = real[0];
      out.push({
        responseId: response.id,
        detector: NAME,
        signal: strong ? 'contradiction' : 'possible_contradiction',
        strength: strong ? 'strong' : 'weak',
        blocks: blocksOf(real),
        summary:
          `${real.length} contradiction(s) between answers` +
          (real.some(crossScope) ? ', including the declared screening profile' : '') +
          `: ${lead.judgement.explanation}`,
        stats: {
          nContradictions: real.length,
          nScreeningVsBody: real.filter(crossScope).length,
          weightedCount: weight,
          minConfidence: Math.min(...real.map((h) => h.judgement.confidence)),
        },
      });
    }
    return out;
  },
};
