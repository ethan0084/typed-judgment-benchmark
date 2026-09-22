/**
 * Deterministic policy code. Jev supplies semantic judgments; THIS file owns
 * the final route. Pure and side-effect free so it can be unit tested without
 * a network. Normative source: docs/06_jev_decision_design.md sections 6 and 7.
 */
import type { Claim, ExpenseCategory, FinalDecision, JevSemanticResult } from "@/lib/types";

/** Manager-approval thresholds in the claim's stated currency. No FX conversion. */
export const APPROVAL_THRESHOLDS = {
  client_entertainment: { perAttendee: 60 },
  employee_welfare: { perAttendee: 40, totalWhenNoAttendees: 300 },
  travel: { total: 1200 },
  transportation: { total: 200 },
  office_supplies: { total: 500 },
  marketing: { total: 800 },
  software_subscription: { total: 1000 },
  other: { total: 1500 },
} as const;

export function exceedsApprovalThreshold(
  claim: Pick<Claim, "amount" | "attendee_count">,
  category: ExpenseCategory,
): boolean {
  const amount = claim.amount;
  if (amount == null) return false;
  const attendees = claim.attendee_count;

  switch (category) {
    case "client_entertainment": {
      // Only applies when attendee count is available.
      if (attendees == null || attendees <= 0) return false;
      return amount / attendees > APPROVAL_THRESHOLDS.client_entertainment.perAttendee;
    }
    case "employee_welfare": {
      if (attendees == null || attendees <= 0) {
        return amount > APPROVAL_THRESHOLDS.employee_welfare.totalWhenNoAttendees;
      }
      return amount / attendees > APPROVAL_THRESHOLDS.employee_welfare.perAttendee;
    }
    case "travel":
      return amount > APPROVAL_THRESHOLDS.travel.total;
    case "transportation":
      return amount > APPROVAL_THRESHOLDS.transportation.total;
    case "office_supplies":
      return amount > APPROVAL_THRESHOLDS.office_supplies.total;
    case "marketing":
      return amount > APPROVAL_THRESHOLDS.marketing.total;
    case "software_subscription":
      return amount > APPROVAL_THRESHOLDS.software_subscription.total;
    case "other":
      return amount > APPROVAL_THRESHOLDS.other.total;
    case "insufficient_information":
      // Never reached: handled earlier by request_more_information.
      return false;
  }
}

/**
 * Final route. Priority is normative and must not be reordered:
 * human_review > request_more_information > manager_approval > auto_process.
 */
export function routeClaim(input: {
  claim: Claim;
  semantic: JevSemanticResult;
}): FinalDecision {
  const { claim, semantic } = input;

  if (semantic.requires_human_review.value) {
    return "human_review";
  }

  const category = semantic.expense_category.choice;

  if (
    claim.amount == null ||
    claim.currency == null ||
    claim.expense_date == null ||
    category === "insufficient_information" ||
    !semantic.has_business_purpose.value ||
    (category === "client_entertainment" &&
      !semantic.has_external_party_identity.value) ||
    semantic.explanation_quality.level <= 1
  ) {
    return "request_more_information";
  }

  if (
    exceedsApprovalThreshold(claim, category) ||
    semantic.has_exception_explanation.value
  ) {
    return "manager_approval";
  }

  return "auto_process";
}
