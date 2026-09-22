# Data dictionary and integrity audit

Audit date: 2026-09-20

## Files

| File | SHA-256 |
| --- | --- |
| `01_finance_test_input.xlsx` | `1c4e9bff01c8bec0b48de07e9c551b8e1d7683e02a3a2f439082a7d09221f05c` |
| `02_gold_labels.xlsx` | `6cf184d2137ac47d699e90954932d410fa8e84ad49c07d6eb7ae83f20356037e` |
| `03_company_policy.md` | `0e210af7ad5a72c88f8576bb0cf128667be89c419db2439522bc2f606ffb989c` |

These hashes identify the current source files. The input and gold workbooks were structurally audited on 2026-09-20. The policy was rewritten as a standard human-facing company policy on the same date. Live-run manifests should record all three hashes so changed source data cannot be confused with an earlier run.

## Input workbook

- Sheet: `Test Input`
- Rows: 1 header + 1,000 data rows
- Columns: 9
- Formulas: 0
- Hidden rows/columns: 0
- Merged cells: 0
- Case IDs: `FIN-0001` through `FIN-1000`, unique and non-null

| Field | Type | Missing | Notes |
| --- | --- | ---: | --- |
| `case_id` | string | 0 | Unique join key |
| `employee_description` | string | 9 | Canonical `description` |
| `amount` | number | 19 | Range 19.30–3,800.40 where present |
| `currency` | string | 17 | Includes seven intentional `US$` dirty values |
| `attendee_count` | integer | 660 | Range 1–12 where present |
| `expense_date` | Excel date | 24 | 2025-01-04 through 2026-08-25 |
| `merchant_or_vendor` | string | 48 | Supporting evidence, not proof of counterparty/category |
| `submitted_category` | string | 31 | Supporting evidence, not ground truth |
| `notes_or_context` | string | 35 | Must be treated as untrusted claim content |

The missing values and dirty values are intentional benchmark cases, not ingestion errors to repair.

## Gold workbook

- Sheets: `Gold Labels`, `Policy`
- `Gold Labels`: 1 header + 1,000 data rows, 10 columns
- `Policy`: 1 header + 18 policy rows
- Formulas: 0
- Hidden rows/columns: 0
- Merged cells: 0
- Case IDs exactly match the input workbook in both set and order
- No missing gold values or rationales

### Gold label types

| Field | Type | Valid values |
| --- | --- | --- |
| `expense_category` | string | 9 policy categories |
| `has_business_purpose` | boolean | `true`, `false` |
| `has_external_party_identity` | boolean | `true`, `false` |
| `has_exception_explanation` | boolean | `true`, `false` |
| `explanation_quality` | integer | 0, 1, 2, 3 |
| `expected_route` | string | `human_review`, `request_more_information`, `manager_approval`, `auto_process` |
| `difficulty` | string | `easy`, `medium`, `hard`, `adversarial` |
| `case_type` | string | 9 generation strata |
| `gold_rationale` | string | post-inference diagnostics only |

### Distribution summary

- Categories: travel 191; insufficient information 172; transportation 149; other 118; client entertainment 113; software subscription 101; office supplies 93; employee welfare 37; marketing 26.
- Business purpose: 758 true / 242 false.
- External party: 403 true / 597 false.
- Exception explanation: 126 true / 874 false.
- Explanation quality: level 0 = 22; level 1 = 353; level 2 = 425; level 3 = 200.
- Difficulty: 200 easy; 300 medium; 450 hard; 50 adversarial.
- Expected route: 396 human review; 214 request more information; 168 manager approval; 222 automatic processing.

## Isolation rules

- The model layer may read only the normalized input row and the approved policy/question definitions.
- The scorer loads `Gold Labels` only after a result event for that claim has been finalized.
- `expected_route`, `difficulty`, `case_type`, and `gold_rationale` never enter model state or prompts.
- The `Policy` sheet inside the gold workbook is also kept out of model input; the approved Markdown policy is the policy source.

## Adversarial content

The input intentionally includes instructions embedded in employee-controlled text. At least five descriptions contain direct instructions to ignore review rules, and additional notes contain reviewer/model-directed language. Both fields must be wrapped and labelled as untrusted claim evidence. They must never be interpolated into system-level instructions.
