import "server-only";
import { readFile } from "node:fs/promises";
import * as XLSX from "xlsx";
import { sha256 } from "../hash";
import { SOURCE_FILES, verifyIntegrity } from "../data-source";
import { isFinalDecision, type FinalDecision } from "@/lib/types";

/**
 * GOLD ISOLATION BOUNDARY.
 *
 * This module is the ONLY place the gold workbook is read, and it lives under
 * src/server/scorer/ so the rule is mechanically checkable: no file under
 * src/server/providers/ may import from this directory. tests/gold-isolation
 * enforces that, and the scorer may only join a case after its TerminalResult
 * has been durably written.
 *
 * Adapters, prompt builders and question builders must never import this file.
 */

export type GoldRow = {
  case_id: string;
  expense_category: string;
  has_business_purpose: boolean;
  has_external_party_identity: boolean;
  has_exception_explanation: boolean;
  explanation_quality: number;
  expected_route: FinalDecision;
  difficulty: string;
  case_type: string;
  gold_rationale: string;
};

export type LoadedGold = {
  byCaseId: Map<string, GoldRow>;
  file_sha256: string;
};

function bool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  return String(value).trim().toLowerCase() === "true";
}

export async function loadGold(
  filePath: string = SOURCE_FILES.gold.path,
): Promise<LoadedGold> {
  const buffer = await readFile(filePath);
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });
  const goldSheetName = workbook.Sheets[SOURCE_FILES.gold.sheet]
    ? SOURCE_FILES.gold.sheet
    : workbook.SheetNames[0];
  const sheet = goldSheetName ? workbook.Sheets[goldSheetName] : undefined;
  if (!sheet) {
    throw new Error(`Gold workbook "${filePath}" contains no readable sheet.`);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const byCaseId = new Map<string, GoldRow>();
  for (const row of rows) {
    const caseId = String(row.case_id ?? "").trim();
    const route = String(row.expected_route ?? "").trim();
    if (!isFinalDecision(route)) {
      throw new Error(`Gold row ${caseId} has invalid expected_route "${route}".`);
    }
    byCaseId.set(caseId, {
      case_id: caseId,
      expense_category: String(row.expense_category ?? "").trim(),
      has_business_purpose: bool(row.has_business_purpose),
      has_external_party_identity: bool(row.has_external_party_identity),
      has_exception_explanation: bool(row.has_exception_explanation),
      explanation_quality: Number(row.explanation_quality),
      expected_route: route,
      difficulty: String(row.difficulty ?? "").trim(),
      case_type: String(row.case_type ?? "").trim(),
      gold_rationale: String(row.gold_rationale ?? ""),
    });
  }

  verifyIntegrity("Gold row count", byCaseId.size, SOURCE_FILES.gold.rows);

  return { byCaseId, file_sha256: sha256(buffer) };
}
