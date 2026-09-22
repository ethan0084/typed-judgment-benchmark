import { NextResponse } from "next/server";
import { readEnvStatus } from "@/server/env";
import { loadClaims } from "@/server/input-loader";
import { loadPolicy } from "@/server/policy-loader";
import { SOURCE_FILES } from "@/server/data-source";

export const dynamic = "force-dynamic";

/** Presence-only environment status plus source-file integrity. No secrets. */
export async function GET() {
  const env = readEnvStatus();

  const sources: Record<string, { ok: boolean; detail: string }> = {};
  try {
    const input = await loadClaims();
    sources.input = {
      ok: input.file_sha256 === SOURCE_FILES.input.sha256,
      detail: `${input.claims.length} claims`,
    };
  } catch (error) {
    sources.input = { ok: false, detail: (error as Error).message };
  }
  try {
    const policy = await loadPolicy();
    sources.policy = {
      ok: policy.sha256 === SOURCE_FILES.policy.sha256,
      detail: `${policy.text.length} chars`,
    };
  } catch (error) {
    sources.policy = { ok: false, detail: (error as Error).message };
  }

  return NextResponse.json({ env, sources });
}
