# Decision log

## 2026-09-20 — confirmed

- The product is a single-page, left-versus-right benchmark.
- Jev is shown on the left; DeepSeek Flash is shown on the right.
- Both routes receive the same ordered claims, produce one of the same four final results, and use the same number of provider calls.
- Both runners start together and use concurrency 1 independently.
- One claim is one provider request per route. The Jev request contains its approved fan-out questions; the DeepSeek request asks only for the final result.
- Demo mode is allowed for UI review only; live results must use real calls and real data.
- Gold labels, including `expected_route`, are used only after the final result is fixed.
- Jev preserves native Choice, Noul, and Score outputs; DeepSeek probabilities are not fabricated.
- The two reference images are available locally and establish the visual direction.
- Both workbooks contain 1,000 matching, ordered, unique case IDs and pass structural validation.
- Missing and dirty input fields are intentional test cases and must not be cleaned away.
- `notes_or_context` is model-visible, untrusted evidence and must be displayed in the current-claim panel.
- DeepSeek will use the official API.
- The shared business objective is the final handling decision, not the five intermediate Jev fields.
- Final results are `auto_process`, `manager_approval`, `request_more_information`, or `human_review`.
- Jev uses targeted typed judgments plus deterministic code; the general-purpose model reads the standard company policy and directly determines the final result.
- `data/03_company_policy.md` is a normal human-facing policy with all Jev, benchmark, primitive, and gold-label instructions removed.
- The Jev-only decomposition is stored separately in `docs/06_jev_decision_design.md` and must not be shown to the general-purpose model.
- Each provider takes one row at a time through its API. Jev does not receive the full policy per row; DeepSeek receives the complete standard policy on every row.
- The two concurrency-1 runners share a start barrier and then advance independently. They are not locked together per row.
- Project continuity is file-based: the numbered design documents in `docs/` are authoritative over chat memory.
- A run uses append-only provider result logs and an immutable manifest. An interrupted in-flight request with no durable terminal result becomes `unknown` and is not automatically retried.

## 2026-09-20 — approved technical decisions

The following recommendations were approved by the user on 2026-09-20:

- Display and call the current official model as `DeepSeek V4.1 Flash` / `deepseek-flash`; do not use the retired `deepseek-v4-flash` identifier. Re-check the current official model immediately before implementation and formal runs.
- Use the DeepSeek Responses API with JSON Schema structured output.
- Configure DeepSeek with thinking enabled and `reasoning_effort=high`; record it visibly in the run manifest, while storing no reasoning content.
- Disable automatic retries for both providers during timed runs so the physical call counts remain equal.
- Add the sixth Jev Noul `requires_human_review` to the same fan-out request as the original five judgments.
- Give DeepSeek the standard company policy. Keep Jev's private compiled question criteria separate while keeping the gold workbook isolated from both routes.

## Remaining external prerequisites before live mode

1. Make `TYPESAFE_API_KEY` available to the project's server runtime without exposing its value.
2. Create and configure `DEEPSEEK_API_KEY` locally.
3. Re-check current model IDs, pricing, and SDK retry controls immediately before implementation and again before a formal run.
4. Obtain explicit user approval before any paid full 1,000-claim run.

## 2026-09-20 — TASK-001A 官方文档复核快照

复核方式：直接读取官方在线文档与 SDK 源码，未发送任何模型请求，未读取密钥。

### TypeSafe / Jev

- 当前模型 ID：`jev-1.13.0`（别名 `jev-latest`、`jev-preview` 当前均解析到同一版本）。
- 正式 run 固定写死 `jev-1.13.0`，不使用别名，避免运行中版本漂移。
- 计价：输入 $42 / 十亿 tokens（$0.042 / 百万 tokens）；输出免费。
- 限流：250,000 tokens/s，1,200 requests/min。
- 上下文：单请求 64k（state 32k + 最长问题）。
- 包名：`@typesafe-ai/sdk`，要求 Node.js 20+。
- 响应会返回实际处理请求的 versioned model ID，按契约原样保存。

### TASK-011 结论：SDK 可以确定性关闭自动重试

SDK v0.6.0 `src/client.ts` 的重试循环为 `for (let attempt = 0; ; attempt++)`，
`retriesLeft = req.retry.maxRetries - attempt`，且校验函数允许 `maxRetries` 为 0。

