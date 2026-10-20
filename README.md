# DevAgent-Harness

基于 DeepSeek Harness 的通用软件工程助手基础，当前交付 **M0 + M1**。
一个框架无关的工程核心，通过项目适配器识别 Python、Node.js/TypeScript、C#/.NET；
通过独立只读 MCP Server 向 DSH 提供项目上下文和诊断能力。

## 安装与检查

需要 Node.js **22.13+（22.x）、24.x 或 26+**、npm、Git。推荐 Node 24 LTS。
直接依赖锁定，提交的 `pnpm-lock.yaml` 锁定传递依赖。
无需全局安装 pnpm；以下示例均使用锁定版本：

```powershell
Set-Location E:\Agent_Harness
npx --yes pnpm@10.32.1 install --frozen-lockfile
npx --yes pnpm@10.32.1 build
npx --yes pnpm@10.32.1 devagent doctor
```

如果已安装 pnpm 10.32.1，可直接使用 `pnpm`。
`devagent` 是工作区 CLI 包的 bin，也可直接调用
`node E:\Agent_Harness\apps\cli\dist\main.js`，无需全局链接。
`doctor` 返回 JSON，分别显示工具版本和外部集成状态。
通过直接 `node` 启动时，未全局安装的 pnpm 可能显示 unavailable；通过上述 npx 启动则可用。
诊断缺项返回 `attention`，命令本身完成时退出码为 0；参数/读取失败退出码为 1。

## 接入项目

```powershell
# 先预览，不写文件、不执行目标项目脚本
npx --yes pnpm@10.32.1 devagent init --path "D:\work\my-project" --dry-run
# 创建 .devagent/project.yaml，已存在时拒绝覆盖
npx --yes pnpm@10.32.1 devagent init --path "D:\work\my-project"
npx --yes pnpm@10.32.1 devagent inspect --path "D:\work\my-project"
```

Linux 使用相同命令和本机绝对路径，例如 `--path /work/my-project`。
识别结果来自有限深度的清单和目录元数据，不读取源码正文、日志、`.env`、数据库或数据集。
命令从现有脚本/依赖推导，全部标记 `pending`。本版不执行、验证或自动晋升这些命令。
已人工验证的命令必须附带提交版本、执行时间、退出码 0 和证据引用。
配置契约见 [configuration.md](docs/configuration.md)。

## 只读 MCP

先初始化目标项目，通过 `inspect` 获得 `projectId`，然后启动：

```powershell
node packages/diagnostics-mcp/dist/main.js --allow-project "D:\work\my-project"
```

每个 `--allow-project` 授权一个项目，最多 20 个。工具输入仅接受项目 ID，
客户端不能传入任意文件路径。两个工具是：

- `get_project_context`：项目、技术栈、组件、来源、有限目录结构。
- `get_project_capabilities`：日志元数据、测试命令的验证状态、UI/设备支持和能力缺口。

stdout 专用于 MCP；诊断写 stderr。工具不执行命令、不读日志内容、不访问网络。
项目 ID 绑定本机规范路径，移动项目后 ID 会变化。授权集合仅存在于当前进程，不写全局注册表。

## DSH 最小启动

```powershell
npx --yes pnpm@10.32.1 devagent runtime prepare --path "D:\work\my-project"
# 校验官方 profile 合成结果，不发起模型请求
npx --yes pnpm@10.32.1 devagent runtime check --path "D:\work\my-project"
# 凭据通过受信任的进程环境配置后，显式执行一个模型任务
npx --yes pnpm@10.32.1 devagent runtime run --path "D:\work\my-project" --task "分析当前项目的能力缺口"
```

默认运行目录是本仓库忽略的 `.dsh-local/runtime`，支持 `--output <新目录>` 隔离多个实例。
prepare 拒绝覆盖现有运行目录；check/run 校验它与目标项目的绑定。
生成官方 `dsh.profile.bundles` 清单和 `cordis.patch.yml`，复用 base/headless、官方 MCP Client、
Skills registry 和 filesystem provider。没有自建 Agent Loop，也不修改上游。
默认只暴露 Skills 加载工具和两个只读 MCP 工具，关闭 shell、文件读写、网页、PTC、子 Agent
及插件管理工具；禁用遥测。项目/用户默认 Skills 根目录关闭，只挂载本仓库 Skills。
DSH 自带的平台诊断 Skill 仍可能出现在目录中。

DSH 启动和模型认证交给官方机制（例如进程环境中的 `DEEPSEEK_API_KEY`），
不要在仓库、配置或命令历史中保存实际密钥。CLI 不要求或打印密钥。
**真实模型调用尚未验证**。`runtime run` 会把用户任务和工具返回的元数据发送给已配置的模型；
只应对已批准分享元数据的项目使用它。DSH 自身可能读取其原生环境/凭据配置，
与本项目的只读 inspect 扫描是两个独立边界。

官方 Codex 可选配置见 [codex.patch.example.yml](templates/codex.patch.example.yml)。
默认不启用。包附带 Codex **0.153.4**，与主机 CLI 的版本独立；已验证 payload 可启动并输出版本，
**尚未验证认证、真实委派或模型请求**。`permissionMode: never` 会沿用原生沙箱配置，
不等于强制只读；启用前应在独立环境配置原生只读权限并审阅 Profile。
prepare 同时生成未启用的 `codex.optional.patch.yml`，其中入口已经解析为本机绝对路径。
审阅权限并准备认证后，可通过原生 DSH 的 `--patch <该文件绝对路径>` 显式选择；
需设置 `DSH_HOME` 为对应运行目录，并在目标项目目录调用本仓库锁定的 DSH CLI。
这一操作会启用真实委派能力，参见 [架构决策](docs/decisions/001-runtime-and-boundaries.md)。

## Skills、知识和验证

三个 Skills 位于 `skills/<name>/SKILL.md`，符合所选 DSH 的 YAML frontmatter 和单层发现规范。
`feature-planning` 会加载 `observability-design`，按 JSON Schema 输出包含实施、观测、诊断、
回归和能力缺口的计划。只读运行时缺少执行工具时，onboarding 会返回可由人执行的 CLI 命令。
知识仅提供三类存储/引用/版本契约，无向量库、长期检索或自动晋升，见
[knowledge.md](docs/knowledge.md)。

```powershell
npx --yes pnpm@10.32.1 typecheck
npx --yes pnpm@10.32.1 lint
npx --yes pnpm@10.32.1 test
npx --yes pnpm@10.32.1 build
npx --yes pnpm@10.32.1 test:integration
```

安装依赖后，以上测试均无需网络和模型凭据。集成测试使用临时模拟工程和标准 MCP SDK，
包括旧版握手、现代协议发现、官方 DSH 启动与真实 MCP Client 调用。
Fixtures 仅用于识别测试，不是可部署业务系统，不在本项目中安装其框架依赖或构建 WPF。
完整检查结果、未验证事项和限制见 [verification.md](docs/verification.md)。

- [架构与模块列表](docs/architecture.md)
- [安全与授权边界](docs/security.md)
- [依赖和上游资料](docs/upstream-research.md)
- [M2～M4 后续方向](docs/roadmap.md)
