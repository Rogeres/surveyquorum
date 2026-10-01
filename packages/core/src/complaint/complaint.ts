import type { Block, Response } from '../contract/types.js';
import type { Evidence } from '../detectors/types.js';
import type { Verdict } from '../quorum/score.js';
import { acceptsGround, codeFor, type PanelProfile, resolvePanelProfile } from './panels.js';
import type {
  Complaint,
  ComplaintGround,
  ComplaintLang,
  ComplaintOptions,
  IneligibleReason,
} from './types.js';

/** Default hard cap of a panel comment field. */
export const COMPLAINT_MAX_CHARS = 500;
/** Why a row is left out even though it has a ground: the profile wants a respondent token. */
export const SKIPPED_NO_TOKEN = 'skipped: profile requires a respondent token';
/** Whole-survey time below this share of the cohort median is a speed ground panels accept. */
export const SPEED_TOTAL_RATIO_MAX = 0.5;

/** Open-answer labels that are a ground on their own, in the order we prefer to quote them. */
export const NONSENSE_SIGNALS = ['gibberish', 'fake', 'wrong_language', 'bad_language'] as const;
const TEMPLATE_SIGNALS = new Set(['straightline', 'straightline_fast']);

export type GroundSelection =
  | { ground: ComplaintGround; evidence: Evidence }
  | { ground: null; reason: IneligibleReason };

/**
 * The single strongest ground panels recognise, in the order they accept most reliably:
 * a nonsense open answer → the same text on three or more questions → a template across a
 * rating grid → the whole survey done in under half the cohort median. A single fast block,
 * a repeat on two questions, an abandoned task, mass-select, a contradiction or an off-target
 * click are not grounds: the verdict stands for the client, no complaint is filed.
 *
 * With a `profile`, a ground its `acceptedGrounds` leaves out is reported as
 * `ground_not_accepted` instead (an empty list means the panel has no complaint channel).
 */
export function selectGround(
  verdict: Verdict,
  evidence: Evidence[],
  profile?: PanelProfile,
): GroundSelection {
  const sel = selectStrongestGround(verdict, evidence);
  if (sel.ground && profile && !acceptsGround(profile, sel.ground)) {
    return { ground: null, reason: 'ground_not_accepted' };
  }
  return sel;
}

function selectStrongestGround(verdict: Verdict, evidence: Evidence[]): GroundSelection {
  if (verdict.outcome !== 'block') return { ground: null, reason: 'not_blocked' };
  const own = evidence.filter((e) => e.responseId === verdict.responseId && !e.designArtifact);
  if (own.length === 0) return { ground: null, reason: 'no_evidence' };

  for (const signal of NONSENSE_SIGNALS) {
    const e = own.find((x) => x.detector === 'open-answer' && x.signal === signal);
    if (e) return { ground: 'nonsense_text', evidence: e };
  }
  const dup = own.find((x) => x.detector === 'duplicate-open' && x.signal === 'x3');
  if (dup) return { ground: 'duplicate_text', evidence: dup };
  const tpl = own.find((x) => x.detector === 'matrix-pattern' && TEMPLATE_SIGNALS.has(x.signal));
  if (tpl) return { ground: 'template_pattern', evidence: tpl };

  const pace = own.filter((x) => x.detector === 'pace');
  for (const e of pace) {
    const t = totals(e);
    if (t && t.total / t.median < SPEED_TOTAL_RATIO_MAX) {
      return { ground: 'speed_whole_survey', evidence: e };
    }
  }
  if (pace.length > 0) return { ground: null, reason: 'speed_not_whole_survey' };
  return { ground: null, reason: 'internal_only' };
}

