import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { fakeApi } from '../../core/test/helpers/pathway-api-fixture.js';
import { importCommand } from '../src/commands/import.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-import-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function capture(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l) => out.push(l), err: (l) => err.push(l) }, out, err };
}

describe('import command', () => {
  it('imports a Pathway test through the API and writes the dataset', async () => {
    const api = fakeApi();
    const { io, out, err } = capture();
    const outFile = join(dir, 'nested', 'dataset.json');
    const code = await importCommand(
      ['pathway', '--test', 'demo-test-1', '--out', outFile, '--survey-id', 'spring-wave'],
      io,
      {
        fetch: api.fetch,
        sleep: api.opts.sleep,
        env: { PATHWAY_API_TOKEN: 'demo-token', PATHWAY_API_URL: 'https://api.example.test' },
      },
    );
    expect(code).toBe(0);
    expect(out).toEqual([`dataset written to ${outFile}`]);
    const dataset = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(dataset[0].id).toBe('spring-wave');
    expect(dataset[0].responses.map((r: { id: string }) => r.id)).toEqual(['a1', 'a2', 'a4']);
    const log = err.join('\n');
    expect(log).toContain('page 1: 2 response(s), 2 of 4 so far');
    expect(log).toContain('page 2: 2 response(s), 4 of 4 so far — last page');
    expect(log).toContain(
      'fetched 2 page(s), 4 response(s) for test "demo-test-1" (Garden app concept check): 3 kept, 1 skipped',
    );
    expect(log).toContain('convert (pathway api): 4 rows read, 3 converted, 1 skipped');
    expect(log).toContain('skipped 1 row(s) — status "screened_out" is not completed:');
    expect(log).toContain('no screening answers → coherence (screening-vs-body) unavailable');
    expect(api.calls.every((c) => c.auth === 'Bearer demo-token')).toBe(true);
  });

  it('prefers --token and --base-url over the environment and honours --max-pages', async () => {
    const api = fakeApi({ failFirstResponses: false });
    const { io, err } = capture();
    const code = await importCommand(
      [
        'pathway',
        '--test',
        'demo-test-1',
        '--token',
        'demo-token',
        '--base-url',
        'https://api.example.test',
        '--max-pages',
        '1',
        '--out',
        join(dir, 'one.json'),
      ],
      io,
      {
        fetch: api.fetch,
        sleep: api.opts.sleep,
        env: { PATHWAY_API_TOKEN: 'wrong', PATHWAY_API_URL: 'https://wrong.example.test' },
      },
    );
    expect(code).toBe(0);
    expect(api.calls).toHaveLength(2); // test + one page
    expect(err.join('\n')).toContain('fetched 1 page(s), 2 response(s)');
  });

  it('returns 2 with usage when the source, test id or token is missing', async () => {
    const env = { PATHWAY_API_TOKEN: 't', PATHWAY_API_URL: 'https://api.example.test' };
    let c = capture();
    expect(await importCommand([], c.io, { env })).toBe(2);
    expect(c.err[0]).toMatch(/^surveyquorum import pathway/);
    c = capture();
    expect(await importCommand(['qualtrics', '--test', 'x'], c.io, { env })).toBe(2);
    expect(c.err[0]).toContain('unknown source "qualtrics"');
    c = capture();
    expect(await importCommand(['pathway'], c.io, { env })).toBe(2);
    c = capture();
    expect(await importCommand(['pathway', '--test', 'x'], c.io, { env: {} })).toBe(2);
    expect(c.err[0]).toContain('PATHWAY_API_TOKEN');
    c = capture();
    expect(
      await importCommand(['pathway', '--test', 'x', '--max-pages', 'zero'], c.io, { env }),
    ).toBe(2);
    expect(c.err[0]).toContain('--max-pages');
  });

  it('reports API errors as a message, not a stack trace', async () => {
    const api = fakeApi({ failFirstResponses: false });
    const { io, err } = capture();
    const code = await importCommand(
      ['pathway', '--test', 'missing-test', '--out', join(dir, 'none.json')],
      io,
      {
        fetch: api.fetch,
        sleep: api.opts.sleep,
        env: { PATHWAY_API_TOKEN: 't', PATHWAY_API_URL: 'https://api.example.test' },
      },
    );
    expect(code).toBe(1);
    expect(err.join('\n')).toMatch(/^import: Pathway API: .*not found/);
  });
});
