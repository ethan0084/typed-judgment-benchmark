/**
 * Guards the scenario contract. The bundled scenario composes the normative
 * modules, so these tests fail if the config drifts away from the code that
 * actually runs, or if the advisory-integrity behaviour regresses.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import scenario from "@/config/expense-scenario";
import { jevQuestions } from "@/server/providers/jev-questions";
import { FINAL_DECISIONS } from "@/lib/types";
import { verifyIntegrity } from "@/server/data-source";

describe("bundled scenario config", () => {
  it("declares the same outcomes the rest of the app routes to", () => {
    expect([...scenario.outcomes]).toEqual([...FINAL_DECISIONS]);
  });

  it("documents every outcome it declares", () => {
    for (const outcome of scenario.outcomes) {
      expect(scenario.outcomeDescriptions[outcome]).toBeTruthy();
    }
  });

  it("uses the normative question spec rather than a copy", () => {
    expect(scenario.questions).toBe(jevQuestions);
  });

  it("names case_id first, since the loader treats it as the identifier", () => {
    expect(scenario.fields[0]?.name).toBe("case_id");
  });

  it("routes through the deterministic router", () => {
    const row = {
      case_id: "T-1",
      employee_description: "Client dinner with Acme",
      amount: 100,
      currency: "USD",
      attendee_count: 4,
      expense_date: "2026-01-01",
      merchant_or_vendor: "Restaurant",
      submitted_category: "Business Meals",
      notes_or_context: null,
    };
    const semantic = {
      expense_category: { choice: "client_entertainment", confidence: 0.9 },
      has_business_purpose: { value: true, confidence: 0.9 },
      has_external_party_identity: { value: true, confidence: 0.9 },
      has_exception_explanation: { value: false, confidence: 0.9 },
      explanation_quality: { level: 2, confidence: 0.9 },
      requires_human_review: { value: false, confidence: 0.9 },
    };
    // 100 / 4 = 25, under the 60 per-attendee threshold.
    expect(scenario.route({ row, semantic } as never)).toBe("auto_process");
  });
});

describe("advisory integrity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns null when the value matches", () => {
    expect(verifyIntegrity("Subject", "abc", "abc")).toBeNull();
  });

  it("skips the check when nothing is pinned", () => {
    expect(verifyIntegrity("Subject", "abc", undefined)).toBeNull();
  });

  it("warns instead of throwing on a mismatch", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const issue = verifyIntegrity("Custom row count", 7, 1000);
    expect(issue).toEqual({ subject: "Custom row count", expected: "1000", actual: "7" });
    expect(warn).toHaveBeenCalled();
  });

  it("throws on a mismatch under BENCHMARK_STRICT", () => {
    vi.stubEnv("BENCHMARK_STRICT", "1");
    expect(() => verifyIntegrity("Strict subject", 7, 1000)).toThrow(/mismatch/);
  });
});
