import "server-only";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { CLAIM_FIELD_ORDER, type Claim } from "@/lib/types";

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function fileSha256(path: string): Promise<string> {
  return sha256(await readFile(path));
}

/**
 * Stable hash over the normalized claim in the contract field order.
 * Any change to CLAIM_FIELD_ORDER changes every hash, which is intended:
 * it makes a normalization change visible across runs.
 */
export function claimPayloadHash(claim: Claim): string {
  const ordered = CLAIM_FIELD_ORDER.map((field) => [field, claim[field]]);
  return sha256(JSON.stringify(ordered));
}
