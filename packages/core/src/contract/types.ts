/**
 * Input contract v1 — the single data format between any survey export and the engine.
 *
 * Terminology
 * - Survey   — one questionnaire fielded to one cohort (a panel order, a link, an upload).
 *              Cohort statistics (speed, consensus, design artifacts) are computed per Survey.
 * - Response — one respondent's complete set of answers to the Survey.
 * - Block    — one question (or task) and the respondent's answer to it.
 *
 * This file is the source of truth for the format; `schema.ts` is its runtime validator and
 * the two are kept in sync by a compile-time drift guard at the bottom of `schema.ts`.
 */

/** A dataset is an array of surveys. */
export type Dataset = Survey[];

export interface Survey {
  /** Stable id of the survey in the source system. Any string. */
  id: string;
  /** Where respondents came from: a panel name, "link", "upload", … Any string. */
  source?: string;
  /** Human-readable description of the recruiting target (who was supposed to answer). */
  target?: string;
  /**
   * Inventory of questions from the survey definition, in survey order. Lets detectors
   * see questions that a respondent never reached (branching) and gives the coherence
   * detector a stable key per survey version. Optional: when absent, the inventory is
   * rebuilt from the answers.
   */
  inventory?: InventoryItem[];
  responses: Response[];
}

export interface InventoryItem {
  /** Screening question (declared profile) or body question. */
  scope: 'screening' | 'body';
  type: string;
  question: string;
  options?: string[];
}

export interface Response {
  /** Stable id of the response. Any string; the user decides whether it is personal. */
  id: string;
  /** "desktop", "mobile" or a more specific user-agent family. */
  device?: string;
  /** Body blocks in survey order. Screening answers go to `screening`, not here. */
  blocks: Block[];
  /** Cross-survey respondent key (device fingerprint, panel id). Optional. */
  fingerprint?: string;
  /** Declared profile: screening questions and the respondent's answers to them. */
  screening?: ScreeningAnswer[];
  /** Panel-side metadata, used when drafting a complaint. */
  panel?: PanelMeta;
  /** Ground-truth label when the dataset is used for calibration or tests. */
  label?: QualityLabel | null;
  /** Where the label came from. */
  labelSource?: LabelSource | null;
}

export interface ScreeningAnswer {
  question: string;
  answer: string[];
}

export interface PanelMeta {
  /** Respondent token in the panel's own system. */
  token?: string;
  age?: string;
  sex?: string;
}

/** Ground truth for calibration and tests. */
export type QualityLabel = 'good' | 'bad_targeting' | 'bad_content' | 'bad_coherence';
export type LabelSource = 'auto' | 'human';

// ----------------------------------------------------------------------------
// Blocks — the answer shape depends on the block type
// ----------------------------------------------------------------------------

export type Block =
  | ChoiceBlock
  | ScaleBlock
  | MatrixBlock
  | CardsortBlock
  | OpenTextBlock
  | FirstClickBlock
  | PrototypeBlock
  | WebsiteBlock
  | OtherBlock;

export type BlockType = Block['type'];

interface BlockBase {
  /** Stable per-question id from the source. Optional: flat exports may omit it. */
  blockId?: string;
  question: string;
  /** Seconds spent on the block. 0 when unknown. */
  duration: number;
}

/** Single or multiple choice. */
export interface ChoiceBlock extends BlockBase {
  type: 'choice';
  answer: string[];
  /** Full option list from the survey definition, when known. */
  options?: string[];
}

/** Rating scale. The answer is always a string ("5", "Strongly agree"). */
export interface ScaleBlock extends BlockBase {
  type: 'scale';
  answer: string;
}

/** Grid question: rows × columns. */
export interface MatrixBlock extends BlockBase {
  type: 'matrix';
  answer: Record<string, string[]>;
}

/** Card sorting: category → cards placed in it. */
export interface CardsortBlock extends BlockBase {
  type: 'cardsort';
  answer: Record<string, string[]>;
}

/**
 * Open text. The answer is a transcript in chronological order so that AI-moderated
 * follow-ups fit the same shape: a plain open question is a single `user` turn.
 */
export interface OpenTextBlock extends BlockBase {
  type: 'open';
  answer: OpenTurn[];
}

export interface OpenTurn {
  role: 'assistant' | 'user';
  text: string;
}

/** First-click test: normalized click coordinates (0–1). */
export interface FirstClickBlock extends BlockBase {
  type: 'firstclick';
  answer: { top: number; left: number };
}

/**
 * Interactive prototype task (Figma or similar).
 * - `gave_up`   — pressed "give up"
 * - `completed` — reached the goal screen
 * - `partial`   — left the task without either
 */
export interface PrototypeBlock extends BlockBase {
  type: 'prototype';
  status: 'gave_up' | 'completed' | 'partial';
  clickCount: number;
}

/** Live website task: the respondent was sent to a real site with a task. */
export interface WebsiteBlock extends BlockBase {
  type: 'website';
  gaveUp: boolean;
}

/**
 * Any other block type (ranking, NPS, max-diff, tree test, …). Kept so that duration counts
 * toward the respondent's total time and so the coherence detector sees that the block exists.
 */
export interface OtherBlock extends BlockBase {
  type: 'other';
  /** Original type name from the source system. */
  sourceType?: string;
  rawAnswer?: unknown;
}
