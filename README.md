# DevAgent-Harness V0.2

基于官方 DeepSeek Harness 的通用工程助手。已实现并验证**基础工具、隔离执行和离线工作流**；真实模型在线验收仍被认证阻塞，**AI Functional MVP 尚未完成验收**。

相比 M0/M1，新增外部只读注册、有限源码/规则查询、过滤 Git 快照、容器执行、签名证据、诊断、计划门禁、任务和 Patch 报告。DSH 固定 `0.2.1-rc.2`，官方 Codex provider 自带 payload `0.153.4`，没有自建模型客户端或 Agent Loop。

## 安装

需要 Git、Node 24（兼容范围见 package.json）、Docker Linux engine、seccomp/cgroup 限额。

```powershell
Set-Location E:\Agent_Harness
npx --yes pnpm@10.32.1 install --frozen-lockfile
npx --yes pnpm@10.32.1 build
docker pull node:24-bookworm-slim
node apps/cli/dist/main.js isolation configure --image node:24-bookworm-slim
node apps/cli/dist/main.js doctor
```

镜像解析为本机不可变 image ID，实际探测非 root、只读根、禁网和资源约束；失败返回 blocked，绝不回退宿主 Shell。默认状态目录 `.devagent-state/` 被 Git 忽略；`--home <绝对路径>` 可隔离状态。已安装依赖与镜像后，离线验收无需模型和联网执行项目代码。

## 只读接入与真实代码查询

```powershell
node apps/cli/dist/main.js project add --path D:\Kyle\auto-label-studio --read-only --rules
node apps/cli/dist/main.js project list
node apps/cli/dist/main.js project inspect --id <project-id>
node apps/cli/dist/main.js code search --project <project-id> --query ProductWorker
node apps/cli/dist/main.js code read --project <project-id> --file src/auto_label_studio/application/product_worker.py --start 21 --end 49
node apps/cli/dist/main.js project plan --id <project-id> --prompt "训练任务状态展示"
node apps/cli/dist/main.js project fingerprint --id <project-id>
```

注册、计划与证据仅写 Harness。原项目不创建 `.devagent`，规则需要 `--rules` 授权。真实 ALS/Pollen 本轮始终 local-only，不发送远端；本地静态计划明确标记 modelCalls 0。Graphify 原目录不运行或刷新，查询报告降级及限制。

旧版 init/inspect/runtime 与双工具 MCP 继续兼容；`init --path` 会写项目配置，不用于只读业务接入。旧契约见 [configuration.md](docs/configuration.md)。

## 快照、任务与证据

```powershell
node apps/cli/dist/main.js workspace create --project <project-id> --revision HEAD
node apps/cli/dist/main.js workspace inspect --id <workspace-id>
node apps/cli/dist/main.js workspace diff --id <workspace-id>
```

快照基于明确 Commit，不带入未提交改动；过滤数据库、缓存、数据集、权重和可识别敏感内容，拒绝链接/submodule，建立独立 Git 基线，不修改源 Git。过滤可能使真实工程无法构建，必须报告限制。

人工批准固定 argv；模型不能批准命令。下面示例用于已批准分享的专用 fixture：

```powershell
node apps/cli/dist/main.js command approve --workspace <workspace-id> --id acceptance --executable node --args-file fixtures/functional-mvp/test-argv.json
node apps/cli/dist/main.js task run --project <fixture-project-id> --workspace <workspace-id> --mode isolated --prompt "修复 progress 与 statusLabel；批准命令 acceptance；不得修改测试"
node apps/cli/dist/main.js task status --id <task-id>
node apps/cli/dist/main.js task report --id <task-id>
node apps/cli/dist/main.js evidence list --task <task-id>
node apps/cli/dist/main.js evidence export --task <task-id>
```

`test-argv.json` 指向只读 `/grader/acceptance.test.mjs`，完整 grader 准备由下方 eval 自动完成。自有测试可使用 JSON argv `['--test','tests/acceptance.test.mjs']`（文件应为标准 JSON 双引号）。发现命令不等于批准，批准不等于执行成功；manifest 改变使批准失效。计划通过后才能改代码，最多执行 3 次命令，所有批准命令都需最终版本的成功证据。只输出 Patch，绝不回写原工程。

## 官方认证与在线任务

DSH 仅使用当前受信任进程环境中明确配置的 `DEEPSEEK_API_KEY`。请使用自己的安全凭据管理方式，不把密钥放入仓库、参数、聊天或日志；Harness 不扫描磁盘找 Key。只允许注册时带 `--fixture --share-fixture` 的专用 mock 工程在线。

```powershell
node apps/cli/dist/main.js task smoke --project <fixture-project-id> --prompt "查询 progress；返回 taskId 和实际工具结果中的 sourcePath"
```

Smoke 检查真实 DSH JSON 事件、成功 MCP 调用和结构化来源；进程 exit 0 不足以通过。本轮用户选择 DSH 暂留 blocked_by_auth。

Codex 使用官方 `@deepseek-ai/dsh-subagent-codex`，独立容器与认证目录；构建上下文仅 installer/codex，专用 lockfile 固定依赖与 base digest：

```powershell
docker build --tag devagent-codex:0.153.4 installer/codex
node apps/cli/dist/main.js codex configure --image devagent-codex:0.153.4
node apps/cli/dist/main.js codex login
node apps/cli/dist/main.js codex status
node apps/cli/dist/main.js task run --project <fixture-project-id> --workspace <workspace-id> --codex --prompt "修复模拟工程；不得修改测试"
```

在交互终端执行 login，使用官方设备认证，仅写 Harness 独立目录，不导入主机现有认证或修改全局配置。当前独立目录未登录，原生检查为 blocked_by_auth。DSH 有 Key 时通过 MCP 委派；没有 DSH Key 时可单独验收 DSH runtime 的 Codex provider。两条已认证路径均尚未实测。模型编辑容器关闭项目 Shell，测试转交另一禁网执行器，详见 [runtime-profiles.md](docs/runtime-profiles.md)。

## 可复现验收

```powershell
npx --yes pnpm@10.32.1 check
node apps/cli/dist/main.js eval --suite functional-mvp
node apps/cli/dist/main.js eval --suite functional-mvp --als-path D:\Kyle\auto-label-studio --pollen-path <已授权Pollen源码副本绝对路径>
# 认证准备后显式调用真实模型，仅模拟工程，可能计费
node apps/cli/dist/main.js eval --suite functional-mvp --online
```

离线 eval 复现真实失败，再用**确定性修复**验证基础设施，不计为 Agent 自主修复。在线 eval 使用全新 Bug 快照。结果保存在 `.devagent-state/reports/functional-latest.json` / `.md`，明确区分 Unit、Integration、Offline E2E、Online E2E、Real Project Validation；未提供真实路径的对应层 blocked。显式在线验收 blocked 返回退出码 2，失败返回 1；不能把 blocked 算 passed。task run 默认 analysis，`--mode isolated` 或 `--codex` 显式选择隔离编码。尚无直接 Codex 同任务效率对照。

- [实际验收结果](docs/verification.md) · [功能边界](docs/functional-mvp.md)
- [架构](docs/architecture.md) · [安全](docs/security.md) · [隔离](docs/workspace-isolation.md)
- [证据契约](docs/evidence-contract.md) · [真实项目验证](docs/real-project-validation.md) · [后续工作](docs/roadmap.md)
