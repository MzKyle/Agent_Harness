# V0.2 实施与分层验收

日期：2026-10-20；仓库 `E:\Agent_Harness`，开发分支 `dev/functional-mvp`，基于 `7ba79c7`。用户已明确要求将本次变更提交并推送到远程 `main`；未改业务源。当前结论：**基础工具与离线工作流已验证；AI Functional MVP 在线验收未完成**。提交与推送不改变在线验收状态。

## 实际结果

| 等级 | 结果 | 证据范围 |
| --- | --- | --- |
| Level 1 Unit | 30/30 通过，4 个文件 | 严格契约、路径/链接、过滤、源码/规则、计划/预算/gap、诊断、旧 API |
| Level 2 Integration | 13/13 通过，5 个文件 | 真实 stdio MCP、V2 官方 DSH runtime/MCP/Skills 与委派工具装配、工作区、Docker、最终所有命令门禁、证据/输出篡改拒绝 |
| Level 3 Offline E2E | passed | 真实初始失败→确定性快照修复→独立 RO grader 通过→Patch/版本证据→源不变；trace 查询 |
| Level 4 Online Agent E2E | **blocked** | DSH Key 缺失且用户明确暂缓；隔离 Codex 原生 login status 返回 blocked_by_auth。实际创建 smoke/DSH/Codex blocked Task、gap 与报告，modelCalls 0，不计通过 |
| Level 5 Real Project Validation | passed，限只读静态接入 | 真实 ALS、本轮创建的 Pollen 授权源码副本，规则/模块/路径行号/计划/过滤快照；前后不变性 gate 通过 |

`aiFunctionalMvpComplete: false`。真实 Pollen 当前为 Windows Forms/.NET Framework 4.8，未误报 WPF。两个真实源快照已物化，ALS 257 文件/67 过滤记录，Pollen 514/121；没有构建/执行业务工程。Pollen 初次稀疏副本缺失 blob 曾阻塞快照，后只在新受管副本补齐允许 blob，重跑成功。

## 实际命令

| 命令 | 结果 |
| --- | --- |
| `npx --yes pnpm@10.32.1 install --frozen-lockfile` | 成功，锁文件一致 |
| `npx --yes pnpm@10.32.1 check` | typecheck、lint、30 单元、build、13 集成全部通过 |
| `devagent isolation configure --image node:24-bookworm-slim` | full/verified；真实 Linux 容器探针 |
| `docker build --tag devagent-codex:0.153.4 installer/codex` | 成功，固定 base digest 与 npm lockfile |
| `devagent codex configure --image devagent-codex:0.153.4` | 官方 payload 原生认证检查：blocked_by_auth，hostCredentialsImported false |
| `devagent diagnostics import --file fixtures/functional-mvp/events.jsonl` | 3 条脱敏事件导入成功 |
| `devagent eval --suite functional-mvp --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument` | Offline passed、Online blocked、Real passed |
| 同上附加 `--online`，确认进程无 DSH Key | 真实启动前置检查，3 个在线 Task 均 blocked_by_auth；没有发起模型请求；最新 CLI 为在线 blocked 返回码 2 |
| `skill-creator/scripts/quick_validate.py`，uv Python 3.14 + PyYAML 6.0.3 | 三个 Skills 均 valid；没有安装全局 Python 依赖 |
| `devagent doctor` | 隔离 full；直接 node 启动时 pnpm 非全局 PATH 显示 unavailable，status attention；npx 工作入口可用 |

环境：Windows x64、Node 24.19.0、npm 11.17.0、pnpm 10.32.1、Git 2.55.0.windows.3、Docker Linux 29.7.2。测试镜像 image ID `sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`。Codex provider payload 0.153.4 与主机 CLI 0.157.1 独立。

## 安全验收

真实 Docker 测试确认：不能读宿主 canary 路径，`.git/config` 写入拒绝，无网络路由/socket，非 root/RO root/no-new-privileges/cgroup 限额有效。90 KiB 输出截断，超时及主动取消终止子进程树，容器不残留。恶意 argv、未知项目、穿越、链接、`.env`、无计划写入均拒绝；MCP/CLI 有 denial 回执。注入文本作为不可信内容标记，不能授权执行。

证据测试覆盖：真实非零退出不通过，旧版本不能证明新版本，多个批准命令不能只验证一个，记录和 stdout artifact 被改均拒绝。源不变性包含 HEAD/status/source/tree/Git 管理文件摘要；不声称排除数据目录逐字节不变。

## 尚未完成与限制

- DSH 真实模型响应/MCP 利用/自主修复，以及已认证 Codex 实际委派、修改和反馈循环均未通过在线验收。准备认证后运行 README 中在线 suite，不能使用 mock 或版本输出替代。
- 用户明确仅允许 fixture 源码/脱敏日志在线。真实 ALS/Pollen 只做本地分析，不借认证可用自动上传。
- Graphify 没有安全 runner，不在原源运行/刷新；明确降级。Python/C# 为词法静态关联，完整运行时链未证明。
- 不运行真实训练、GPU/CVAT/Docker 业务编排、WPF/WinForms UI、硬件、数据库、安装升级/部署。缺少安全 Windows runner，UI 动态验收未完成。
- 没有直接 Codex 的受控同任务效率对照，不能宣称开发速度或自主成功率提升。离线修复为确定性基础设施验证。
- 过滤快照不保证完整构建；Docker 共享内核不是 VM；签名依赖宿主密钥可信。详见 security、workspace-isolation、evidence-contract。

完整模块/文件清单见 [files.md](files.md)，真实代码证据见 [real-project-validation.md](real-project-validation.md)。本机生成产物在被忽略的 `.devagent-state` 与 `.devagent-evals`；最终 JSON/Markdown 可复现，不包含真实业务凭据。
