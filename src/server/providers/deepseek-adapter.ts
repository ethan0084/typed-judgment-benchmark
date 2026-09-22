import "server-only";
import type { Claim } from "@/lib/types";
import { isFinalDecision } from "@/lib/types";
import { publicConfig, redact, requireSecret } from "../env";
import {
  DECISION_JSON_SCHEMA,
  INSTRUCTIONS_TEMPLATE,
  buildDeepSeekInput,
} from "./deepseek-prompt";
import type { AdapterOutcome, ProviderAdapter } from "./adapter";

/**
 * DeepSeek route: one POST /responses per claim, thinking enabled at
 * reasoning effort "high" (frozen decision, 2026-09-20).
 *
 * No SDK-level retry exists here because the call is a single fetch and we
 * never re-issue it. Reasoning CONTENT is never stored or forwarded; only the
 * public reasoning token count from usage is kept.
 */
export class DeepSeekAdapter implements ProviderAdapter {
  readonly id = "deepseek" as const;
  readonly requestedModel: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #policyText: string;

  constructor(options: { timeoutMs: number; policyText: string }) {
    const config = publicConfig();
    this.requestedModel = config.deepseek_model;
    this.#baseUrl = config.deepseek_base_url.replace(/\/+$/, "");
    this.#apiKey = requireSecret("DEEPSEEK_API_KEY");
    this.#timeoutMs = options.timeoutMs;
    this.#policyText = options.policyText;
  }

  async decide(claim: Claim, signal?: AbortSignal): Promise<AdapterOutcome> {
    const controller = new AbortController();
    // Distinguish our own timeout from an operator pressing Stop: the first is
    // a provider failure, the second is a request that never got to answer.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const response = await fetch(`${this.#baseUrl}/responses`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.#apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.requestedModel,
          instructions: INSTRUCTIONS_TEMPLATE,
          input: buildDeepSeekInput(claim, this.#policyText),
          reasoning: { effort: "high" },
          text: { format: DECISION_JSON_SCHEMA },
          stream: false,
        }),
      });

      const requestId = response.headers.get("x-request-id");

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        return {
          status: "failed",
          error: {
            category: "provider",
            code: `HTTP:${response.status}`,
            safe_message: redact(body).slice(0, 300),
          },
          resolved_model: null,
          provider_request_id: requestId,
          usage: null,
        };
      }

      const payload = (await response.json()) as DeepSeekResponse;
      const usage = extractUsage(payload);
      const resolvedModel = payload.model ?? null;

      if (payload.status !== "completed") {
        return {
          status: "failed",
          error: {
            category: "provider",
            code: `status:${payload.status ?? "unknown"}`,
            safe_message: `Response did not complete (status ${payload.status ?? "unknown"}).`,
          },
          resolved_model: resolvedModel,
          provider_request_id: payload.id ?? requestId,
          usage,
        };
      }

      const text = extractOutputText(payload);
      if (!text) {
        return failInvalid("Response contained no message output.", resolvedModel, payload, usage, requestId);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return failInvalid("Output was not valid JSON.", resolvedModel, payload, usage, requestId);
      }

      const record = parsed as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (keys.length !== 2 || keys[0] !== "case_id" || keys[1] !== "decision") {
        return failInvalid(
          `Output had unexpected fields: ${keys.join(",")}.`,
          resolvedModel, payload, usage, requestId,
        );
      }
      if (!isFinalDecision(record.decision)) {
        return failInvalid(
          `Output decision "${String(record.decision)}" is not an allowed label.`,
          resolvedModel, payload, usage, requestId,
        );
      }
      if (record.case_id !== claim.case_id) {
        return {
          status: "failed",
          error: {
            category: "case_mismatch",
            code: null,
            safe_message: `Returned case_id "${String(record.case_id)}" does not match requested "${claim.case_id}".`,
          },
          resolved_model: resolvedModel,
          provider_request_id: payload.id ?? requestId,
          usage,
        };
      }

      return {
        status: "succeeded",
        decision: record.decision,
        resolved_model: resolvedModel,
        provider_request_id: payload.id ?? requestId,
        usage,
        jev_semantic: null,
      };
    } catch (error) {
      const stopped = signal?.aborted === true && !timedOut;
      return {
        status: "failed",
        error: {
          category: stopped
            ? "interrupted"
            : controller.signal.aborted
              ? "timeout"
              : "provider",
          code: error instanceof Error ? error.name : null,
          safe_message: redact(
            error instanceof Error ? error.message : String(error),
          ).slice(0, 300),
        },
        resolved_model: null,
        provider_request_id: null,
        usage: null,
      };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
}

type DeepSeekResponse = {
  id?: string;
  model?: string;
  status?: string;
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };
};

/** Keeps public token counts only. Reasoning CONTENT is never read or stored. */
function extractUsage(payload: DeepSeekResponse): Record<string, number> | null {
  const usage = payload.usage;
  if (!usage) return null;
  const out: Record<string, number> = {};
  if (typeof usage.input_tokens === "number") out.input_tokens = usage.input_tokens;
  if (typeof usage.output_tokens === "number") out.output_tokens = usage.output_tokens;
  if (typeof usage.total_tokens === "number") out.total_tokens = usage.total_tokens;
  const cached = usage.input_tokens_details?.cached_tokens;
  if (typeof cached === "number") out.cached_input_tokens = cached;
  const reasoning = usage.output_tokens_details?.reasoning_tokens;
  if (typeof reasoning === "number") out.reasoning_tokens = reasoning;
  return out;
}

/** Reads message items only; reasoning items are deliberately skipped. */
function extractOutputText(payload: DeepSeekResponse): string | null {
  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (typeof part.text === "string" && part.text.trim().length > 0) {
        return part.text;
      }
    }
  }
  return null;
}

function failInvalid(
  message: string,
  resolvedModel: string | null,
  payload: DeepSeekResponse,
  usage: Record<string, number> | null,
  requestId: string | null,
): AdapterOutcome {
  return {
    status: "failed",
    error: { category: "invalid_output", code: null, safe_message: message },
    resolved_model: resolvedModel,
    provider_request_id: payload.id ?? requestId,
    usage,
  };
}
