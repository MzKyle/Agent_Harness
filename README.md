# Agent_Harness V0.4.1

日常入口与本轮结果见 [使用指南](docs/daily-engineering.md)、[配置隔离](docs/configuration-isolation.md)、[实施报告](docs/implementation-v0.4.1.md) 和 [分层验收](docs/verification.md)。
新增 Fast / Engineering / Deep / 静态 Auto；不增加分类模型请求或 MCP 工具名称。
会话完成、工程结果和证据状态分别表达；旧认证HOME含Hook文件时阻止启用，空新HOME还需官方登录和定义信任，真回调未验收。

```powershell
Set-Location E:\Agent_Harness
node apps/cli/dist/main.js codex use --project <registered-project-id> --mode auto --home <state>
node apps/cli/dist/main.js codex run --project <approved-fixture-id> --goal '继续上次开发' --mode auto --home <state>
node apps/cli/dist/main.js codex status --project <registered-project-id> --home <state>
node apps/cli/dist/main.js work latest --project <registered-project-id> --home <state>
node apps/cli/dist/main.js doctor --home <state>
```

`use` 保存显式项目选择并检查现有能力；任务使用 `run`，编码另需 `--coding`、批准的命令和隔离器。
普通未绑定 IDE 聊天不会自动采集。所有真实业务项目本轮继续仅本地只读。
本轮最终check通过71单元/30集成；冻结候选42次真实对照通过。单模块Fast相对Engineering
减少调用，但本样本Baseline整体仍更快；最终项目过滤的本地Work查询中位10.89秒→0.46秒。
版本范围、样本限制与Hooks blocked分别记录于 [性能](docs/performance-v0.4.1.md) 和分层验收。
下方 V0.4 能力概述和历史数据不能替代 V0.4.1 的分层结果；认证 HOME 复用的现行边界以配置隔离文档为准。

Codex 的本地个人工程上下文与能力管理系统：开发偏好、项目画像、近期工作、工程规范、能力契约，以及受控的诊断和验证。复用 V0.2 Registry / Task / Workspace / Evidence；DSH 是可选集成，不是画像、记忆和 Onboarding 的依赖。

**当前：独立 Codex 官方授权成功，真实模型 MCP/答案验收、模拟工程自主修复和新会话接续通过。**
新增显式 Work、最小事件记录、ALS 工作流诊断映射、真实 HTTP/Worker/SQLite fixture 和最终版本 Validator。
原生 Hooks 已配置但尚未观测到回调；受管事件降级路径已验证。ALS/Pollen 保持本地只读。
小样本对照中增强版开销更高，暂不声称速度或 Token 收益。完整结果见 [验收](docs/verification.md)。

## 受管 Codex 工程工作

```powershell
node apps/cli/dist/main.js codex attach --project <fixture-project>
node apps/cli/dist/main.js codex login-native --id <attachment> --method browser
node apps/cli/dist/main.js codex run --project <fixture-project> --goal '排查当前状态异常'
node apps/cli/dist/main.js work status --project <fixture-project>
node apps/cli/dist/main.js work resume --id <work>
node apps/cli/dist/main.js codex run --project <fixture-project> --work <work> --coding --goal '继续修复并验证'
```

`--coding` 只编辑该 attachment 的过滤 Workspace，必须预先批准具体命令；没有审批或隔离器就拒绝执行。
默认分析；fixture-only 在线许可和个人偏好分享各自独立。业务项目本轮仅本地分析，不可升级为在线分享。
Hooks 不触发仍由 MCP 回执、官方 exec 事件、checkpoint 和 finalize 记录受管任务。
普通未受管 IDE 聊天不会自动关联。详细操作见 [工作会话](docs/codex-work-sessions.md)、
[原生接入](docs/codex-native.md)、[ALS 诊断](docs/als-diagnostics-adapter.md) 和 [对照评测](docs/engineering-evals.md)。

## 安装与验证

Windows 10/11 x64，Git，Node 24，Docker Linux engine。其他 Node 版本兼容范围见 package.json；Ubuntu 尚未实机验收。

```powershell
Set-Location E:\Agent_Harness
npx --yes pnpm@10.32.1 install --frozen-lockfile
npx --yes pnpm@10.32.1 build
docker pull node:24-bookworm-slim
node apps/cli/dist/main.js isolation configure --image node:24-bookworm-slim
npx --yes pnpm@10.32.1 check
```

容器执行需要真实隔离探针通过，镜像解析为不可变 image ID。执行无网络、非 root、只读根、资源限额，没有宿主 Shell 回退。`.devagent-state` 和 `.devagent-evals` 均被 Git 忽略。

## 接入项目并审查规范

下面命令均可加 `--home <绝对状态目录>`。注册返回 `stableProjectId` 和兼容 V0.2 的 `id`，后续推荐使用前者。

```powershell
node apps/cli/dist/main.js project add --path D:\my-project --read-only --rules
node apps/cli/dist/main.js project profile --project <stable-project-id>
node apps/cli/dist/main.js onboard analyze --project <stable-project-id>
node apps/cli/dist/main.js onboard plan --project <stable-project-id>
node apps/cli/dist/main.js onboard diff --plan <plan-id> --human
```

计划逐文件解释目的、收益和风险，保留原 AGENTS 前缀，复用已有项目 Skill / Codex 配置。缺少对应规范时才建议 AGENTS 增量、工程 Skill、`docs/agent-capabilities.json`；`--with-codex` 才建议原生配置。敏感或注入内容会阻塞候选生成。

检查完整 Diff 和 JSON 中的 `diffHash` 后，进行独立审批，再应用到过滤快照：

