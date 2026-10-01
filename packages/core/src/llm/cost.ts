import prices from './prices.json' with { type: 'json' };

interface PriceRow {
  match: string[];
  input: number;
  output: number;
}

interface PriceTable {
  asOf: string;
  unit: string;
  note: string;
  models: Record<string, PriceRow>;
}

export const PRICES: PriceTable = prices as PriceTable;

export interface CostInput {
  requests: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  model: string;
}

export interface CostEstimate {
  usd: number;
  /** Price row the model matched; `generic` when nothing matched. */
  priceClass: string;
  asOf: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

/** Price row for a model id: first row whose `match` regex hits, else `generic`. */
export function priceClassFor(model: string): string {
  const m = model.toLowerCase();
  for (const [name, row] of Object.entries(PRICES.models)) {
    if (row.match.some((re) => new RegExp(re, 'i').test(m))) return name;
  }
  return 'generic';
}

/** Rough spend for a batch of similar requests. Tokens are averages the caller guesses. */
export function estimateCost(input: CostInput): CostEstimate {
  const priceClass = priceClassFor(input.model);
  const row = PRICES.models[priceClass];
  const inputTokens = Math.round(input.requests * input.avgInputTokens);
  const outputTokens = Math.round(input.requests * input.avgOutputTokens);
  const usd = (inputTokens * row.input + outputTokens * row.output) / 1_000_000;
  return {
    usd: Math.round(usd * 10000) / 10000,
    priceClass,
    asOf: PRICES.asOf,
    requests: input.requests,
    inputTokens,
    outputTokens,
  };
}

/** One-line human rendering for the CLI. */
export function formatCost(e: CostEstimate, model: string): string {
  const usd = e.usd < 0.01 && e.usd > 0 ? '<$0.01' : `$${e.usd.toFixed(2)}`;
  return `${e.requests} requests to ${model} ≈ ${usd} (price class ${e.priceClass}, list prices as of ${e.asOf}; verify with your provider)`;
}
