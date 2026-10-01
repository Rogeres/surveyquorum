#!/usr/bin/env tsx
/**
 * Fit signal weights (log-likelihood ratios) from labelled respondents.
 *
 * Input, one of:
 *   --verdicts <verdicts.json> --labels <labels.json>
 *       verdicts.json is what `surveyquorum run --out` writes; labels.json maps responseId to
 *       "good" | "bad_*" (or to an object with a `label` field, as examples/demo-ground-truth.json).
 *   --csv <table.csv>
 *       columns response_id,label,signals — signals is a `;`-separated list of detector.signal keys.
 *
 * Output: a weights.json in the v1 Bayesian form (--out, default .surveyquorum/weights.json) and a
 * console report: per-signal counts, precision and LLR, then the ladder (k signals → junk share).
 *
 * Options: --prior <p> (default: share of junk among the labels), --cap <llr> (default 4.5),
 *          --block <p> --review <p> (default 0.95 / 0.2, the shipped thresholds), --version <string>.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Strength } from '../packages/core/src/detectors/types.js';
import type { SurveyResult } from '../packages/core/src/index.js';
import {
  DEFAULT_WEIGHTS,
  LLR_CAP,
  logit,
  sigmoid,
  type WeightEntry,
  type Weights,
} from '../packages/core/src/quorum/score.js';

interface Row {
  id: string;
  junk: boolean;
  /** Distinct weighed detector.signal keys. */
  signals: string[];
  /** Strength per key when known (verdicts input); absent for CSV input. */
  strengths?: Record<string, Strength>;
}

const arg = (flags: string[], name: string): string | undefined => {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
};

function parseLabel(raw: unknown): boolean | undefined {
  const label = typeof raw === 'string' ? raw : (raw as { label?: unknown } | null)?.label;
  if (typeof label !== 'string') return undefined;
  if (label === 'good') return false;
  if (label.startsWith('bad')) return true;
  return undefined;
}

function fromVerdicts(verdictsPath: string, labelsPath: string): Row[] {
  const results = JSON.parse(readFileSync(resolve(verdictsPath), 'utf8')) as SurveyResult[];
  const labels = JSON.parse(readFileSync(resolve(labelsPath), 'utf8')) as Record<string, unknown>;
  if (!Array.isArray(results))
    throw new Error(`${verdictsPath}: expected the array written by "surveyquorum run"`);
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    for (const v of r.verdicts) {
      seen.add(v.responseId);
      const junk = parseLabel(labels[v.responseId]);
      if (junk === undefined) continue;
      const strengths: Record<string, Strength> = {};
      for (const e of v.evidence) strengths[`${e.detector}.${e.signal}`] = e.strength;
      rows.push({ id: v.responseId, junk, signals: Object.keys(strengths).sort(), strengths });
    }
  }
  const missing = Object.keys(labels).filter((id) => !seen.has(id)).length;
  if (missing) console.error(`warning: ${missing} labelled id(s) not found in ${verdictsPath}`);
  return rows;
}

