/**
 * Small deterministic statistics helpers shared by the statistical detectors.
 * No randomness, no external dependencies.
 */

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Sample standard deviation (n − 1). Returns 0 for fewer than two values. */
export function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (xs.length - 1));
}

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((p, q) => p - q);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** Linear-interpolated percentile, p in [0, 1]. */
export function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((u, v) => u - v);
  const pos = (a.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (pos - lo);
}

/**
 * Log-time statistics for a cohort of durations in seconds. Durations are log-normal in
 * practice; outliers are measured in standard deviations of ln(t). Values below `floorSec`
 * are clamped so that a zero never becomes a fake −15σ outlier.
 */
export interface LogStats {
  n: number;
  mu: number;
  sigma: number;
  medianSec: number;
}

export function logStats(durationsSec: number[], floorSec = 0.1): LogStats {
  const logs = durationsSec
    .filter((d) => Number.isFinite(d) && d > 0)
    .map((d) => Math.log(Math.max(floorSec, d)));
  return {
    n: logs.length,
    mu: mean(logs),
    sigma: sd(logs),
    medianSec: median(durationsSec.filter((d) => Number.isFinite(d) && d > 0)),
  };
}

/** z-score of one duration against log-time cohort stats; 0 when the cohort has no spread. */
export function logZ(durationSec: number, stats: LogStats, floorSec = 0.1): number {
  if (stats.sigma <= 1e-9 || stats.n < 2) return 0;
  return (Math.log(Math.max(floorSec, durationSec)) - stats.mu) / stats.sigma;
}

/** Round to a fixed number of decimals for stable, readable stats. */
export function round(x: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}
