# 架构（M0 + M1）

## 模块边界

```text
CLI ──> adapters ──> core
 │                    ▲
 └──> dsh-bridge       │
       │              │
       └ DSH 官方 MCP Client ─stdio─> diagnostics-mcp
```

| 路径 | 实际职责 |
| --- | --- |
| apps/cli | doctor、init、inspect、runtime prepare/check/run；JSON 输出和安全错误码 |
| packages/core | 配置/证据/知识 Schema、显式根授权注册表、路径校验、限量扫描、上下文投影、能力缺口 |
| packages/adapters | NodeAdapter、PythonAdapter、DotnetAdapter；共享扫描结果，产出统一组件和待验证命令 |
| packages/dsh-bridge | 唯一 DSH 依赖层；版本检查、官方 Profile/patch 生成和启动 |
| packages/diagnostics-mcp | 框架无关 MCP Server，官方 SDK stdio transport、输入/输出 Schema、安全错误 |
| skills | onboarding、feature planning、observability design 及计划输出 Schema |
| templates | 官方 Codex 可选 patch；三类知识记录示例 |
| fixtures | ALS-like 与 Pollen-like 模拟清单/目录/日志，不含真实数据或硬件代码 |
| evals | 离线单元、CLI、MCP 协议、DSH 真启动和 Codex payload 检查 |

core 和 adapters 不依赖 Cordis/DSH。MCP 不依赖 DSH；它只调用 core。
`RuntimeAdapter.prepare()` 是当前唯一必要的可替换运行时契约，不预先扩张会话或模型抽象。
换 Harness 时可以继续使用相同 MCP Server、核心和 Skills，并提供新的启动适配器。
现阶段 Registry 只接受当前进程启动时的显式授权；持久项目列表和远程调度均不实现。

## 数据流

init 将用户路径规范化，排除链接和敏感目录，最多扫描深度 4、1500 个目录条目、100 个清单，
每次清单读取最多 128 KiB。识别器只提取语言、受支持框架、构建/测试依赖存在性和脚本名称。
它不执行 manifest 脚本，原始脚本值不会复制到配置或 MCP。
发现的命令只保存固定可执行文件和参数模板，均为 pending。
最终通过严格 Schema 检查后，以排他创建方式写 `.devagent/project.yaml`。

inspect/MCP 每次重新验证配置，无共享可变项目上下文缓存。Registry 将规范根目录映射为
本机稳定 ID；工具只接受该 ID。读取路径检查词法包含关系、每段链接、realpath 和大小限制。
输出经过明确字段投影，不输出原始 manifest、环境或命令参数。所有正常响应包含来源和诊断状态。

doctor 只运行固定的 `--version` 检查，从输出提取版本号，不打印原始 stdout/stderr 或环境值。
Windows `.cmd` 通过固定命令参数和正确的原样命令行引用启动；不接收用户提供的 shell 文本。

## DSH 扩展

Profile 使用官方 base/headless bundle，patch 从锁定版本的 base 条目生成，关闭模型可调用的
通用执行/读写/网络/子 Agent 工具，仅保留 Skills loader 和项目 MCP。
Skills filesystem 配置 `includeDefaultRoots: false` 与绝对 `customSkillDirs`。
MCP 条目使用官方 `serverName/transport/command/args/cwd/env` 配置；进程由官方客户端管理。
默认遥测关闭，不修改 `~/.dsh`。DSH 自身仍在本地运行并持有其正常服务，
工具限制不是操作系统隔离；应在受控账户/环境运行不受信任任务。

测试中的 DSH probe 禁用 headless runner，启动真实官方 Profile 和服务，通过
`ctx.tools.execute()` 调用已注册的 MCP 工具，然后通过官方 shutdown 生命周期退出。
该 probe 不配置测试模型、不发 LLM 请求，也不属于产品 Agent Loop。

当前边界和决定见 [decisions/001-runtime-and-boundaries.md](decisions/001-runtime-and-boundaries.md)。
