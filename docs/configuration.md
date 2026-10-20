# 项目配置 v1

位置：每个项目自身的 `.devagent/project.yaml`；init 拒绝覆盖。
精确运行时契约在 `packages/core/src/schema.ts`，未知字段拒绝加载，YAML 别名展开关闭。
schemaVersion 固定为 1；后续破坏性变更必须提供迁移方案。

| 字段 | 语义 |
| --- | --- |
| name | 来自授权根目录的安全名称，不复制清单中的任意自由文本 |
| components | 相对路径、语言/框架/构建/测试枚举，以及清单来源 |
| mainDirectories | 有限扫描的相对目录名，不含业务内容 |
| commands | 从声明提取的候选命令，包含组件、purpose、来源、pending/verified 和证据 |
| observability.logs | 已知目录/声明来源、验证状态、contentAccess 固定 false |
| observability.uiTesting | 发现 Playwright 依赖仍只是 pending，不保证 UI 测试可运行 |
| observability.deviceAdapter | M1 固定 unsupported，不连接设备 |
| permissions | metadata-only；executeCommands/hardware/network/remoteBusinessData 均 false |
| detection | complete/partial，以及 scan-limit、invalid-manifest 等有限错误码 |

路径统一采用 `/`，必须为项目内相对路径，拒绝绝对路径、驱动器、流语法、反斜杠和 `..`。
配置包含的路径只是声明，不授权访问对应内容。进程启动时的项目根授权优先于任何配置。
命令 `verified` 要求 evidence：revision（提交哈希）、checkedAt（UTC ISO 时间）、exitCode: 0、
reference（项目内证据路径）。这些证据由可信操作人员提供，M1 不自动运行或核实证据。
MCP 投影不返回 executable/args 或证据正文，只返回命令标识、用途、来源和验证状态。

识别范围：

- Python：pyproject TOML/requirements，FastAPI、pytest、常见 build backend；不完整解释所有 Poetry/tox/nox 生态。
- Node：package.json、lockfile、tsconfig，React/Electron、Vite/TypeScript、Vitest/Jest/Playwright。
- .NET：有限读取 csproj，MSBuild、WPF 和常见测试 PackageReference；拒绝 DTD/实体，不展开 XML include。

`.NET` 使用保守标记识别，不等同于完整 MSBuild 求值；复杂条件导入、单引号或外部属性可能未识别。
C++、ROS 2 等在路线图中，不会伪造本版识别支持。
