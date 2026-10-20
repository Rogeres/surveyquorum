#!/usr/bin/env tsx
/**
 * Assembles the skill's generated files from the bilingual catalog cards:
 *   reference.md            (English, read by the skill)
 *   catalog/README.md       (English index)
 *   catalog/README.ru.md    (Russian index + full cards, read by researchers)
 *   evals/TAGS.md           (code -> slug table for the eval harness)
 * Cards are the source of truth. Run: npm run catalog:build   Check: npm run catalog:check
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skillDir = join(here, '..');
const GROUPS: Record<string, { ru: string; en: string }> = {
  A: { ru: 'Отбор: кто проходит', en: 'Gate design - who gets in' },
  B: { ru: 'Списки вариантов', en: 'Option lists' },
  C: { ru: 'Формулировки и вёрстка', en: 'Wording and format' },
  D: { ru: 'Структура и логика', en: 'Structure and logic' },
};

export interface Card { code: string; slug: string; group: string; titleRu: string; titleEn: string; ru: string; en: string; file: string }

export function loadCards(dir = here): Card[] {
  const files = readdirSync(dir).filter((f) => /^[A-D]\d+-[a-z-]+\.md$/.test(f)).sort(byCode);
  return files.map((file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    if (!fm) throw new Error(`${file}: missing front matter`);
    const meta: Record<string, string> = {};
    for (const line of fm[1].split('\n')) {
      const m = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line);
      if (m) meta[m[1]] = m[2];
    }
    const body = text.slice(fm[0].length);
    const ru = section(body, 'RU'), en = section(body, 'EN');
    for (const k of ['code', 'slug', 'group', 'title_ru', 'title_en']) if (!meta[k]) throw new Error(`${file}: front matter lacks ${k}`);
    if (!ru || !en) throw new Error(`${file}: needs both "## RU" and "## EN" sections`);
    if (!file.startsWith(`${meta.code}-${meta.slug}.md`)) throw new Error(`${file}: file name must be <code>-<slug>.md`);
    return { code: meta.code, slug: meta.slug, group: meta.group, titleRu: meta.title_ru, titleEn: meta.title_en, ru, en, file };
  });
}

function section(body: string, name: string): string {
  const m = new RegExp(`\\n## ${name}\\n([\\s\\S]*?)(?=\\n## [A-Z]{2}\\n|$)`).exec(`\n${body}`);
  return m ? m[1].trim() : '';
}
function byCode(a: string, b: string) {
  const [ga, na] = [a[0], Number.parseInt(a.slice(1), 10)], [gb, nb] = [b[0], Number.parseInt(b.slice(1), 10)];
  return ga === gb ? na - nb : ga < gb ? -1 : 1;
}

export function render(cards: Card[]) {
  const head = readFileSync(join(here, '_reference-head.md'), 'utf8');
  const tail = readFileSync(join(here, '_reference-tail.md'), 'utf8');
  let reference = head;
  for (const g of Object.keys(GROUPS)) {
    reference += `\n## ${g}. ${GROUPS[g].en}\n`;
    for (const c of cards.filter((c) => c.group === g)) reference += `\n### ${c.code} \`${c.slug}\` - ${c.titleEn}\n\n${c.en}\n`;
  }
  reference += `\n${tail}`;

  const rowEn = (c: Card) => `| ${c.code} | \`${c.slug}\` | [${c.titleEn}](${c.file}) |`;
  const rowRu = (c: Card) => `| ${c.code} | \`${c.slug}\` | [${c.titleRu}](#${anchor(c)}) |`;
  let readme = `# Screener fault catalog\n\n25 faults a screener can have, one card each. Every card names the fault, what it breaks in the field, how to repair it, the exceptions, and a bad / good example. The cards are the source of truth: \`reference.md\` (what the skill reads), this index, \`README.ru.md\` and \`evals/TAGS.md\` are generated from them by \`npm run catalog:build\`. Russian index: [README.ru.md](README.ru.md).\n\n| code | tag | fault |\n|---|---|---|\n${cards.map(rowEn).join('\n')}\n`;
  let readmeRu = `# Каталог ошибок скрининга\n\n25 ошибок, по карточке на каждую. В карточке: что это, что ломается в поле, как чинить, исключения, пример «плохо» и «хорошо». Карточки это источник истины: \`reference.md\` (его читает скилл), индексы и \`evals/TAGS.md\` собираются из них командой \`npm run catalog:build\`. Как добавить своё правило: [CONTRIBUTING.ru.md](CONTRIBUTING.ru.md).\n\n| код | тег | ошибка |\n|---|---|---|\n${cards.map(rowRu).join('\n')}\n`;
  for (const g of Object.keys(GROUPS)) {
    readmeRu += `\n## ${g}. ${GROUPS[g].ru}\n`;
    for (const c of cards.filter((c) => c.group === g)) readmeRu += `\n### ${c.code} ${c.titleRu}\n\nТег: \`${c.slug}\` · [карточка](${c.file})\n\n${c.ru}\n`;
  }
  const tags = `# Screener fault codes\n\nClosed vocabulary of the optional \`tags:\` line of the screener-design review output and of the eval graders. The line is produced only when the request asks for machine-readable tags; a person reads "What to fix and why" in words instead. One tag per fault, anchored to a question position of the draft: \`multi-no-limit@S3\`, \`body-contradiction@B4\`, or \`no-screener@screener\` / \`long-screener@screener\` for the draft as a whole; \`none\` when nothing is wrong. Generated from \`../catalog/\` by \`npm run catalog:build\`; the code is the card's id, the slug is the tag.\n\n| code | slug | fault |\n|---|---|---|\n${cards.map((c) => `| \`${c.code}\` | ${c.slug} | ${c.titleEn} |`).join('\n')}\n`;
  return { reference, readme, readmeRu, tags };
}
function anchor(c: Card) { return `${c.code.toLowerCase()}-${c.titleRu.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '')}`; }

export const OUTPUTS = (skill: string) => ({
  reference: join(skill, 'reference.md'),
  readme: join(skill, 'catalog', 'README.md'),
  readmeRu: join(skill, 'catalog', 'README.ru.md'),
  tags: join(skill, 'evals', 'TAGS.md'),
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const out = render(loadCards());
  const paths = OUTPUTS(skillDir);
  let drift = 0;
  for (const k of Object.keys(out) as (keyof typeof out)[]) {
    const current = (() => { try { return readFileSync(paths[k], 'utf8'); } catch { return ''; } })();
    if (current !== out[k]) {
      drift++;
      if (check) console.error(`out of date: ${paths[k]}`);
      else { writeFileSync(paths[k], out[k]); console.log(`wrote ${paths[k]}`); }
    }
  }
  if (check && drift) { console.error('run: npm run catalog:build'); process.exit(1); }
  if (check) console.log('catalog: generated files are up to date');
}
