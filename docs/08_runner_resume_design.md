# 双 Runner、持久化与断点续跑设计

最后更新：2026-09-20

## 1. 目标

系统必须允许 UI 刷新、服务重启、额度中断或模型接手后继续，而不依赖聊天上下文，也不静默重复付费调用。恢复依据只能是 immutable manifest 和 append-only artifacts。

## 2. 状态机

Run 状态：

```text
created -> ready -> running -> completed
                     │  ├----> stopped
                     │  └----> crashed
                     └-------> blocked
```

Provider/claim 状态：

```text
pending -> in_flight -> succeeded
                    ├-> failed
                    └-> unknown  (process dies after send, before durable terminal write)
```

`unknown` 不能自动当作 pending。否则恢复时可能第二次调用同一条，破坏“一条一次请求”。

## 3. 同时启动、独立推进

1. 进程启动时一次性读取并验证输入，把 claims 冻结为 ordered immutable array。
2. 创建 manifest、provider 文件和事件流。
3. Jev 与 DeepSeek runner 都完成初始化并报告 ready。
4. controller 写入一个 shared monotonic/UTC start event，再同时释放 barrier。
5. 每个 runner 独立循环：找到本 provider 的第一条 pending claim，发一次请求，落一个终态，再取下一条。
6. 任一 provider 结束不停止另一边。UI 分别显示两边状态。

绝不使用下面的锁步形式：

```text
for claim: await Promise.all([jev(claim), deepseek(claim)])
```

它会让快模型每条都等待慢模型，不能反映真实吞吐。应是两个各自 sequential 的 promise，在 run 层共同 `Promise.allSettled`。

## 4. Run 目录

建议结构：

```text
runs/<run_id>/
  manifest.json
  run-state.json
  events.jsonl
  jev/
    results.jsonl
    inflight.json
  deepseek/
    results.jsonl
    inflight.json
  scoring/
    jev-summary.json
    deepseek-summary.json
    comparison-summary.json
```

- `runs/` 默认 gitignore。
- live、demo、development 使用不同 run ID 前缀或 manifest mode。
- 不把完整 request、API headers、keys、DeepSeek reasoning 写入目录。
- `run-state.json` 是方便 UI 读取的派生快照，允许原子替换；权威事实仍是 manifest + JSONL。

## 5. 单条安全写入顺序

每个 provider 对一条 claim：

1. 原子写 `inflight.json`：run、provider、case、sequence、started_at、payload hash、attempt=1。
2. 发出唯一 API 请求。
3. 得到结果或错误后，构造完整 `TerminalResult`。
4. 以单行 append 到 provider `results.jsonl`，flush/fsync 或使用具有同等持久性的实现。
5. 清除/原子替换 `inflight.json`。
6. 追加 `result_finalized` event。
7. scorer 此时才可按 case ID 读取 gold 并更新派生 summary。

必须保证 JSONL 每行完整。启动恢复时如果最后一行因崩溃不完整，把它隔离为 corruption event，不能猜测内容。

## 6. 恢复算法

恢复某个 run 时：

1. 读取 manifest，重新计算数据、policy、question/prompt 和 ordered case IDs hash；任何不匹配都拒绝续跑。
2. 逐行验证两边 JSONL schema、provider、run ID、sequence、case ID 和 payload hash。
3. 每个 provider 建立已终态 case set；重复 case 是审计失败，自动停止。
4. 检查 `inflight.json`：
   - 若该 case 已有终态行，inflight 是残留，记录清理事件；
   - 若没有终态行，则标记为 `unknown`，默认不重发。
5. 没有 unknown 时，从该 provider 第一条未终态 case 继续；两边仍各自单并发。
6. 有 unknown 时，将 run 设为 blocked，要求用户决定：接受缺口并结束，或创建一个全新的 run。不能在原正式 run 偷偷补发。

这套策略优先保证调用次数真实性。若未来 provider 提供可查询的幂等 request key/结果接口，可经官方文档验证后扩展，但当前计划不假设存在。

## 7. UI 与 runner 解耦

- 浏览器只订阅事件并请求派生 snapshot，不拥有 runner 生命周期。
- 刷新、关闭页面或 SSE/WebSocket 断线不取消服务端 benchmark。
- 重连时先取 snapshot，再从最后 event sequence 继续。
- 当前 claim 来自各自 runner state，因此左右可能不同。
- Stop 操作只阻止发起下一条；正在进行的请求等待终态或 timeout，不粗暴杀死后自动重发。
- 页面完成后保留数据，不导航到第二页。

## 8. 事件契约

最少事件：

- `run_created`
- `provider_ready`
- `run_started`
- `claim_started`
- `result_finalized`
- `score_updated`
- `provider_completed`
- `provider_stopped`
- `provider_blocked`
- `run_completed`
- `run_crashed`

每个事件带 `event_sequence`、UTC timestamp、run ID、provider（如适用）和 safe payload。事件只用于重建 UI；最终审计以 results JSONL 为准。

## 9. Demo 模式

- fake adapters 使用固定 seed 与显式 `mode=demo`。
- 可随机模拟时延和成本用于看页面，但页面每个区域都显示 DEMO。
- demo 不读取 API key、不调用 provider、不读取 gold 生成“漂亮结果”。
- demo artifacts 与 live 目录隔离，不计入正式历史。
- 从 demo 切 live 必须创建新 run，不能在原 run 中途换 adapter。

## 10. 必测故障场景

在真实 API 前用 fake adapters 自动测试：

1. Jev 快、DeepSeek 慢，两边不锁步，max in-flight 都为 1。
2. 某条返回 429/500/timeout，只有一次调用，记录 failed 后继续下一条。
3. 进程在请求前崩溃：该 claim 仍是 pending，可安全恢复。
4. 进程在请求发出后、终态落盘前崩溃：标记 unknown，不自动重发。
5. 进程在终态落盘后、清理 inflight 前崩溃：恢复识别已有终态，不重复调用。
6. JSONL 最后一行被截断：检测并阻塞，不吞掉错误。
7. 数据或 policy hash 改变：拒绝恢复旧 run。
8. 浏览器刷新/重连：runner 不受影响，UI 恢复一致状态。
9. gold loader 在结果落盘前被调用：测试必须失败。
10. 同一 provider/case 出现第二条终态：审计失败。

## 11. 人工续接协议

如果开发工作本身中断，而不是 benchmark 运行中断，新模型只需：

1. 阅读 `docs/` 下的编号设计文档，确认架构与不可违反的边界。
2. 检查工作区已有变更，避免覆盖他人修改。
3. 完成一个小阶段并验证后再进入下一阶段。

任何只存在于聊天但没写入上述文件的决定，都不算正式项目决定。
