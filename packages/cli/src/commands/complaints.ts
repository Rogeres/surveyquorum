import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  type ArbitratedVerdict,
  buildComplaint,
  type Complaint,
  type ComplaintLang,
  type Dataset,
  GENERIC_PROFILE,
  hasComplaintChannel,
  type IneligibleReason,
  isPanelId,
  PANEL_IDS,
  type PanelProfile,
  parseDataset,
  parsePanelProfile,
  type Response,
  resolvePanelProfile,
  SKIPPED_NO_TOKEN,
  type SurveyResult,
  selectGround,
} from 'surveyquorum';
import { arg, consoleIo, type Io, readJson } from './shared.js';

export const COMPLAINTS_USAGE =
  'surveyquorum complaints <verdicts.json> [--panel generic | --panel-profile <profile.json>] ' +
  '[--lang en|ru] [--out <complaints.csv>] [--dataset <dataset.json>] [--decisions <decisions.json>]';

export const PANEL_HELP =
  `--panel accepts: ${PANEL_IDS.join(', ')} (default generic). ` +
  "For your panel's reason codes, token requirement and accepted grounds pass " +
  '--panel-profile <profile.json>; the format and two examples are in adapters/panel-profiles/.';

export const CSV_HEADER = 'response_id,panel_token,ground,code,text,chars';

export type Decision = 'keep' | 'block';

/**
 * Human decisions, as `quorum-screen` records them: `{ "<responseId>": { "decision": "keep" |
 * "block", "note"?: string } }`. The short form `{ "<responseId>": "keep" | "block" }` is also
 * accepted. Anything else is rejected with the offending id.
 */
export function parseDecisions(raw: unknown): Map<string, Decision> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('decisions: expected an object keyed by responseId');
  }
  const out = new Map<string, Decision>();
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const decision =
      typeof value === 'string'
        ? value
        : value && typeof value === 'object'
          ? (value as { decision?: unknown }).decision
          : undefined;
    if (decision !== 'keep' && decision !== 'block') {
      throw new Error(
        `decisions: "${id}" must be "keep" or "block" (got ${JSON.stringify(value)})`,
      );
    }
    out.set(id, decision);
  }
  return out;
}

export interface DecisionsApplied {
  /** Verdicts that were not `block` and a human decided to block: now eligible as if blocked. */
  toBlock: number;
  /** Verdicts that were not `keep` and a human decided to keep: now excluded. */
  toKeep: number;
  /** Decision ids that match no verdict in the file. */
  unknown: string[];
}

/**
 * Overrides outcomes with human decisions before eligibility is judged. `block` makes a
 * `review` (or an overturned) verdict eligible as if the engine had blocked it; `keep` excludes
 * it. Returns new objects; the input is not mutated.
 */
export function applyDecisions(
  results: SurveyResult[],
  decisions: Map<string, Decision>,
): { results: SurveyResult[]; applied: DecisionsApplied } {
  const applied: DecisionsApplied = { toBlock: 0, toKeep: 0, unknown: [] };
  const seen = new Set<string>();
  const out = results.map((r) => ({
    ...r,
    verdicts: r.verdicts.map((v) => {
      const d = decisions.get(v.responseId);
      if (!d) return v;
      seen.add(v.responseId);
      if (d === v.outcome) return v;
      if (d === 'block') applied.toBlock++;
      else applied.toKeep++;
      return { ...v, outcome: d };
    }),
  }));
  for (const id of decisions.keys()) if (!seen.has(id)) applied.unknown.push(id);
  return { results: out, applied };
}

export interface ComplaintsSummary {
  eligible: number;
  notEligible: Record<IneligibleReason, number>;
  /** Blocked respondents whose text came from the arbiter rather than a template. */
  fromArbiter: number;
  /** Eligible rows left out because the profile requires a respondent token and there is none. */
  skippedNoToken: string[];
}

export interface ComplaintsOptions {
  /** Language of the texts; defaults to the profile's `language`, then `en`. */
  lang?: ComplaintLang;
  /** A built-in profile id (`generic`) or a profile parsed from a file. Default `generic`. */
  panel?: string | PanelProfile;
  /** responseId → Response, when a dataset was given; enables verbatim quotes and panel tokens. */
  responses?: Map<string, Response>;
}

/** One complaint per eligible blocked respondent, plus the reasons the others were left out. */
export function buildComplaints(
  results: SurveyResult[],
  opts: ComplaintsOptions,
): { rows: Complaint[]; summary: ComplaintsSummary } {
  const rows: Complaint[] = [];
  const profile = resolvePanelProfile(opts.panel);
  const lang = opts.lang ?? profile.language ?? 'en';
  const summary: ComplaintsSummary = {
    eligible: 0,
    notEligible: {
      not_blocked: 0,
      no_evidence: 0,
      speed_not_whole_survey: 0,
      internal_only: 0,
      ground_not_accepted: 0,
    },
    fromArbiter: 0,
    skippedNoToken: [],
  };
  for (const r of results) {
    for (const v of r.verdicts as ArbitratedVerdict[]) {
      const sel = selectGround(v, v.evidence, profile);
      if (!sel.ground) {
        if (sel.reason !== 'not_blocked') summary.notEligible[sel.reason]++;
        else if (v.outcome !== 'keep' || v.arbiter) summary.notEligible.not_blocked++;
        continue;
      }
      const response = opts.responses?.get(v.responseId);
      if (profile.requiresToken && !response?.panel?.token) {
        summary.skippedNoToken.push(v.responseId);
        continue;
      }
      const c = buildComplaint(v, v.evidence, {
        lang,
        panel: profile,
        response,
        panelText: v.panelText,
      });
      if (!c) continue;
      rows.push(c);
      summary.eligible++;
      if (v.panelText && c.text === v.panelText.replace(/\s+/g, ' ').trim()) summary.fromArbiter++;
    }
  }
  return { rows, summary };
}

