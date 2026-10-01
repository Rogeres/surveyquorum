import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Io } from '../src/commands/shared.js';
import { formatWeights, weightsCommand } from '../src/commands/weights.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-weights-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe('surveyquorum weights', () => {
  it('prints the default table sorted by LLR with sources', () => {
    const { io, out } = capture();
    expect(weightsCommand([], io)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('prior 0.0225');
    expect(text).toMatch(/pace\.consistent\s+\+4\.500/);
    expect(text).toContain('assumed');
    const first = text.indexOf('pace.consistent');
    const last = text.indexOf('open-answer.rich_open_answers');
    expect(first).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(first);
  });

  it('reads a user file, including the legacy additive form', () => {
    const path = join(dir, 'legacy.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 'legacy',
        provenance: 'test',
        defaults: { strong: 2, weak: 0.7, positive: -1.5 },
        weights: { 'pace.consistent': 2.4 },
        thresholds: { block: 3, review: 1.5 },
      }),
    );
    const { io, out } = capture();
    expect(weightsCommand(['--file', path], io)).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('legacy additive form');
    expect(text).toMatch(/pace\.consistent\s+\+2\.400/);
  });

  it('rejects a file that is not a weights file', () => {
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{"hello": 1}');
    const { io, err } = capture();
    expect(weightsCommand(['--file', path], io)).toBe(1);
    expect(err[0]).toContain('expected a weights file');
  });

  it('formatWeights counts measured vs assumed entries', () => {
    const text = formatWeights({
      version: 'v',
      provenance: 'p',
      prior: 0.05,
      defaults: { strong: 3, weak: 2, positive: -1 },
      weights: { 'a.b': { llr: 1, source: 'measured: x' }, 'c.d': { llr: 2, source: 'assumed' } },
      thresholds: { block: 0.8, review: 0.3 },
    });
    expect(text).toContain('2 weights: 1 measured, 1 assumed, 0 without a source.');
  });
});
