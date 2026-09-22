import "server-only";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Claim } from "@/lib/types";
import { publicConfig, redact, requireSecret } from "../env";
import { buildJevState, jevQuestions } from "./jev-questions";
import { normalizeJevAnswers } from "./jev-normalize";
import { routeClaim } from "./router";
import type { AdapterOutcome, ProviderAdapter } from "./adapter";

/**
 * Jev route: one fan-out systemOne() call per claim, then deterministic
 * routing in memory.
 *
 * maxRetries is pinned to 0 (verified against @typesafe-ai/sdk v0.6.0
 * RetryPolicy) so one claim is exactly one physical request. A failure stays
 * a failure; it is never silently retried. See TASK-011.
 */
export class JevAdapter implements ProviderAdapter {
  readonly id = "jev" as const;
  readonly requestedModel: string;
  readonly #client: TypeSafeClient;

  constructor(options: { timeoutMs: number }) {
    this.requestedModel = publicConfig().typesafe_model;
    this.#client = new TypeSafeClient({
      apiKey: requireSecret("TYPESAFE_API_KEY"),
      defaultModel: this.requestedModel,
      timeout: options.timeoutMs,
      retry: { maxRetries: 0 },
    });
  }

  async decide(claim: Claim, signal?: AbortSignal): Promise<AdapterOutcome> {
    try {
      const { data, requestId } = await this.#client
        .systemOne(
          {
            state: buildJevState(claim),
            questions: jevQuestions,
            model: this.requestedModel,
          },
          { signal, retry: { maxRetries: 0 } },
        )
        .withResponse();

      const usage: Record<string, number> = {
        input_tokens: data.usage.input_tokens,
        output_tokens: data.usage.output_tokens,
      };

      const semantic = normalizeJevAnswers(data.answers);
      const decision = routeClaim({ claim, semantic });

      return {
        status: "succeeded",
        decision,
        resolved_model: data.model,
        provider_request_id: requestId ?? null,
        usage,
        jev_semantic: semantic,
      };
    } catch (error) {
      return {
        status: "failed",
        // A run stopped by the operator is not a provider failure.
        error: signal?.aborted ? INTERRUPTED : classify(error),
        resolved_model: null,
        provider_request_id: null,
        usage: null,
      };
    }
  }
}

const INTERRUPTED = {
  category: "interrupted" as const,
  code: null,
  safe_message: "Run stopped before this claim was answered.",
};

function classify(error: unknown): {
  category: "timeout" | "provider" | "invalid_output";
  code: string | null;
  safe_message: string;
} {
  const name = error instanceof Error ? error.name : "Error";
  const message = redact(error instanceof Error ? error.message : String(error));

  if (name === "APITimeoutError" || /timeout/i.test(message)) {
    return { category: "timeout", code: name, safe_message: message.slice(0, 300) };
  }
  // Normalization/route errors mean the payload was unusable, not a transport fault.
  if (/Jev returned/.test(message)) {
    return { category: "invalid_output", code: name, safe_message: message.slice(0, 300) };
  }
  const status = (error as { status?: number } | null)?.status;
  return {
    category: "provider",
    code: status ? `${name}:${status}` : name,
    safe_message: message.slice(0, 300),
  };
}
