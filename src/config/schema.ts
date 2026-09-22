/**
 * Scenario configuration contract.
 *
 * A scenario describes ONE batch-decision task: the input columns, the typed
 * judgments Jev is asked for, the deterministic routing code, and the outcomes
 * both providers are scored on. Swapping this object swaps the domain —
 * expense claims, support tickets, contract clauses — with no change to the
 * runner, adapters, scorer, or UI.
 *
 * See SCENARIO.md for the authoring guide.
 */
import type { choice, noul, score } from "@typesafe-ai/sdk";

/** One input column as it appears in the source workbook. */
export type FieldSpec = {
  /** Column name, matched against the sheet header. */
  name: string;
  /** How the raw cell is normalized. Missing values always become null. */
  type: "string" | "number" | "integer" | "date";
  /** Shown to the model; also documents the column for humans. */
  description?: string;
};

/**
 * The judgments sent to Jev in one fan-out request. Values are SDK primitives
 * (`choice` / `noul` / `score`). Keys become the semantic result keys the
 * router reads.
 */
export type QuestionSpec = Record<
  string,
  ReturnType<typeof choice> | ReturnType<typeof noul> | ReturnType<typeof score>
>;

/** Optional integrity pins. Omit any field to skip that check. */
export type IntegritySpec = {
  /** Expected SHA-256 of the input file. Mismatch warns unless `strict`. */
  input_sha256?: string;
  /** Expected SHA-256 of the rules document. */
  rules_sha256?: string;
  /** Expected SHA-256 of the gold file. */
  gold_sha256?: string;
  /** Expected row count. */
  expected_rows?: number;
  /**
   * When true, a mismatch throws instead of warning. Use for a published
   * benchmark whose numbers must be reproducible; leave false while iterating
   * on your own data.
   */
  strict?: boolean;
};

export type ScenarioConfig<Q extends QuestionSpec = QuestionSpec> = {
  /** Stable slug, recorded in the run manifest. */
  id: string;
  /** Human-readable name shown in the UI. */
  name: string;
  description?: string;

  /** Source files, relative to the project root. */
  files: {
    input: string;
    /** Sheet name for .xlsx input. Ignored for .csv. */
    input_sheet?: string;
    /** The full rules text handed to the baseline model on every request. */
    rules: string;
    /** Optional: omit to run without scoring. */
    gold?: string;
    gold_sheet?: string;
  };

  /** Input columns, in order. The first is the unique case identifier. */
  fields: readonly FieldSpec[];

  /** Allowed final outcomes. Both routes are scored on this single output. */
  outcomes: readonly string[];
  /** One line per outcome, used in the baseline prompt and the UI legend. */
  outcomeDescriptions: Record<string, string>;

  /** The typed judgments Jev answers in one request. */
  questions: Q;

  /**
   * Deterministic routing. Receives one normalized row plus Jev's typed
   * results and returns one outcome. This is ordinary code: put thresholds,
   * arithmetic, and priority order here, not in the questions.
   */
  route: (input: { row: Row; semantic: SemanticResult<Q> }) => string;

  /** The single question put to the baseline model. */
  baselineQuestion: string;

  integrity?: IntegritySpec;
};

/** One normalized input row. Values are untrusted, possibly missing evidence. */
export type Row = {
  case_id: string;
  [field: string]: string | number | null;
};

/** Jev's typed answers, keyed by question name. */
export type SemanticResult<Q extends QuestionSpec = QuestionSpec> = {
  [K in keyof Q]: {
    choice?: string;
    value?: boolean;
    level?: number;
    confidence: number;
    distribution?: Record<string, number>;
  };
};

/** Helper that preserves question-key types through `defineScenario`. */
export function defineScenario<Q extends QuestionSpec>(
  config: ScenarioConfig<Q>,
): ScenarioConfig<Q> {
  return config;
}