因此构造客户端时传入 `retry: { maxRetries: 0 }` 即可保证每条 claim 只有一次物理请求。
不需要改用裸 HTTP 调用。TASK-011 的前置风险解除。

### DeepSeek

- Base URL：`https://api.deepseek.com`，端点 `POST /responses`。
- 模型：`deepseek-flash`（DeepSeek-V4.1-Flash）。
- `reasoning.effort` 合法值：`none` | `low` | `high` | `max`；已冻结的 `high` 有效。
- `text.format` 支持 `{"type":"json_schema","name":...,"schema":...}`，与既有输出契约一致。
- usage 字段：`input_tokens`、`input_tokens_details.cached_tokens`、`output_tokens`、
  `output_tokens_details.reasoning_tokens`、`total_tokens`。
  只保存 reasoning token 计数，不保存 reasoning 内容。
- 计价（USD / 百万 tokens，deepseek-flash）：
  - 峰时：cache hit $0.006，cache miss $0.3，output $1.2
  - 谷时：cache hit $0.003，cache miss $0.15，output $0.6
- 峰时定义：UTC 周一至周五 01:00–04:00 与 06:00–10:00（不含中国法定节假日）；其余为谷时。
- 由于本项目每条请求都带完整公司制度，cache hit 比例会显著影响成本，
  必须按 provider 返回的 `cached_tokens` 分别计价，不得用单一费率估算。

### 后续动作

费率与模型 ID 在开跑前仍需再次确认，并写入 immutable run manifest 的 tariff 快照。

## 2026-09-20 — Jev 问题措辞校准（explanation_quality 与 requires_human_review）

### 触发原因

40 条真实运行后发现界面上几乎没有 `auto_process`。排查结论：

- **数据没问题**：gold 全量 1,000 条中 `auto_process` 有 222 条（22.2%），前 20 条就有 3 条。
- **router 规则没问题**：gold 里 222 条 `auto_process` 的 `explanation_quality` **全部是 L2 或 L3**，
  没有一条 L0/L1，与 `level <= 1 → request_more_information` 的规则完全一致。
- **真正原因**：Jev 的 Score 系统性低估约一档。40 条里有 36 条被打成 L1，
  而 gold 全量分布是 L0=22 / L1=353 / L2=425 / L3=200（L1 仅约 35%）。
  低估后被 `level <= 1` 拦截，`auto_process` 几乎无法产生。

### 改动一：重写 explanation_quality 的 rubric

旧 L1「critical information is missing, ambiguous, or contradictory」过于宽松，
且与 L2「not fully complete」语义重叠，模型无法区分，默认下沉到 L1。

新 rubric 让四档互斥且各自描述具体情形，并在 instructions 中明确：
只判断「审核人能否看出买了什么、为什么是公务支出」，
不因措辞、简写、口语、拼写或非必要细节而降级。

效果（同样 20 条，真实 API）：

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| 等级低估 | 8/20 | 2/20 |
| 出现 L3 | 0 | 4 |
| `auto_process` | 1 | 2 |
| 最终准确率 | 75% | 80% |

### 改动二：收紧 requires_human_review 的 criteria

剩余错误全部是该 Noul 的假阳性（4 次假阳、0 次漏判）：
把「资料不全、应退回补充」误判为「需 Finance 介入」。
旧措辞中的 "unresolved classification ambiguity" 与「信息缺失」边界模糊。

新措辞显式排除：claim 仅仅是不完整、含糊、单薄或目的不清时一律答 no，
并强调「只根据 claim 已经写了什么判断，不根据它遗漏了什么」。

效果：**无改善**，假阳仍为 4，决策分布不变。
经查那 4 条文本（如 "Hotel charge from last week."、"Team meal, six people."）
确实只是信息不全、无矛盾无指令，但 Jev 仍给出 P(YES)=0.72~0.79。
结论：措辞已到位，这是模型在该边界上的固有倾向，剩余杠杆在 Noul 阈值。

### 阈值分析（20 条样本，未采纳）

两类 P(YES) 分布存在实质重叠：真需人工的最低 0.50，不需人工的最高 0.79。

| 阈值 | 正确 | 假阳 | 漏判 |
| ---: | ---: | ---: | ---: |
| 0.5（当前） | 13 | 4 | 0 |
| 0.7 | 11 | 3 | 2 |
| 0.8 | 9 | 0 | 4 |

