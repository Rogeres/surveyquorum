import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/** Output sinks, injectable so that tests can call commands without spawning a process. */
export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

export const consoleIo: Io = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** Value following a `--flag`, or undefined. */
export function arg(flags: string[], name: string): string | undefined {
  const i = flags.indexOf(name);
  return i >= 0 ? flags[i + 1] : undefined;
}

/** True when the arguments ask for help. Checked before anything is read or written. */
export function wantsHelp(flags: string[]): boolean {
  return flags.includes('--help') || flags.includes('-h');
}

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(path), 'utf8'));
}

export function writeOut(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
