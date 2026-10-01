import type { CardsortBlock, Survey } from '../../contract/types.js';
import { groupByQuestion } from '../shared/cohort.js';
import { logStats, logZ, mean, round, sd } from '../shared/stats.js';
import type { Detector, DetectorContext, Evidence, Strength } from '../types.js';

/** A card pair is decided when at least this share of the cohort put it in the same category … */
export const SAME_SHARE = 0.6;
/** … or at most this share did (the majority keeps the cards apart). */
export const DIFFERENT_SHARE = 0.4;
/** A pair is only judged when at least half the cohort placed both cards. */
export const PAIR_COVERAGE = 0.5;
/** Minimum decided pairs a respondent must have placed before agreement is computed. */
export const MIN_DECIDED_PAIRS = 5;
/** Agreement z at or below which the sort disagrees with the room. */
export const LOW_AGREEMENT_Z = -2;
/**
 * Agreement z at or below which the placement is random regardless of duration: this far from
 * the cohort's pair consensus on a whole task, a contrarian criterion no longer explains it
 * (Curran 2016; Meade & Craig 2012 — a whole-task pattern is strong on its own).
 */
export const RANDOM_AGREEMENT_Z = -2.5;
/** Duration log-z at or below which a low-agreement sort was also rushed. */
export const FAST_Z = -1;
/** Fewer cards than this in one pile is a plausible "I only see one group". */
export const SINGLE_PILE_MIN_CARDS = 6;
/** Share of the cohort that single-piled a task before the task, not the respondent, is blamed. */
export const SINGLE_PILE_COHORT_SHARE = 0.2;
/** Share of a respondent's category names that are empty / numeric / one character. */
export const UNNAMED_SHARE = 0.5;
/** Share of the cohort with unnamed categories on a task before the categories are seen as given. */
export const UNNAMED_COHORT_SHARE = 0.5;

/** card → category of the first category that lists it. */
export function cardPlacement(b: CardsortBlock): Map<string, string> {
  const m = new Map<string, string>();
  for (const [category, cards] of Object.entries(b.answer)) {
    for (const card of cards) {
      const c = card.trim();
      if (c !== '' && !m.has(c)) m.set(c, category);
    }
  }
  return m;
}

export function isUnnamedCategory(name: string): boolean {
  const n = name.trim();
  return n.length <= 1 || (n !== '' && Number.isFinite(Number(n)));
}

interface Candidate {
  signal: string;
  strength: Strength;
  rank: number;
  summary: string;
  stats: Evidence['stats'];
  index: number;
  designArtifact?: boolean;
}

/** Lower is stronger. Among weak signals the more specific explanation wins. */
const SIGNAL_RANK: Record<string, number> = {
  random_sort: 0,
  single_pile: 1,
  low_consensus: 2,
  unnamed_categories: 3,
};

