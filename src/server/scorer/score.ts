import "server-only";
import {
  FINAL_DECISIONS,
  type FinalDecision,
  type TerminalResult,
} from "@/lib/types";
import type { GoldRow } from "./gold-loader";

/**
 * Scoring. Consumes ONLY durably written TerminalResults plus gold labels.
 * Gold enters here and nowhere earlier in the pipeline.
 */

export type LatencyStats = { avg_ms: number; p50_ms: number; p95_ms: number };

export function latencyStats(samples: number[]): LatencyStats {
  if (samples.length === 0) return { avg_ms: 0, p50_ms: 0, p95_ms: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, value) => acc + value, 0);
  return {
    avg_ms: sum / sorted.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
  };
}

/** Nearest-rank percentile on an ascending array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedAsc.length);
  const index = Math.min(sortedAsc.length, Math.max(1, rank)) - 1;
  return sortedAsc[index]!;
}

export type RouteMetrics = {
  route: FinalDecision;
  support: number;
  predicted: number;
  true_positive: number;
  precision: number;
  recall: number;
};

export type ProviderScore = {
  total_cases: number;
  succeeded: number;
  failed: number;
  unknown: number;
  scored: number;
  correct: number;
  incorrect: number;
  /** correct / scored — excludes failures. */
  accuracy: number;
  /** correct / total_cases — failures count against the provider. */
  coverage_adjusted_accuracy: number;
  latency: LatencyStats;
  total_cost: number;
  confusion: Record<string, Record<string, number>>;
  per_route: RouteMetrics[];
};

export function scoreProvider(
  results: readonly TerminalResult[],
  gold: ReadonlyMap<string, GoldRow>,
  totalCases: number,
): ProviderScore {
  const confusion: Record<string, Record<string, number>> = {};
  for (const expected of FINAL_DECISIONS) {
    confusion[expected] = Object.fromEntries(
      FINAL_DECISIONS.map((predicted) => [predicted, 0]),
    );
  }

  let succeeded = 0;
  let failed = 0;
  let unknown = 0;
  let correct = 0;
  let scored = 0;
  let totalCost = 0;
  const latencies: number[] = [];

  for (const result of results) {
    totalCost += result.calculated_cost?.amount ?? 0;

    if (result.status === "failed") {
      failed += 1;
      continue;
    }
    if (result.status === "unknown") {
      unknown += 1;
      continue;
    }

    succeeded += 1;
    latencies.push(result.latency_ms);

    const expected = gold.get(result.case_id)?.expected_route;
    const predicted = result.decision;
    if (!expected || !predicted) continue;

    scored += 1;
    confusion[expected]![predicted] = (confusion[expected]![predicted] ?? 0) + 1;
    if (expected === predicted) correct += 1;
  }

  const per_route: RouteMetrics[] = FINAL_DECISIONS.map((route) => {
    const support = FINAL_DECISIONS.reduce(
      (acc, predicted) => acc + (confusion[route]![predicted] ?? 0),
      0,
    );
    const predictedCount = FINAL_DECISIONS.reduce(
      (acc, expected) => acc + (confusion[expected]![route] ?? 0),
      0,
    );
    const truePositive = confusion[route]![route] ?? 0;
    return {
      route,
      support,
      predicted: predictedCount,
      true_positive: truePositive,
      precision: predictedCount === 0 ? 0 : truePositive / predictedCount,
      recall: support === 0 ? 0 : truePositive / support,
    };
  });

  return {
    total_cases: totalCases,
    succeeded,
    failed,
    unknown,
    scored,
    correct,
    incorrect: scored - correct,
    accuracy: scored === 0 ? 0 : correct / scored,
    coverage_adjusted_accuracy: totalCases === 0 ? 0 : correct / totalCases,
    latency: latencyStats(latencies),
    total_cost: totalCost,
    confusion,
    per_route,
  };
}
