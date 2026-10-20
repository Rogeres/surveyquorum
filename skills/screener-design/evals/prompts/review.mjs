// Builds the chat for one case: the skill (SKILL.md + reference.md) as system, the draft as user.
// Same framing as the lab harness: review mode, no brief, machine tags line requested.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const skillDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) => (s.startsWith('---') ? s.split('\n---', 2)[1] ?? s : s);
export default function review({ vars }) {
  const skill = strip(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).replaceAll('${CLAUDE_SKILL_DIR}/reference.md', 'the REFERENCE section below').replaceAll('${CLAUDE_SKILL_DIR}/evals/TAGS.md', 'the tags table in the REFERENCE section');
  const reference = readFileSync(join(skillDir, 'reference.md'), 'utf8');
  const tags = readFileSync(join(skillDir, 'evals', 'TAGS.md'), 'utf8');
  const system = [
    'You are running the skill below exactly as written, in review mode: the user brings a DRAFT screener.',
    'There is no separate audience brief: read the audience from the draft and the hiring quotas, state it in the one-line "Audience" section, and put every guessed criterion under "Confirm with the researcher". Do not ask questions back.',
    'Answer in Russian, keep the skill\'s output order and section names (Аудитория / Скринер / Что исправить и почему / Уточнить у исследователя).',
    'This is an eval harness: end the answer with the machine line `tags: slug@S#, ...` exactly as the skill describes (slugs from the tags table; `none` if nothing is wrong).',
    '', '=== SKILL ===', skill, '', '=== REFERENCE ===', reference, '', tags,
  ].join('\n');
  const user = `$audience: ${vars.brief ?? 'не задана, выведи из черновика и квот.'}\n$draft:\n\n${vars.draft}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}