export const cardsortConsensusDetector: Detector = {
  name: 'cardsort-consensus',
  needsLlm: false,
  detect(survey: Survey, ctx: DetectorContext): Evidence[] {
    const perResponse = new Map<string, Candidate[]>();
    const artifacts = new Map<string, Candidate[]>();
    const push = (map: Map<string, Candidate[]>, id: string, c: Candidate) => {
      const list = map.get(id) ?? [];
      list.push(c);
      map.set(id, list);
    };

    for (const [, cohort] of groupByQuestion(survey)) {
      const items = cohort.filter(
        (cb): cb is typeof cb & { block: CardsortBlock } => cb.block.type === 'cardsort',
      );
      if (items.length < ctx.minCohort) continue;
      const n = items.length;

      const placements = items.map((it) => cardPlacement(it.block));
      const cardSet = new Set<string>();
      for (const p of placements) for (const c of p.keys()) cardSet.add(c);
      const cards = [...cardSet].sort();
      const cardIndex = new Map(cards.map((c, i) => [c, i]));
      const C = cards.length;
      const pairId = (i: number, j: number) => (i < j ? i * C + j : j * C + i);

      const both = new Map<number, number>();
      const same = new Map<number, number>();
      for (const p of placements) {
        const ids = [...p.keys()].map((c) => cardIndex.get(c) as number);
        for (let a = 0; a < ids.length; a++) {
          for (let b = a + 1; b < ids.length; b++) {
            const id = pairId(ids[a], ids[b]);
            both.set(id, (both.get(id) ?? 0) + 1);
            if (p.get(cards[ids[a]]) === p.get(cards[ids[b]]))
              same.set(id, (same.get(id) ?? 0) + 1);
          }
        }
      }
      /** pair id → true when the majority keeps the pair together. */
      const decided = new Map<number, boolean>();
      for (const [id, k] of both) {
        if (k < n * PAIR_COVERAGE) continue;
        const share = (same.get(id) ?? 0) / k;
        if (share >= SAME_SHARE) decided.set(id, true);
        else if (share <= DIFFERENT_SHARE) decided.set(id, false);
      }

      const agreements: (number | null)[] = placements.map((p) => {
        const ids = [...p.keys()].map((c) => cardIndex.get(c) as number);
        let judged = 0;
        let matched = 0;
        for (let a = 0; a < ids.length; a++) {
          for (let b = a + 1; b < ids.length; b++) {
            const majority = decided.get(pairId(ids[a], ids[b]));
            if (majority === undefined) continue;
            judged++;
            if ((p.get(cards[ids[a]]) === p.get(cards[ids[b]])) === majority) matched++;
          }
        }
        return judged >= MIN_DECIDED_PAIRS ? matched / judged : null;
      });
      const decidedPairs = decided.size;
      const defined = agreements.filter((a): a is number => a !== null);
      const cohortMean = mean(defined);
      const cohortSd = sd(defined);
      const durations = logStats(items.map((it) => it.block.duration));

      const singlePiled = items.map((it, i) => {
        const nonEmpty = Object.values(it.block.answer).filter((cs) => cs.length > 0).length;
        return nonEmpty === 1 && placements[i].size >= SINGLE_PILE_MIN_CARDS;
      });
      const singlePileShare = singlePiled.filter(Boolean).length / n;
      const unnamed = items.map((it) => {
        const names = Object.keys(it.block.answer);
        if (names.length === 0) return false;
        return names.filter(isUnnamedCategory).length / names.length >= UNNAMED_SHARE;
      });
      const unnamedShare = unnamed.filter(Boolean).length / n;

      items.forEach((it, i) => {
        const id = it.response.id;
        const agreement = agreements[i];
        const base = {
          agreement: agreement === null ? null : round(agreement, 3),
          cohortMeanAgreement: round(cohortMean, 3),
          z: null as number | null,
          decidedPairs,
          cards: placements[i].size,
          categories: Object.keys(it.block.answer).length,
        };
        if (agreement !== null && cohortSd > 1e-9) {
          const z = (agreement - cohortMean) / cohortSd;
          base.z = round(z);
          // A single pile disagrees with every "apart" pair by construction; single_pile says it better.
          if (z <= LOW_AGREEMENT_Z && !singlePiled[i]) {
            const dz = logZ(it.block.duration, durations);
            const fast = dz <= FAST_Z;
            const farOff = z <= RANDOM_AGREEMENT_Z;
            const random = fast || farOff;
            const head = `Agreement with the cohort's card pairs is ${round(agreement * 100, 0)}% against a mean of ${round(cohortMean * 100, 0)}% (z ${round(z)})`;
            let summary = `${head} over ${decidedPairs} decided pairs.`;
            if (fast) {
              summary = `${head}, and the sort took a log-time z of ${round(dz)} — cards dropped at random.`;
            } else if (farOff) {
              summary = `${head} over ${decidedPairs} decided pairs — too far from the room for a contrarian criterion; cards dropped at random.`;
            }
            push(perResponse, id, {
              signal: random ? 'random_sort' : 'low_consensus',
              strength: random ? 'strong' : 'weak',
              rank: random ? SIGNAL_RANK.random_sort : SIGNAL_RANK.low_consensus,
              index: it.index,
              summary,
              stats: { ...base, durationZ: round(dz) },
            });
          }
        }
        if (singlePiled[i]) {
          const artifact = singlePileShare >= SINGLE_PILE_COHORT_SHARE;
          push(artifact ? artifacts : perResponse, id, {
            signal: artifact ? 'cohort_single_pile' : 'single_pile',
            strength: 'weak',
            rank: SIGNAL_RANK.single_pile,
            index: it.index,
            designArtifact: artifact || undefined,
            summary: artifact
              ? `All ${placements[i].size} cards in one category, like ${round(singlePileShare * 100, 0)}% of the cohort — the task or the cards invite a single pile.`
              : `All ${placements[i].size} cards were put in a single category.`,
            stats: { ...base, cohortSinglePileShare: round(singlePileShare, 3) },
          });
        }
        if (unnamed[i]) {
          const artifact = unnamedShare >= UNNAMED_COHORT_SHARE;
          push(artifact ? artifacts : perResponse, id, {
            signal: artifact ? 'cohort_unnamed_categories' : 'unnamed_categories',
            strength: 'weak',
            rank: SIGNAL_RANK.unnamed_categories,
            index: it.index,
            designArtifact: artifact || undefined,
            summary: artifact
              ? `Category names are empty, numeric or one character for ${round(unnamedShare * 100, 0)}% of the cohort — most likely given by the task, not typed.`
              : `${Object.keys(it.block.answer).filter(isUnnamedCategory).length} of ${base.categories} category names are empty, numeric or a single character.`,
            stats: { ...base, cohortUnnamedShare: round(unnamedShare, 3) },
          });
        }
      });
    }

    const evidence: Evidence[] = [];
    const toEvidence = (id: string, c: Candidate): Evidence => ({
      responseId: id,
      detector: 'cardsort-consensus',
      signal: c.signal,
      strength: c.strength,
      summary: c.summary,
      stats: c.stats,
      blocks: [c.index],
      ...(c.designArtifact ? { designArtifact: true } : {}),
    });
    for (const r of survey.responses) {
      const seen = new Set<string>();
      for (const c of artifacts.get(r.id) ?? []) {
        if (seen.has(c.signal)) continue;
        seen.add(c.signal);
        evidence.push(toEvidence(r.id, c));
      }
      const own = perResponse.get(r.id);
      if (!own || own.length === 0) continue;
      own.sort((a, b) => a.rank - b.rank || a.index - b.index);
      evidence.push(toEvidence(r.id, own[0]));
    }
    return evidence;
  },
};