function csvCell(s: string | number): string {
  const t = String(s);
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function toCsv(rows: Complaint[]): string {
  const lines = [CSV_HEADER];
  for (const c of rows) {
    lines.push(
      [c.responseId, c.panelToken ?? '', c.ground, c.code, c.text, c.chars].map(csvCell).join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function indexResponses(dataset: Dataset): Map<string, Response> {
  const m = new Map<string, Response>();
  for (const s of dataset) for (const r of s.responses) m.set(r.id, r);
  return m;
}

/** Read and validate a `--panel-profile` file; the message names the file and every problem. */
export function loadPanelProfile(path: string): PanelProfile {
  let raw: unknown;
  try {
    raw = readJson(path);
  } catch (err) {
    throw new Error(
      `${path}: cannot read panel profile (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  try {
    return parsePanelProfile(raw);
  } catch (err) {
    throw new Error(`${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function complaintsCommand(rest: string[], io: Io = consoleIo): number {
  const input = rest[0];
  if (!input || input.startsWith('--')) {
    io.err(COMPLAINTS_USAGE);
    io.err(PANEL_HELP);
    return input === '--help' ? 0 : 2;
  }
  const panelId = arg(rest, '--panel') ?? 'generic';
  if (!isPanelId(panelId)) {
    io.err(`--panel must be one of ${PANEL_IDS.join(', ')} (got "${panelId}")`);
    io.err(PANEL_HELP);
    return 2;
  }
  let profile: PanelProfile = GENERIC_PROFILE;
  const profilePath = arg(rest, '--panel-profile');
  if (profilePath) {
    try {
      profile = loadPanelProfile(profilePath);
    } catch (err) {
      io.err(err instanceof Error ? err.message : String(err));
      io.err('see adapters/panel-profiles/README.md for the profile format');
      return 2;
    }
  }
  const lang = arg(rest, '--lang') ?? profile.language ?? 'en';
  if (lang !== 'en' && lang !== 'ru') {
    io.err(`--lang must be en or ru (got "${lang}")`);
    return 2;
  }
  const out = arg(rest, '--out') ?? '.surveyquorum/complaints.csv';
  let results = readJson(input) as SurveyResult[];
  if (!Array.isArray(results)) {
    io.err(`${input}: expected the array written by "surveyquorum run"`);
    return 1;
  }
  const decisionsPath = arg(rest, '--decisions');
  if (decisionsPath) {
    let decisions: Map<string, Decision>;
    try {
      decisions = parseDecisions(readJson(decisionsPath));
    } catch (err) {
      io.err(`${decisionsPath}: ${err instanceof Error ? err.message : String(err)}`);
      return 1;
    }
    const applied = applyDecisions(results, decisions);
    results = applied.results;
    const a = applied.applied;
    io.err(
      `decisions: ${decisions.size} read; ${a.toBlock} changed to block (human confirmed), ` +
        `${a.toKeep} changed to keep (human kept)` +
        (a.unknown.length
          ? `; ${a.unknown.length} id(s) not in the verdicts: ${a.unknown.join(', ')}`
          : ''),
    );
  }
  const datasetPath = arg(rest, '--dataset');
  const responses = datasetPath ? indexResponses(parseDataset(readJson(datasetPath))) : undefined;

  const { rows, summary } = buildComplaints(results, { lang, panel: profile, responses });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toCsv(rows));

  const ne = summary.notEligible;
  io.err(
    `complaints: ${summary.eligible} eligible` +
      (summary.fromArbiter ? ` (${summary.fromArbiter} with arbiter text)` : '') +
      `; not eligible: ${ne.speed_not_whole_survey} speed without whole-survey time, ` +
      `${ne.internal_only} internal-only grounds, ${ne.no_evidence} without evidence, ` +
      `${ne.not_blocked} not blocked` +
      (profile.acceptedGrounds
        ? `, ${ne.ground_not_accepted} ground not accepted by this profile`
        : ''),
  );
  if (summary.skippedNoToken.length) {
    io.err(
      `${SKIPPED_NO_TOKEN}; ${summary.skippedNoToken.length} eligible row(s) without one: ` +
        summary.skippedNoToken.join(', '),
    );
  }
  io.err(
    `panel ${profile.id} (${profile.name}): ${profile.note ?? `${profile.maxChars} characters or less`}`,
  );
  if (!hasComplaintChannel(profile)) {
    io.err(
      'this profile accepts no grounds (no complaint channel); the file is for your own records.',
    );
  }
  if (!responses) {
    io.err(
      profile.requiresToken
        ? 'this profile requires a respondent token: pass --dataset <dataset.json> so panel_token can be filled.'
        : 'tip: pass --dataset <dataset.json> to quote questions verbatim and fill panel_token.',
    );
  }
  io.out(`${rows.length} complaint(s) written to ${out}`);
  return 0;
}
