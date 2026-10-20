# M0 + M1 交付与验证报告

日期：2026-10-20。项目位置：`E:\Agent_Harness`。
首次交付验收时为独立 Git 仓库，开发分支 `dev/m0-m1`，当时未提交、未关联远程、未推送或合并。
未修改 Auto Label Studio 或真实 Pollen Instrument 业务工程。

## 完成范围

- pnpm TypeScript monorepo：strict、ESLint、Vitest、构建及测试代码类型检查。
- 框架无关 core：显式 Project Registry、路径/限量读取、严格项目配置、上下文与诊断能力、知识契约。
- 三类适配器：Python/FastAPI/pytest、Node/TypeScript/React/Electron、.NET/WPF/测试清单。
- CLI：doctor、init（含 dry-run 与防覆盖）、inspect、runtime prepare/check/run。
- 官方 DSH Bridge：锁定版本、隔离 Profile、官方 MCP Client、官方 Skills、默认最小工具暴露。
- 官方 Codex 可选配置：静态模板及 prepare 生成的绝对入口 patch，不默认启用。
- 独立只读 MCP：两个工具、严格输入/输出 Schema、来源和诊断状态、授权 ID、无日志/凭据内容访问。
- 三个可加载 Skills、结构化计划 Schema、三类版本关联知识契约。
- 两种模拟工程和离线协议/运行时集成验证。M2～M4 仅记录路线图。

架构、依赖及变更文件分别见 [architecture.md](architecture.md)、
[upstream-research.md](upstream-research.md)、[files.md](files.md)。
所有项目文件均为本次新增；依赖安装和生成产物由 .gitignore 排除。

## 实际检查结果

环境：Windows x64，Node 24.19.0、npm 11.17.0、pnpm 10.32.1、Git 2.55.0.windows.3。
主机 Codex CLI 0.157.1；DSH 官方 provider 自带的独立 Codex payload 为 0.153.4。

| 实际执行命令 | 最终结果 |
| --- | --- |
| `npx --yes pnpm@10.32.1 install --frozen-lockfile` | 成功；锁文件一致 |
| `npx --yes pnpm@10.32.1 typecheck` | 通过；所有源码及 evals TypeScript 检查 |
| `npx --yes pnpm@10.32.1 lint` | 通过；0 错误 |
| `npx --yes pnpm@10.32.1 test` | 21/21 通过；2 个测试文件 |
| `npx --yes pnpm@10.32.1 build` | 通过；5 个工作区包编译产物已生成 |
| `npx --yes pnpm@10.32.1 test:integration` | 7/7 通过；3 个测试文件 |
| `npx --yes pnpm@10.32.1 check` | 上述完整类型/lint/单元/构建/集成串行检查通过 |
| `npx --yes pnpm@10.32.1 devagent doctor` | status: ok；Node/npm/pnpm/Git/Codex/DSH 均识别可用 |
| `devagent init --path E:\Agent_Harness` | 成功；创建本机忽略的 .devagent/project.yaml |
| `devagent runtime prepare --path E:\Agent_Harness` | 成功；创建本机忽略的 .dsh-local/runtime，绑定当前工程 |
| `devagent runtime check --path E:\Agent_Harness` | 官方 DSH Profile 合成成功，无模型请求 |

三个 Skills 均通过 `skill-creator/scripts/quick_validate.py`。
执行方式为 `uv run --no-project --python <已有 Python 3.14> --with pyyaml==6.0.3 <validator> <skill>`；
PyYAML 仅用于临时验证环境，未加入项目依赖或修改全局 Python。
最初的 `python` Windows App Alias 返回 9009，切换到 uv 已安装的 Python 后验证成功。

首轮测试曾发现并修复 Windows 短路径规范化和 `.cmd` 引用问题；
上游类型/协议/平台内置 Skill 差异也已按真实接口修正。最终检查无失败项。

## 测试证据覆盖

- 两种 fixture 由同一个 detector/core 接入，生成独立配置；上下文相互隔离。
- dry-run 不写入，已有配置拒绝覆盖，未知/坏清单返回 partial，命令无证据不得标记 verified。
- 拒绝未知项目 ID、路径输入、遍历与配置目录链接；扫描不跟随 junction/symlink。
- 大文件与深度限制，原始脚本、日志、环境内容不出现在结果中。
- Windows 驱动器/大小写/UNC、Linux 大小写/遍历的路径语义测试均在本机执行通过。
- 标准官方 MCP client 真正启动 stdio Server，分别确认 legacy 与 modern 协商；
  modern 精确协商到 2026-07-28，执行发现、schema 校验、两个工具调用、授权拒绝和越界拒绝。
- 用发布包的真实 Config 校验 MCP、Skills、Codex provider 和 Codex tool 模板。
- 官方 filesystem provider 实际发现并读取三个 Skills。
- 真正启动官方 DSH Profile，禁用模型 runner，通过官方 ToolRuntime 和 MCP Client 调用本项目 Server，
  返回 FastAPI 项目数据，并经官方 shutdown 释放进程；验证通用 shell/读写/PTC/Codex 工具未暴露。
- 运行官方 Codex payload 的 `--version`，无需认证，成功返回 0.153.4。

## 未执行的验证及原因

| 验证 | 状态与原因 |
| --- | --- |
| DSH 真实模型请求 | 未执行；本次未配置或核实真实认证，不声称模型可调用 |
| Codex 真实委派、认证、模型回包和变更执行 | 未执行；只验证 Schema、可选 patch 和 payload 启动 |
| Linux 原生端到端测试 | 未执行；当前执行宿主为 Windows；path.posix 语义测试不能替代 Linux 真运行 |
| 真实 ALS/Pollen 仓库接入 | 未执行；本次用两类模拟工程完成接入验收，不声称已审阅它们的完整源码 |
| Python/FastAPI、React、WPF 业务构建 | 不适用；fixtures 是识别样本，不是交付业务应用 |
| Docker/CVAT/GPU/工业硬件验收 | 不适用；M0/M1 没有对应操作工具，未连接真实服务或设备 |

## 风险、兼容性与下一步

DSH 是预览软件，升级时需重新验证插件 Schema、Profile、工具集、MCP 代际和 Codex payload。
默认 pnpm 安装没有自动批准上游原生构建脚本；只读启动路径已验，不代表其他 DSH 本机工具可用。
上游锁定依赖仍有 node-domexception 的弃用提示，未擅自覆盖上游版本。
路径检查不能防止同账户恶意并发替换的所有 TOCTOU 情况，参见 [security.md](security.md)。

这是新仓库，未改变已有业务 API。项目配置 schemaVersion 为 1，后续变更需保持兼容或提供迁移。
本机 projectId 随规范根路径变化，不适合作为跨机器全局身份。
能力状态来自声明/证据元数据，pending 不能解释成实际可用；M1 不自动执行或验证项目命令。

建议下一阶段首先做 Linux 原生验证与隔离认证环境中的 DSH/Codex 在线验收，
随后实现经授权的命令验证和证据记录（M2），再按实际缺口补观测适配。
