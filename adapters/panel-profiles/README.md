# Panel profiles — telling `complaints` what your panel's form wants

`surveyquorum complaints` ships one built-in profile, `generic`: one ground per respondent,
500 characters or less, no reason codes, no token requirement. Everything a particular panel
needs on top of that — reason codes, a mandatory respondent token, a shorter field, a list of
grounds it accepts — goes into a small JSON file you pass with `--panel-profile`:

```bash
surveyquorum complaints verdicts.json --panel-profile my-panel.json --dataset dataset.json
```

**Name your file after your panel; the repository ships no vendor-specific profile.** The two
files here are examples of the two shapes we have met in practice, with invented names.

## Fields

| Field             | Type                                   | Default | Meaning |
|-------------------|----------------------------------------|---------|---------|
| `id`              | string                                 | —       | required; short identifier printed in the CLI summary |
| `name`            | string                                 | —       | required; human-readable name of the panel or profile |
| `maxChars`        | positive integer                       | `500`   | hard cap of the comment field; texts are cut at a word boundary to fit |
| `requiresToken`   | boolean                                | `false` | the form needs the respondent token (`response.panel.token`, filled from `--dataset`); eligible rows without one are reported as `skipped: profile requires a respondent token` and left out of the CSV |
| `codes`           | object: ground → string or number      | `{}`    | reason code per ground; fills the CSV `code` column. Grounds without a code get an empty cell |
| `acceptedGrounds` | array of grounds                       | all     | grounds the panel accepts. A ground not listed is reported as `ground not accepted by this profile`. `[]` means the panel has no complaint channel at all: every row is ineligible and the CLI says the file is for your own records |
| `note`            | string                                 | —       | one factual line shown in the CLI summary: what the form wants, where to file |
| `language`        | `"en"` \| `"ru"`                       | `"en"`  | language the panel's moderators read; the default for `--lang` |

Unknown fields are rejected, so a misspelt key cannot silently turn into "accept everything".

The grounds are the engine's four (`docs/panels.md`): `nonsense_text`, `duplicate_text`,
`template_pattern`, `speed_whole_survey`.

## The two examples

**`coded-api.example.json`** — a panel whose complaint API wants the respondent token and a
numeric reason code. Codes: `1` non-informative open answer (also used for the same text on
three or more questions, since the panel has no separate code for repeats), `3` template in a
rating grid, `4` speedster. Rows without a `panel_token` are skipped, so run with `--dataset`.

**`records-only.example.json`** — a crowdsourcing marketplace with no complaint channel.
`acceptedGrounds: []` makes every row ineligible; the CSV documents what was blocked and why,
for the client's own records and replacement negotiations, not for submission.

## Writing yours

1. Copy the example closer to your panel and rename it (`<your-panel>.json`).
2. Read the panel's complaint form or API documentation: field size, reason codes, whether
   the respondent id from the survey link is mandatory, which grounds it lists.
3. Fill the fields; delete the ones you do not need. Keep `note` factual — it is what the
   person filing sees.
4. Run `complaints` with `--panel-profile` and read the summary: the line `panel <id> (<name>)`
   repeats your note; the `not eligible` counts tell you how many bans the profile excludes.

Keep the file next to your other project files, not in this repository: a profile names a
panel, and this repository stays vendor-neutral.
