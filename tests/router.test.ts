import { describe, expect, it } from "vitest";
import { exceedsApprovalThreshold, routeClaim } from "@/server/providers/router";
import type { Claim, JevSemanticResult } from "@/lib/types";

const baseClaim: Claim = {
  case_id: "FIN-0001",
  employee_description: "Team lunch with Acme Corp to discuss the Q4 renewal.",
  amount: 100,
  currency: "USD",
  attendee_count: 4,
  expense_date: "2026-01-15",
  merchant_or_vendor: "Bistro",
  submitted_category: "Business Meals",
  notes_or_context: null,
};

function semantic(overrides: Partial<{
  category: JevSemanticResult["expense_category"]["choice"];
  purpose: boolean;
  external: boolean;
  exception: boolean;
  level: number;
  human: boolean;
}> = {}): JevSemanticResult {
  const o = {
    category: "client_entertainment" as const,
    purpose: true,
    external: true,
    exception: false,
    level: 3,
    human: false,
    ...overrides,
  };
  return {
    expense_category: {
      choice: o.category,
      selected_probability: 0.9,
      confidence: 0.9,
      probabilities: { [o.category]: 0.9 },
    },
    has_business_purpose: { p_yes: o.purpose ? 0.9 : 0.1, value: o.purpose },
    has_external_party_identity: { p_yes: o.external ? 0.9 : 0.1, value: o.external },
    has_exception_explanation: { p_yes: o.exception ? 0.9 : 0.1, value: o.exception },
    explanation_quality: {
      score: o.level,
      level: o.level,
      confidence: 0.9,
      probabilities: { [String(o.level)]: 0.9 },
      tie: false,
    },
    requires_human_review: { p_yes: o.human ? 0.9 : 0.1, value: o.human },
  };
}

describe("routeClaim priority", () => {
  it("returns human_review first, overriding every other signal", () => {
    const result = routeClaim({
      claim: { ...baseClaim, amount: null, currency: null, expense_date: null },
      semantic: semantic({ human: true, purpose: false, level: 0 }),
    });
    expect(result).toBe("human_review");
  });

  it("returns request_more_information when a required field is missing", () => {
    for (const field of ["amount", "currency", "expense_date"] as const) {
      const claim = { ...baseClaim, [field]: null } as Claim;
      expect(routeClaim({ claim, semantic: semantic() })).toBe(
        "request_more_information",
      );
    }
  });

  it("returns request_more_information for insufficient_information category", () => {
    expect(
      routeClaim({ claim: baseClaim, semantic: semantic({ category: "insufficient_information" }) }),
    ).toBe("request_more_information");
  });

  it("returns request_more_information without a business purpose", () => {
    expect(routeClaim({ claim: baseClaim, semantic: semantic({ purpose: false }) })).toBe(
      "request_more_information",
    );
  });

  it("requires external party identity only for client_entertainment", () => {
    expect(
      routeClaim({ claim: baseClaim, semantic: semantic({ external: false }) }),
    ).toBe("request_more_information");
    // Same missing signal, different category: not a blocker.
    expect(
      routeClaim({
        claim: { ...baseClaim, amount: 50 },
        semantic: semantic({ category: "office_supplies", external: false }),
      }),
    ).toBe("auto_process");
  });

  it("returns request_more_information at explanation quality 0 and 1", () => {
    for (const level of [0, 1]) {
      expect(routeClaim({ claim: baseClaim, semantic: semantic({ level }) })).toBe(
        "request_more_information",
      );
    }
    expect(routeClaim({ claim: baseClaim, semantic: semantic({ level: 2 }) })).toBe(
      "auto_process",
    );
  });

  it("returns manager_approval over threshold or on an explained exception", () => {
    expect(
      routeClaim({
        claim: { ...baseClaim, amount: 400, attendee_count: 2 },
        semantic: semantic(),
      }),
    ).toBe("manager_approval");
    expect(
      routeClaim({ claim: baseClaim, semantic: semantic({ exception: true }) }),
    ).toBe("manager_approval");
  });

  it("returns auto_process for a clean in-policy claim", () => {
    expect(routeClaim({ claim: baseClaim, semantic: semantic() })).toBe("auto_process");
  });
});

describe("exceedsApprovalThreshold", () => {
  it("uses per-attendee limits for client_entertainment", () => {
    expect(
      exceedsApprovalThreshold({ amount: 244, attendee_count: 4 }, "client_entertainment"),
    ).toBe(true); // 61 per attendee
    expect(
      exceedsApprovalThreshold({ amount: 240, attendee_count: 4 }, "client_entertainment"),
    ).toBe(false); // exactly 60 is not "greater than"
  });

  it("falls back to a total limit for employee_welfare without attendees", () => {
    expect(
      exceedsApprovalThreshold({ amount: 301, attendee_count: null }, "employee_welfare"),
    ).toBe(true);
    expect(
      exceedsApprovalThreshold({ amount: 300, attendee_count: null }, "employee_welfare"),
    ).toBe(false);
  });

  it("never flags a missing amount", () => {
    expect(exceedsApprovalThreshold({ amount: null, attendee_count: 2 }, "travel")).toBe(
      false,
    );
  });

  it("applies each category total threshold", () => {
    const cases = [
      ["travel", 1200], ["transportation", 200], ["office_supplies", 500],
      ["marketing", 800], ["software_subscription", 1000], ["other", 1500],
    ] as const;
    for (const [category, limit] of cases) {
      expect(exceedsApprovalThreshold({ amount: limit, attendee_count: null }, category)).toBe(false);
      expect(exceedsApprovalThreshold({ amount: limit + 0.01, attendee_count: null }, category)).toBe(true);
    }
  });
});
