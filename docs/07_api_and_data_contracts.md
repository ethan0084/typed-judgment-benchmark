# API 与数据契约

最后更新：2026-09-20

本文是实现 adapter 和 runner 的规范。示例字段是契约，不是可直接复制的完整生产代码。

## 1. 规范化 claim

```ts
type Claim = {
  case_id: string;
  employee_description: string | null;
  amount: number | null;
  currency: string | null;
  attendee_count: number | null;
  expense_date: string | null; // ISO YYYY-MM-DD after workbook normalization
  merchant_or_vendor: string | null;
  submitted_category: string | null;
  notes_or_context: string | null;
};
```

- 不补写缺失值，不把 `US$` 等脏值自动纠正为 gold 所期待的值。
- 每条 API 请求只允许包含一个 `Claim`。
- claim 字段顺序与规范化逻辑必须固定并计算 `claim_payload_hash`。
- 员工文字必须序列化为数据，不能成为高优先级 prompt 指令。

## 2. 统一最终结果

```ts
type FinalDecision =
  | "auto_process"
  | "manager_approval"
  | "request_more_information"
  | "human_review";
```

共同最终问题：

> 根据适用规则和当前报销资料，这条报销应该自动进入常规处理、交经理审批、退回补充资料，还是交财务人工复核？

## 3. Jev 请求契约

### 输入

- provider：TypeSafe AI。
- SDK：`@typesafe-ai/sdk`。
- 方法：一次 `client.systemOne(...)`。
- model：正式运行前锁定明确版本，当前候选 `jev-1.13.0`。
- state：仅当前规范化 claim，并明确所有文字是 untrusted evidence。
- questions：`docs/06_jev_decision_design.md` 中批准的全部独立问题，一次发出。
- 完整公司制度不逐条发送给 Jev。
- gold、expected route、difficulty、case type、rationale 绝不发送。

已批准的六个问题 key：

```ts
type JevSemanticResult = {
  expense_category: ChoiceAnswer;
  has_business_purpose: NoulAnswer;
  has_external_party_identity: NoulAnswer;
  has_exception_explanation: NoulAnswer;
  explanation_quality: ScoreAnswer;
  requires_human_review: NoulAnswer;
};
```

第六项已在 `TASK-001` 中于 2026-09-20 获得批准，live router 必须包含它。

### 输出

- 原样保留 provider 返回的实际 versioned model ID。
- Choice：choice、全分布、selected probability、native confidence。
- Noul：yes probability 和阈值后的 boolean；禁止把 yes probability 改名为 confidence。
- Score：raw score、level distribution、native confidence、用于路由的离散 level。
- deterministic router 追加最终 `decision`。
- 不请求或拼接生成式解释。

### Jev 计时边界

`request_started_monotonic` 在调用前立即记录；API 返回后立即执行纯内存 router；router 得到合法 final decision 时记录 `decision_finished_monotonic`。二者差值是 latency。JSONL 写入与 scoring 不包含在内。

## 4. DeepSeek 请求契约

### 接口

- Base URL：`https://api.deepseek.com`
- Endpoint：`POST /responses`
- Model：`deepseek-flash`
- Auth：server-only `DEEPSEEK_API_KEY`
- 每次请求无状态，不把上一条 claim 或回复带入下一条。
- 已冻结：thinking enabled、reasoning effort high。
- 正式运行不使用 streaming，以完整合法终态作为计时终点；UI 的“处理中”动画来自 runner state，不是假 token 流。

### 每条请求必须包含

1. 稳定的系统/说明段：角色、最终问题、四个结果的业务含义、员工文本不可信、只输出 schema。
2. `data/03_company_policy.md` 的完整原文，每条请求均包含。
3. 当前一条规范化 claim，放在明确的数据边界中。
4. JSON Schema output contract。

不得包含：

- `docs/06_jev_decision_design.md`；
- Jev 的问题名、criteria、primitive 或阈值实现；
- gold workbook 的任何列；
- 其他 claim；
- 模型之前的回答；
- 要求展示思维链的指令。

### 结构化输出

