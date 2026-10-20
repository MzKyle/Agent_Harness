# Codex 原生接入与验收边界

目标：新会话通过官方 MCP + 可复用 Skill 获取相关上下文，不依赖 DSH。实现位于 packages/codex-integration，复用已有 MCP SDK；不会实现模型请求客户端或 Agent Loop。

## 接入方式

codex attach --project <id> 创建过滤 committed Workspace、Harness analysis Task、独立 HOME/CODEX_HOME 和 config.toml。默认没有认证、没有个人偏好分享，不改全局配置。标准 [Codex MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) 使用 mcp_servers.devagent 的 command/args/enabled_tools，绑定项目与 Task；只有明确 fixture-only 分享才 enabled。已有 .codex/config.toml 在 Onboarding 中复用，不自动覆盖；机器路径不写入便携备份。

工程 Skill 名为 devagent-project-engineering，存于 skills/ 和独立 Codex HOME 的原生 Skill 位置。它要求重要任务按需读取 brief、当前证据和批准验证，简单修改不机械调用全部工具；候选需审查，不能自行批准命令或写原项目。使用官方 [Skills 机制](https://developers.openai.com/plugins/concepts/skills) 的原生发现器，没有自制 Skill loader。

inspect 真实启动 codex app-server --stdio，经 initialize、skills/list、mcpServerStatus/list、account/read 检查发现和认证。只保存版本、名称、工具清单和认证布尔状态，不保存账号详情或 stderr。发现检查没有 thread/turn/model 请求。RPC 对交互请求返回拒绝，退出时只清理本次自有进程树。

login-native --id 使用该附件自己的官方设备认证。用户在官方流程操作；不复制主机 auth.json、不扫描磁盘、不从聊天获取密钥。

## 工具与数据作用域

原生配置仅暴露画像/相关偏好/近期任务/能力、规则、源码、诊断等读取工具。个人上下文需 attach --include-preferences；本地 CLI 不等于在线分享授权。即使客户端改配置，服务端仍核对项目/Task、fixture 分享、Plan、批准和预算。完整 MCP 有候选记忆/gap/Workspace 操作；审批、恢复、采纳、规范 apply 永远不暴露。

只读的 get_context_brief 优先安全、真实当前项目事实、约束/目标、近期工作，最后相关偏好；预算1024–16000字符。候选偏好、别的项目私有记忆不混入。引用过时明确标记，普通外部 Codex 历史不会被猜测或自动采集。

## 真正模型验收

session --id 先真实发现/认证检查。没有 auth 或 fixture 分享立即保存 blocked Task/report/history，模型调用0。认证后才运行官方 codex exec，显式调用 $devagent-project-engineering，要求使用 get_context_brief、get_recent_work 和具体源码查询。

验收检查同时要求：

- 原生 turn.completed 与成功退出。
- 项目/Task 匹配且 HMAC 有效的服务端 MCP 完成回执。
- 最终 JSON 的 projectId、当前 revision、实际返回源码路径准确。
- 禁止硬件/生产/源写入，以及最近工作状态与真实工具回执相符。

叙述“调用过工具”不算通过；oracle 单元测试覆盖假 revision、假路径、遗漏约束和错误状态。过滤 transcript 才落盘，答案先在内存检查，避免合法 quoted commit 被日志脱敏后误判。CLI 不暴露精确后端模型请求次数，报告中 completed turns/modelCalls 仅是明确标注的下界；不是精确 token/请求计费。

## 当前结果与限制

本机原生 CLI 0.157.1：fresh app-server、工程 Skill 和14项 MCP 读取工具发现通过。独立 HOME 无 auth，在线模型工具利用为 blocked_by_auth。没有复制当前宿主账户。真实 ALS/Pollen 从未发送模型。DSH 继续按用户指令暂缓。

SDK stdio probe 确实发现 MCP 并调用 context，但它不是 Codex 模型。Skill 生成/发现/显式指令/模型实际使用/自动触发分开记录；自动触发尚未证明。认证后的模型答案、权限策略和自主修复仍需独立实测。原生宿主 read-only 并非 Docker 全文件隔离；见 [安全边界](security.md)。官方 [app-server](https://learn.chatgpt.com/docs/app-server) 和 [权限](https://learn.chatgpt.com/docs/permissions) 文档随版本演进，不能将新字段盲加到旧 binary 当成已经生效。