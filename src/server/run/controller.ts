import "server-only";
import type { ProviderId, TerminalResult } from "@/lib/types";
import { emptyProviderSnapshot, type ProviderAccuracy, type RunSnapshot } from "@/lib/events";
import { percentile } from "../scorer/score";
import { createStartBarrier, runProvider, type RunnerEvent } from "./runner";
import { readResults } from "./store";
import type { ProviderAdapter } from "../providers/adapter";
import { TARIFF_2026_09_20 } from "../cost";
import type { Claim } from "@/lib/types";

/**
 * Holds live run state for the single benchmark page and fans events out to
 * connected browsers. A dropped browser connection never affects the runners:
 * they write to disk regardless, and a reconnecting page replays the snapshot.
 */
export class RunController {
  #snapshot: RunSnapshot;
  #latencies: Record<ProviderId, number[]> = { jev: [], deepseek: [] };
  #startedMonotonic = 0;
  /** Claim currently being processed, per provider. */
  #inFlightClaim: Partial<Record<ProviderId, Claim>> = {};
  /** Claim behind the decision currently on screen, per provider. */
  #lastDecidedClaim: Partial<Record<ProviderId, Claim>> = {};
  #subscribers = new Set<(snapshot: RunSnapshot) => void>();
  #abort: AbortController | null = null;
  /** Sticky for the current run: an aborted run must never report "finished". */
  #aborted = false;

