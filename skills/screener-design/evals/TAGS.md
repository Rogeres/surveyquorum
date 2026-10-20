# Screener fault codes

Closed vocabulary of the optional `tags:` line of the screener-design review output and of the eval graders. The line is produced only when the request asks for machine-readable tags; a person reads "What to fix and why" in words instead. One tag per fault, anchored to a question position of the draft: `multi-no-limit@S3`, `body-contradiction@B4`, or `no-screener@screener` / `long-screener@screener` for the draft as a whole; `none` when nothing is wrong. Generated from `../catalog/` by `npm run catalog:build`; the code is the card's id, the slug is the tag.

| code | slug | fault |
|---|---|---|
| `A1` | no-screener | no screener, and a brief criterion is not covered by a hire target |
| `A2` | no-exit | a filtering question with no way out |
| `A3` | yes-no-gate | yes/no on the qualifying behavior |
| `A4` | topic-leak | the topic is revealed before the gate |
| `A5` | no-none | no honest option for the non-fit |
| `A6` | multi-no-limit | multi-select without a limit and without a ranking basis |
| `A7` | primary-question | "main" instead of "uses" |
| `A8` | bad-order | details before behavior |
| `A9` | vague-frequency | frequency as adverbs |
| `A10` | criterion-mismatch | the screener condition differs from the brief |
| `A13` | panel-profile-reasked | re-asking what the recruitment target verifies |
| `A16` | unmasked-intent | intent asked head-on |
| `B2` | no-randomization | a fixed-order list |
| `B3` | short-list | too few options around the target |
| `B4` | huge-list | thirty or more options |
| `C1` | overlap | overlapping or gapped ranges |
| `C2` | leading | a presumption or a hint in the wording |
| `C3` | jargon | jargon or a preamble |
| `C4` | double-barrelled | two criteria in one |
| `C5` | instruction-mismatch | instruction contradicts the type |
| `C6` | success-message | a "you qualify" screen |
| `C7` | format-defect | broken layout |
| `D2` | long-screener | a long screener without a reason |
| `D5` | logic-contradiction | a rule that passes everyone or no one |
| `D6` | body-contradiction | the body re-asks the screener |
