import "server-only";
import { readFile } from "node:fs/promises";
import type { Tariff } from "../cost";
import { manifestPath, writeAtomic } from "./store";

/**
 * Immutable run manifest. Written once, before the run starts, via atomic
 * rename. Nothing rewrites it afterwards: configuration cannot be "corrected"
 * retroactively, which is what makes a run auditable.
 */
export type RunManifest = {
  schema_version: 1;
  run_id: string;
  mode: "demo" | "development" | "live";
  created_at: string;
  /**
   * "published" when every source matched the pinned benchmark hashes;
   * "custom" when any differed. Custom runs are valid for your own data but
   * are not comparable to published figures.
   */
  dataset?: "published" | "custom";
  /** Populated on a custom run: which sources differed from the pins. */
  integrity_issues?: { subject: string; expected: string; actual: string }[];
  sources: {
    input: { path: string; sha256: string; sheet: string; rows: number };
    gold: { path: string; sha256: string };
    policy: { path: string; sha256: string };
    ordered_case_id_hash: string;
  };
  jev: {
    requested_model: string;
    question_spec_hash: string;
    noul_threshold: number;
    sdk_version: string;
    max_retries: 0;
  };
  deepseek: {
    requested_model: string;
    base_url: string;
    prompt_template_hash: string;
    policy_sha256: string;
    thinking: "enabled";
    reasoning_effort: "high";
    api_format: "responses";
    max_retries: 0;
  };
  execution: {
    concurrency_per_provider: 1;
    shared_start_barrier: true;
    timeout_ms: number;
    total_cases: number;
  };
  tariff: Tariff;
  environment: {
    node_version: string;
    app_version: string;
  };
  scorer: { gold_isolation_version: number; scorer_version: number };
};

export async function writeManifest(manifest: RunManifest): Promise<void> {
  await writeAtomic(manifestPath(manifest.run_id), JSON.stringify(manifest, null, 2));
}

export async function readManifest(runId: string): Promise<RunManifest> {
  return JSON.parse(await readFile(manifestPath(runId), "utf8")) as RunManifest;
}

export function newRunId(mode: RunManifest["mode"], at: Date = new Date()): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-").replace("Z", "");
  return `${stamp}-${mode}`;
}
