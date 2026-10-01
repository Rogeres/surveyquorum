import { cardsortConsensusDetector } from './cardsort-consensus/index.js';
import { coherenceDetector } from './coherence/index.js';
import { duplicateOpenDetector } from './duplicate-open/index.js';
import { firstclickOfftargetDetector } from './firstclick-offtarget/index.js';
import { massSelectDetector } from './mass-select/index.js';
import { matrixPatternDetector } from './matrix-pattern/index.js';
import { openAnswerDetector } from './open-answer/index.js';
import { paceDetector } from './pace/index.js';
import { prototypeEffortDetector } from './prototype-effort/index.js';
import type { Detector } from './types.js';
import { websiteBounceDetector } from './website-bounce/index.js';

/**
 * Detectors are registered explicitly so that the library stays tree-shakeable and the CLI can
 * list what is enabled. Statistical detectors run without any LLM; LLM detectors are appended
 * here as they land and are skipped automatically when no client is configured.
 */
export function defaultDetectors(): Detector[] {
  return [
    paceDetector,
    massSelectDetector,
    duplicateOpenDetector,
    prototypeEffortDetector,
    websiteBounceDetector,
    matrixPatternDetector,
    cardsortConsensusDetector,
    firstclickOfftargetDetector,
    // LLM detectors — skipped by runSurvey when no client is configured.
    openAnswerDetector,
    coherenceDetector,
  ];
}

export {
  cardsortConsensusDetector,
  coherenceDetector,
  duplicateOpenDetector,
  firstclickOfftargetDetector,
  massSelectDetector,
  matrixPatternDetector,
  openAnswerDetector,
  paceDetector,
  prototypeEffortDetector,
  websiteBounceDetector,
};
