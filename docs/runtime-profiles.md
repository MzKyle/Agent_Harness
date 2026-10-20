# 官方 Profile 与认证

DSH/MCP client/Skills/Codex provider 固定 `0.2.1-rc.2`。官方 schema、实际 runtime/MCP/Skills 离线集成已有测试；没有重写 Agent Loop 或修改上游。原 M1 Profile 兼容。

V2 按 Task 生成 `runtime/<task-id>/profiles/devagent`。只挂本仓库 Skills 与标准 MCP，禁默认用户/项目 Skills 根、通用 Shell/文件/Web/PTC、插件管理、配置编辑、项目指令自动加载与遥测。工程规则经授权工具显式读取。

Analysis 使用中立受管 cwd，避免 launcher 在原工程发现 `.env`；无项目修改/任意命令工具。真实源 local-only，本轮使用本地确定性规划；远端 Analysis 仅 fixture。Isolated Coding 实际 cwd 绑定快照，写入仅 write_workspace_code，测试仅 run_approved_command，MCP 绑定 project/task，计划通过方可变更。

普通任务需要进程中明确配置 DEEPSEEK_API_KEY，缺失保存 blocked Task/gap/report。DSH JSON 投影需有 committed step、成功 MCP 调用、Task ID 结构化结果；Smoke 还核对 sourcePath 来自工具。modelCalls 为已提交模型步骤，不含不可观测的服务端重试。已认证在线路径尚未实测。

Codex 单独路径中的 modelCalls 统计原生委派次数，不推断 provider 内部模型轮次或计费请求数。当前认证阻塞，因此在线记录均为 0；认证后还需核对原生返回和调用指标，不能据进程次数推算费用。

`--codex` 两条装配：

1. DSH Key 可用：DSH 分析/提交计划，经可选 delegate_codex MCP 调用隔离容器内官方 provider；验收要求出现成功 delegate，启用配置本身不算通过。
2. DSH Key 缺失：单独通过官方 DSH runtime provider API 调 Codex，先 RO 快照规划，再原生编辑、禁网测试。用于独立 Codex 验收，不声称有 DSH 模型分析。

Codex 镜像独立 lockfile + pinned base，解析为 image ID。固定 runner 每次写原生权限配置，关闭 Shell/code mode/浏览器/插件/web/原生子 Agent；项目代码只在另一个禁网执行容器运行。模型容器需要官方 API 网络，当前未通过认证后的真实委派验证。

主机登录与容器认证独立。codex configure/status 实际调用 payload 的 login status，当前 blocked_by_auth；不是只跑版本。交互终端 `codex login` 使用官方设备认证，只写 Harness 独立目录，不导入主机认证/改全局配置。准备后运行 README 的 eval --online，须实际工具、修改、反馈和独立测试全部通过。不得把 auth 文件或 Key 放进源码/聊天。
