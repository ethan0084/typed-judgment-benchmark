import { describe, expect, it } from "vitest";
import {
  normalizeChoice, normalizeNoul, normalizeScore, NOUL_THRESHOLD,
} from "@/server/providers/jev-normalize";
import { deepseekCost, isPeak, jevCost, TARIFF_2026_09_20 } from "@/server/cost";
import { latencyStats, percentile, scoreProvider } from "@/server/scorer/score";
import type { GoldRow } from "@/server/scorer/gold-loader";
import type { TerminalResult } from "@/lib/types";

describe("Jev normalization", () => {
  it("keeps the full choice distribution and selected probability", () => {
    const result = normalizeChoice({
      choice: "travel", confidence: 0.81,
      probabilities: { travel: 0.7, transportation: 0.2, other: 0.1 },
    });
    expect(result.choice).toBe("travel");
    expect(result.selected_probability).toBe(0.7);
    expect(result.confidence).toBe(0.81);
    expect(result.probabilities).toEqual({ travel: 0.7, transportation: 0.2, other: 0.1 });
  });

  it("rejects an unknown category rather than coercing it", () => {
    expect(() =>
      normalizeChoice({ choice: "not_a_category", confidence: 1, probabilities: {} }),
    ).toThrow(/unknown expense category/);
  });

  it("keeps p_yes and never renames it confidence", () => {
    const yes = normalizeNoul({ noul: 0.73 });
    expect(yes).toEqual({ p_yes: 0.73, value: true });
    expect(Object.keys(yes)).not.toContain("confidence");
    expect(normalizeNoul({ noul: 0.49 }).value).toBe(false);
    // Threshold is inclusive at 0.5.
    expect(normalizeNoul({ noul: NOUL_THRESHOLD }).value).toBe(true);
  });

  it("rejects an out-of-range Noul probability", () => {
    expect(() => normalizeNoul({ noul: 1.4 })).toThrow(/out-of-range/);
  });

  it("picks the highest-probability score level", () => {
    const result = normalizeScore({
      score: 2.3, confidence: 0.6,
      probabilities: { "0": 0.05, "1": 0.15, "2": 0.6, "3": 0.2 },
    });
    expect(result.level).toBe(2);
    expect(result.score).toBe(2.3);
    expect(result.tie).toBe(false);
  });

  it("resolves a tie to the lower level and flags it", () => {
    const result = normalizeScore({
      score: 1.5, confidence: 0.4,
      probabilities: { "0": 0.1, "1": 0.4, "2": 0.4, "3": 0.1 },
    });
    expect(result.level).toBe(1);
    expect(result.tie).toBe(true);
  });
});

describe("cost", () => {
  it("prices Jev on input tokens only", () => {
    // 1M input tokens = $0.042; output is free.
    expect(jevCost({ input_tokens: 1_000_000, output_tokens: 500_000 })).toBeCloseTo(0.042, 10);
  });

  it("splits DeepSeek input into cache hit and miss", () => {
    const offPeak = new Date("2026-09-20T12:00:00Z"); // Sunday
    expect(isPeak(offPeak)).toBe(false);
    const cost = deepseekCost(
      { input_tokens: 1_000_000, cached_input_tokens: 400_000, output_tokens: 1_000_000 },
      offPeak,
    );
    // 400k hit @0.003/M + 600k miss @0.15/M + 1M out @0.6/M
    expect(cost).toBeCloseTo(0.0012 + 0.09 + 0.6, 10);
  });

  it("identifies the documented peak windows", () => {
    expect(isPeak(new Date("2026-09-21T02:00:00Z"))).toBe(true);  // Mon 02:00
    expect(isPeak(new Date("2026-09-21T07:00:00Z"))).toBe(true);  // Mon 07:00
    expect(isPeak(new Date("2026-09-21T05:00:00Z"))).toBe(false); // Mon 05:00 gap
    expect(isPeak(new Date("2026-09-19T02:00:00Z"))).toBe(false); // Sat: weekends are off-peak
    expect(isPeak(new Date("2026-09-18T02:00:00Z"))).toBe(true);  // Fri 02:00
    expect(isPeak(new Date("2026-09-21T10:00:00Z"))).toBe(false); // Mon 10:00, window is exclusive
  });

  it("charges nothing when usage is unavailable", () => {
    expect(jevCost(null)).toBe(0);
    expect(deepseekCost(null, new Date())).toBe(0);
  });

  it("uses the 2026-09-20 verified tariff", () => {
    expect(TARIFF_2026_09_20.tariff_id).toBe("tariff-2026-09-20");
    expect(TARIFF_2026_09_20.currency).toBe("USD");
  });
});

describe("scoring", () => {
  const gold = new Map<string, GoldRow>(
    (["auto_process", "human_review", "manager_approval", "request_more_information"] as const)
      .map((route, i) => [
        `FIN-000${i + 1}`,
        { case_id: `FIN-000${i + 1}`, expected_route: route } as GoldRow,
      ]),
  );

  function result(n: number, status: TerminalResult["status"], decision: string | null): TerminalResult {
    return {
      schema_version: 1, run_id: "r", provider: "jev", sequence: n - 1,
      case_id: `FIN-000${n}`, claim_payload_hash: "h", status,
      decision: decision as TerminalResult["decision"],
      started_at: "", finished_at: "", latency_ms: n * 100,
      provider_request_id: null, requested_model: "m", resolved_model: "m",
      usage: null, calculated_cost: { currency: "USD", amount: 0.01, tariff_id: "t" },
      jev_semantic: null, error: null,
    };
  }

  it("excludes failures from accuracy but counts them in coverage", () => {
    const results = [
      result(1, "succeeded", "auto_process"),      // correct
      result(2, "succeeded", "manager_approval"),  // wrong (gold human_review)
      result(3, "failed", null),
      result(4, "succeeded", "request_more_information"), // correct
    ];
    const score = scoreProvider(results, gold, 4);
    expect(score.succeeded).toBe(3);
    expect(score.failed).toBe(1);
    expect(score.scored).toBe(3);
    expect(score.correct).toBe(2);
    expect(score.accuracy).toBeCloseTo(2 / 3, 10);
    expect(score.coverage_adjusted_accuracy).toBe(0.5);
    expect(score.total_cost).toBeCloseTo(0.04, 10);
  });

  it("records the confusion matrix by expected then predicted", () => {
    const score = scoreProvider([result(2, "succeeded", "manager_approval")], gold, 1);
    expect(score.confusion.human_review!.manager_approval).toBe(1);
    expect(score.confusion.human_review!.human_review).toBe(0);
  });

  it("computes per-route precision and recall", () => {
    const score = scoreProvider(
      [result(1, "succeeded", "auto_process"), result(2, "succeeded", "auto_process")],
      gold, 2,
    );
    const auto = score.per_route.find((r) => r.route === "auto_process")!;
    expect(auto.predicted).toBe(2);
    expect(auto.true_positive).toBe(1);
    expect(auto.precision).toBe(0.5);
    expect(auto.recall).toBe(1);
  });

  it("computes nearest-rank percentiles", () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
    expect(percentile([1, 2, 3, 4], 95)).toBe(4);
    const stats = latencyStats([100, 200, 300]);
    expect(stats.avg_ms).toBe(200);
    expect(stats.p50_ms).toBe(200);
    expect(latencyStats([]).avg_ms).toBe(0);
  });
});
