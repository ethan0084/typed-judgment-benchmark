import { NextResponse } from "next/server";
import { loadClaims } from "@/server/input-loader";
import { loadPolicy } from "@/server/policy-loader";
import { SOURCE_FILES } from "@/server/data-source";
import { verifyIntegrity } from "@/server/data-source";
import { publicConfig, readEnvStatus } from "@/server/env";
import { getController } from "@/server/run/controller";
import { newRunId, writeManifest, type RunManifest } from "@/server/run/manifest";
import { TARIFF_2026_09_20 } from "@/server/cost";
import { DemoAdapter } from "@/server/providers/demo-adapter";
import { JevAdapter } from "@/server/providers/jev-adapter";
import { DeepSeekAdapter } from "@/server/providers/deepseek-adapter";
import { QUESTION_SPEC_HASH } from "@/server/providers/jev-questions";
import { PROMPT_TEMPLATE_HASH } from "@/server/providers/deepseek-prompt";
import { NOUL_THRESHOLD } from "@/server/providers/jev-normalize";
import type { ProviderAdapter } from "@/server/providers/adapter";

export const dynamic = "force-dynamic";

const TIMEOUT_MS = 120_000;

/**
 * Starts a run. `mode` must be sent explicitly:
 * - "demo": simulated adapters, no network, results are not benchmark data;
 * - "development": real APIs on a small slice, kept out of formal results;
 * - "live": the formal run. Requires an explicit confirm flag.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    mode?: "demo" | "development" | "live";
    limit?: number;
    confirm?: boolean;
  };
  const mode = body.mode ?? "demo";

  if (mode === "live" && body.confirm !== true) {
    return NextResponse.json(
      { error: "A live run requires explicit confirmation." },
      { status: 400 },
    );
  }

  const controller = getController();
  if (controller.snapshot.status === "running") {
    return NextResponse.json({ error: "A run is already in progress." }, { status: 409 });
  }

  const env = readEnvStatus();
  if (mode !== "demo") {
    if (!env.typesafe_key_present) {
      return NextResponse.json({ error: "TYPESAFE_API_KEY is not set." }, { status: 400 });
    }
    if (!env.deepseek_key_present) {
      return NextResponse.json({ error: "DEEPSEEK_API_KEY is not set." }, { status: 400 });
    }
  }

  const input = await loadClaims();
  const policy = await loadPolicy();
  // Advisory unless BENCHMARK_STRICT=1: a mismatch means custom data, which is
  // a supported use. The manifest records it so results are never mistaken for
  // published benchmark figures.
  const integrityIssues = [
    verifyIntegrity("Input workbook", input.file_sha256, SOURCE_FILES.input.sha256),
    verifyIntegrity("Company policy", policy.sha256, SOURCE_FILES.policy.sha256),
  ].filter((issue): issue is NonNullable<typeof issue> => issue !== null);

  const claims =
    typeof body.limit === "number" && body.limit > 0
      ? input.claims.slice(0, body.limit)
      : input.claims;

  const config = publicConfig();
  const runId = newRunId(mode);

  let adapters: { jev: ProviderAdapter; deepseek: ProviderAdapter };
  if (mode === "demo") {
    adapters = {
      jev: new DemoAdapter("jev", { min: 40, max: 120 }),
      deepseek: new DemoAdapter("deepseek", { min: 300, max: 900 }),
    };
  } else {
    adapters = {
      jev: new JevAdapter({ timeoutMs: TIMEOUT_MS }),
      deepseek: new DeepSeekAdapter({ timeoutMs: TIMEOUT_MS, policyText: policy.text }),
    };
  }

  const manifest: RunManifest = {
    schema_version: 1,
    run_id: runId,
    mode,
    created_at: new Date().toISOString(),
    dataset: integrityIssues.length === 0 ? "published" : "custom",
    ...(integrityIssues.length > 0 ? { integrity_issues: integrityIssues } : {}),
    sources: {
      input: {
        path: "data/01_finance_test_input.xlsx",
        sha256: input.file_sha256,
        sheet: SOURCE_FILES.input.sheet,
        rows: claims.length,
      },
      gold: { path: "data/02_gold_labels.xlsx", sha256: SOURCE_FILES.gold.sha256 },
      policy: { path: "data/03_company_policy.md", sha256: policy.sha256 },
      ordered_case_id_hash: input.ordered_case_id_hash,
    },
    jev: {
      requested_model: mode === "demo" ? "simulated-jev" : config.typesafe_model,
      question_spec_hash: QUESTION_SPEC_HASH,
      noul_threshold: NOUL_THRESHOLD,
      sdk_version: "0.6.0",
      max_retries: 0,
    },
    deepseek: {
      requested_model: mode === "demo" ? "simulated-deepseek" : config.deepseek_model,
      base_url: config.deepseek_base_url,
      prompt_template_hash: PROMPT_TEMPLATE_HASH,
      policy_sha256: policy.sha256,
      thinking: "enabled",
      reasoning_effort: "high",
      api_format: "responses",
      max_retries: 0,
    },
    execution: {
      concurrency_per_provider: 1,
      shared_start_barrier: true,
      timeout_ms: TIMEOUT_MS,
      total_cases: claims.length,
    },
    tariff: TARIFF_2026_09_20,
    environment: { node_version: process.version, app_version: "0.1.0" },
    scorer: { gold_isolation_version: 1, scorer_version: 1 },
  };

  await writeManifest(manifest);

  // Fire and forget: the HTTP response returns immediately and progress
  // reaches the browser over SSE. Runner state does not depend on this request.
  void controller.start({ runId, mode, claims, adapters }).catch(() => {
    /* Terminal results and failures are already persisted per claim. */
  });

  return NextResponse.json({ run_id: runId, mode, total_cases: claims.length });
}

export async function DELETE() {
  getController().abort();
  return NextResponse.json({ ok: true });
}