function fromCsv(path: string): Row[] {
  const lines = readFileSync(resolve(path), 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim());
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${path}: missing column "${name}" (have ${header.join(', ')})`);
    return i;
  };
  const idCol = col('response_id');
  const labelCol = col('label');
  const sigCol = col('signals');
  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const junk = parseLabel(cells[labelCol]?.trim());
    if (junk === undefined) continue;
    const signals = [
      ...new Set(
        (cells[sigCol] ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].sort();
    rows.push({ id: cells[idCol].trim(), junk, signals });
  }
  return rows;
}

interface SignalStat {
  key: string;
  nJunk: number;
  nHonest: number;
  precision: number;
  llr: number;
}

function fit(rows: Row[], cap: number): SignalStat[] {
  const nJunkTotal = rows.filter((r) => r.junk).length;
  const nHonestTotal = rows.length - nJunkTotal;
  const counts = new Map<string, { junk: number; honest: number }>();
  for (const r of rows) {
    for (const k of r.signals) {
      const c = counts.get(k) ?? { junk: 0, honest: 0 };
      if (r.junk) c.junk++;
      else c.honest++;
      counts.set(k, c);
    }
  }
  const stats: SignalStat[] = [];
  for (const [key, c] of counts) {
    // Laplace (+1) smoothing on both conditional probabilities.
    const pJunk = (c.junk + 1) / (nJunkTotal + 2);
    const pHonest = (c.honest + 1) / (nHonestTotal + 2);
    const raw = Math.log(pJunk / pHonest);
    stats.push({
      key,
      nJunk: c.junk,
      nHonest: c.honest,
      precision: c.junk / (c.junk + c.honest),
      llr: Math.max(-cap, Math.min(cap, raw)),
    });
  }
  return stats.sort((a, b) => b.llr - a.llr || a.key.localeCompare(b.key));
}

function ladder(rows: Row[], stats: SignalStat[], prior: number): string[] {
  const llr = new Map(stats.map((s) => [s.key, s.llr]));
  const buckets = new Map<string, { n: number; junk: number; pSum: number }>();
  for (const r of rows) {
    const negative = r.signals.filter((k) => (llr.get(k) ?? 0) < 0).length;
    const k = r.signals.length - negative;
    const label = k >= 4 ? '4+' : String(k);
    const b = buckets.get(label) ?? { n: 0, junk: 0, pSum: 0 };
    b.n++;
    if (r.junk) b.junk++;
    b.pSum += sigmoid(logit(prior) + r.signals.reduce((a, key) => a + (llr.get(key) ?? 0), 0));
    buckets.set(label, b);
  }
  const lines = ['k signals  n      observed junk  mean fitted p'];
  for (const label of ['0', '1', '2', '3', '4+']) {
    const b = buckets.get(label);
    if (!b) continue;
    lines.push(
      `${label.padEnd(10)} ${String(b.n).padEnd(6)} ${(b.junk / b.n).toFixed(3).padEnd(14)} ${(b.pSum / b.n).toFixed(3)}`,
    );
  }
  return lines;
}

function meanBy(stats: SignalStat[], rows: Row[], strength: Strength, fallback: number): number {
  const keys = new Set<string>();
  for (const r of rows)
    for (const [k, s] of Object.entries(r.strengths ?? {})) if (s === strength) keys.add(k);
  const vals = stats.filter((s) => keys.has(s.key)).map((s) => s.llr);
  if (!vals.length) return fallback;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 1000) / 1000;
}

function main(argv: string[]): number {
  const verdicts = arg(argv, '--verdicts');
  const labels = arg(argv, '--labels');
  const csv = arg(argv, '--csv');
  if (!(csv || (verdicts && labels))) {
    console.error(
      'usage: npm run calibration:fit -- (--verdicts <verdicts.json> --labels <labels.json> | --csv <table.csv>)\n' +
        '       [--out <weights.json>] [--prior <p>] [--cap <llr>] [--block <p>] [--review <p>] [--version <v>]',
    );
    return 2;
  }
  const rows = csv ? fromCsv(csv) : fromVerdicts(verdicts as string, labels as string);
  const nJunk = rows.filter((r) => r.junk).length;
  if (!rows.length || nJunk === 0 || nJunk === rows.length) {
    console.error(`need both junk and honest labels; got ${nJunk} junk of ${rows.length}`);
    return 1;
  }
  const prior = Number(arg(argv, '--prior') ?? nJunk / rows.length);
  const cap = Number(arg(argv, '--cap') ?? LLR_CAP);
  const block = Number(arg(argv, '--block') ?? 0.95);
  const review = Number(arg(argv, '--review') ?? 0.2);
  const date = new Date().toISOString().slice(0, 10);
  const version = arg(argv, '--version') ?? `fitted-${date}`;

  const stats = fit(rows, cap);
  const source = `fitted on ${rows.length} labelled responses, ${date}`;
  const weights: Record<string, WeightEntry> = {};
  for (const s of stats) {
    weights[s.key] = {
      llr: Math.round(s.llr * 1000) / 1000,
      source: `${source}; n_junk ${s.nJunk}, n_honest ${s.nHonest}, precision ${s.precision.toFixed(3)}`,
    };
  }
  const out: Weights = {
    version,
    provenance:
      `${source} (${nJunk} junk, ${rows.length - nJunk} honest). LLR = ln(P(signal|junk)/P(signal|honest)) ` +
      `with Laplace +1 smoothing, capped at ±${cap}. Thresholds are posterior probabilities.`,
    prior: Math.round(prior * 1e6) / 1e6,
    defaults: {
      strong: meanBy(stats, rows, 'strong', DEFAULT_WEIGHTS.defaults.strong),
      weak: meanBy(stats, rows, 'weak', DEFAULT_WEIGHTS.defaults.weak),
      positive: meanBy(stats, rows, 'positive', DEFAULT_WEIGHTS.defaults.positive),
    },
    weights,
    thresholds: { block, review },
  };

  const outPath = resolve(arg(argv, '--out') ?? '.surveyquorum/weights.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);

  const w = Math.max(6, ...stats.map((s) => s.key.length));
  console.log(
    `${rows.length} labelled responses: ${nJunk} junk, ${rows.length - nJunk} honest; prior ${prior.toFixed(4)}`,
  );
  console.log('');
  console.log(`${'signal'.padEnd(w)}  n_junk  n_honest  precision      LLR`);
  for (const s of stats) {
    console.log(
      `${s.key.padEnd(w)}  ${String(s.nJunk).padStart(6)}  ${String(s.nHonest).padStart(8)}  ${s.precision.toFixed(3).padStart(9)}  ${(s.llr >= 0 ? '+' : '') + s.llr.toFixed(3)}`,
    );
  }
  console.log('');
  for (const line of ladder(rows, stats, prior)) console.log(line);
  console.log('');
  console.log(`wrote ${outPath} (version ${version})`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
