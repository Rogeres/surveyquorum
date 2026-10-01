import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { cliVersion, main, USAGE } from '../src/cli.js';
import type { Io } from '../src/commands/shared.js';

const dir = mkdtempSync(join(tmpdir(), 'surveyquorum-cli-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function capture(): Io & { lines: { out: string[]; err: string[] } } {
  const lines = { out: [] as string[], err: [] as string[] };
  return { lines, out: (l) => lines.out.push(l), err: (l) => lines.err.push(l) };
}

describe('cli entry point', () => {
  it('prints the usage and exits 0 with no command or --help', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['help']]) {
      const io = capture();
      expect(await main(argv, io)).toBe(0);
      expect(io.lines.out).toEqual([USAGE]);
    }
  });

  it('prints the version', async () => {
    const io = capture();
    expect(await main(['--version'], io)).toBe(0);
    expect(io.lines.out[0]).toBe(`surveyquorum ${cliVersion()}`);
    expect(cliVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('exits 2 on an unknown command and names it', async () => {
    const io = capture();
    expect(await main(['frobnicate'], io)).toBe(2);
    expect(io.lines.err[0]).toContain('frobnicate');
  });

  it('answers --help for every command before anything runs', async () => {
    for (const cmd of ['run', 'resume', 'convert', 'import', 'explain', 'weights', 'complaints']) {
      const io = capture();
      expect(await main([cmd, '--help'], io), cmd).toBe(0);
      expect(io.lines.err, cmd).toEqual([]);
      expect(io.lines.out.join('\n'), cmd).toContain(`surveyquorum ${cmd}`);
    }
  });

  it('resume --help has no side effects even when an agent dir is named', async () => {
    const agentDir = join(dir, 'agent');
    const io = capture();
    expect(await main(['resume', '--agent-dir', agentDir, '--help'], io)).toBe(0);
    expect(existsSync(agentDir)).toBe(false);
    expect(io.lines.out.join('\n')).toContain('judge-responses.jsonl');
  });

  it('convert --help lists the presets instead of opening a file called --help', async () => {
    const io = capture();
    expect(await main(['convert', '--help'], io)).toBe(0);
    expect(io.lines.out.join('\n')).toContain('flat-long');
    expect(existsSync('--help')).toBe(false);
  });
});
