import type { Response } from '../contract/types.js';
import type { PanelProfile } from './panels.js';

/** The grounds panels recognise. Everything else stays an internal rejection. */
export type ComplaintGround =
  | 'nonsense_text'
  | 'duplicate_text'
  | 'template_pattern'
  | 'speed_whole_survey';

export type ComplaintLang = 'en' | 'ru';

export interface Complaint {
  responseId: string;
  ground: ComplaintGround;
  /** Panel-facing text: one ground, numbers included, ≤ maxChars. */
  text: string;
  chars: number;
  eligible: true;
  /** Panel reason code for the ground from the profile's `codes`; empty when it has none. */
  code: string;
  /** Respondent token in the panel's system, when the response carried one. */
  panelToken?: string;
}

/**
 * Why no complaint is built. `internal_only` = the evidence is real but not a ground panels
 * accept; `ground_not_accepted` = a ground the chosen profile's `acceptedGrounds` leaves out.
 */
export type IneligibleReason =
  | 'not_blocked'
  | 'no_evidence'
  | 'speed_not_whole_survey'
  | 'internal_only'
  | 'ground_not_accepted';

export interface ComplaintOptions {
  lang?: ComplaintLang;
  /** A built-in profile id (`generic`) or a profile parsed from a file. Default `generic`. */
  panel?: string | PanelProfile;
  /** Hard cap; default = the profile's field size (500). */
  maxChars?: number;
  /** The respondent's answers, when the caller has them: lets the text quote questions verbatim. */
  response?: Response;
  /** Arbiter text to prefer over the template when present and within the cap. */
  panelText?: string;
}