```powershell
node apps/cli/dist/main.js onboard approve --plan <plan-id> --target workspace --digest <diffHash>
node apps/cli/dist/main.js onboard apply --plan <plan-id> --target workspace --grant <grant-id>
node apps/cli/dist/main.js onboard verify --plan <plan-id>
node apps/cli/dist/main.js context show --project <stable-project-id> --task "继续当前功能开发" --human
```

审批默认 300 秒过期，绑定项目、文件 Hash、Diff、revision、分支和目标，单次使用。`verify` 实际检查 Schema/Skill/MCP；缺少批准的回归命令时返回 **blocked**。先为输出 Workspace 批准 argv，再将命令 ID JSON 数组传给 `--commands-file`，才能验证回归。完整流程见 [操作指南](docs/personal-engineering.md)。本轮只在受管 fixture 验证 `--target project`；ALS/Pollen 未调用写入路径。

## 长期画像与记忆

```powershell
node apps/cli/dist/main.js profile import-template --file templates/developer-profile.candidates.json
node apps/cli/dist/main.js profile review
node apps/cli/dist/main.js profile review --id <memory-id> --decision confirm
node apps/cli/dist/main.js profile set --type engineering-preference --topic "验证习惯" --content "保留实际命令与最终版本证据"
node apps/cli/dist/main.js profile show
node apps/cli/dist/main.js profile history --id <memory-id>
node apps/cli/dist/main.js memory search --project <stable-project-id> --query "训练状态"
node apps/cli/dist/main.js project refresh --project <stable-project-id>
```

模板是待确认示例。推断只能产生 candidate；人工确认不会把推断改成 verified。支持来源、版本历史、废弃、删除和显式导出。项目画像从实际 manifest / README / 规则元数据 / 源码结构建立，区分配置声明、源码确认、推断和未知。刷新保留历史决策，旧事实标为 stale。Harness Task 报告自动更新近期工作和证据关联的记忆候选，**普通外部 Codex 会话不会被自动采集**。

## 原生 Codex 接入

```powershell
node apps/cli/dist/main.js codex attach --project <approved-fixture-id>
node apps/cli/dist/main.js codex inspect --id <attachment-id>
node apps/cli/dist/main.js codex login-native --id <attachment-id>
node apps/cli/dist/main.js codex session --id <attachment-id>
```

attach 分离附件配置与认证上下文，创建官方 MCP 配置，在过滤 Workspace provision 公开 `devagent-project-engineering` Skill；不改全局配置、不复制宿主认证。exec 忽略认证目录用户配置并传完整 scoped overrides，复用登录只共享显式受管认证引用。inspect 真实启动官方 app-server 检查实际 MCP/Skill 路径，无模型请求。login-native 使用官方交互认证。session 仅允许明确分享的模拟工程，并用签名回执与外部答案核验判断实际调用；没有认证时保留 blocked Task。在线个人偏好需额外 `--include-preferences`。ALS/Pollen 本轮保持 local-only。详见 [原生接入](docs/codex-native.md)。

MCP 提供预算化 context brief、画像/近期工作/相关偏好查询、源码/日志工具、候选记忆和 gap 提议。没有人工审批、备份恢复、规范应用或能力采纳工具。Codex 仍负责推理与行动循环。

## 设备迁移

通过自己的安全凭据工具在当前进程设置专用 `DEVAGENT_BACKUP_PASSPHRASE` 环境变量，不把口令放在命令参数、仓库、日志或聊天中。

```powershell
node apps/cli/dist/main.js backup create --passphrase-env DEVAGENT_BACKUP_PASSPHRASE
# 将加密文件传到设备 B；使用独立 --home
node apps/cli/dist/main.js backup inspect --file <absolute-backup-file> --passphrase-env DEVAGENT_BACKUP_PASSPHRASE
node apps/cli/dist/main.js backup restore --file <absolute-backup-file> --review <restore-preview-id> --passphrase-env DEVAGENT_BACKUP_PASSPHRASE
node apps/cli/dist/main.js project relink --project <stable-project-id> --path D:\new-clone
node apps/cli/dist/main.js project refresh --project <stable-project-id>
```

scrypt + AES-256-GCM，带受认证 manifest 和内容摘要。恢复先预览冲突，再原子合并并保留现有数据。不迁移路径绑定、认证、签名密钥、原始执行证据、命令/写入授权、Workspace、业务源码或数据。历史降级为未在本机验证，重新关联后仍只读、本地分享；规则读取和执行必须独立授权。详见 [记忆与迁移](docs/knowledge.md)。

## 可复跑演示与证据

```powershell
node apps/cli/dist/main.js eval --suite personal-engineering --image node:24-bookworm-slim
# --online 才尝试真实模型会话；认证阻塞时返回非零
node apps/cli/dist/main.js eval --suite personal-engineering --online --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
```

演示从零接入、增量规范、审批/验证、任务记忆、双设备恢复；诊断演进先真实失败，再实现模块、独立容器测试、模拟人工审查采纳，随后由新 Task 实际调用。生成状态、Patch、签名 Evidence 和分层报告；不声称由 Codex 自主实现。状态严格区分 passed / failed / blocked / skipped。

[验收结果](docs/verification.md) · [12 项实施回答](docs/implementation-v0.3.md) · [架构](docs/architecture.md) · [安全边界](docs/security.md) · [修改文件](docs/files.md) · [后续工作](docs/roadmap.md)

V0.2 code/workspace/command/task/evidence/diagnostics、旧 init/runtime 与可选 DSH bridge 保留。V0.2 操作与验收记录归档于 [history](docs/history/v0.2-README.md)；历史文档相对链接以当时目录为准。