0.8 可消除全部假阳但会漏判 4 条真正需要人工复核的（业务风险更高）。
20 条样本过小，现在调整容易过拟合。

### 决定

**保持 `NOUL_THRESHOLD = 0.5` 不变**，先用当前配置跑完整 1,000 条，
拿到全量概率分布后再决定是否调整阈值。用户于 2026-09-20 确认此方向。

### 冻结值

- 新 `question_spec_hash`：`48d0c8e508bf8be91b5c500f6834246ccb45ce01ddc7b6fb19ea28b0a8b8011f`
- 此前运行（hash `0be87ff7…`、`e157ae96…`）使用旧措辞，
  **不可与新配置的结果直接比较**。

## 2026-09-21 — requires_human_review 三次修复尝试与回滚

### 全量运行结果（run `2026-09-20T13-06-26-321-development`）

Jev 完成 1,000 条，DeepSeek 跑到 58 条由用户停止。

| | Jev | DeepSeek |
| --- | ---: | ---: |
| 准确率 | 76.70% (767/1000) | 75.44% (43/57) |
| 平均时延 | 301 ms | 5,374 ms |
| P50 / P95 | 295 / 362 ms | 2,811 / 17,947 ms |
| 单条成本 | $0.000065 | $0.000589 |

在两边都跑过的同一批 57 条上，**准确率完全相同（均为 43/57 = 75.4%）**。
差异体现在工程指标：速度约 17.9x、成本约 9.1x、P95/P50 稳定性 1.2 vs 6.4。

### 诊断

233 个错误中 150 个（64%）是误判为 `human_review`。
按 case_type 拆解后定位到单一模式：**Jev 把「信息少」当成「有问题」**。

消融实验（逐个替换为完美答案）：

| 场景 | 准确率 |
| --- | ---: |
| 基线 | 76.7% |
| +完美 `requires_human_review` | **94.2%** |
| +完美 `explanation_quality` | 76.9% |
| +完美 `expense_category` | 76.9% |
| 六个全完美 | 100.0% |

六个判断全对时为 100%，证明 **router 规则本身完全正确**，
瓶颈唯一地集中在 `requires_human_review`。

### 三次尝试，全部失败

1. **改 Score rubric**（2026-09-20）：修好了 `explanation_quality` 的低估
   （8/20 → 2/20），但消融显示它对最终结果影响仅 0.2 个百分点。
2. **改 Noul criteria 措辞**：显式排除「仅仅是信息不全」。无效，假阳性不变。
3. **拆成两个 Noul**（本轮）：`has_substantive_defect` +
   `resolvable_by_asking_employee`，router 改为两者与运算。
   同一批 100 条上 **76.0% → 75.0%，略微变差**。

### 拆分为什么失败

机械层面正常（7 问一次 fan-out、router 逻辑正确），但两个新问题**同向答错**。
例 `FIN-0009`（"Hotel charge from last week." / "Per discussion."）：

- `has_substantive_defect` = true (0.82) — 但它陈述的内容并无矛盾
- `resolvable_by_asking_employee` = false (0.23) — 但问员工显然能解决

`resolvable_by_asking_employee` 尤其失败：在按定义即「可由员工解决」的
`missing_information` 上，18 条只答对 4 条；全样本 P(YES) 中位数仅 0.33、
最大 0.71；对 `request_more_information` 的召回率仅 19%。

`has_substantive_defect` 的精确率 78% / 召回率 80%，
相对原单 Noul（69.6% / 86.9%）是平移而非改善，误差还发生叠加。

### 决定：回滚

回滚至单 Noul 设计。`question_spec_hash` 已验证恢复为
`48d0c8e508bf8be91b5c500f6834246ccb45ce01ddc7b6fb19ea28b0a8b8011f`，
与全量 1,000 条运行的 manifest 完全一致，因此该次运行结果仍然有效可用。

**不再继续调优。** 76.7% 是这套设计在 Jev 上的真实水平。
「Jev 在『信息稀疏 vs 内容有缺陷』边界上存在系统性偏差，
且在三种不同问法下均未能通过 prompt 工程修正」——
这本身就是 benchmark 应当产出的结论，不应通过拟合 gold 来掩盖。

用户于 2026-09-21 确认回滚。
