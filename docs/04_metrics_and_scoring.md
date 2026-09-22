# Metrics and scoring

Last reviewed: 2026-09-20

## Common live counters

| Metric | Definition |
| --- | --- |
| `processed` | Claims that reached an immutable terminal state, whether succeeded or failed; this is the progress-bar numerator |
| `total` | 1,000 input claims |
| `successful` | Claims with one valid final decision |
| `failed` | Claims ending without a valid final decision |
| `decisions_per_second` | `successful ÷ route elapsed seconds` |
| `current_latency` | End-to-end time for the most recently finalized claim decision |
| `elapsed` | Wall-clock time from the shared start signal until that route completes or stops |
| `cost` | Accumulated provider cost calculated from reported usage and the frozen tariff |

Do not use `judgments_per_second` as the shared headline metric. Jev has several internal judgments while DeepSeek returns one direct final decision. The shared unit is one finalized claim decision.

## Latency boundaries

### Jev route

Start immediately before the Jev request. Stop after typed values have returned and deterministic code has produced the final decision. Include only the tiny in-process routing computation after the API response.

### DeepSeek route

Start immediately before the DeepSeek request. Stop when the complete final decision is returned.

For both routes, exclude workbook loading, gold scoring, UI rendering, and result persistence.

Average is the arithmetic mean of successful claim latencies. P50 and P95 use nearest-rank percentiles. Total time is measured from the shared start signal through the route's final success or failure.

## Primary accuracy

Compare the predicted final result with `expected_route` from the gold row joined by `case_id`.

```text
final-route accuracy = correct final decisions / successfully scored claims
```

Also report:

- correct count;
- incorrect count;
- failed count;
- per-route precision and recall; and
- a 4 × 4 confusion matrix in saved results, even if the live page shows only overall accuracy.

Failed claims are excluded from primary route accuracy but remain prominently visible. A coverage-adjusted result may additionally divide correct decisions by all 1,000 claims.

## Jev-only diagnostics

After inference, Jev's original five intermediate fields may be compared with their gold columns to diagnose why final routes were correct or incorrect. These values are not common metrics and must not be presented as if DeepSeek were required to output them.

Jev normalization:

- Choice category: selected choice;
- Noul booleans: initial threshold `p(yes) >= 0.5`;
- Score quality: level with the highest native probability;
- probability distributions and confidence are preserved without affecting the gold answer automatically.

## Cost

Jev cost uses provider-reported input/output tokens and the configured run tariff.

DeepSeek cost distinguishes cache-hit input, cache-miss input, output, and applicable peak/off-peak rates. Freeze the tariff and timezone classification in the run manifest.

## Methodology invariants

- same ordered claim IDs;
- same four possible final outcomes;
- one provider request per claim per route;
- concurrency 1 per route;
- shared start signal;
- same version of the human-facing company policy;
- Jev uses its private compiled decision design; DeepSeek must not see that design;
- no gold access before final inference;
- no hidden repair of invalid outputs;
- actual model ID and configuration saved in the run manifest.
