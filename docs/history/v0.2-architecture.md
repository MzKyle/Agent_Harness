# V0.2 架构与当前实现

保留 monorepo 与 M0/M1 API。Core 不依赖 DSH。

| 模块 | 实际职责 |
| --- | --- |
| `packages/core/src/v2` | 外部 Registry、Code/Rules、Plan/Task、Workspace、Execution、Evidence、Diagnostics；严格 Schema、过滤、门禁与预算 |
| `packages/adapters` | 原有 Python/Node/.NET 检测；engineeringSystem 组合服务 |
| `packages/diagnostics-mcp` | 标准 SDK stdio；项目/Task 授权、限量工具、结构化输出和回执；main 按选项注入 Codex delegate 接口 |
| `packages/dsh-bridge` | 官方 DSH Profile/JSON 事件、官方 Codex provider 容器；无自制 LLM 客户端、上下文压缩或 Agent Loop |
| `apps/cli` | 人工批准、工作流与验收入口；legacy.ts 保留旧命令 |
| `skills` | 接入、结构化规划、观测设计、持久化能力缺口 |
| `evals/functional-mvp` | 独立 grader、真实容器/MCP 测试、分层离线/在线/真实项目报告 |

链路：CLI/MCP/Skills → Framework-independent Core → 注入 AgentDriver → 官方 DSH runtime。Core 管理状态门禁，模型内部行动循环仍由 DSH/Codex 实现。

状态默认 `.devagent-state`：projects、workspaces、tasks、approvals、plans、gaps、evidence、diagnostics、artifacts、reports、runtime。源目录与状态目录不能互相包含。日志/证据达到限额拒绝新增，要求人工归档，不自动删除审计历史。

TypeScript 使用官方编译器 AST 提取声明与 import；Python/C# 使用词法静态提取，不是语义解析或动态调用图。架构层来自有路径证据的候选模块。Graphify 没有当前安全执行器中的授权 runner，明确降级受限源码查询；不会在原目录运行或更新索引，也不会发送整个图缓存。

项目读取授权、远端分享和命令批准独立。真实源 local-only，本轮仅 fixture 在线。快照来自明确 Commit，建立独立 Git baseline；工作区版本是允许源码内容摘要。完成任务需计划及所有批准命令在最终版本的签名成功证据。

最多 3 次实际命令、60 次变更操作、200 次单任务 MCP 回执；文件锁串行化计数，执行并发 1。进程崩溃后的遗留锁需人工确认。兼容旧 project.yaml、init/inspect/runtime 和双工具 MCP；V2 独立 schemaVersion 2。保留 V1 计划 Schema，新增 V2 submit_plan 契约。Core 新增 TypeScript 运行时依赖复用已固定版本，以调用官方解析器。