```json
{
  "type": "json_schema",
  "name": "expense_claim_decision",
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["case_id", "decision"],
    "properties": {
      "case_id": { "type": "string" },
      "decision": {
        "type": "string",
        "enum": [
          "auto_process",
          "manager_approval",
          "request_more_information",
          "human_review"
        ]
      }
    }
  }
}
```

adapter 必须验证返回 `case_id` 与请求一致。额外字段、非法 label、空输出或不完整 response 都是失败，不做隐藏的第二次“修复请求”。

如 API 返回 reasoning item，不写入结果、不发到浏览器、不纳入可下载 artifact。可以保留 provider usage 中公开的 reasoning token 计数，但不保存内容。

### DeepSeek 计时边界

在发起 HTTP/SDK 请求前立即记录 monotonic time；接收到 completed response 并通过 schema 与 case ID 校验后停止。JSONL 写入与 scoring 不包含在内。

## 5. 终态记录契约

每个 provider 使用独立 append-only JSONL。每一行代表一个不可变终态：

```ts
type TerminalResult = {
  schema_version: 1;
  run_id: string;
  provider: "jev" | "deepseek";
  sequence: number;             // 0..999 input order
  case_id: string;
  claim_payload_hash: string;
  status: "succeeded" | "failed" | "unknown";
  decision: FinalDecision | null;
  started_at: string;           // UTC ISO timestamp
  finished_at: string;
  latency_ms: number;
  provider_request_id: string | null;
  requested_model: string;
  resolved_model: string | null;
  usage: Record<string, number> | null;
  calculated_cost: {
    currency: "USD" | "CNY";
    amount: number;
    tariff_id: string;
  } | null;
  jev_semantic: JevSemanticResult | null;
  error: {
    category: "timeout" | "provider" | "invalid_output" | "case_mismatch" | "interrupted";
    code: string | null;
    safe_message: string;
  } | null;
};
```

- DeepSeek 的 `jev_semantic` 永远为 `null`。
- 错误信息先脱敏，禁止包含 key、完整 headers、完整 request 或 reasoning。
- `unknown` 仅用于进程在请求发出后、终态落盘前崩溃，且无法确认 provider 是否已计费/完成的情况。为保证“每条最多一次物理请求”，恢复时默认不自动重发 unknown；由用户决定是否创建新 run。
- 终态行落盘并 fsync/等价保证后，才发布 `result_finalized` 事件并允许 scorer join gold。

## 6. Run manifest 契约

创建 run 前一次性写入，进入 running 后不可修改：

- run ID、created/start time、mode（demo/live）、schema version；
- 三个数据文件 path、SHA-256、sheet、row count；
- ordered case ID hash；
- Jev requested model、question spec hash、Noul thresholds、SDK version、retry count；
- DeepSeek model、policy hash、prompt template hash、thinking、effort、API format、retry count；
- 每边 concurrency=1、共同 start barrier、timeout；
- 两家费率快照、币种、时区、峰谷规则、抓取时间和文档 URL；
- 应用 git commit（若存在）、dirty flag、Node/package versions；
- gold isolation version 和 scorer version。

manifest 先写临时文件，再原子 rename。run 开始后只追加状态事件，不能回写原 manifest 来“修正”配置。

## 7. Scoring 契约

scorer 的输入只有已落盘 `TerminalResult` 与 gold workbook。它按 `case_id` join：

- succeeded 且 label 合法：进入 primary accuracy 分母；
- failed/unknown：不进入 primary accuracy，但进入 failure/coverage；
- coverage-adjusted accuracy：correct / 1000；
- 输出 correct、incorrect、failed、unknown、per-route precision/recall 和 4×4 confusion matrix。

Jev 的五个原有中间字段可以在终态后做诊断评分；DeepSeek 没有这些字段，不产生假值。

## 8. 请求计数与重试

- 形式化 benchmark：adapter 层和 provider SDK 层 retry 均为 0。
- 每条 provider 的 `attempt_count` 必须为 1；失败照实记录。
- 429、5xx、timeout、schema error 都不能在同一 run 自动重发。
- 开发期的连接测试必须使用单独 run ID 和 `mode=development`，不进入正式汇总。
- 若官方 SDK 无法确认关闭自动重试，实施者必须先解决或换用能够明确控制请求次数的官方兼容调用方式，不能凭猜测继续。
