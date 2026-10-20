# 上游核实与依赖

核实日期：2026-10-20。依据官方 npm 元数据、已安装包的 Config/类型/行为，以及发布标签文档。
用户提供的版本已在 npm 验证可安装，GitHub Release 标签为 `dsh-v0.2.1-rc.2`（2026-10-17）。
未使用 latest 作为持久依赖，也未 Fork 上游。

| 直接依赖 | 锁定版本 | 必要性 |
| --- | --- | --- |
| @deepseek-ai/dsh | 0.2.1-rc.2 | 官方 Profile/CLI 运行时 |
| @deepseek-ai/dsh-mcp-client | 0.2.1-rc.2 | 复用官方 MCP 桥接 |
| @deepseek-ai/dsh-skill-filesystem | 0.2.1-rc.2 | Skills 的官方发现/加载与 Schema 验证 |
| @deepseek-ai/dsh-subagent-codex | 0.2.1-rc.2 | 可选官方委派模板和 payload 检查 |
| @deepseek-ai/cordis | 4.0.5 | Bridge/官方插件测试的版本兼容锚点，不进入 core |
| @modelcontextprotocol/server、client | 2.2.0 | 标准协议 Server 与测试 Client；匹配 DSH 当前代际 |
| zod（core / MCP） | 3.25.76 / 4.4.3 | 核心配置和现代 MCP Standard Schema；两个包的 API 世代隔离 |
| yaml | 2.9.1 | YAML 配置解析/生成，禁止不可信项目配置的别名展开 |
| smol-toml | 1.9.1 | 正确解析 Python pyproject，避免用正则模拟 TOML |
| TypeScript / typescript-eslint | 5.9.3 / 8.72.0 | strict 编译；TypeScript 7 尚超出该 lint 工具的支持范围 |
| ESLint / @eslint/js | 10.13.0 / 10.0.1 | 使用当前受支持 ESLint 代际 |
| Vitest | 5.0.5 | 离线单元和集成测试 |
| @types/node | 24.19.2 | Node 24 类型 |
| pnpm | 10.32.1 | 工作区和锁文件管理 |

Codex provider 的传递依赖固定为 `@openai/codex@0.153.4`。
安装保留 pnpm 默认的依赖构建审批，未自动批准任何被阻止的生命周期脚本。
DSH 自带一些本机/可选模块，其构建脚本在当前安装被 pnpm 忽略；本次只读路径的真启动测试已通过，
不代表 PTY、原生命令/硬件或所有上游功能都可用。不要自动执行 approve-builds。
当前锁文件保留上游传递依赖 `node-domexception@1.0.0` 的弃用警告；未修改上游依赖树。

官方资料：

- [DSH 发布版本](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.2)
- [包结构](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/README.md)
- [官方 CLI 与 Profile](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/apps/cli/README.md)
- [官方插件机制](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/docs/user/develop/basic/index.md)
- [官方 MCP Client](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/mcp/mcp-client/README.md)
- [Skills filesystem 规范](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/skill/skill-filesystem/README.md)
- [Codex provider 配置及权限映射](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/packages/subagent/subagent-codex/README.md)
- [DSH 安全说明](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.1-rc.2/SAFETY.md)
- [标准 MCP 官方文档](https://modelcontextprotocol.io/docs/develop/build-server)
- [OpenAI Docs：Codex 非交互模式](https://developers.openai.com/codex/noninteractive/)

DSH 集成以安装包的实际接口为准：MCP 用 serverName 和 transport，Skills 用
customSkillDirs/includeDefaultRoots，Codex provider 用 permissionMode，未编造 read-only 枚举值。
