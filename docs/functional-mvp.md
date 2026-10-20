# Functional MVP 状态

已提供可调用的：项目接入 → 源码/规则 → 计划 → 快照修改 → 容器测试 → 签名证据 → Patch/报告。离线工作流已通过，在线认证阻塞，**AI Functional MVP 尚未完成验收**。

| 能力 | 当前入口/产物 |
| --- | --- |
| 外部只读注册 | project add/list/inspect/remove，注销只删登记 |
| 源码/规则 | code search/read/symbol/dependencies、project rules；路径/行号/commit/限量/降级原因 |
| 本地辅助规划 | project plan；deterministic、modelCalls 0，计划和能力缺口持久化 |
| 工作区 | workspace create/inspect/diff/cleanup；明确 commit，过滤记录，独立 Git baseline |
| 执行/证据 | isolation configure/check、command approve/run、evidence get/list/export；真实退出码、隔离、版本和 HMAC |
| AI 入口 | task run/smoke/status/report；官方运行时、计划门禁、预算、失败保留 |
| 诊断 | diagnostics import/query/failures/diagnose；JSONL/文本、trace/operation/time/severity、版本关联 |

diagnose 是真实可调用的确定性关联：读取失败、提取类型、检索相关代码、保存建议；匹配字符串不等于已证明根因。trace 场景的观察和测试失败分别保存报告。

日志导入可用 `diagnostics import --file <显式文件> --project <id> [--task <id>]` 绑定范围；Task/MCP 只能查询同项目且适用当前 Task 的事件，明确请求其他范围 ID 会留下拒绝证据。未绑定的本地导入只供本地查询，不自动进入模型上下文。

E2E-A/F 由真实静态接入和跨项目授权测试覆盖；B/D 为独立 grader + 真实容器；C 为 trace；E 为路径、链接、命令、敏感读取、注入警告、宿主访问、超时/取消拒绝；G 为独立在线 suite。离线修复为确定性测试步骤，不伪装模型自主修复。

标准任务见 `evals/functional-mvp/tasks.json`、`grader.mjs`：后端百分比、前端状态、多组件错误阶段。记录耗时、模型步骤、工具回执、命令次数、人工介入、独立最终测试与 Patch。尚无直接 Codex 同任务对照，不能据工具数量宣称效率或模型能力提升。

实际增加的是可复现工程输入、隔离执行、计划/诊断契约及版本证据约束。真实自主成功率需要在线数据。协议可用、独立工具可用、离线工作流可用、AI Agent 可用和真实源接入可用分别判断；Online E2E 与必要真实项目验证均成功才能完成 AI Functional MVP。
