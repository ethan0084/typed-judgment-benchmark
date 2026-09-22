/**
 * Browser-visible event contract. Shared by the SSE endpoint and the page.
 * Nothing here may carry a secret, a reasoning trace, or a gold label.
 */
import type { Claim, FinalDecision, JevSemanticResult, ProviderId } from "./types";

export type ProviderSnapshot = {
  processed: number;
  succeeded: number;
  failed: number;
  total: number;
  elapsed_ms: number;
  decisions_per_second: number;
  current_latency_ms: number | null;
  avg_latency_ms: number;
  p50_latency_ms: number;
  p95_latency_ms: number;
  total_cost: number;
  finished: boolean;
  current_claim: Claim | null;
  last_decision: FinalDecision | null;
  last_semantic: JevSemanticResult | null;
  last_error: string | null;
};

/**
 * Accuracy for one provider, computed only AFTER the run finishes and every
 * terminal result is durably written. Gold labels never reach the page before
 * this point, and never reach a provider at all.
 */
export type ProviderAccuracy = {
  scored: number;
  correct: number;
  incorrect: number;
  failed: number;
  /** Requests cut short by Stop: not scored, not counted as failures. */
  interrupted: number;
  /** scored + failed — what this provider actually attempted. */
  attempted: number;
  accuracy: number;
  coverage_adjusted_accuracy: number;
  /** expected route -> predicted route -> count */
  confusion: Record<string, Record<string, number>>;
  per_case: Array<{
    case_id: string;
    expected: string;
    predicted: string | null;
    correct: boolean;
  }>;
};

export type RunSnapshot = {
  run_id: string | null;
  mode: "demo" | "development" | "live" | null;
  status: "idle" | "running" | "finished" | "aborted";
  started_at: string | null;
  total_cases: number;
  providers: Record<ProviderId, ProviderSnapshot>;
  /** Present only after the run finishes and the scorer has joined gold. */
  scores: Record<ProviderId, ProviderAccuracy> | null;
};

export function emptyProviderSnapshot(total: number): ProviderSnapshot {
  return {
    processed: 0, succeeded: 0, failed: 0, total,
    elapsed_ms: 0, decisions_per_second: 0, current_latency_ms: null,
    avg_latency_ms: 0, p50_latency_ms: 0, p95_latency_ms: 0,
    total_cost: 0, finished: false, current_claim: null,
    last_decision: null, last_semantic: null, last_error: null,
  };
}