function num(e: Evidence, key: string): number | null {
  const v = e.stats?.[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function totals(e: Evidence): { total: number; median: number } | null {
  const total = num(e, 'totalSec');
  const median = num(e, 'cohortMedianSec');
  return total !== null && median !== null && median > 0 && total > 0 ? { total, median } : null;
}

// ---------------------------------------------------------------------------
// text helpers
// ---------------------------------------------------------------------------

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function cut(s: string, max: number): string {
  const t = squash(s);
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Cut at a word boundary so that the text fits `max`, with an ellipsis. */
export function capAtWord(text: string, max: number): string {
  const t = squash(text);
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`;
}

/** Render with progressively shorter quotes until the text fits; cap at a word as a last resort. */
function fit(max: number, render: (qMax: number, aMax: number) => string): string {
  for (const [q, a] of [
    [90, 60],
    [70, 45],
    [50, 30],
    [35, 20],
  ] as const) {
    const t = squash(render(q, a));
    if (t.length <= max) return t;
  }
  return capAtWord(render(35, 20), max);
}

const fmtTime: Record<ComplaintLang, (sec: number) => string> = {
  en(sec) {
    const s = Math.max(1, Math.round(sec));
    if (s < 600) return `${s} s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} min` : `${m} min ${r} s`;
  },
  ru(sec) {
    const s = Math.max(1, Math.round(sec));
    if (s < 600) return `${s} с`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? `${m} мин` : `${m} мин ${r} с`;
  },
};

/** "7 times" / "2.5 times" — and the Russian «в 7 раз» / «в 2,5 раза» agreement. */
export function times(k: number, lang: ComplaintLang): string {
  const n = k >= 3 ? Math.round(k) : Math.round(k * 10) / 10;
  if (lang === 'en') return `${n} times`;
  const word = Number.isInteger(n) && (n < 2 || n > 4) ? 'раз' : 'раза';
  return `в ${String(n).replace('.', ',')} ${word}`;
}

/** Russian plural: plural(3, 'вопрос', 'вопроса', 'вопросов') → «вопроса». */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

// ---------------------------------------------------------------------------
// facts
// ---------------------------------------------------------------------------

function userText(b: Block | undefined): string {
  if (b?.type !== 'open') return '';
  return b.answer
    .filter((t) => t.role === 'user')
    .map((t) => t.text.trim())
    .filter(Boolean)
    .join(' ');
}

function questionAt(r: Response | undefined, i: number | undefined): string {
  return i === undefined ? '' : (r?.blocks[i]?.question ?? '');
}

/** Question and answer behind a nonsense flag: from the response when available, else from the summary. */
function nonsenseFacts(e: Evidence, r?: Response): { q: string; a: string } {
  const i = e.blocks?.[0];
  if (r && i !== undefined && r.blocks[i]?.type === 'open') {
    return { q: r.blocks[i].question, a: userText(r.blocks[i]) };
  }
  const m = /^Answer "(.*?)" to "(.*?)" classified as/.exec(e.summary);
  return { q: m?.[2] ?? '', a: m?.[1] ?? '' };
}

function duplicateFacts(
  e: Evidence,
  r?: Response,
): { text: string; n: number; questions: string[] } {
  const n = num(e, 'nQuestions') ?? e.blocks?.length ?? 3;
  const fromSummary = /The same text "(.*?)" appears on/.exec(e.summary)?.[1] ?? '';
  const text = (e.blocks?.[0] !== undefined ? userText(r?.blocks[e.blocks[0]]) : '') || fromSummary;
  const questions = r
    ? [...new Set((e.blocks ?? []).map((i) => questionAt(r, i)).filter(Boolean))]
    : [];
  return { text, n, questions };
}

// ---------------------------------------------------------------------------
// templates
// ---------------------------------------------------------------------------

const WHY: Record<ComplaintLang, Record<string, string>> = {
  en: {
    gibberish: 'This is not an answer to the question but a string of letters without meaning.',
    fake: 'This is not an answer in substance: a single character or a fragment that says nothing.',
    wrong_language: 'The answer is not in the language of the survey.',
    bad_language: 'Abuse instead of an answer in substance.',
    unknown: 'The answer carries no information about the question asked.',
  },
  ru: {
    gibberish: 'Это не ответ на вопрос, а набор букв без смысла.',
    fake: 'Это не ответ по существу: одиночный символ или обрывок, из которого нельзя понять ничего.',
    wrong_language: 'Ответ дан не на языке анкеты.',
    bad_language: 'Нецензурная лексика вместо ответа по существу.',
    unknown: 'Ответ не несёт информации по заданному вопросу.',
  },
};

function renderNonsense(e: Evidence, lang: ComplaintLang, max: number, r?: Response): string {
  const { q, a } = nonsenseFacts(e, r);
  const why = WHY[lang][e.signal] ?? WHY[lang].unknown;
  return fit(max, (qMax, aMax) =>
    lang === 'en'
      ? `Question: "${cut(q, qMax)}" Answer: "${cut(a, aMax)}". ${why}`
      : `Вопрос: «${cut(q, qMax)}» Ответ: «${cut(a, aMax)}». ${why}`,
  );
}

function renderDuplicate(e: Evidence, lang: ComplaintLang, max: number, r?: Response): string {
  const { text, n, questions } = duplicateFacts(e, r);
  return fit(max, (qMax, aMax) => {
    if (lang === 'en') {
      const list = questions.map((q) => `"${cut(q, qMax)}"`).join(', ');
      return (
        `The same answer "${cut(text, aMax)}" was given to ${n} different open questions` +
        `${list ? `: ${list}` : ''}. None of them addresses the question asked.`
      );
    }
    const list = questions.map((q) => `«${cut(q, qMax)}»`).join(', ');
    return (
      `Один и тот же ответ «${cut(text, aMax)}» дан на ${n} ${pluralRu(n, 'разный открытый вопрос', 'разных открытых вопроса', 'разных открытых вопросов')}` +
      `${list ? `: ${list}` : ''}. Ни один из них не относится к содержанию вопроса.`
    );
  });
}

function renderTemplate(e: Evidence, lang: ComplaintLang, max: number, r?: Response): string {
  const patterned = num(e, 'patternedUnits') ?? e.blocks?.length ?? 2;
  const units = num(e, 'units') ?? patterned;
  const first = (e.blocks ?? []).map((i) => r?.blocks[i]).find((b) => b?.type === 'matrix');
  const q = first?.question ?? '';
  const rows = first?.type === 'matrix' ? Object.keys(first.answer).length : 0;
  const zigzag = typeof e.stats?.patterns === 'string' && /zigzag/i.test(e.stats.patterns);
  return fit(max, (qMax) => {
    if (lang === 'en') {
      const where = q ? `In the rating grid "${cut(q, qMax)}"` : 'In the rating grids';
      const how = zigzag
        ? 'the answers alternate between two extremes row by row'
        : rows > 1
          ? `the same rating is given in all ${rows} rows although the statements differ in meaning`
          : 'the same rating is given in every row although the statements differ in meaning';
      return `${where} ${how}. The pattern repeats in ${patterned} of ${units} rating questions; the grids were filled without reading.`;
    }
    const where = q ? `В таблице «${cut(q, qMax)}»` : 'В табличных вопросах';
    const how = zigzag
      ? 'ответы чередуются двумя крайними значениями строго через строку'
      : rows > 1
        ? `одна и та же оценка во всех ${rows} строках, хотя утверждения разные по смыслу`
        : 'одна и та же оценка в каждой строке, хотя утверждения разные по смыслу';
    return `${where} ${how}. Шаблон повторяется в ${patterned} из ${units} ${pluralRu(units, 'оценочного вопроса', 'оценочных вопросов', 'оценочных вопросов')}; таблицы заполнены не читая.`;
  });
}

function renderSpeed(e: Evidence, lang: ComplaintLang, max: number): string {
  const t = totals(e);
  if (!t) return '';
  const k = t.median / t.total;
  const f = fmtTime[lang];
  const text =
    lang === 'en'
      ? `Whole survey completed in ${f(t.total)}; cohort median ${f(t.median)}` +
        `${k >= 1.5 ? ` (${times(k, lang)} faster)` : ''}. In that time the questions and answer options cannot be read.`
      : `Анкета пройдена за ${f(t.total)} при медиане других участников ${f(t.median)}` +
        `${k >= 1.5 ? ` (${times(k, lang)} быстрее)` : ''}. За это время невозможно прочитать вопросы и варианты ответа.`;
  return capAtWord(text, max);
}

export function renderGround(
  ground: ComplaintGround,
  e: Evidence,
  lang: ComplaintLang,
  max: number,
  r?: Response,
): string {
  switch (ground) {
    case 'nonsense_text':
      return renderNonsense(e, lang, max, r);
    case 'duplicate_text':
      return renderDuplicate(e, lang, max, r);
    case 'template_pattern':
      return renderTemplate(e, lang, max, r);
    case 'speed_whole_survey':
      return renderSpeed(e, lang, max);
  }
}

// ---------------------------------------------------------------------------
// composition
// ---------------------------------------------------------------------------

/**
 * One complaint text for a blocked respondent, or `null` when no ground the profile accepts
 * exists, or when the profile requires a respondent token and the response carries none.
 * The arbiter's `panelText` wins over the template when it is present and fits the cap.
 */
export function buildComplaint(
  verdict: Verdict,
  evidence: Evidence[],
  opts: ComplaintOptions = {},
): Complaint | null {
  const panel = resolvePanelProfile(opts.panel);
  const sel = selectGround(verdict, evidence, panel);
  if (!sel.ground) return null;
  const token = opts.response?.panel?.token;
  if (panel.requiresToken && !token) return null;
  const max = opts.maxChars ?? panel.maxChars ?? COMPLAINT_MAX_CHARS;
  const lang = opts.lang ?? panel.language ?? 'en';
  const arbiterText = opts.panelText ? squash(opts.panelText) : '';
  const text =
    arbiterText && arbiterText.length <= max
      ? arbiterText
      : renderGround(sel.ground, sel.evidence, lang, max, opts.response);
  const out: Complaint = {
    responseId: verdict.responseId,
    ground: sel.ground,
    text,
    chars: text.length,
    eligible: true,
    code: codeFor(panel, sel.ground),
  };
  if (token) out.panelToken = token;
  return out;
}
