/**
 * Deterministic synthetic cohorts for detector tests. No real survey data: question texts
 * and answers are invented, durations come from a seeded log-normal generator.
 */
import type { Block, Response, Survey } from '../../src/contract/types.js';

/** mulberry32 — small seeded PRNG, enough for test fixtures. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller on a seeded uniform source. */
export function gaussian(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  const v = next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Log-normal duration around `medianSec` with ln-space spread `sigma`. */
export function logNormalSec(next: () => number, medianSec: number, sigma = 0.45): number {
  return Math.round(Math.exp(Math.log(medianSec) + sigma * gaussian(next)) * 10) / 10;
}

export const CHOICE_OPTIONS = [
  'Price',
  'Battery life',
  'Camera',
  'Screen size',
  'Brand',
  'Weight',
  'Colour',
  'Warranty',
];

export const OPEN_TEXTS = [
  'I usually compare prices online before buying anything expensive.',
  'The checkout flow felt slow and the error messages were unclear.',
  'I would like a dark mode and a faster search.',
  'My main concern is how long the battery lasts on a trip.',
  'Delivery was quick but the packaging was damaged.',
  'I mostly use it on the train in the morning.',
];

export interface HonestOptions {
  /** Number of choice blocks. */
  choice?: number;
  /** Number of open blocks. */
  open?: number;
  /** Number of prototype tasks. */
  prototype?: number;
  /** Number of website tasks. */
  website?: number;
  /** Median seconds per block type. */
  medians?: Partial<Record<Block['type'], number>>;
}

/**
 * Build one honest respondent: moderate durations, 1–2 ticks on multi-select questions,
 * varied open texts, completed prototype tasks with a normal click count, and
 * finished website tasks.
 */
export function honestResponse(id: string, next: () => number, opts: HonestOptions = {}): Response {
  const choice = opts.choice ?? 0;
  const open = opts.open ?? 0;
  const prototype = opts.prototype ?? 0;
  const website = opts.website ?? 0;
  const med = { choice: 12, open: 40, prototype: 60, website: 45, ...opts.medians };
  const blocks: Block[] = [];
  for (let i = 0; i < choice; i++) {
    const nTicks = 1 + Math.floor(next() * 2);
    const start = Math.floor(next() * (CHOICE_OPTIONS.length - nTicks));
    blocks.push({
      type: 'choice',
      blockId: `c${i}`,
      question: `Which of these matter to you? (${i})`,
      options: CHOICE_OPTIONS,
      answer: CHOICE_OPTIONS.slice(start, start + nTicks),
      duration: logNormalSec(next, med.choice),
    });
  }
  for (let i = 0; i < open; i++) {
    const text = OPEN_TEXTS[Math.floor(next() * OPEN_TEXTS.length)];
    blocks.push({
      type: 'open',
      blockId: `o${i}`,
      question: `Tell us more about topic ${i}`,
      answer: [{ role: 'user', text: `${text} (${id}-${i})` }],
      duration: logNormalSec(next, med.open),
    });
  }
  for (let i = 0; i < prototype; i++) {
    blocks.push({
      type: 'prototype',
      blockId: `p${i}`,
      question: `Find the settings screen (${i})`,
      status: 'completed',
      clickCount: 6 + Math.floor(next() * 8),
      duration: logNormalSec(next, med.prototype),
    });
  }
  for (let i = 0; i < website; i++) {
    blocks.push({
      type: 'website',
      blockId: `w${i}`,
      question: `Find the returns policy on the site (${i})`,
      gaveUp: false,
      duration: logNormalSec(next, med.website),
    });
  }
  return { id, blocks };
}

export function cohort(n: number, seed: number, opts: HonestOptions = {}): Response[] {
  const next = rng(seed);
  const out: Response[] = [];
  for (let i = 0; i < n; i++) out.push(honestResponse(`h${i}`, next, opts));
  return out;
}

export function survey(responses: Response[], id = 'synthetic'): Survey {
  return { id, responses };
}
