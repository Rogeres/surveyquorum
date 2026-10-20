import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadCards, render, OUTPUTS } from './build.ts';

const skill = join(import.meta.dirname, '..');
const cards = loadCards();
const slugs = new Set(cards.map((c) => c.slug));

describe('screener-design catalog', () => {
  it('has 25 cards with unique codes and slugs, both RU and EN sections', () => {
    expect(cards.length).toBe(25);
    expect(new Set(cards.map((c) => c.code)).size).toBe(25);
    expect(slugs.size).toBe(25);
    for (const c of cards) {
      expect(c.ru, `${c.file} RU`).toMatch(/\*\*Что это\.\*\*/);
      expect(c.ru, `${c.file} RU`).toMatch(/\*\*Что ломается\.\*\*/);
      expect(c.ru, `${c.file} RU`).toMatch(/\*\*Как чинить\.\*\*/);
      expect(c.en, `${c.file} EN`).toMatch(/\*\*What\.\*\*/);
      expect(c.en, `${c.file} EN`).toMatch(/\*\*Breaks\.\*\*/);
      expect(c.en, `${c.file} EN`).toMatch(/\*\*Fix\.\*\*/);
    }
  });

  it('generated files are up to date (run: npm run catalog:build)', () => {
    const out = render(cards);
    const paths = OUTPUTS(skill);
    for (const k of Object.keys(out) as (keyof typeof out)[]) {
      expect(readFileSync(paths[k], 'utf8'), paths[k]).toBe(out[k]);
    }
  });

  it('SKILL.md mentions every catalog group and no retired rule', () => {
    const skillMd = readFileSync(join(skill, 'SKILL.md'), 'utf8');
    for (const g of ['A2', 'A5', 'A6', 'B2', 'C1', 'D5', 'D6']) expect(skillMd).toContain(g);
    expect(skillMd).not.toMatch(/Findings block|difficulty: N\/10/);
  });
});

describe('screener-design evals', () => {
  const casesDir = join(skill, 'evals', 'cases');
  const files = readdirSync(casesDir).filter((f) => f.endsWith('.yaml'));
  const tagRe = /\b([a-z]+(?:-[a-z]+)*)@(?:S\d+|B\d+|screener|body)\b|\[([^\]]*)\]/g;

  it('every case references existing tags and an existing draft', () => {
    for (const f of files) {
      const text = readFileSync(join(casesDir, f), 'utf8');
      const draft = /draft:\s*file:\/\/(\S+)/.exec(text)?.[1];
      expect(draft, `${f}: draft`).toBeTruthy();
      expect(existsSync(join(skill, 'evals', draft!)), `${f}: ${draft}`).toBe(true);
      for (const line of text.split('\n')) {
        const m = /^\s*(expect|reject|tolerate):\s*(?:\[(.*)\]|["']?([^"'\n]*)["']?)\s*$/.exec(line);
        if (!m) continue;
        for (const t of (m[2] ?? m[3] ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
          if (t === 'none') continue;
          const slug = t.split('@')[0];
          expect(slugs.has(slug), `${f}: unknown tag "${t}"`).toBe(true);
        }
      }
    }
  });

  it('reports which catalog codes have no eval case yet', () => {
    const covered = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(casesDir, f), 'utf8').matchAll(/\b([a-z]+(?:-[a-z]+)*)@/g)) covered.add(m[1]);
    const uncovered = cards.filter((c) => !covered.has(c.slug)).map((c) => c.code);
    console.info(`catalog codes without an eval case: ${uncovered.length ? uncovered.join(', ') : 'none'}`);
    expect(uncovered.length).toBeLessThan(25);
  });
});
