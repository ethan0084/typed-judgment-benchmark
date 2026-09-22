import "server-only";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { z } from "zod";
import type { Claim } from "@/lib/types";
import { sha256 } from "./hash";
import { EXPECTED_CASE_COUNT, SOURCE_FILES, verifyIntegrity } from "./data-source";

/**
 * Loads the model-visible input workbook.
 *
 * Normalization rules (docs/02_data_dictionary.md):
 * - Missing values stay null. Blanks are intentional benchmark cases.
 * - Dirty values such as `US$` are preserved verbatim, never corrected.
 * - Excel date serials become ISO `YYYY-MM-DD`; nothing else is reformatted.
 */

const HEADER = [
  "case_id",
  "employee_description",
  "amount",
  "currency",
  "attendee_count",
  "expense_date",
  "merchant_or_vendor",
  "submitted_category",
  "notes_or_context",
] as const;

const claimSchema = z.object({
  case_id: z.string().min(1),
  employee_description: z.string().nullable(),
  amount: z.number().finite().nullable(),
  currency: z.string().nullable(),
  attendee_count: z.number().int().nullable(),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  merchant_or_vendor: z.string().nullable(),
  submitted_category: z.string().nullable(),
  notes_or_context: z.string().nullable(),
});

/** Trims only surrounding whitespace; empty becomes null. Content is untouched. */
function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  return str.length === 0 ? null : str;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** Excel serial -> ISO date, using the workbook's own formatted text when present. */
export function toIsoDate(value: unknown, formatted?: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (formatted && /^\d{4}-\d{2}-\d{2}$/.test(formatted)) return formatted;
  if (typeof value === "number") {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}`;
  }
  const str = String(value).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

export type LoadedInput = {
  claims: Claim[];
  file_sha256: string;
  ordered_case_id_hash: string;
};

export async function loadClaims(
  filePath: string = SOURCE_FILES.input.path,
): Promise<LoadedInput> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  // Prefer the benchmark's sheet; otherwise use the first sheet in the book.
  const sheetName = workbook.Sheets[SOURCE_FILES.input.sheet]
    ? SOURCE_FILES.input.sheet
    : workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) {
    throw new Error(`Input workbook "${filePath}" contains no readable sheet.`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
  const formatted = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    header: 1,
    raw: false,
    defval: null,
    blankrows: false,
  }) as unknown as (string | null)[][];

  const header = (rows[0] ?? []).map((h) => String(h ?? "").trim());

  // Columns are matched by NAME, so extra columns and reordering are fine.
  // Only a genuinely missing required column is an error, because there is no
  // sensible value to substitute for it.
  const columnIndex = new Map<string, number>();
  for (const [index, name] of header.entries()) {
    if (name && !columnIndex.has(name)) columnIndex.set(name, index);
  }
  const missing = HEADER.filter((name) => !columnIndex.has(name));
  if (missing.length > 0) {
    throw new Error(
      `Input workbook is missing required column(s): ${missing.join(", ")}. ` +
        `Found: ${header.filter(Boolean).join(", ")}. ` +
        `To use a different schema, define a scenario (see SCENARIO.md).`,
    );
  }
  const at = (row: unknown[], name: (typeof HEADER)[number]) =>
    row[columnIndex.get(name) as number];

  const claims: Claim[] = [];
  const seen = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const fmt = formatted[i] ?? [];
    const dateIndex = columnIndex.get("expense_date") as number;
    const claim: Claim = {
      case_id: text(at(row, "case_id")) ?? "",
      employee_description: text(at(row, "employee_description")),
      amount: num(at(row, "amount")),
      currency: text(at(row, "currency")),
      attendee_count: num(at(row, "attendee_count")),
      expense_date: toIsoDate(at(row, "expense_date"), fmt[dateIndex] ?? undefined),
      merchant_or_vendor: text(at(row, "merchant_or_vendor")),
      submitted_category: text(at(row, "submitted_category")),
      notes_or_context: text(at(row, "notes_or_context")),
    };

    const parsed = claimSchema.safeParse(claim);
    if (!parsed.success) {
      throw new Error(
        `Row ${i + 1} failed validation: ${parsed.error.issues
          .map((issue) => `${issue.path.join(".")} ${issue.message}`)
          .join("; ")}`,
      );
    }
    if (seen.has(claim.case_id)) {
      throw new Error(`Duplicate case_id "${claim.case_id}" at row ${i + 1}.`);
    }
    seen.add(claim.case_id);
    claims.push(claim);
  }

  // Advisory: a different row count means custom data, not a broken file.
  verifyIntegrity("Input row count", claims.length, EXPECTED_CASE_COUNT);

  return {
    claims,
    file_sha256: sha256(buffer),
    ordered_case_id_hash: sha256(claims.map((c) => c.case_id).join("\n")),
  };
}