  constructor(totalCases = 0) {
    this.#snapshot = {
      run_id: null, mode: null, status: "idle", started_at: null,
      total_cases: totalCases,
      providers: {
        jev: emptyProviderSnapshot(totalCases),
        deepseek: emptyProviderSnapshot(totalCases),
      },
      scores: null,
    };
  }

  get snapshot(): RunSnapshot {
    return this.#snapshot;
  }

  subscribe(fn: (snapshot: RunSnapshot) => void): () => void {
    this.#subscribers.add(fn);
    fn(this.#snapshot);
    return () => this.#subscribers.delete(fn);
  }

  #publish(): void {
    for (const fn of this.#subscribers) fn(this.#snapshot);
  }

  abort(): void {
    this.#aborted = true;
    this.#abort?.abort();
    this.#snapshot = { ...this.#snapshot, status: "aborted" };
    this.#publish();
  }

  #onEvent = (event: RunnerEvent): void => {
    const providers = { ...this.#snapshot.providers };
    const current = { ...providers[event.provider] };

    if (event.type === "claim_started") {
      current.current_claim = event.claim;
      this.#inFlightClaim[event.provider] = event.claim;
    } else if (event.type === "result_finalized") {
      const result: TerminalResult = event.result;
      current.processed += 1;
      if (result.status === "succeeded") current.succeeded += 1;
      else current.failed += 1;

      current.total_cost += result.calculated_cost?.amount ?? 0;

      // A request cut short by Stop is not a real outcome for this claim, so it
      // must not replace the last decision already on screen. Keeping the prior
      // result visible is what the operator was looking at when they stopped.
      const interrupted = result.error?.category === "interrupted";
      if (interrupted) {
        // Fall back to the claim whose decision is still displayed.
        current.current_claim = this.#lastDecidedClaim[event.provider] ?? current.current_claim;
      } else {
        this.#lastDecidedClaim[event.provider] =
          this.#inFlightClaim[event.provider] ?? current.current_claim ?? undefined;
        current.current_latency_ms = result.latency_ms;
        current.last_decision = result.decision;
        current.last_semantic = result.jev_semantic;
        current.last_error = result.error?.safe_message ?? null;
      }

      if (result.status === "succeeded") {
        this.#latencies[event.provider].push(result.latency_ms);
      }
      const samples = [...this.#latencies[event.provider]].sort((a, b) => a - b);
      if (samples.length > 0) {
        current.avg_latency_ms =
          samples.reduce((acc, value) => acc + value, 0) / samples.length;
        current.p50_latency_ms = percentile(samples, 50);
        current.p95_latency_ms = percentile(samples, 95);
      }

      current.elapsed_ms = performance.now() - this.#startedMonotonic;
      current.decisions_per_second =
        current.elapsed_ms > 0 ? current.processed / (current.elapsed_ms / 1000) : 0;
    } else {
      current.finished = true;
      // Keep the last processed claim on screen so the finished column shows
      // what it actually decided, rather than going blank.
      current.elapsed_ms = performance.now() - this.#startedMonotonic;
    }

    providers[event.provider] = current;
    this.#snapshot = { ...this.#snapshot, providers };

    // A runner that stops early still emits provider_finished, so an aborted
    // run must not be relabelled as a completed one.
    if (providers.jev.finished && providers.deepseek.finished) {
      this.#snapshot = {
        ...this.#snapshot,
        status: this.#aborted ? "aborted" : "finished",
      };
      // Gold is joined only now, reading back what was durably written.
      void this.#scoreFinishedRun();
    }
    this.#publish();
  };

  /**
   * Scores the finished run against gold labels.
   *
   * This is the ONLY path by which gold reaches the UI, and it runs strictly
   * after every terminal result is on disk. It re-reads results from the
   * JSONL files rather than trusting in-memory state, so what is scored is
   * exactly what was persisted. Demo runs are never scored: their decisions
   * are simulated and an accuracy number would be meaningless.
   */
  async #scoreFinishedRun(): Promise<void> {
    const runId = this.#snapshot.run_id;
    const mode = this.#snapshot.mode;
    if (!runId || mode === "demo") return;

    try {
      const { loadGold } = await import("../scorer/gold-loader");
      const { byCaseId } = await loadGold();

      const scores = {} as Record<ProviderId, ProviderAccuracy>;
      for (const provider of ["jev", "deepseek"] as const) {
        const { results } = await readResults(runId, provider);

        let correct = 0;
        let scored = 0;
        let failed = 0;
        let interrupted = 0;
        const confusion: Record<string, Record<string, number>> = {};
        const per_case: ProviderAccuracy["per_case"] = [];

        for (const result of results) {
          const expected = byCaseId.get(result.case_id)?.expected_route;
          // A request cut short by Stop was never given a chance to answer,
          // so it is neither correct, incorrect, nor a provider failure.
          if (result.error?.category === "interrupted") {
            interrupted += 1;
            continue;
          }
          if (result.status !== "succeeded" || !result.decision) {
            failed += 1;
            if (expected) {
              per_case.push({
                case_id: result.case_id,
                expected,
                predicted: null,
                correct: false,
              });
            }
            continue;
          }
          if (!expected) continue;

          scored += 1;
          const isCorrect = expected === result.decision;
          if (isCorrect) correct += 1;
          confusion[expected] ??= {};
          confusion[expected]![result.decision] =
            (confusion[expected]![result.decision] ?? 0) + 1;
          per_case.push({
            case_id: result.case_id,
            expected,
            predicted: result.decision,
            correct: isCorrect,
          });
        }

        /**
         * Coverage is measured against what this provider actually attempted,
         * not the run's planned size. When a run is stopped early the two
         * differ, and dividing by the plan would understate a provider that
         * simply had not reached the remaining claims yet.
         */
        const attempted = scored + failed;
        scores[provider] = {
          scored,
          correct,
          incorrect: scored - correct,
          failed,
          interrupted,
          attempted,
          accuracy: scored === 0 ? 0 : correct / scored,
          coverage_adjusted_accuracy: attempted === 0 ? 0 : correct / attempted,
          confusion,
          per_case,
        };
      }

      this.#snapshot = { ...this.#snapshot, scores };
      this.#publish();
    } catch {
      // Scoring is diagnostic: a failure here must never corrupt the run or
      // the already-persisted results. The UI simply shows no accuracy.
    }
  }

  /** Starts both runners behind one shared barrier. Resolves when both finish. */
  async start(options: {
    runId: string;
    mode: "demo" | "development" | "live";
    claims: Claim[];
    adapters: { jev: ProviderAdapter; deepseek: ProviderAdapter };
    completed?: Partial<Record<ProviderId, ReadonlySet<string>>>;
  }): Promise<void> {
    const { runId, mode, claims, adapters } = options;
    this.#abort = new AbortController();
    this.#aborted = false;
    this.#latencies = { jev: [], deepseek: [] };
    this.#inFlightClaim = {};
    this.#lastDecidedClaim = {};
    this.#snapshot = {
      run_id: runId, mode, status: "running",
      started_at: new Date().toISOString(),
      total_cases: claims.length,
      providers: {
        jev: emptyProviderSnapshot(claims.length),
        deepseek: emptyProviderSnapshot(claims.length),
      },
      scores: null,
    };
    this.#publish();

    const barrier = createStartBarrier();
    this.#startedMonotonic = performance.now();

    const shared = {
      runId, claims, tariff: TARIFF_2026_09_20,
      startBarrier: barrier.promise,
      onEvent: this.#onEvent,
      signal: this.#abort.signal,
    };

    const work = Promise.all([
      runProvider({ ...shared, adapter: adapters.jev, completedCaseIds: options.completed?.jev }),
      runProvider({ ...shared, adapter: adapters.deepseek, completedCaseIds: options.completed?.deepseek }),
    ]);

    // Both runners are parked on the barrier; release starts them together.
    barrier.release();
    await work;
  }
}

/** Module-level singleton: one page, one active run. */
let controller: RunController | null = null;

export function getController(): RunController {
  controller ??= new RunController();
  return controller;
}
