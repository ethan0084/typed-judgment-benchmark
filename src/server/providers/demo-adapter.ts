import "server-only";
import type { Claim, ExpenseCategory, FinalDecision } from "@/lib/types";
import type { AdapterOutcome, ProviderAdapter } from "./adapter";
import { routeClaim } from "./router";

/**
 * SIMULATED adapter for UI work. Makes NO network request and produces
 * deterministic pseudo-random values from the case_id.
 *
 * Results from this adapter are simulated and must never be presented as
 * benchmark findings or written into a live run. The UI marks demo mode
 * prominently and the run mode is recorded in the manifest.
 */

function hashString(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 0xffffffff;
  };
}

const CATEGORIES: ExpenseCategory[] = [
  "client_entertainment", "travel", "transportation", "office_supplies",
  "marketing", "employee_welfare", "software_subscription", "other",
  "insufficient_information",
];

export class DemoAdapter implements ProviderAdapter {
  readonly requestedModel: string;
  constructor(
    readonly id: "jev" | "deepseek",
    private readonly latency: { min: number; max: number },
  ) {
    this.requestedModel = `simulated-${id}`;
  }

  async decide(claim: Claim, signal?: AbortSignal): Promise<AdapterOutcome> {
    const next = rng(hashString(`${this.id}:${claim.case_id}`));
    const wait = this.latency.min + next() * (this.latency.max - this.latency.min);
    await new Promise((resolve) => setTimeout(resolve, wait));
    if (signal?.aborted) {
      return {
        status: "failed",
        error: { category: "interrupted", code: null, safe_message: "aborted" },
        resolved_model: null, provider_request_id: null, usage: null,
      };
    }

    const category = CATEGORIES[Math.floor(next() * CATEGORIES.length)]!;
    const semantic = {
      expense_category: {
        choice: category,
        selected_probability: 0.55 + next() * 0.4,
        confidence: 0.5 + next() * 0.5,
        probabilities: { [category]: 0.6 },
      },
      has_business_purpose: noulOf(next()),
      has_external_party_identity: noulOf(next()),
      has_exception_explanation: noulOf(next() * 0.6),
      explanation_quality: {
        score: next() * 3,
        level: Math.floor(next() * 4),
        confidence: 0.4 + next() * 0.5,
        probabilities: { "0": 0.1, "1": 0.2, "2": 0.4, "3": 0.3 },
        tie: false,
      },
      requires_human_review: noulOf(next() * 0.8),
    };

    const decision: FinalDecision =
      this.id === "jev"
        ? routeClaim({ claim, semantic })
        : (["auto_process", "manager_approval", "request_more_information", "human_review"] as const)[
            Math.floor(next() * 4)
          ]!;

    return {
      status: "succeeded",
      decision,
      resolved_model: this.requestedModel,
      provider_request_id: `demo-${claim.case_id}`,
      usage: { input_tokens: 1200, output_tokens: 40 },
      jev_semantic: this.id === "jev" ? semantic : null,
    };
  }
}

function noulOf(p: number) {
  return { p_yes: p, value: p >= 0.5 };
}
