# 报销决策 Benchmark — Jev vs. DeepSeek Flash

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

*[English](README.md)*

在同一份 1,000 条报销数据上对比两种 AI 架构，最终业务输出相同：四选一处理路线。
页面实时并排运行两条路线，展示速度、延迟、成本与准确率。

这比较的是**架构**，不是模型本身的优劣：

| | 左 · Jev（TypeSafe） | 右 · DeepSeek Flash |
| --- | --- | --- |
| **做法** | 一次 fan-out 请求拿到六个类型化判断，由普通代码完成计算、阈值与最终路由 | 每条请求都带完整公司制度 + 单条 claim，模型直接给出最终结果 |
| **模型输出** | `Choice` / `Noul` / `Score`，带原生概率 | 自然语言推理 → 最终答案 |
| **谁做决定** | 确定性代码 | 模型 |

两边读取同一份、同一顺序的输入；每条只发一次 API 请求；每边并发固定为 1；
由同一个开始信号启动后各自独立前进，快的一边不等慢的一边。

## 共同任务

> 根据公司制度和当前报销资料，这条报销应该如何处理？

只允许四个最终结果，双方都只按这一个输出计分：

| 结果 | 含义 |
| --- | --- |
| `auto_process` | 资料完整可信，且在普通政策范围内 |
| `manager_approval` | 超过审批阈值，或包含已充分说明的例外 |
| `request_more_information` | 可能合理，但缺少完成审核所需的普通资料 |
| `human_review` | 存在矛盾、混合公私用途、提示注入或严重歧义 |

## 什么保持相同，什么故意不同

一个诚实的架构对比，必须说清楚哪些被拉齐、哪些是刻意不同的。
这**不是**"同一个 prompt 比两个模型快慢"的测试。

**保持相同**

- 同一组 1,000 条 claim、同一顺序、同一个最终问题、同样四个允许结果。
- 每条、每个 provider 只有一次物理 API 尝试。
- 每边并发固定为 1，由同一个 start barrier 放行。
- 两边都看不到 gold labels。
- 都对照同一个 `expected_route` 计分。

**故意不同——这正是被测量的东西**

- Jev 使用开发者预先分解好的问题 + 普通代码；基线模型拿到的是完整的人类可读制度。
- Jev 返回中间的类型化判断；基线模型只返回最终决定。
- 两边的输入 token 数、内部计算和输出形态本就不同。

任何对外引用这些结果的地方都必须说明以上差异。这里检验的主张是：
**把任务分解成类型化判断 + 确定性代码**，能在准确率相当的前提下更快更便宜——
而不是"某个模型更聪明"。

## 快速开始

```bash
npm install
cp .env.example .env.local   # 填入两个 API key；.env.local 不会被提交
npm run dev                  # http://localhost:3000
```

需要 **Node.js >= 20**。

页面上有两个无需凭证、不产生费用的安全入口：

- **Run simulated demo** — 完全不发网络请求，用于查看界面。
  结果带醒目警示，永远不算 benchmark 数据。
- **Connection test (3 claims, real API)** — 真实调用，仅用于连通性验证。

完整的 1,000 条真实运行会产生实际费用，必须显式确认才能触发，不会被误操作启动。

### 获取 API key

