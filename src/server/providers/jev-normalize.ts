/**
 * Maps raw SDK answers to the stored contract, preserving every probability.
 * Pure: no network, no secrets, unit testable with fixtures.
 *
 * Rules (docs/07 section 3):
 * - Choice keeps the full distribution, selected probability and native confidence.
 * - Noul keeps p(yes) only; it has no confidence and must never be relabelled.
 * - Score keeps raw score, distribution, confidence and a discrete level,
 *   where a tie for highest probability resolves to the LOWER level.
 */
import {
  EXPENSE_CATEGORIES,
  type ChoiceAnswer,
  type ExpenseCategory,
  type JevSemanticResult,
  type NoulAnswer,
  type ScoreAnswer,
} from "@/lib/types";

export const NOUL_THRESHOLD = 0.5;

type RawChoice = { choice: string; confidence: number; probabilities: Record<string, number> };
type RawNoul = { noul: number };
type RawScore = { score: number; confidence: number; probabilities: Record<string, number> };

function isExpenseCategory(value: string): value is ExpenseCategory {
  return (EXPENSE_CATEGORIES as readonly string[]).includes(value);
}

export function normalizeChoice(raw: RawChoice): ChoiceAnswer {
  if (!isExpenseCategory(raw.choice)) {
    throw new Error(`Jev returned unknown expense category "${raw.choice}".`);
  }
  const probabilities: Record<string, number> = { ...raw.probabilities };
  return {
    choice: raw.choice,
    selected_probability: probabilities[raw.choice] ?? Number.NaN,
    confidence: raw.confidence,
    probabilities,
  };
}

export function normalizeNoul(raw: RawNoul): NoulAnswer {
  const p = raw.noul;
  if (typeof p !== "number" || Number.isNaN(p) || p < 0 || p > 1) {
    throw new Error(`Jev returned an out-of-range Noul probability: ${String(p)}.`);
  }
  return { p_yes: p, value: p >= NOUL_THRESHOLD };
}

export function normalizeScore(raw: RawScore): ScoreAnswer {
  const probabilities: Record<string, number> = { ...raw.probabilities };
  const entries = Object.entries(probabilities)
    .map(([level, p]) => [Number(level), p] as const)
    .sort((a, b) => a[0] - b[0]);

  if (entries.length === 0) {
    throw new Error("Jev returned a Score answer with no level probabilities.");
  }

  let bestLevel = entries[0]![0];
  let bestP = entries[0]![1];
  let tie = false;
  for (const [level, p] of entries.slice(1)) {
    if (p > bestP) {
      bestLevel = level;
      bestP = p;
      tie = false;
    } else if (p === bestP) {
      // Ties resolve to the lower level; entries are ascending so keep current.
      tie = true;
    }
  }

  return {
    score: raw.score,
    level: bestLevel,
    confidence: raw.confidence,
    probabilities,
    tie,
  };
}

export function normalizeJevAnswers(answers: {
  expense_category: RawChoice;
  has_business_purpose: RawNoul;
  has_external_party_identity: RawNoul;
  has_exception_explanation: RawNoul;
  explanation_quality: RawScore;
  requires_human_review: RawNoul;
}): JevSemanticResult {
  return {
    expense_category: normalizeChoice(answers.expense_category),
    has_business_purpose: normalizeNoul(answers.has_business_purpose),
    has_external_party_identity: normalizeNoul(answers.has_external_party_identity),
    has_exception_explanation: normalizeNoul(answers.has_exception_explanation),
    explanation_quality: normalizeScore(answers.explanation_quality),
    requires_human_review: normalizeNoul(answers.requires_human_review),
  };
}
