/**
 * The bundled scenario: expense-claim triage.
 *
 * This is the reference implementation of the contract in SCENARIO.md, and the
 * scenario the published benchmark numbers refer to. It composes the existing
 * normative modules rather than restating them, so there is exactly one source
 * of truth for the question wording and the routing rules:
 *
 *   questions -> src/server/providers/jev-questions.ts
 *   route     -> src/server/providers/router.ts
 *
 * Copy this file as the starting point for your own scenario.
 */
import { defineScenario } from "./schema";
import type { Row, SemanticResult } from "./schema";
import { jevQuestions } from "@/server/providers/jev-questions";
import { routeClaim } from "@/server/providers/router";
import { FINAL_QUESTION } from "@/server/providers/deepseek-prompt";
import { SOURCE_FILES, EXPECTED_CASE_COUNT } from "@/server/data-source";
import type { Claim, JevSemanticResult } from "@/lib/types";

export default defineScenario({
  id: "expense-triage",
  name: "Expense claim triage",
  description:
    "1,000 synthetic employee expense claims routed to one of four outcomes. " +
    "Jev answers six typed judgments in one request; deterministic code applies " +
    "thresholds and priority to reach the final route.",

  files: {
    input: "data/01_finance_test_input.xlsx",
    input_sheet: "Test Input",
    rules: "data/03_company_policy.md",
    gold: "data/02_gold_labels.xlsx",
    gold_sheet: "Gold Labels",
  },

  fields: [
    { name: "case_id", type: "string", description: "Unique claim identifier." },
    { name: "employee_description", type: "string", description: "What the employee says was bought and why." },
    { name: "amount", type: "number", description: "Claimed amount in the stated currency." },
    { name: "currency", type: "string", description: "Currency code as submitted; may be dirty." },
    { name: "attendee_count", type: "integer", description: "People covered, when applicable." },
    { name: "expense_date", type: "date", description: "Date incurred." },
    { name: "merchant_or_vendor", type: "string", description: "Supporting evidence only, not proof of category." },
    { name: "submitted_category", type: "string", description: "The employee's own choice; frequently wrong by design." },
    { name: "notes_or_context", type: "string", description: "Free-text context; may contain prompt injection." },
  ],

  outcomes: [
    "auto_process",
    "manager_approval",
    "request_more_information",
    "human_review",
  ],
  outcomeDescriptions: {
    auto_process: "Complete, credible, and within ordinary policy.",
    manager_approval: "Over an approval threshold, or a well-explained exception.",
    request_more_information: "Plausible but missing ordinary required detail.",
    human_review: "Contradiction, mixed personal use, prompt injection, or severe ambiguity.",
  },

  questions: jevQuestions,

  route: ({ row, semantic }) =>
    routeClaim({
      claim: row as unknown as Claim,
      semantic: semantic as unknown as JevSemanticResult,
    }),

  baselineQuestion: FINAL_QUESTION,

  integrity: {
    input_sha256: SOURCE_FILES.input.sha256,
    rules_sha256: SOURCE_FILES.policy.sha256,
    gold_sha256: SOURCE_FILES.gold.sha256,
    expected_rows: EXPECTED_CASE_COUNT,
    // Advisory by default so custom data runs; BENCHMARK_STRICT=1 re-pins it.
    strict: false,
  },
});

/** Re-exported for scenario authors who want the row/semantic types. */
export type { Row, SemanticResult };