| 变量 | 获取地址 |
| --- | --- |
| `TYPESAFE_API_KEY` | [TypeSafe AI](https://typesafe.ai) — Jev 模型 |
| `DEEPSEEK_API_KEY` | [DeepSeek 开放平台](https://platform.deepseek.com) |

key 只在 [`src/server/env.ts`](src/server/env.ts) 中读取：对浏览器只暴露"是否存在"的布尔值，
并从错误信息中抹除任何形似 key 的内容。key 不会被打印、序列化或下发到前端。

## 命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `build` / `start` | 开发、构建、生产启动 |
| `npm run lint` / `typecheck` | ESLint 与 TypeScript 检查 |
| `npm test` | Vitest 测试（66 项） |
| `npm run inspect -- <run_id>` | 只读审计某次运行，含 resume dry-run |
| `npm run score -- <run_id>` | 对已完成运行计分（拒绝 demo run） |

## 产出

每次运行在 `runs/<run_id>/` 下生成：

- `manifest.json` — 运行前一次性原子写入，之后不可修改。
  记录输入/gold/制度的 SHA-256、模型版本与冻结的计价表。
- `results.jev.jsonl` / `results.deepseek.jsonl` — append-only 终态记录
- `summary.json` — 计分后生成

`runs/` 已被 gitignore，你自己的结果只留在本地。

## 用于你自己的场景

内置的是报销场景，但项目要比较的是**架构**，不是某个具体领域。两条路径：

**同样的字段，换成你的数据。** 直接替换工作簿即可。列按**名称**匹配，
多余的列和不同的顺序都没问题。哈希和行数校验会降级为警告，
运行 manifest 里会记录 `dataset: "custom"`，结果不会与已发布数字混淆。

```bash
BENCHMARK_STRICT=1 npm test   # 恢复对已发布 benchmark 的严格哈希校验
```

**换一个领域** —— 工单、合同条款、内容审核。写一个 scenario 配置，
描述你的列、类型化判断、路由代码和最终结果。
runner、adapter、scorer、UI 都不用改。

编写指南见 **[SCENARIO.md](SCENARIO.md)**，可参考的完整实现见
[`src/config/expense-scenario.ts`](src/config/expense-scenario.ts)。

### 配合 Claude Code / Codex 使用

[CLAUDE.md](CLAUDE.md)（以及给 Codex 等工具的 [AGENTS.md](AGENTS.md)）
向 AI 工具说明了项目边界、花费控制，以及让这个对比保持有意义的那条设计规则。
用 Claude Code 或 Codex 打开仓库，直接描述你的任务就能让它起草配置：

> 读一下 SCENARIO.md，帮我写一个给客服工单分流的 scenario。
> 列定义在 data/tickets.xlsx 里。

AI 工具被要求坚守的设计规则是：**只问模型代码无法确定的部分。**
如果一个 scenario 直接让 Jev 给出最终结果，那就等于丢掉了被测量的那个架构。

## 目录结构

```
src/
  config/         scenario 契约 + 内置报销场景
  app/            Next.js 界面与 API 路由（run、status、stream）
  server/
    providers/    Jev + DeepSeek adapter、prompt、router
    scorer/       gold label 加载与计分（仅事后）
    run/          runner、controller、manifest、store
  lib/            共享类型、事件、i18n
data/             输入数据、gold labels、公司制度
docs/             规格、契约、指标、决策日志
tests/            Vitest 测试，含隔离/泄漏测试
```

## 数据说明

全部 benchmark 数据均为**合成数据**。"Harborstone Group"是虚构公司，
1,000 条数据中不含任何真实人员、供应商或交易。

- `data/01_finance_test_input.xlsx` — 模型可见的报销输入（1,000 行）
- `data/02_gold_labels.xlsx` — 计分标签，仅在结果落盘后读取
- `data/03_company_policy.md` — 公司制度与判断定义

## 不可违反的边界

以下由测试强制保证，而非仅靠约定：

- gold labels 只能在结果落盘后由 `src/server/scorer/` 读取；adapter 无法导入（有结构性测试）。
- DeepSeek 不得看到 Jev 的私有分解、中间问题或 gold（有 9 项泄漏测试）。
- 不保存、不展示 DeepSeek 的思维链，只保留公开 usage 中的 reasoning token 计数。
- 正式运行禁用自动重试；失败照实记录，不重发。
- API key 只存在于服务端环境变量中。
- 不伪造概率、时延、成本或准确率；模拟模式必须显著标注。

## 当前状态

实现已完成并通过验证：typecheck 与全部 66 项测试通过。
仓库中不包含已计分的 1,000 条完整运行结果——请自行运行以生成 `summary.json`。
任何对外公布的数字，只在该次运行 `manifest.json` 所记录的计价表下可复现。

延伸阅读见 [`docs/`](docs/README.md)：解释项目为什么这样设计——
类型化判断的设计依据、指标定义、数据字典、运行持久化，
以及一份记录了"改了反而更差并回滚"的决策日志。

## 许可证

[MIT](LICENSE)
