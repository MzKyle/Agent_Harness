# V0.4.1 当前架构

Codex 负责推理与行动循环；Harness 提供本地上下文、作用域、审批、隔离执行、签名证据和可审查记忆。
不新增 Agent Loop、模型客户端或 MCP 工具名称，不新增 Harness 生产依赖。

| 模块 | 当前职责 |
| --- | --- |
| core/v2 | Registry / Task / Workspace / 容器执行 / Evidence；最终命令定义、版本与截断检查 |
| core/v3 | 画像、记忆、身份、预算上下文、V3 备份；本机签名摘要副本与审查归档 |
| core/v4 | Work 三类状态、恢复 Journal、lease、事件分片、异步诊断、静态模式、回执分片 |
| codex-integration | 官方 CLI/app-server 薄适配；认证上下文、附件配置、逐次执行配置分离 |
| diagnostics-mcp | 标准 SDK；固定模式集合、作用域、预算、短期源码缓存、签名回执 |
| adapters / cli | 组合、ALS 语义映射；显式项目选择、受管运行、审查、接续与恢复 |

官方共享受管 CODEX_HOME 只复用认证，exec 忽略用户配置并完整覆盖单次配置；app-server 核对固定
受管配置 Hash，发现检查关闭 Hooks。附件拥有独立配置/Skill/Workspace，模型运行按认证上下文排他。
新建认证目录与配置目录也分离；Skill 由过滤 Workspace 的官方 `.agents/skills` 发现根提供，
完整文件路径开关并核对实际枚举，详见配置隔离中的早期禁用缺陷说明。
不声称官方 HOME 内所有缓存/日志物理分离，详见 [配置隔离](configuration-isolation.md)。

Work state 描述会话；engineeringOutcome 与 evidenceStatus 独立。模型最终回答不能晋升验证。
当前 Task、最终 Workspace 内容、全部批准命令及定义、源完整性共同决定结果。保留旧失败，旧通过
不能覆盖新 Revision。Journal 先落签名意图，再幂等更新；恢复重放 checkpoint/finalize/progress。
Evidence 先落盘而 Task 索引中断时，只从签名同 Task/Workspace 记录恢复关联。
单文件原子替换不等于跨文件事务；未知锁人工检查，只有可证明退出的本机 PID 锁可回收。

Fast 延迟画像/历史/诊断，brief 预算1800 UTF-8字节；Engineering 3600；Deep 6000。
Auto 静态选择，无分类模型请求。工具集合只减少暴露，不改变审批、隔离和分享。
源码缓存最多16条/每条64KiB，进程内按项目/Task/内容版本/查询绑定，编辑失效，不落盘源码。
运行记录官方 usage、完成 turn、调用类别、上下文字节、重复查询、测试和人工介入，不推算账单。

便携 schema 保持3，认证/权限/路径/原始证据留本机。知识索引3MiB、1500记忆、500摘要；到限摘要
另存本机签名历史并提示审查归档，已确认个人记忆不自动删。回执和事件超窗口后分片保留。
Evidence 归档后仍按 ID 核验，活跃上限1000。Work 接续最多30个 Task，到限新建，不静默删审计。

运行快照新增时钟、来源、观测/更新时间、传播策略和重复采样窗口；缺依据返回 insufficient-evidence。
兼容 state-mismatch 仅为已确认采样持续分歧的旧别名。旧 v1 快照可读取，缺依据时不晋升因果判断。
ALS 仅静态映射，业务源只读；Python 准备环境只测试 Harness 合成代码。

[日常入口](daily-engineering.md) · [安全](security.md) · [验收](verification.md) · [V0.4历史](history/v0.4-architecture.md)
