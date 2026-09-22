/**
 * Shared domain contract. See docs/07_api_and_data_contracts.md.
 * This module is safe to import from both server and browser code:
 * it contains types and constants only, never secrets or provider clients.
 */

export const FINAL_DECISIONS = [
  "auto_process",
  "manager_approval",
  "request_more_information",
  "human_review",
] as const;

export type FinalDecision = (typeof FINAL_DECISIONS)[number];

export const EXPENSE_CATEGORIES = [
  "client_entertainment",
  "travel",
  "transportation",
  "office_supplies",
  "marketing",
  "employee_welfare",
  "software_subscription",
  "other",
  "insufficient_information",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ProviderId = "jev" | "deepseek";

/**
 * One normalized input row. Every field is untrusted employee-provided
 * evidence. Missing and dirty values are intentional benchmark cases and
 * must never be repaired toward the gold answer.
 */
export type Claim = {
  case_id: string;
  employee_description: string | null;
  amount: number | null;
  currency: string | null;
  attendee_count: number | null;
  expense_date: string | null;
  merchant_or_vendor: string | null;
  submitted_category: string | null;
  notes_or_context: string | null;
};

/** Field order is part of the contract: it feeds claim_payload_hash. */
export const CLAIM_FIELD_ORDER = [
  "case_id",
  "employee_description",
  "amount",
  "currency",
  "attendee_count",
  "expense_date",
  "merchant_or_vendor",
  "submitted_category",
  "notes_or_context",
] as const satisfies readonly (keyof Claim)[];

export type ChoiceAnswer = {
  choice: ExpenseCategory;
  selected_probability: number;
  confidence: number;
  probabilities: Record<string, number>;
};

/**
 * Noul exposes probability of yes and no separate confidence field.
 * `p_yes` must never be relabelled as confidence.
 */
export type NoulAnswer = {
  p_yes: number;
  value: boolean;
};

export type ScoreAnswer = {
  score: number;
  level: number;
  confidence: number;
  probabilities: Record<string, number>;
  /** True when two levels tied for highest probability and the lower won. */
  tie: boolean;
};

export type JevSemanticResult = {
  expense_category: ChoiceAnswer;
  has_business_purpose: NoulAnswer;
  has_external_party_identity: NoulAnswer;
  has_exception_explanation: NoulAnswer;
  explanation_quality: ScoreAnswer;
  requires_human_review: NoulAnswer;
};

export type ResultStatus = "succeeded" | "failed" | "unknown";

export type ErrorCategory =
  | "timeout"
  | "provider"
  | "invalid_output"
  | "case_mismatch"
  | "interrupted";

export type TerminalResult = {
  schema_version: 1;
  run_id: string;
  provider: ProviderId;
  sequence: number;
  case_id: string;
  claim_payload_hash: string;
  status: ResultStatus;
  decision: FinalDecision | null;
  started_at: string;
  finished_at: string;
  latency_ms: number;
  provider_request_id: string | null;
  requested_model: string;
  resolved_model: string | null;
  usage: Record<string, number> | null;
  calculated_cost: {
    currency: "USD" | "CNY";
    amount: number;
    tariff_id: string;
  } | null;
  jev_semantic: JevSemanticResult | null;
  error: {
    category: ErrorCategory;
    code: string | null;
    safe_message: string;
  } | null;
};

export function isFinalDecision(value: unknown): value is FinalDecision {
  return (
    typeof value === "string" &&
    (FINAL_DECISIONS as readonly string[]).includes(value)
  );
}
