# Design documents

Why the benchmark is built the way it is. Start with
[README.md](../README.md) for what it does, and
[SCENARIO.md](../SCENARIO.md) to adapt it to your own task.

Documents marked **normative** are cited by code comments as the source of
truth for a rule. Changing the code without changing them — or the reverse —
leaves the project inconsistent.

| Document | What it covers |
| --- | --- |
| [02_data_dictionary.md](02_data_dictionary.md) | **Normative.** Every input and gold column, how dirty values are normalized, and why missing data is preserved rather than repaired. |
| [03_model_contracts.md](03_model_contracts.md) | The shared result shape both routes return, and each provider's request/response contract. |
| [04_metrics_and_scoring.md](04_metrics_and_scoring.md) | What counts as one decision, where latency starts and stops, and how accuracy, precision, and recall are computed. |
| [05_decision_log.md](05_decision_log.md) | **Normative.** Dated record of decisions and their reasons — including measured changes that made results *worse* and were rolled back. |
| [06_jev_decision_design.md](06_jev_decision_design.md) | **Normative.** The six typed judgments, why each is worded as it is, and how deterministic code turns them into one route. The best reference for writing your own scenario. |
| [07_api_and_data_contracts.md](07_api_and_data_contracts.md) | **Normative.** HTTP routes, the event stream, and the on-disk run artifacts. |
| [08_runner_resume_design.md](08_runner_resume_design.md) | The run state machine, append-only persistence, and how a run resumes after a restart without repeating paid calls. |

## Reading order

**Understanding the comparison** — [06_jev_decision_design.md](06_jev_decision_design.md),
then [04_metrics_and_scoring.md](04_metrics_and_scoring.md).

**Changing the data** — [02_data_dictionary.md](02_data_dictionary.md) first.

**Changing the runner or persistence** — [08_runner_resume_design.md](08_runner_resume_design.md)
and [07_api_and_data_contracts.md](07_api_and_data_contracts.md).

**Wondering why something is odd** — [05_decision_log.md](05_decision_log.md).
It records the failed attempts too, so you don't repeat them.

Some documents are in Chinese and some in English, reflecting how they were
written. Both describe the same system.
