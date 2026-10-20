// promptfoo may hand YAML lists to graders as JSON strings; normalize.
export function arr(v) { if (Array.isArray(v)) return v; if (v == null || v === '') return []; if (typeof v === 'string') { try { const j = JSON.parse(v); return Array.isArray(j) ? j : [v]; } catch { return v.split(',').map((s) => s.trim()).filter(Boolean); } } return [v]; }
// "Do no harm" graders: facts about the repaired screener the skill wrote, independent of tags.
function screenerSection(output) {
  const m = /(?:^|\n)[#*\s]*(?:2\.\s*)?[«"]?(?:Скринер|Screener)[»"]?[\s\S]*?(?=\n[#*\s]*(?:3\.\s*)?[«"]?(?:Что исправить|What to fix|Почему так|Why so)|\n[#*\s]*(?:4\.\s*)?[«"]?(?:Уточнить|Confirm)|\ntags\s*:|$)/i.exec(output);
  return m ? m[0] : output;
}
/** the skill never adds an information screen to the screener */
export function noInfoScreen(output, { vars }) {
  const sec = screenerSection(output);
  const draftHas = /информационный экран|information screen/i.test(vars.draft ?? '');
  const has = /информационн\w* экран|information screen|контекстн\w* блок/i.test(sec);
  return { pass: draftHas || !has, score: draftHas || !has ? 1 : 0, reason: has && !draftHas ? 'added an information screen' : 'no information screen added' };
}
/** quota questions from the draft are still present (by a keyword each) */
export function keepsQuotaQuestions(output, { vars }) {
  const sec = screenerSection(output).toLowerCase();
  const missing = arr(vars.mustKeep).filter((k) => !sec.includes(k.toLowerCase()));
  return { pass: missing.length === 0, score: missing.length ? 0 : 1, reason: missing.length ? `dropped: ${missing.join(', ')}` : 'quota/brief questions kept' };
}
/** nothing from a forbidden list appears in the repaired screener (e.g. a criterion the draft never had) */
export function noNewCriterion(output, { vars }) {
  // only question headings count: a remark like «возраст проверяет таргет» is not an added question
  const heads = screenerSection(output).split('\n').filter((l) => /^\W*S\d+\b/.test(l)).join('\n').toLowerCase();
  const hit = arr(vars.mustNotAdd).filter((k) => heads.includes(k.toLowerCase()));
  return { pass: hit.length === 0, score: hit.length ? 0 : 1, reason: hit.length ? `added a criterion the draft never had: ${hit.join(', ')}` : 'no invented criterion' };
}
/** the answer has the four sections and no catalog codes in the human text */
export function formatHeld(output) {
  const body = output.replace(/(?:^|\n)\W*tags\W*:.*$/i, '');
  const hasAud = /Аудитория|Audience/i.test(body), hasScr = /Скринер|Screener/i.test(body), hasFix = /Что исправить|What to fix|со скринингом всё в порядке|nothing is wrong/i.test(body);
  const codes = body.match(/\b[A-D]\d{1,2}@S\d+\b/g) ?? [];
  const pass = hasAud && hasScr && hasFix && codes.length === 0;
  return { pass, score: pass ? 1 : 0, reason: pass ? 'format held' : `sections: ${[hasAud, hasScr, hasFix].map(Number).join('')}, codes in prose: ${codes.length}` };
}
