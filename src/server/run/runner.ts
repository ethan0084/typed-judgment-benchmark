import "server-only";
import type { Claim, ProviderId, TerminalResult } from "@/lib/types";
import type { ProviderAdapter } from "../providers/adapter";
import { claimPayloadHash } from "../hash";
import { deepseekCost, jevCost, type Tariff } from "../cost";
import { ResultWriter, readResults } from "./store";

/**
 * One sequential runner per provider.
 *
 * Fairness rules enforced here:
 * - concurrency is exactly 1 per provider, asserted at runtime;
 * - each claim is attempted exactly once, with no retry;
 * - both runners wait on one shared start barrier, then advance independently:
 *   the faster side never waits for the slower one.
 */

export type RunnerEvent =
  | { type: "claim_started"; provider: ProviderId; sequence: number; claim: Claim }
  | { type: "result_finalized"; provider: ProviderId; result: TerminalResult }
  | { type: "provider_finished"; provider: ProviderId; processed: number };

export type RunnerOptions = {
  runId: string;
  adapter: ProviderAdapter;
  claims: Claim[];
  tariff: Tariff;
  /** Resolves when both providers are ready; both runners await the same promise. */
  startBarrier: Promise<void>;
  onEvent: (event: RunnerEvent) => void;
  signal?: AbortSignal;
  /** Sequences already durably recorded, skipped on resume. */
  completedCaseIds?: ReadonlySet<string>;
};

export async function runProvider(options: RunnerOptions): Promise<void> {
  const { runId, adapter, claims, tariff, startBarrier, onEvent, signal } = options;
  const completed = options.completedCaseIds ?? new Set<string>();
  const writer = new ResultWriter(runId, adapter.id);

  let inFlight = 0;
  let processed = 0;

  await startBarrier;

  for (const [sequence, claim] of claims.entries()) {
    if (signal?.aborted) break;
    if (completed.has(claim.case_id)) continue;

    onEvent({ type: "claim_started", provider: adapter.id, sequence, claim });

    inFlight += 1;
    if (inFlight !== 1) {
      throw new Error(
        `Concurrency violation for ${adapter.id}: in-flight=${inFlight}, must be 1.`,
      );
    }

    const startedAt = new Date();
    const startedMonotonic = performance.now();

    // Exactly one physical provider request. No retry wrapper here by design.
    const outcome = await adapter.decide(claim, signal);

    const latencyMs = performance.now() - startedMonotonic;
    inFlight -= 1;

    const usage = outcome.usage;
    const cost =
      adapter.id === "jev"
        ? jevCost(usage, tariff)
        : deepseekCost(usage, startedAt, tariff);

    const result: TerminalResult = {
      schema_version: 1,
      run_id: runId,
      provider: adapter.id,
      sequence,
      case_id: claim.case_id,
      claim_payload_hash: claimPayloadHash(claim),
      status: outcome.status,
      decision: outcome.status === "succeeded" ? outcome.decision : null,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      latency_ms: Math.round(latencyMs * 1000) / 1000,
      provider_request_id: outcome.provider_request_id,
      requested_model: adapter.requestedModel,
      resolved_model: outcome.resolved_model,
      usage,
      calculated_cost: usage
        ? { currency: tariff.currency, amount: cost, tariff_id: tariff.tariff_id }
        : null,
      jev_semantic: outcome.status === "succeeded" ? outcome.jev_semantic : null,
      error: outcome.status === "failed" ? outcome.error : null,
    };

    // Durable first, announced second: nothing observes a result that a crash
    // could erase, and the scorer may only join gold after this returns.
    await writer.append(result);
    processed += 1;
    onEvent({ type: "result_finalized", provider: adapter.id, result });
  }

  onEvent({ type: "provider_finished", provider: adapter.id, processed });
}

/** A barrier both runners await so neither starts before the other is ready. */
export function createStartBarrier(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Resume support: returns the case IDs already durably recorded, and flags
 * duplicates. `unknown` results are NOT re-sent; re-running them could double
 * bill and would break the one-request-per-claim guarantee.
 */
export async function loadResumeState(
  runId: string,
  provider: ProviderId,
): Promise<{
  completedCaseIds: Set<string>;
  duplicates: string[];
  unknownCaseIds: string[];
  discardedPartialLine: boolean;
}> {
  const { results, discardedPartialLine } = await readResults(runId, provider);
  const completedCaseIds = new Set<string>();
  const duplicates: string[] = [];
  const unknownCaseIds: string[] = [];

  for (const result of results) {
    if (completedCaseIds.has(result.case_id)) {
      duplicates.push(result.case_id);
      continue;
    }
    completedCaseIds.add(result.case_id);
    if (result.status === "unknown") unknownCaseIds.push(result.case_id);
  }

  return { completedCaseIds, duplicates, unknownCaseIds, discardedPartialLine };
}
