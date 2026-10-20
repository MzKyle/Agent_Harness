# V0.3 当前架构

Codex 是主要 Agent。Harness 负责有来源的上下文、项目接管和权限门禁，复用现有服务；不新增模型客户端、Agent Loop、编辑器或第二套项目注册/任务系统。

| 模块 | 当前职责 |
| --- | --- |
| core/src/v2 | 原有 StateStore、ExternalRegistry、Code/Rules、Task/Plan/Gap、Workspace、Docker Execution、Signed Evidence、Diagnostics |
| core/src/v3/contracts.ts、data.ts | 严格画像/记忆/身份/能力契约；使用同一 StateStore 的签名、锁和原子替换 |
| identity.ts | 随机逻辑项目 ID、旧路径 ID 别名、仓库远端/历史校验、机器本地绑定 |
| memory.ts、profiles.ts、context.ts | 可审查记忆、实际项目事实、Task 结果摘要、预算和相关性检索 |
| capabilities.ts、evolution.ts | 能力评估、原 Task.gap 到 Proposal 闭环、受审查 Workspace 扩展的容器调用 |
| onboarding*.ts、files.ts、provisioning.ts | 分析、增量候选、逐文件 Diff、签名审批、CAS 文件应用、回滚和验证 |
| portability.ts | 加密备份、冲突预览、原子合并、导入信任降级 |
| adapters | 实际 Python/Node/.NET 检测及 engineeringSystem 组合；识别 Windows Forms |
| diagnostics-mcp | 复用标准 MCP server/SDK；作用域、预算、拒绝回执和带来源路径的签名调用回执 |
| codex-integration | 官方原生 Codex 配置/Skill 接入、app-server 发现、标准 MCP 探针、会话外部验收；无 DSH 依赖 |
| dsh-bridge | 保留 V0.2 官方 DSH 与 provider 路径；按用户要求暂缓在线验收 |
| apps/cli | 人工审查、审批、恢复、关联、演进采纳及演示；DSH 功能按需加载 |

## 数据分离

单个受签名 intelligence/portable.json 保存开发者/项目记忆、身份、画像、能力快照、任务摘要、Proposal 和 Skill 偏好；同一锁下原子替换。上限 3 MiB，1500 条记忆、500 条任务摘要；画像历史 500 条事实，记忆版本 50 条。整体到限拒绝新写入，不静默删除审计数据；单记录历史为明确的有限窗口。

独立受签名 intelligence/local.json 保存随机 machineId、逻辑 ID 到本机旧 Registry ID/路径的绑定。原有 projects、approvals、workspaces、evidence、runtime/认证和 HMAC key 留在本机，不进入可迁移数据。配置、绑定和知识都不能授权执行。

V0.2 路径 ID 经 resolve/注册回调惰性迁移为逻辑身份，保留别名，旧 Task/Evidence 不改写。所有别名遵从当前本机绑定，不能借历史注册恢复旧分享权限。同远端独立 clone 列为重复候选，不自动合并。relink 明确选目录并核对远端与已知 commit/共同历史；拒绝无共同历史和身份冲突。浅克隆可能需操作员自行补齐历史。

## 事实与时效

画像来自实际 manifest、README、授权规则元数据、目录/静态源码、revision 和 source digest。事实区分 source-confirmed、configuration-declared、task-proven、user-provided、inferred、unknown、stale、conflicted。架构层是有文件证据的静态候选，不是语义调用图。Graphify 无授权安全 runner，不在原源运行或刷新，保留降级说明。

refresh 重扫并保留替换事实的 stale 历史，保留主观决策；源码引用过期标记 stale。context 优先安全、当前项目、确认约束/目标、近期工作，最后相关偏好和能力不确定性。默认 6000 字符，可选1024–16000，返回截断标志；中英文词法检索，无向量库。

TaskService.report 更新实际修改、执行、最终版本通过、失败、阻塞、未完成和 Evidence ID，另生成记忆候选。staticPlan、Onboarding 验证、原生会话结果使用现有 Task/report。未被 Harness 记录的外部 Codex 活动不自动采集。

## 规范与演进

Onboarding：analyze → plan → diff → 人工 approve → apply → verify/report。只允许 AGENTS、约定位置 Skill、可选 .codex/config.toml、能力 JSON。原 AGENTS 字节前缀保留；已有 Skill/配置复用。审批绑定内容 Hash、Diff、Commit、分支、目标，有过期/单次检查。Workspace 与原项目写入独立；protected 分支禁止原项目写入。业务源本轮只 analyze/plan。

能力 discovered/configured/verified/unavailable/unsupported/forbidden 是事实，不是权限。硬件、生产执行、源写入保持 forbidden。Task.gap 自动分类/去重/关联 Proposal；实现绑定 Workspace 和批准命令，通过当前版本真实签名 Evidence 后才人工采纳。下一 Task 调用仍受同项目、同 Workspace、版本、计划、预算、批准和 Docker 门禁约束；变化即失效，不加载宿主全局插件。

## 原生集成与兼容性

官方 MCP/Skill 配置和原生加载器。薄 JSON-RPC 客户端只查官方 app-server 发现/认证元数据，不运行模型循环。独立 HOME，不导入宿主 auth。在线仅 fixture；MCP 再次检查项目/Task 分享权限。签名回执和答案核对真实 revision、实际返回路径、禁止操作、近期状态。目前发现路径已实测；认证后会话、自动 Skill 触发和自主修复尚未通过验收。

旧接口/格式保持兼容；新增独立 V3 数据契约。Windows Forms 是框架枚举增量值。原生包复用已安装 MCP SDK，没有新增第三方生产依赖；新包用于隔离原生 Codex 与 DSH 的依赖边界。