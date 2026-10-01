# Demo dataset

Synthetic demo data for surveyquorum: three fictional surveys, 100 responses each, with a
known persona behind every response. **Everything here is invented** — the brands, the
questions, the options, the cards, every open answer and every respondent. Nothing was taken
from a real survey, a real panel or a real person.

## Files

| File | What it is |
|------|------------|
| `generate.ts` | The generator. Seeded PRNG (mulberry32, seed `20261001`); two runs produce byte-identical output. |
| `demo-dataset.json` | A `Dataset` in the input contract (`packages/core/src/contract/types.ts`): three surveys with `inventory`, `target`, and per-response `label` / `labelSource: "auto"`. |
| `demo-ground-truth.json` | `{ "<responseId>": { "persona", "label" } }` for all 300 responses. |
| `demo-answers.csv` | The same answers as a flat long-form CSV (`survey_id,response_id,block_id,question_type,question,answer,duration_sec`, RFC 4180), one row per block — the generic flat-long layout; `convert` recognises this header on its own (`--preset flat-long` makes it explicit), so `convert examples/demo-answers.csv --out dataset.json` brings it back into the input contract (minus `inventory`, `target`, screening answers and labels, which the CSV does not carry). |

Durations are seconds, log-normal around a per-question typical time, scaled by a per-respondent
pace habit, so the honest majority is genuinely spread out.

## Surveys

### `demo-ux` — Marrow, a fictional grocery-delivery app

15 blocks: 2 prototype tasks, 3 first-click tasks, 1 website task, 4 open questions, 3 scales,
2 choice questions.

Planted design artifact: the second prototype task (`ux-q07`) **fails to load** for 12 honest
respondents — `gave_up`, 0 clicks, 3–8 s — and their next open answer says so. They are labelled
`good`; a detector that bans on "gave up fast" alone should see this as a cohort-level artifact,
not twelve offenders.

### `demo-consumer` — Kettlebird, a fictional snack brand

18 blocks: 3 matrices (6 rows × 5-point agreement), a run of 6 scale questions, 4 multi-select
questions with 8–12 options, 3 open questions, 2 single-choice questions.

Planted design artifact: `co-q13` ("Have you tried the new Sea Salt & Thyme flavour?") is an
open question that should have been a choice question — about 60% of honest respondents answer
a one-word "Yes" / "No". Short-answer heuristics must not treat that as low effort.

### `demo-b2b` — fictional small-business owners

Target: owners or co-owners of businesses with 2–50 employees who decide on software purchases.
Every response carries 3 screening answers (role, company size, software decided in the last
year). Body: 11 blocks — 1 card sort (12 back-office tools into 3–5 named groups), 4 open
questions including an experience verifier ("Describe the last software purchase you decided
on…"), 4 choice questions, 2 scales.

Planted coherence fault: the `imposter` persona passes screening as an owner with 2–50 staff,
then writes "I'm a student" / "I don't have a company" / "not applicable" in the body.

## Persona mix

| Persona | Label | ux | consumer | b2b | Behaviour |
|---------|-------|---:|---------:|----:|-----------|
| `honest` | good | 71 | 71 | 68 | Varied pace, substantive invented answers (8–40 words), sensible matrices, card sorts near a hidden grouping with 1–3 cards moved |
| `honest_profane` | good | 3 | 3 | 2 | Honest, with a mild swear in 1–2 on-topic answers |
| `honest_dont_know` | good | 3 | 3 | 3 | Honest, 1–2 open answers are "don't know" / "no opinion" |
| `honest_single_outlier` | good | 3 | 3 | 3 | Honest, one non-open block answered in about 1 s |
| `speedster` | bad_content | 6 | 6 | 6 | Every block at 15–30% of typical time, 1–3-word open answers, flat matrices |
| `copy_paster` | bad_content | 4 | 4 | 4 | One 5–8-word sentence pasted into every open question |
| `gibberish` | bad_content | 3 | 3 | 3 | Keyboard mash or a bare number in every open question |
| `straightliner` | bad_content | – | 4 | – | Flat or zigzag matrices, identical scale run, near-normal speed |
| `mass_selector` | bad_content | – | 3 | – | Ticks 80–100% of options on every multi-select, fast on those blocks |
| `give_upper` | bad_content | 4 | – | – | Both prototypes `gave_up` with 0 clicks in 2–5 s, website bounce, "it was easy" |
| `same_spot_clicker` | bad_content | 3 | – | – | Identical coordinates on all first-click tasks, 1.5–3 s each |
| `random_sorter` | bad_content | – | – | 5 | Cards scattered randomly over 3–5 groups, fast |
| `imposter` | bad_coherence | – | – | 6 | Passes screening as an owner; body answers reveal no business |

Offenders carry only the signals their persona describes; the rest of their answers look
ordinary, so no single detector separates the cohort trivially.

## Regenerate

```bash
npm run examples:generate      # or: npx tsx examples/generate.ts
```

Runs in well under a second, validates the output with `parseDataset`, prints the persona
counts per survey and overwrites the three data files. Change `SEED` in `generate.ts` to get a
different but equally reproducible cohort.
