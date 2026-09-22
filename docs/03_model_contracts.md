# Model contracts

Last reviewed: 2026-09-20

## Shared final result

Both routes return:

```ts
type FinalDecision =
  | "auto_process"
  | "manager_approval"
  | "request_more_information"
  | "human_review";

type ClaimDecision = {
  case_id: string;
  decision: FinalDecision;
};
```

Only this final result is required from both providers. Jev's intermediate fields are provider-specific implementation data.

## Jev / TypeSafe

- Docs: https://docs.typesafe.ai
- SDK: `@typesafe-ai/sdk`
- Runtime: Node.js 20+
- Environment variable: `TYPESAFE_API_KEY`
- Current documented stable model at review time: `jev-1.13.0`; re-check and pin the actual version before a formal run.
- Pattern: Speculative Fan-Out.
- One claim produces one `systemOne()` request containing all approved semantic questions.
- Jev returns typed values and probabilities without generated explanations.
- Deterministic code produces the final result.

Original primitive mapping:

| Signal | Primitive | Native output |
| --- | --- | --- |
| Expense category | Choice | selected choice, distribution, confidence |
| Business purpose | Noul | probability of yes |
| External business party | Noul | probability of yes |
| Adequately explained exception | Noul | probability of yes |
| Explanation quality | Score | fractional score, level distribution, confidence |

A sixth `requires_human_review` Noul is approved because the original five signals do not identify contradictions, mixed use, adversarial instructions, serious ambiguity, or corrupted data reliably. It is sent in the same fan-out request. The full Jev-only contract is in `docs/06_jev_decision_design.md`.

## DeepSeek official API

- Base URL: `https://api.deepseek.com`
- Environment variable: `DEEPSEEK_API_KEY`
- Current model ID: `deepseek-flash`
- Current documented served version: DeepSeek-V4.1-Flash
- The retired `deepseek-v4-flash` identifier must not be used for a formal run.

DeepSeek receives:

- the complete standard policy in `data/03_company_policy.md`;
- one complete claim;
- the final question; and
- the four allowed final results.

DeepSeek does not receive:

- `docs/06_jev_decision_design.md`;
- Jev question definitions;
- Jev primitive names;
- the five or six intermediate Jev fields;
- gold labels, difficulty, case type, or rationale.

Use the official Responses API with a small JSON Schema containing `case_id` and `decision`. The schema constrains the interface but does not give DeepSeek Jev's reasoning decomposition.

DeepSeek is configured with thinking enabled and `reasoning_effort=high`. This configuration must be displayed and frozen in the run manifest. Reasoning content is neither stored nor displayed.

## Failure policy

- Automatic provider retries are disabled during timed runs.
- Timeout, provider error, empty result, invalid final label, or mismatched `case_id` records a failed claim.
- Failed claims increment the UI `processed` progress count because they reached an immutable terminal state, but they do not increment `successful` or `decisions_per_second`.
- Re-running creates a new run ID rather than modifying an earlier run.

## Credentials

Keys are server-side only. They may be supplied through the local runtime environment or an uncommitted `.env.local`; values are never printed, documented, committed, or sent to the browser.

## References

- TypeSafe SDK: https://docs.typesafe.ai/sdk/javascript
- TypeSafe state: https://docs.typesafe.ai/concepts/state
- TypeSafe primitives: https://docs.typesafe.ai/primitives
- TypeSafe Fan-Out: https://docs.typesafe.ai/patterns/fan-out
- TypeSafe confidence: https://docs.typesafe.ai/confidence
- DeepSeek quick start: https://api-docs.deepseek.com/zh-cn/
- DeepSeek Responses API: https://api-docs.deepseek.com/zh-cn/api/create-response/
