/**
 * Common adapter contract. An adapter performs EXACTLY ONE physical provider
 * request per claim and returns an outcome; it never retries, never writes
 * files, and never reads gold labels.
 */
import type { FinalDecision, JevSemanticResult } from "@/lib/types";
import type { ErrorCategory } from "@/lib/types";

export type AdapterOutcome =
  | {
      status: "succeeded";
      decision: FinalDecision;
      resolved_model: string | null;
      provider_request_id: string | null;
      usage: Record<string, number> | null;
      jev_semantic: JevSemanticResult | null;
    }
  | {
      status: "failed";
      error: { category: ErrorCategory; code: string | null; safe_message: string };
      resolved_model: string | null;
      provider_request_id: string | null;
      usage: Record<string, number> | null;
    };

export interface ProviderAdapter {
  readonly id: "jev" | "deepseek";
  readonly requestedModel: string;
  decide(claim: import("@/lib/types").Claim, signal?: AbortSignal): Promise<AdapterOutcome>;
}
