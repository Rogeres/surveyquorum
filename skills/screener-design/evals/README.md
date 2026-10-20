# Evals of the screener-design skill

Fourteen cases: anonymized twins of real screeners (brands and clients renamed, structure and faults kept), synthetic screeners written so that every one of the 25 catalog codes has at least one expected tag, a clean control, and traps built from the cards' exceptions (things that used to produce false alarms). The skill reviews the draft; graders check the machine `tags:` line and the repaired screener itself.

- `drafts/*.md` — the screener as the editor shows it (questions, options, logic, quotas, body outline).
- `cases/*.yaml` — one case: an optional `brief` (the audience as the researcher would state it; without it the skill reads the audience from the draft), which tags must be found (`expect`), which are false alarms (`reject`), which are acceptable extras (`tolerate`), how many extras are allowed (`maxExtra`), and what the repaired screener must keep (`mustKeep`) or must not invent (`mustNotAdd`).
- `lib/tags.mjs`, `lib/harm.mjs` — the graders; deterministic, no judge model.
- `prompts/review.mjs` — builds the system prompt from `SKILL.md` + `reference.md`; `providers/claude-cli.mjs` — runs it through the local `claude` CLI.

Run (repo root): `npm run eval:screener` (3 runs per case, 14 cases, ≈ 9 min at `-j 4`; the provider spawns the CLI asynchronously, so `-j` is real parallelism) · `npm run eval:screener -- --repeat 1` for a quick pass · `npm run eval:view` opens the web report of the last run. Baseline scores: `results/baseline.md`.

Adding a case: copy a draft, keep the editor format, rename every real client; list the expected tags from `TAGS.md`; run the suite twice and keep the case only if the pass is stable. Russian guide: `../catalog/CONTRIBUTING.ru.md`.
