# Screener fault catalog

25 faults a screener can have, one card each. Every card names the fault, what it breaks in the field, how to repair it, the exceptions, and a bad / good example. The cards are the source of truth: `reference.md` (what the skill reads), this index, `README.ru.md` and `evals/TAGS.md` are generated from them by `npm run catalog:build`. Russian index: [README.ru.md](README.ru.md).

| code | tag | fault |
|---|---|---|
| A1 | `no-screener` | [no screener, and a brief criterion is not covered by a hire target](A1-no-screener.md) |
| A2 | `no-exit` | [a filtering question with no way out](A2-no-exit.md) |
| A3 | `yes-no-gate` | [yes/no on the qualifying behavior](A3-yes-no-gate.md) |
| A4 | `topic-leak` | [the topic is revealed before the gate](A4-topic-leak.md) |
| A5 | `no-none` | [no honest option for the non-fit](A5-no-none.md) |
| A6 | `multi-no-limit` | [multi-select without a limit and without a ranking basis](A6-multi-no-limit.md) |
| A7 | `primary-question` | ["main" instead of "uses"](A7-primary-question.md) |
| A8 | `bad-order` | [details before behavior](A8-bad-order.md) |
| A9 | `vague-frequency` | [frequency as adverbs](A9-vague-frequency.md) |
| A10 | `criterion-mismatch` | [the screener condition differs from the brief](A10-criterion-mismatch.md) |
| A13 | `panel-profile-reasked` | [re-asking what the recruitment target verifies](A13-panel-profile-reasked.md) |
| A16 | `unmasked-intent` | [intent asked head-on](A16-unmasked-intent.md) |
| B2 | `no-randomization` | [a fixed-order list](B2-no-randomization.md) |
| B3 | `short-list` | [too few options around the target](B3-short-list.md) |
| B4 | `huge-list` | [thirty or more options](B4-huge-list.md) |
| C1 | `overlap` | [overlapping or gapped ranges](C1-overlap.md) |
| C2 | `leading` | [a presumption or a hint in the wording](C2-leading.md) |
| C3 | `jargon` | [jargon or a preamble](C3-jargon.md) |
| C4 | `double-barrelled` | [two criteria in one](C4-double-barrelled.md) |
| C5 | `instruction-mismatch` | [instruction contradicts the type](C5-instruction-mismatch.md) |
| C6 | `success-message` | [a "you qualify" screen](C6-success-message.md) |
| C7 | `format-defect` | [broken layout](C7-format-defect.md) |
| D2 | `long-screener` | [a long screener without a reason](D2-long-screener.md) |
| D5 | `logic-contradiction` | [a rule that passes everyone or no one](D5-logic-contradiction.md) |
| D6 | `body-contradiction` | [the body re-asks the screener](D6-body-contradiction.md) |
