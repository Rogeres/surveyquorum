# Example: complaints after a reviewed run

## Input

> "Draft the complaints for the kitchen survey. Verdicts in `.surveyquorum/verdicts.json`,
> dataset `data/kitchen-survey.json`, my decisions in `.surveyquorum/decisions.json`. The
> panel reads English; its complaint API wants our respondent token and a reason code, I
> have the profile file in `panels/my-panel.json`."

`decisions.json` holds 6 entries: 4 review -> block, 1 block -> keep, 1 review -> keep.

## Run

`panels/my-panel.json` (written from the panel's API documentation, named after the panel,
kept in the user's project — see `adapters/panel-profiles/README.md`):

```json
{
  "id": "my-panel",
  "name": "My panel",
  "requiresToken": true,
  "codes": { "nonsense_text": 1, "duplicate_text": 1, "template_pattern": 3, "speed_whole_survey": 4 },
  "note": "Token from the survey link, one numeric reason code, comment of 500 characters or less."
}
```

```
$ surveyquorum complaints .surveyquorum/verdicts.json --panel-profile panels/my-panel.json --lang en \
    --dataset data/kitchen-survey.json --decisions .surveyquorum/decisions.json \
    --out .surveyquorum/complaints.csv
decisions: 6 read; 4 changed to block (human confirmed), 2 changed to keep (human kept)
complaints: 12 eligible (5 with arbiter text); not eligible: 2 speed without whole-survey time,
4 internal-only grounds, 0 without evidence, 262 not blocked
skipped: profile requires a respondent token; 1 eligible row(s) without one: k-0288
panel my-panel (My panel): Token from the survey link, one numeric reason code, comment of 500 characters or less.
12 complaint(s) written to .surveyquorum/complaints.csv
```

The agent repeats the decisions line in words: "4 review verdicts you confirmed are now
candidates; the block you kept and the review you kept are excluded. 15 engine blocks + 4
confirmed - 1 kept = 18 candidates, 12 of them eligible." The verdicts file itself is
untouched. One eligible respondent (k-0288) was skipped because the dataset carries no panel
token for them and the profile requires one; the agent says so and suggests checking the
import mapping's `panelToken` column.

## CSV (first rows)

```
response_id,panel_token,ground,code,text,chars
k-0031,tk-8812,nonsense_text,1,"Non-informative open answer. Question: ""What did you cook most recently with the appliance?"" Answer: ""asdfgh"". The same respondent left similar text on one more open question.",171
k-0192,tk-4420,speed_whole_survey,4,"Whole survey completed in 96 s; cohort median 310 s (3 times faster). In that time the questions and answer options cannot be read.",131
k-0205,tk-1937,template_pattern,3,"Identical rating down the whole 6-row grid ""How satisfied are you with…"" in 7 s against a cohort median of 41 s.",118
k-0118,tk-7703,duplicate_text,1,"The same answer ""good product would buy again"" was given to 3 different open questions: ""What did you cook most recently with the appliance?"", ""What would you change about it?"", ""Any other comments?"".",196
```

## What the agent tells the user

- **12 complaints**, all under 500 characters (longest 212): 6 nonsense text, 3 whole-survey
  speed, 2 template grids, 1 duplicate text. Five texts come from the arbiter and already use
  the one-ground form. The `code` column carries the panel's reason codes from the profile
  file. The CSV carries `panel_token` only - no names or emails.
- **Not filed, 6 blocks:**
  - k-0260, k-0271 - fast on four and five single questions, but total time 190 s and 204 s
    against a 310 s median (ratio above 0.5). Panels judge the whole survey; these stand as
    blocks in your data only.
  - k-0144, k-0150, k-0163, k-0177 - mass-select on both multi-selects plus a contradiction
    with the screening profile. Real for your analysis, not a ground any panel recognizes.
- **Never filed:** the one review respondent you kept, and the 16 review respondents you did
  not decide on. If you want any of those filed, decide them in `quorum-screen` first.
- The profile says the API wants the token and one code per complaint; both are in the CSV.
  Attach the whole-survey time to the three speed complaints and the answer link where the
  form allows it. Filing is yours.
- When the panel answers, record `accepted` / `rejected` per `response_id` in
  `.surveyquorum/complaints.result.csv`; rejected grounds are what the complaint texts, `docs/panels.md`
  and the profile file's `note` and `acceptedGrounds` need.
