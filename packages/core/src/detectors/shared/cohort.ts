import type { Block, Response, Survey } from '../../contract/types.js';

/**
 * A stable key that identifies "the same question" across respondents: the source block id
 * when present, else the question text with whitespace collapsed. Branching surveys mean not
 * every respondent reaches every question, so cohorts are built per key, not per index.
 */
export function blockKey(b: Block): string {
  return b.blockId ?? `q:${b.question.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export interface CohortBlock {
  response: Response;
  /** Index into `response.blocks`. */
  index: number;
  block: Block;
}

/** Group every block in the survey by question key. Preserves survey order of first appearance. */
export function groupByQuestion(survey: Survey): Map<string, CohortBlock[]> {
  const groups = new Map<string, CohortBlock[]>();
  for (const response of survey.responses) {
    response.blocks.forEach((block, index) => {
      const key = blockKey(block);
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push({ response, index, block });
    });
  }
  return groups;
}

/** Total seconds a respondent spent across all blocks with a known duration. */
export function totalDuration(r: Response): number {
  let s = 0;
  for (const b of r.blocks) if (Number.isFinite(b.duration) && b.duration > 0) s += b.duration;
  return s;
}

/** Text of the respondent's last turn in an open block, trimmed. Empty when no user turn exists. */
export function openText(b: Block): string {
  if (b.type !== 'open') return '';
  for (let i = b.answer.length - 1; i >= 0; i--) {
    if (b.answer[i].role === 'user') return b.answer[i].text.trim();
  }
  return '';
}
