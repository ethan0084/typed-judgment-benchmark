import "server-only";
import path from "node:path";
import { isStrictMode as readStrictMode } from "./env";

/**
 * Canonical source paths and their audited hashes (docs/02_data_dictionary.md).
 *
 * The hashes and row count pin the PUBLISHED benchmark so its numbers stay
 * reproducible. They are advisory by default: `verifyIntegrity` warns on a
 * mismatch so you can point the project at your own data, and only throws
 * when `BENCHMARK_STRICT=1` (or a scenario sets `integrity.strict`).
 */
export const DATA_DIR = path.join(process.cwd(), "data");

export const SOURCE_FILES = {
  input: {
    path: path.join(DATA_DIR, "01_finance_test_input.xlsx"),
    sha256: "1c4e9bff01c8bec0b48de07e9c551b8e1d7683e02a3a2f439082a7d09221f05c",
    sheet: "Test Input",
    rows: 1000,
  },
  gold: {
    path: path.join(DATA_DIR, "02_gold_labels.xlsx"),
    sha256: "6cf184d2137ac47d699e90954932d410fa8e84ad49c07d6eb7ae83f20356037e",
    sheet: "Gold Labels",
    rows: 1000,
  },
  policy: {
    path: path.join(DATA_DIR, "03_company_policy.md"),
    sha256: "0e210af7ad5a72c88f8576bb0cf128667be89c419db2439522bc2f606ffb989c",
  },
} as const;

export const EXPECTED_CASE_COUNT = 1000;

/** Set BENCHMARK_STRICT=1 to turn every integrity warning back into an error. */
export { isStrictMode } from "./env";

export type IntegrityIssue = {
  subject: string;
  expected: string;
  actual: string;
};

const warned = new Set<string>();

/**
 * Compares an observed value against the pinned one.
 *
 * Returns the issue when they differ so callers can surface it, and throws
 * only in strict mode. Each distinct mismatch is logged once per process so a
 * custom dataset does not flood the console.
 */
export function verifyIntegrity(
  subject: string,
  actual: string | number,
  expected: string | number | undefined,
  options: { strict?: boolean } = {},
): IntegrityIssue | null {
  if (expected === undefined) return null;
  if (String(actual) === String(expected)) return null;

  const issue: IntegrityIssue = {
    subject,
    expected: String(expected),
    actual: String(actual),
  };

  const strict = options.strict ?? readStrictMode();
  if (strict) {
    throw new Error(
      `${subject} mismatch. Expected ${issue.expected}, found ${issue.actual}. ` +
        `Unset BENCHMARK_STRICT to continue with custom data.`,
    );
  }

  const key = `${subject}:${issue.expected}:${issue.actual}`;
  if (!warned.has(key)) {
    warned.add(key);
    console.warn(
      `[benchmark] ${subject} differs from the published benchmark ` +
        `(expected ${issue.expected}, found ${issue.actual}). ` +
        `Results are valid for your own data but are not comparable to published figures.`,
    );
  }
  return issue;
}
