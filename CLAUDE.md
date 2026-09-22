# Working in this repository

Guidance for coding agents (Claude Code, Codex, Cursor). Humans should read
[README.md](README.md) first, then [SCENARIO.md](SCENARIO.md).

## What this project is

A benchmark comparing **two architectures** on one batch-decision task over
1,000 rows:

- **Jev route** — one fan-out request returns six *typed* judgments
  ([`jev-questions.ts`](src/server/providers/jev-questions.ts)); deterministic
  code in [`router.ts`](src/server/providers/router.ts) owns the final decision.
- **DeepSeek route** — every request carries the full policy plus one claim and
  returns the final decision directly.

Both are scored on the same single output: one of four routes.

This is a benchmark of *architectures*, not of model quality. Preserving that
comparison matters more than any individual improvement.

## The most common request: "make this work for my own data"

Two different asks — confirm which one before editing:

**(a) Same shape, different rows** — their own expense claims, same nine
columns. No code change. Point `data/01_finance_test_input.xlsx` at their file
(columns match by name; extra columns and reordering are fine). Hash and
row-count checks will warn, not fail, and the run manifest records
`dataset: "custom"`.

**(b) A different domain** — tickets, contracts, moderation. Read
[SCENARIO.md](SCENARIO.md) in full and write a scenario config. Do not edit the
runner, adapters, scorer, or UI; if you find yourself doing so, the scenario
abstraction is missing something — say so rather than working around it.

When writing questions for (b), enforce the design rule in SCENARIO.md: ask the
model only what code cannot determine. A scenario that asks Jev for the final
outcome directly defeats the benchmark. Push back if the user requests that.

## Hard boundaries — enforced by tests, do not work around

These have dedicated tests. If one fails, the change is wrong, not the test.

- **Gold isolation.** `src/server/scorer/` is importable only after results are
  written. Adapters must never import it ([`isolation.test.ts`](tests/isolation.test.ts)).
- **No cross-route leakage.** The DeepSeek prompt must never contain Jev's
  decomposition, question names, thresholds, gold data, another claim, or a
  previous answer (9 tests in [`deepseek-prompt.test.ts`](tests/deepseek-prompt.test.ts)).
- **No chain-of-thought storage.** Keep only the public reasoning-token count.
- **No retries in formal runs.** Failures are recorded as-is. Do not add retry
  logic to make a run "look better".
- **Secrets stay server-side.** Only [`env.ts`](src/server/env.ts) reads keys; it
  returns presence booleans and redacts key-shaped text from errors. Never log,
  serialize, or send a key to the browser.
- **Never fabricate numbers.** No invented probabilities, latencies, costs, or
  accuracy. Demo mode must stay conspicuously labelled.

## Spending money

A full run makes 2,000 paid API calls. Never start one on your own initiative.

Safe by default: `mode: "demo"` (no network) and the 3-claim connection test.
A live run requires `mode: "live"` **and** `confirm: true`. Do not add a code
path that bypasses that flag, and do not run one to "verify" a change — use
demo mode.

## Verifying a change

```bash
npm run typecheck
npm test            # 57 tests
npm run dev         # then use "Run simulated demo" — no network, no spend
```

For data or scoring changes, `npm run inspect -- <run_id>` audits a run
read-only.

To re-enable the published benchmark's strict pinning (exact hashes and row
count), set `BENCHMARK_STRICT=1`. Leave it unset when working with custom data.

## Repository map

```
src/config/schema.ts        Scenario contract (see SCENARIO.md)
src/server/providers/
  jev-questions.ts          The six typed judgments — wording is normative
  router.ts                 Deterministic routing and thresholds
  deepseek-prompt.ts        Baseline prompt; leakage-tested
  jev-normalize.ts          Typed results -> semantic result
src/server/run/             Runner, controller, manifest, append-only store
src/server/scorer/          Gold loading and scoring — POST-HOC ONLY
src/server/input-loader.ts  Column-name-matched loader, advisory validation
data/                       Synthetic input, gold labels, policy
docs/                       Design docs; README.md indexes them, 05_decision_log.md records why
```

## Conventions

- TypeScript strict; no `any` in new code.
- Server-only modules import `"server-only"` at the top.
- Normalization never repairs dirty data toward the expected answer — missing
  and malformed values are intentional test cases.
- Record a non-obvious decision in [`docs/05_decision_log.md`](docs/05_decision_log.md)
  with its reason, including measurements that came out negative.
