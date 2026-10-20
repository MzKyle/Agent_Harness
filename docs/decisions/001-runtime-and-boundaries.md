# ADR 001：运行时、协议和知识边界

状态：接受；2026-10-20；交付范围 M0 + M1。

## 采用 DSH，保留替换能力

用户选择 DSH，且它已有执行循环、会话、Provider、上下文压缩、Skills、权限和 MCP Client。
本项目复用这些能力。官方 npm 发布已核实：DSH、MCP Client、Skills filesystem、Codex provider
均有 `0.2.1-rc.2`。对应 Git 标签是 **dsh-v0.2.1-rc.2**，不是 v0.2.1-rc.2。
所有直接依赖使用确切版本，完整传递依赖见 lockfile。

上游处于 Developer Preview，有明确的破坏性变更预告。DSH 导入和 Profile 操作集中到 Bridge；
core、adapter、MCP 数据契约保持框架无关。不 Fork、不修改官方 npm 包，也不实现另一个 Codex。

## 独立只读 MCP

独立进程可以由官方 DSH MCP Client 或任何标准 MCP 客户端复用，并能用官方 SDK 做端到端协议验证。
授权由进程启动参数授予，模型输入只有项目 ID，不能扩展授权目录。
M1 不提供 shell、文件内容、设备或日志内容工具，从 API 表面直接缩小操作范围。
采用拆分后的官方 `@modelcontextprotocol/server@2.2.0`，测试使用同版 client；
这是所选 DSH 使用的 SDK 代际，支持当前现代协议及旧版协商。
未采用旧单包 SDK 的废弃 raw-shape 注册重载。

## 使用官方 Profile/patch，保持最小暴露

官方插件是导出 apply/inject/Config 的 Cordis 模块，Profile 用 `dsh.profile.bundles` 顺序组合。
本项目不需要额外 Cordis 业务插件：通过已发布 bundle 和官方 patch 配置即可接入独立 MCP/Skills。
DSH 通用工具默认较多，因此生成 patch 时显式关闭除 Skills 以外的模型工具，关闭插件管理、
PTC、动态配置和遥测，避免只在 Prompt 里要求“只读”。固定版本和集成测试共同检查这一边界。
官方平台诊断 Skill 可能仍由其自身服务注册，不表示读取了全局用户 Skills。

Codex 官方包绑定 `@openai/codex@0.153.4`，不使用主机 CLI fallback。
提供可选模板，不默认暴露委派工具。`permissionMode: never` 的沙箱字段省略，沿用原生配置；
因此不声称该值能强制只读，也不使用 bypass 模式。
prepare 会生成不自动选择的 codex.optional.patch.yml，其 name 已解析为已安装模块的绝对入口，
避免 Profile 目录无法解析 Bridge 依赖。若手动启用，先在独立环境配置原生只读沙箱，
再通过原生 DSH --patch 选择它。也可按官方插件管理方式在隔离 Profile 安装确切包版本。
安装属于显式操作，不能因规划 Skill 的建议自动实施。

## 初版无向量数据库

当前只需为通用知识、项目知识、任务证据定义 ownership、内容引用、相互引用、
修订/提交关联和来源。JSON Schema/Zod 契约和 Markdown 内容已经足够。
真实检索、自动晋升、索引或数据库没有经过需求验证，留待后续里程碑。

## 后果

离线测试不需要认证。真实 DSH 模型请求与 Codex 认证/委派必须另做在线验收。
扫描深度与识别栈有限，发现命令不等于可执行或已通过；部分结果通过 partial/pending 显式传递。
修改上游版本前必须重新跑官方 Schema、Profile 真启动、工具集和协议测试。
