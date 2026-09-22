# Agent instructions

This repository keeps its agent guidance in **[CLAUDE.md](CLAUDE.md)**.
Read that file — it applies to Codex, Cursor, and any other coding agent, not
just Claude Code.

Two things to know before you touch anything:

1. **A full run costs real money** (2,000 paid API calls). Never start one on
   your own initiative. Use demo mode, which makes no network calls.
2. **Several boundaries are enforced by tests** — gold-label isolation, no
   cross-route prompt leakage, no retries, no fabricated numbers. If one of
   those tests fails, the change is wrong, not the test.

For adapting the benchmark to your own task, see **[SCENARIO.md](SCENARIO.md)**.
