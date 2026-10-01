# duplicate-open

The same text pasted into different open questions by one respondent. Three distinct
questions with one substantive text is the strong signal; two is weak (a sincere "see above"
happens). Repeated placeholder answers are weak on their own.

## How

Each open block's last `user` turn is normalized: lower-case, trimmed, whitespace collapsed,
trailing punctuation stripped. Texts in the `NON_ANSWER` list ("no", "none", "nothing", "n/a",
"idk", "don't know", "нет", "не знаю", "ничего", "затрудняюсь ответить", "норм", "ок", "ok") are
placeholders and are counted separately whatever their length; any other text shorter than
3 characters is ignored.

For each respondent, every substantive normalized text maps to the set of **distinct question
keys** (`blockKey`) it appears on. The text with the most keys decides the signal.

| signal | strength | when |
| --- | --- | --- |
| `x3` | strong | one substantive text on >= 3 distinct open questions |
| `x2` | weak | one substantive text on exactly 2 distinct open questions |
| `empty_repeat` | weak | placeholder answers on >= 3 distinct open questions (only when no `x2`/`x3`) |
| `cohort_same_answer` | weak, `designArtifact: true` | the respondent gives a text that >= 30% of the cohort gives on that question |

One non-artifact Evidence per respondent (`x3` > `x2` > `empty_repeat`); `cohort_same_answer`
is emitted once and lists the affected blocks, which are excluded from every count.

`stats`: `nQuestions, textLength` (`x2`/`x3`), `nQuestions` (`empty_repeat`),
`nArtifactBlocks, maxCohortShare` (artifact).

## Blind spots

- Exact match after normalization only. Paraphrases, typos and "same text plus one word" are
  not caught; that is the LLM open-answer detector's job.
- Two related questions ("What did you like?" / "Why?") legitimately attract the same text;
  hence `x2` is weak.
- Only the respondent's last turn of a transcript is compared; a moderated follow-up that
  repeats an earlier turn in the same block is invisible.
- The detector stays silent on surveys where no open question reaches `minCohort`, because the
  design-artifact check needs a cohort; it therefore misses tiny surveys.
- The `NON_ANSWER` list is finite; "nope", "-" and emoji are not recognized as placeholders.

## Design artifacts

A question where >= 30% of the cohort types the same text ("yes", a brand name the previous
question asked about, the city the survey was fielded in) is asking for one answer. Each such
(question, text) pair is reported as `cohort_same_answer` and dropped from the counts so that a
respondent is not blamed for an answer the question invites.
