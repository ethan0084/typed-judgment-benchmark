import { describe, expect, it } from "vitest";
import { loadClaims } from "@/server/input-loader";
import { loadPolicy } from "@/server/policy-loader";
import { loadGold } from "@/server/scorer/gold-loader";
import { SOURCE_FILES, EXPECTED_CASE_COUNT } from "@/server/data-source";
import { claimPayloadHash } from "@/server/hash";

describe("input loader", () => {
  it("loads 1,000 unique claims in workbook order with the audited hash", async () => {
    const { claims, file_sha256 } = await loadClaims();
    expect(claims).toHaveLength(EXPECTED_CASE_COUNT);
    expect(file_sha256).toBe(SOURCE_FILES.input.sha256);
    expect(claims[0]!.case_id).toBe("FIN-0001");
    expect(claims.at(-1)!.case_id).toBe("FIN-1000");
    expect(new Set(claims.map((c) => c.case_id)).size).toBe(EXPECTED_CASE_COUNT);
  });

  it("preserves intentional missing and dirty values", async () => {
    const { claims } = await loadClaims();
    const counts = {
      description: claims.filter((c) => c.employee_description === null).length,
      amount: claims.filter((c) => c.amount === null).length,
      currency: claims.filter((c) => c.currency === null).length,
      attendees: claims.filter((c) => c.attendee_count === null).length,
      date: claims.filter((c) => c.expense_date === null).length,
      merchant: claims.filter((c) => c.merchant_or_vendor === null).length,
      category: claims.filter((c) => c.submitted_category === null).length,
      notes: claims.filter((c) => c.notes_or_context === null).length,
    };
    // Exact counts from docs/02_data_dictionary.md.
    expect(counts).toEqual({
      description: 9, amount: 19, currency: 17, attendees: 660,
      date: 24, merchant: 48, category: 31, notes: 35,
    });
    expect(claims.filter((c) => c.currency === "US$")).toHaveLength(7);
  });

  it("normalizes dates to ISO without shifting them", async () => {
    const { claims } = await loadClaims();
    const dated = claims.filter((c) => c.expense_date !== null);
    expect(dated).toHaveLength(EXPECTED_CASE_COUNT - 24);
    for (const claim of dated) {
      expect(claim.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(claims[0]!.expense_date).toBe("2026-08-03");
    const years = new Set(dated.map((c) => c.expense_date!.slice(0, 4)));
    expect([...years].sort()).toEqual(["2025", "2026"]);
  });

  it("produces a stable, field-sensitive claim hash", async () => {
    const { claims } = await loadClaims();
    const first = claims[0]!;
    expect(claimPayloadHash(first)).toBe(claimPayloadHash({ ...first }));
    expect(claimPayloadHash(first)).not.toBe(
      claimPayloadHash({ ...first, amount: (first.amount ?? 0) + 1 }),
    );
  });
});

describe("policy loader", () => {
  it("loads the policy and matches the audited hash", async () => {
    const policy = await loadPolicy();
    expect(policy.sha256).toBe(SOURCE_FILES.policy.sha256);
    expect(policy.text.length).toBeGreaterThan(200);
  });

  it("contains no Jev or benchmark implementation detail", async () => {
    const { text } = await loadPolicy();
    for (const term of ["Noul", "systemOne", "TypeSafe", "Jev", "gold", "benchmark"]) {
      expect(text).not.toContain(term);
    }
  });
});

describe("gold loader", () => {
  it("loads 1,000 labels matching the input case IDs exactly", async () => {
    const { byCaseId, file_sha256 } = await loadGold();
    const { claims } = await loadClaims();
    expect(file_sha256).toBe(SOURCE_FILES.gold.sha256);
    expect(byCaseId.size).toBe(EXPECTED_CASE_COUNT);
    for (const claim of claims) {
      expect(byCaseId.has(claim.case_id)).toBe(true);
    }
  });

  it("matches the documented expected_route distribution", async () => {
    const { byCaseId } = await loadGold();
    const counts: Record<string, number> = {};
    for (const row of byCaseId.values()) {
      counts[row.expected_route] = (counts[row.expected_route] ?? 0) + 1;
    }
    expect(counts).toEqual({
      human_review: 396,
      request_more_information: 214,
      manager_approval: 168,
      auto_process: 222,
    });
  });
});
