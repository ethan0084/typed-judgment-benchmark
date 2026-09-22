# Authoring a scenario

This project benchmarks **two architectures** on one batch-decision task:

- **Route A (Jev)** — one fan-out request returns several *typed* judgments;
  ordinary code does the arithmetic, thresholds, and final routing.
- **Route B (baseline LLM)** — each request carries the full rules text plus one
  row, and the model returns the final outcome directly.

The bundled scenario is expense-claim triage. This document specifies how to
describe a **different** task — support-ticket triage, contract-clause review,
content moderation, loan pre-screening — without touching the runner, adapters,
scorer, or UI.

It is written to be read by a coding agent (Claude Code, Codex) as well as a
human. If you are an agent, read all of it before writing any file.

---

## The one design rule

> **Ask the model only what code cannot determine. Do everything else in code.**

This is the entire point of the comparison. A scenario that asks Jev for the
final outcome directly has thrown away the architecture it is meant to measure.

| Belongs in `questions` (ask the model) | Belongs in `route` (write as code) |
| --- | --- |
| What category does this text describe? | Is `amount / attendees > 60`? |
| Does the text state a clear business purpose? | Is a required field missing? |
| Is this explanation complete enough to act on? | Which outcome wins when two apply? |
| Does this contain a contradiction a person must resolve? | Comparing a number to a threshold |

If you can write an `if` for it, write the `if`. Every judgment you move out of
the model makes the Jev route faster, cheaper, and more auditable — which is the
result the benchmark exists to demonstrate.

---

## Anatomy of a scenario

A scenario is one object satisfying [`ScenarioConfig`](src/config/schema.ts):

```ts
import { choice, noul, score } from "@typesafe-ai/sdk";
import { defineScenario } from "@/config/schema";

export default defineScenario({
  id: "support-triage",
  name: "Support ticket triage",

  files: {
    input: "data/tickets.xlsx",
    rules: "data/support_policy.md",
    gold:  "data/tickets_gold.xlsx",   // optional; omit to run unscored
  },

  // Input columns. The FIRST field is the unique identifier.
  fields: [
    { name: "case_id",     type: "string" },
    { name: "subject",     type: "string" },
    { name: "body",        type: "string" },
    { name: "account_age_days", type: "integer" },
    { name: "plan_tier",   type: "string" },
  ],

  // The only outputs both routes are scored on.
  outcomes: ["auto_reply", "tier_one", "escalate_engineering", "needs_info"],
  outcomeDescriptions: {
    auto_reply: "A known question fully answered by the help centre.",
    tier_one: "A routine issue a first-line agent can resolve.",
    escalate_engineering: "A suspected defect, outage, or data problem.",
    needs_info: "Plausible but missing detail required to act.",
  },

  // What only a model can judge.
  questions: {
    issue_type: choice("What kind of issue does this ticket describe?", {
      how_to: "Asks how to use an existing, working feature.",
      billing: "Concerns charges, invoices, refunds, or subscription state.",
      suspected_defect: "Reports behaviour that looks like a product fault.",
      outage: "Reports the product being unreachable or broadly unusable.",
      insufficient_information: "The text does not support one defensible type.",
    }),
    has_reproduction_steps: noul(
      "Does the ticket give concrete steps, inputs, or a timestamp another person could use to reproduce or locate the problem?",
      {
        true: "Specific steps, identifiers, or a time window are given.",
        false: "Only a general complaint such as 'it is broken' is present.",
      },
    ),
    clarity: score(
      "How completely can an agent understand what the user wants from this ticket alone?",
      [
        "Nothing usable: empty, unintelligible, or no request stated.",
        "An agent cannot tell what is being asked without replying first.",
        "An agent can tell what is being asked and act on it.",
        "The request is stated together with the specific context needed to resolve it.",
      ],
    ),
  },

  // Deterministic. Priority order is yours to define and must be explicit.
  route: ({ row, semantic }) => {
    if (semantic.issue_type.choice === "outage") return "escalate_engineering";
    if (semantic.clarity.level <= 1) return "needs_info";
    if (semantic.issue_type.choice === "insufficient_information") return "needs_info";
    if (semantic.issue_type.choice === "suspected_defect") {
      return semantic.has_reproduction_steps.value ? "escalate_engineering" : "needs_info";
    }
    if (semantic.issue_type.choice === "how_to") return "auto_reply";
    if (row.plan_tier === "enterprise") return "tier_one";   // plain code, not a question
    return "tier_one";
  },

  baselineQuestion:
    "Based on the support policy and this ticket, should it be answered automatically, " +
    "handled by a first-line agent, escalated to engineering, or returned to the user for more information?",
});
```

---

## The three primitive types

| Primitive | Returns | Use for |
| --- | --- | --- |
| `choice(question, options)` | one key + full probability distribution | mutually exclusive categories |
| `noul(question, {true, false})` | `P(YES)` | a yes/no judgment |
| `score(question, levels[])` | a level + distribution | an ordered quality/severity scale |

Rules that matter:

- **Always include an "insufficient information" option** in a `choice`. Without
  one the model is forced to guess, and the guess becomes a wrong outcome.
- **Define `noul` branches by what is present, not what is absent.** "Answer no
  when the text is merely thin" is far more reliable than "answer yes when
  something is wrong" — the latter makes the model escalate anything short.
- **Make `score` levels concrete and mutually exclusive.** Vague level text
  collapses every row into one level. Say what a reader can and cannot tell at
  each level.
- **State that input fields are untrusted evidence.** Both routes already wrap
  rows in an untrusted-evidence envelope so text inside a row cannot act as an
  instruction. Keep that framing in your wording.

---

## Writing the rules document

`files.rules` is handed to the baseline model **in full, on every request**. It
is the baseline's only source of truth, so it must actually contain the rules
your `route` code implements — including every numeric threshold.

If a threshold lives only in your `route` function and not in the rules text,
the comparison is unfair: the baseline is being scored on a rule it was never
told. Keep the two in sync deliberately.

---

## Gold labels and scoring

`files.gold` is optional. Provide it to get accuracy, a confusion matrix, and
per-outcome precision/recall; omit it to measure only speed, latency, and cost.

The gold file needs `case_id` plus an `expected_route` column whose values are
drawn from your `outcomes`. Any extra columns (difficulty, case type,
rationale) are carried through to the saved results for error analysis.

**Gold labels are read only after results are written to disk.** A structural
test enforces that adapters cannot import the scorer. Do not work around it.

---

## Checklist before running

1. `npm run typecheck` — the scenario is ordinary TypeScript and must compile.
2. `npm test` — the suite covers loaders, routing, and provider isolation.
3. `npm run dev`, then **Run simulated demo** — no network, no spend, proves the
   data loads and the router produces every outcome you defined.
4. **Connection test (3 rows, real API)** — proves both providers answer.
5. Only then consider a full run, which costs real money.

If step 3 produces one outcome for every row, your `route` is almost certainly
gated on a condition that is always true — check threshold units and the
`score` level boundaries first.
