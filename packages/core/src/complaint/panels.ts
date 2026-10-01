/**
 * Panel profiles: what a panel's complaint form needs and how a ground maps onto its reason
 * codes. The repository ships exactly one built-in profile, `generic`; everything specific to
 * a panel lives in a JSON file the user passes with `--panel-profile` (format below, examples
 * in `adapters/panel-profiles/`). No panel or vendor is named anywhere in this repository.
 */
import { z } from 'zod';
import type { ComplaintGround, ComplaintLang } from './types.js';

/** Every ground, in the order the engine prefers them (see `selectGround`). */
export const COMPLAINT_GROUNDS = [
  'nonsense_text',
  'duplicate_text',
  'template_pattern',
  'speed_whole_survey',
] as const satisfies readonly ComplaintGround[];

/** Built-in profile ids. `--panel` accepts these; anything else comes from a profile file. */
export const PANEL_IDS = ['generic'] as const;
export type PanelId = (typeof PANEL_IDS)[number];

/** Default hard cap of a panel comment field. */
export const PANEL_DEFAULT_MAX_CHARS = 500;

const groundSchema = z.enum(COMPLAINT_GROUNDS);

/**
 * A profile file, as the user writes it. Unknown keys are rejected so that a typo
 * (`acceptedGround`) does not silently turn into "accept everything".
 */
export const panelProfileSchema = z
  .object({
    /** Short identifier, used in the CLI summary. Name it after your panel. */
    id: z.string().min(1),
    /** Human-readable name of the panel or of the profile. */
    name: z.string().min(1),
    /** Hard cap of the comment field; the text is cut at a word boundary to fit it. */
    maxChars: z.number().int().positive().default(PANEL_DEFAULT_MAX_CHARS),
    /** The complaint form needs the respondent token from the survey link; rows without one are skipped. */
    requiresToken: z.boolean().optional(),
    /** Reason code per ground, as the form expects it. Grounds without a code get an empty cell. */
    codes: z.record(groundSchema, z.union([z.string(), z.number()])).optional(),
    /** Grounds the panel accepts. Omit = all four; `[]` = no complaint channel at all. */
    acceptedGrounds: z.array(groundSchema).optional(),
    /** One factual line shown in the CLI summary (what the form wants, where to file). */
    note: z.string().optional(),
    /** Language the panel's moderators read; the CLI default for `--lang`. */
    language: z.enum(['en', 'ru']).optional(),
  })
  .strict();

export type PanelProfileInput = z.input<typeof panelProfileSchema>;

/** A normalised profile: defaults applied, codes as strings. */
export interface PanelProfile {
  id: string;
  name: string;
  maxChars: number;
  requiresToken: boolean;
  codes: Partial<Record<ComplaintGround, string>>;
  /** Undefined = every ground is accepted; an empty list = no complaint channel. */
  acceptedGrounds?: ComplaintGround[];
  note?: string;
  language?: ComplaintLang;
}

export const GENERIC_PROFILE: PanelProfile = {
  id: 'generic',
  name: 'Generic panel',
  maxChars: PANEL_DEFAULT_MAX_CHARS,
  requiresToken: false,
  codes: {},
  note: 'One ground per respondent, 500 characters or less; no reason codes, no token required.',
};

export const PANELS: Record<PanelId, PanelProfile> = { generic: GENERIC_PROFILE };

export function isPanelId(s: string): s is PanelId {
  return (PANEL_IDS as readonly string[]).includes(s);
}

/** Validate a profile file and apply the defaults. Throws an `Error` listing every problem. */
export function parsePanelProfile(raw: unknown): PanelProfile {
  const parsed = panelProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => {
      const path = i.path.length ? i.path.join('.') : '(root)';
      return `${path}: ${i.message}`;
    });
    throw new Error(`invalid panel profile: ${problems.join('; ')}`);
  }
  const p = parsed.data;
  const codes: Partial<Record<ComplaintGround, string>> = {};
  for (const [ground, code] of Object.entries(p.codes ?? {})) {
    if (code !== undefined) codes[ground as ComplaintGround] = String(code);
  }
  const out: PanelProfile = {
    id: p.id,
    name: p.name,
    maxChars: p.maxChars,
    requiresToken: p.requiresToken ?? false,
    codes,
  };
  if (p.acceptedGrounds) out.acceptedGrounds = [...new Set(p.acceptedGrounds)];
  if (p.note) out.note = p.note;
  if (p.language) out.language = p.language;
  return out;
}

/** A built-in id, a parsed profile, or nothing → the profile to use (default `generic`). */
export function resolvePanelProfile(panel?: string | PanelProfile): PanelProfile {
  if (!panel) return GENERIC_PROFILE;
  if (typeof panel === 'string') return isPanelId(panel) ? PANELS[panel] : GENERIC_PROFILE;
  return panel;
}

/** True when the profile accepts complaints on this ground. */
export function acceptsGround(profile: PanelProfile, ground: ComplaintGround): boolean {
  return !profile.acceptedGrounds || profile.acceptedGrounds.includes(ground);
}

/** True when the profile has no complaint channel at all (`acceptedGrounds: []`). */
export function hasComplaintChannel(profile: PanelProfile): boolean {
  return !profile.acceptedGrounds || profile.acceptedGrounds.length > 0;
}

/** The panel's reason code for a ground; empty when the profile defines none. */
export function codeFor(profile: PanelProfile, ground: ComplaintGround): string {
  return profile.codes[ground] ?? '';
}
