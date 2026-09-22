import "server-only";
import { readFile } from "node:fs/promises";
import { sha256 } from "./hash";
import { SOURCE_FILES } from "./data-source";

/**
 * Loads the human-facing company policy sent in full with every DeepSeek
 * request. Jev never receives this file; it receives typed questions instead.
 */
export type LoadedPolicy = {
  text: string;
  sha256: string;
};

export async function loadPolicy(
  filePath: string = SOURCE_FILES.policy.path,
): Promise<LoadedPolicy> {
  const buffer = await readFile(filePath);
  const text = buffer.toString("utf8");
  if (text.trim().length === 0) {
    throw new Error("Company policy file is empty.");
  }
  return { text, sha256: sha256(buffer) };
}

/** Verifies a loaded artifact against its audited hash. */
export function assertHash(
  label: string,
  actual: string,
  expected: string,
): void {
  if (actual !== expected) {
    throw new Error(
      `${label} hash mismatch. Expected ${expected}, found ${actual}. ` +
        `Update docs/02_data_dictionary.md deliberately if the source really changed.`,
    );
  }
}
