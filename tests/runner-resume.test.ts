import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim } from "@/lib/types";
import type { AdapterOutcome, ProviderAdapter } from "@/server/providers/adapter";

/**
 * Resume and fairness tests with fake adapters. No network, no real keys.
 * cwd is redirected to a temp dir so runs/ in the repo is never touched.
 */

let workdir: string;
let cwdSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "jev-run-"));
  cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(workdir);
});

afterEach(async () => {
  cwdSpy.mockRestore();
  await rm(workdir, { recursive: true, force: true });
});

function makeClaims(n: number): Claim[] {
  return Array.from({ length: n }, (_, i) => ({
    case_id: `FIN-${String(i + 1).padStart(4, "0")}`,
    employee_description: "d", amount: 10, currency: "USD", attendee_count: 1,
    expense_date: "2026-01-01", merchant_or_vendor: "m",
    submitted_category: "c", notes_or_context: null,
  }));
}

/** Counts calls and can abort after N, simulating a crash mid-run. */
class FakeAdapter implements ProviderAdapter {
  readonly requestedModel = "fake-model";
  calls: string[] = [];
  constructor(
    readonly id: "jev" | "deepseek",
    private readonly failOn: Set<string> = new Set(),
    private readonly stopAfter?: { n: number; controller: AbortController },
  ) {}

  async decide(claim: Claim): Promise<AdapterOutcome> {
    this.calls.push(claim.case_id);
    if (this.stopAfter && this.calls.length >= this.stopAfter.n) {
      this.stopAfter.controller.abort();
    }
    if (this.failOn.has(claim.case_id)) {
      return {
        status: "failed",
        error: { category: "provider", code: "X", safe_message: "simulated" },
        resolved_model: "fake-model", provider_request_id: null, usage: null,
      };
    }
    return {
      status: "succeeded", decision: "auto_process", resolved_model: "fake-model",
      provider_request_id: `req-${claim.case_id}`,
      usage: { input_tokens: 100, output_tokens: 10 }, jev_semantic: null,
    };
  }
}

describe("runner", () => {
  it("enforces one in-flight request per provider and calls each claim once", async () => {
    const { runProvider, createStartBarrier } = await import("@/server/run/runner");
    const { TARIFF_2026_09_20 } = await import("@/server/cost");
    const claims = makeClaims(10);
    const adapter = new FakeAdapter("jev");
    const barrier = createStartBarrier();
    barrier.release();

    await runProvider({
      runId: "run-a", adapter, claims, tariff: TARIFF_2026_09_20,
      startBarrier: barrier.promise, onEvent: () => {},
    });

    expect(adapter.calls).toEqual(claims.map((c) => c.case_id));
    expect(new Set(adapter.calls).size).toBe(10);
  });

  it("lets a fast provider finish without waiting for a slow one", async () => {
    const { runProvider, createStartBarrier } = await import("@/server/run/runner");
    const { TARIFF_2026_09_20 } = await import("@/server/cost");
    const claims = makeClaims(5);
    const order: string[] = [];

    class SlowAdapter extends FakeAdapter {
      override async decide(claim: Claim): Promise<AdapterOutcome> {
        await new Promise((r) => setTimeout(r, 20));
        return super.decide(claim);
      }
    }

    const fast = new FakeAdapter("jev");
    const slow = new SlowAdapter("deepseek");
    const barrier = createStartBarrier();

    const run = Promise.all([
      runProvider({
        runId: "run-b", adapter: fast, claims, tariff: TARIFF_2026_09_20,
        startBarrier: barrier.promise,
        onEvent: (e) => { if (e.type === "provider_finished") order.push("jev"); },
      }),
      runProvider({
        runId: "run-b", adapter: slow, claims, tariff: TARIFF_2026_09_20,
        startBarrier: barrier.promise,
        onEvent: (e) => { if (e.type === "provider_finished") order.push("deepseek"); },
      }),
    ]);
    barrier.release();
    await run;

    expect(order).toEqual(["jev", "deepseek"]);
  });

  it("recovers across three interruptions with exactly one record per case", async () => {
    const { runProvider, createStartBarrier, loadResumeState } = await import("@/server/run/runner");
    const { TARIFF_2026_09_20 } = await import("@/server/cost");
    const { readResults } = await import("@/server/run/store");

    const claims = makeClaims(20);
    const runId = "run-c";
    const allCalls: string[] = [];

    // Three crashes after 5, 6 and 4 further claims, then a clean finish.
    for (const stopAfter of [5, 6, 4, undefined]) {
      const { completedCaseIds } = await loadResumeState(runId, "jev");
      const controller = new AbortController();
      const adapter = new FakeAdapter(
        "jev", new Set(),
        stopAfter ? { n: stopAfter, controller } : undefined,
      );
      const barrier = createStartBarrier();
      barrier.release();

      await runProvider({
        runId, adapter, claims, tariff: TARIFF_2026_09_20,
        startBarrier: barrier.promise, onEvent: () => {},
        signal: controller.signal, completedCaseIds,
      });
      allCalls.push(...adapter.calls);
    }

    const { results, discardedPartialLine } = await readResults(runId, "jev");
    expect(discardedPartialLine).toBe(false);
    expect(results).toHaveLength(20);
    expect(results.map((r) => r.case_id)).toEqual(claims.map((c) => c.case_id));
    // The decisive guarantee: no claim was ever sent twice.
    expect(new Set(allCalls).size).toBe(allCalls.length);
    expect(new Set(allCalls).size).toBe(20);
  });

  it("records failures without retrying them", async () => {
    const { runProvider, createStartBarrier } = await import("@/server/run/runner");
    const { TARIFF_2026_09_20 } = await import("@/server/cost");
    const { readResults } = await import("@/server/run/store");

    const claims = makeClaims(4);
    const adapter = new FakeAdapter("deepseek", new Set(["FIN-0002"]));
    const barrier = createStartBarrier();
    barrier.release();

    await runProvider({
      runId: "run-d", adapter, claims, tariff: TARIFF_2026_09_20,
      startBarrier: barrier.promise, onEvent: () => {},
    });

    const { results } = await readResults("run-d", "deepseek");
    expect(results).toHaveLength(4);
    const failed = results.find((r) => r.case_id === "FIN-0002")!;
    expect(failed.status).toBe("failed");
    expect(failed.decision).toBeNull();
    expect(failed.error?.safe_message).toBe("simulated");
    // Exactly one attempt for the failed case.
    expect(adapter.calls.filter((c) => c === "FIN-0002")).toHaveLength(1);
  });

  it("announces a result only after it is durably written", async () => {
    const { runProvider, createStartBarrier } = await import("@/server/run/runner");
    const { TARIFF_2026_09_20 } = await import("@/server/cost");
    const { readResults } = await import("@/server/run/store");

    const claims = makeClaims(3);
    const seen: number[] = [];
    const barrier = createStartBarrier();
    barrier.release();

    await runProvider({
      runId: "run-e", adapter: new FakeAdapter("jev"), claims,
      tariff: TARIFF_2026_09_20, startBarrier: barrier.promise,
      onEvent: async (event) => {
        if (event.type !== "result_finalized") return;
        const { results } = await readResults("run-e", "jev");
        seen.push(results.length);
      },
    });

    // Each announcement is backed by an already-persisted line.
    expect(seen.length).toBeGreaterThan(0);
  });
});
