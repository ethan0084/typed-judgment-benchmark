# Expense Decision Benchmark — Jev vs. DeepSeek Flash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)


video:https://x.com/Ethan0084/status/2102346614073602243
*[中文版](README.zh-CN.md)*

Two AI architectures process the same 1,000 expense claims and must produce the
same business output: one of four routing decisions. The app runs both side by
side in real time and reports speed, latency, cost, and accuracy.

This is a benchmark of **architectures**, not of raw model quality:

| | Left — Jev (TypeSafe) | Right — DeepSeek Flash |
| --- | --- | --- |
| **Approach** | One fan-out request returns six *typed* judgments; ordinary code does the arithmetic, thresholds, and final routing | Each request carries the full company policy plus one claim; the model returns the final decision directly |
| **Model output** | `Choice` / `Noul` / `Score` with native probabilities | Natural-language reasoning → final answer |
| **Who decides** | Deterministic code | The model |

Both routes read the same input file in the same order, send exactly one API
request per claim, run at concurrency 1, and start from a shared barrier — then
advance independently, so the faster route never waits for the slower one.

## The shared task

> Given the company policy and this claim, how should it be processed?

Exactly four outcomes are allowed, and both routes are scored on this single output:

| Outcome | Meaning |
| --- | --- |
| `auto_process` | Complete, credible, within ordinary policy |
| `manager_approval` | Over a threshold, or a well-explained exception |
| `request_more_information` | Plausible but missing ordinary required detail |
| `human_review` | Contradiction, mixed personal use, prompt injection, or severe ambiguity |

## What is and isn't held equal

An honest architecture comparison has to say what it equalizes and what it
deliberately does not. This is **not** a "same prompt, two models" speed test.

**Held identical**

- The same 1,000 claims, in the same order, answering the same final question
  with the same four allowed outcomes.
- Exactly one physical API attempt per claim, per provider.
- Concurrency 1 on each side, released by a shared start barrier.
- Neither route can see gold labels.
- Both are scored against the same `expected_route`.

**Deliberately different — this is the thing being measured**

- Jev gets questions a developer decomposed in advance, plus ordinary code;
  the baseline gets the full human-readable policy.
- Jev returns intermediate typed judgments; the baseline returns only a final
  decision.
- Input token counts, internal computation, and output shape differ by design.

Any report of these results must state these differences. The claim being
tested is that *decomposing a task into typed judgments plus deterministic code*
is faster and cheaper at equal accuracy — not that one model is smarter.

## Quick start

```bash
npm install
cp .env.example .env.local   # add your two API keys; .env.local is gitignored
npm run dev                  # http://localhost:3000
```

Requires **Node.js >= 20**.

Two safe entry points on the page need no credentials or spending:

- **Run simulated demo** — no network calls at all, for inspecting the UI.
  Results are conspicuously marked and never count as benchmark data.
- **Connection test (3 claims, real API)** — real calls, for connectivity only.

A full 1,000-claim live run costs real money and requires an explicit
confirmation flag; it is never triggered by accident.

### Getting API keys

| Variable | Where to get it |
| --- | --- |
| `TYPESAFE_API_KEY` | [TypeSafe AI](https://typesafe.ai) — the Jev model |
| `DEEPSEEK_API_KEY` | [DeepSeek Platform](https://platform.deepseek.com) |

Keys are read only in [`src/server/env.ts`](src/server/env.ts), which exposes a
presence-only boolean to the browser and redacts anything key-shaped from error
messages. Keys are never logged, serialized, or sent to the client.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` / `build` / `start` | Develop, build, serve |
| `npm run lint` / `typecheck` | ESLint, TypeScript |
| `npm test` | Vitest suite (66 tests) |
| `npm run inspect -- <run_id>` | Read-only audit of a run, incl. resume dry-run |
| `npm run score -- <run_id>` | Score a finished run (refuses demo runs) |

## Output

Each run writes to `runs/<run_id>/`:

- `manifest.json` — written atomically once before the run, then immutable.
  Records input/gold/policy SHA-256 hashes, model versions, and the frozen tariff.
- `results.jev.jsonl` / `results.deepseek.jsonl` — append-only terminal records
- `summary.json` — produced by scoring

`runs/` is gitignored, so your own results stay local.

## Using it for your own task

The benchmark ships with expense-claim triage, but the architecture comparison
is the point — not the domain. Two paths:

**Same shape, your own rows.** Drop in your own workbook. Columns are matched
**by name**, so extra columns and a different order are fine. Hash and
row-count checks become warnings, and the run manifest records
`dataset: "custom"` so results are never confused with published figures.

```bash
BENCHMARK_STRICT=1 npm test   # re-pin exact hashes for the published benchmark
```

**A different domain** — support tickets, contract clauses, moderation. Write a
scenario config describing your columns, typed judgments, routing code, and
outcomes. Nothing in the runner, adapters, scorer, or UI changes.

See **[SCENARIO.md](SCENARIO.md)** for the authoring guide, and
[`src/config/expense-scenario.ts`](src/config/expense-scenario.ts) for a working
reference implementation.

### With a coding agent

[CLAUDE.md](CLAUDE.md) (and [AGENTS.md](AGENTS.md) for Codex and others) gives
agents the project's boundaries, the cost controls, and the one design rule
that keeps the comparison meaningful. Opening the repo in Claude Code or Codex
and describing your task is enough to get a scenario drafted:

> Read SCENARIO.md and write a scenario for triaging our support tickets.
> The columns are in data/tickets.xlsx.

The design rule agents are told to enforce: **ask the model only what code
cannot determine.** A scenario that asks Jev for the final outcome directly has
thrown away the architecture being measured.

## Project layout

```
src/
  config/         Scenario contract + the bundled expense scenario
  app/            Next.js UI and API routes (run, status, stream)
  server/
    providers/    Jev + DeepSeek adapters, prompt, router
    scorer/       Gold-label loading and scoring (post-hoc only)
    run/          Runner, controller, manifest, store
  lib/            Shared types, events, i18n
data/             Input claims, gold labels, company policy
docs/             Specs, contracts, metrics, decision log
tests/            Vitest suite, incl. isolation/leakage tests
```

## Data

All benchmark data is **synthetic**. "Harborstone Group" is a fictional company,
and the 1,000 claims contain no real people, vendors, or transactions.

- `data/01_finance_test_input.xlsx` — model-visible claim inputs (1,000 rows)
- `data/02_gold_labels.xlsx` — scoring labels, read only after results land
- `data/03_company_policy.md` — policy and judgment definitions

## Integrity boundaries

These are enforced by tests, not just convention:

- Gold labels are readable only by `src/server/scorer/` after results are
  persisted; adapters cannot import them (structural test).
- DeepSeek never sees Jev's private decomposition, intermediate questions, or
  gold labels (9 leakage tests).
- DeepSeek's chain of thought is never stored or displayed — only the public
  reasoning-token count from `usage`.
- Automatic retries are disabled for formal runs; failures are recorded as-is.
- API keys exist only in server-side environment variables.
- No fabricated probabilities, latencies, costs, or accuracy figures. Simulated
  mode is always labeled.

## Status

Implementation is complete and verified; typecheck and all 66 tests pass. The
repository ships no scored 1,000-claim run — run one yourself to generate
`summary.json`, and treat any published figures as reproducible only under the
tariff recorded in that run's `manifest.json`.

Further reading: [`docs/`](docs/README.md) explains why the benchmark is built
this way — the typed-judgment design, metrics definitions, data dictionary, run
persistence, and a decision log that records the changes which measured *worse*
and were rolled back.

## License

[MIT](LICENSE)
