# V0.3 操作指南

所有 CLI 支持 --home 指向独立绝对状态目录。以下占位 ID 来自上一条 JSON 输出，不是可直接执行的字面值。可完整执行的 fixture 演示见最后一节。

## 接管新项目

1. project add --path <absolute-project> --read-only --rules：只读注册、建立逻辑身份/初始画像；--rules 是明确规则读取许可。默认不对外分享。
2. onboard analyze --project <stableProjectId>：当前事实、能力状态、已有规则/Skill/配置和缺口。
3. onboard plan --project <id> [--with-codex]：保留原规则、复用已有 Skill/配置，只产生缺少的候选。没有实际缺口可复用文件，不制造第二套规范。
4. onboard diff --plan <id> --human；另查看 JSON 的逐文件 reason/benefit/risk、blocked 和 diffHash。
5. onboard approve --plan <id> --digest <reviewed-diffHash> --target workspace；可用 --expires 300 指定秒数（1秒至1小时）。
6. onboard apply --plan <id> --grant <grant-id> --target workspace。
7. 批准 Workspace 的必要回归 argv，onboard verify --plan <id> --commands-file <ids.json>；onboard report 读取结果。

审批不藏在 apply 的 --yes 后面。拒绝用 onboard reject；过期或内容/分支变化后重新计划/审查。对敏感规则或注入内容先让用户在项目自己的流程中处理，Harness 不自动修改。workspace 来自已提交过滤快照；未提交规则变化可能无法在该快照应用，届时拒绝并保留报告。

## 容器回归示例

生成的 workspaceId 来自 apply。命令参数文件内容是标准 JSON：

```json
["--test", "tests/project.test.mjs"]
```

```powershell
node apps/cli/dist/main.js command approve --workspace <workspace-id> --id project-regression --executable node --args-file <argv.json>
# commands.json 内容为 ["project-regression"]
node apps/cli/dist/main.js onboard verify --plan <plan-id> --commands-file <commands.json>
```

这只适用于对应 Node fixture。真实工程须选择实际已安装的 Python/.NET/Node 依赖、镜像和最小必要检查；发现脚本不能自动执行。Onboarding verify 检查生成/目标文件、Skill frontmatter、能力 Schema、Codex TOML/MCP 基本结构，再真实连接 Harness stdio MCP 并调用 context，执行指定批准回归。没有回归命令返回 blocked；失败返回 failed。普通 SDK 探针通过不等于 Codex 模型已调用 Skill。

--target project 的审批与 workspace 完全独立；只允许非保护开发分支及精确文件。本轮真实项目禁止调用，原项目写入路径仅在 fixture/dev 验收。

## 画像、项目事实与近期任务

profile set/propose 可传 --type、--topic、--content，或 --file <memory-input.json>。文件契约：

```json
{"domain":"developer","type":"engineering-preference","topic":"验证","content":"保留最终版本测试证据","tags":["tests"]}
```

profile show/review、profile history --id、profile review --id --decision confirm|reject、profile delete --id；导入 templates/developer-profile.candidates.json 只产生候选。profile export 写入管理目录 artifacts 的显式明文文件；不自动上传。

memory set/propose --project <id> --type decision --topic <topic> --content <text> 保存项目决策；memory search --project <id> --query <text>；--include-candidates / --include-deprecated 显式查看候选/旧项。memory export --project <id> 导出该作用域。知识和 Skill 偏好使用对应 domain/type，不混入另一个项目。

project refresh 重扫当前事实与 capability；--probe 才运行真实隔离能力探针。context show --project <id> --task <goal> --budget 6000 --human 显示预算化上下文。修改后调用 task report --id 会刷新真实 Harness 任务摘要和待审查记忆；外部普通 Codex 工作没有自动采集器。

## 能力演进

record_capability_gap 使用现有绑定 Task；分类/去重 Proposal 可用 capability proposals --project <id> 查看。人工 capability approve --id 后，在受管 Workspace 实现、保留 Patch，并批准将来调用命令。capability implemented --id <proposal> --workspace <id> --task <id> --command <approved-id> 绑定版本；verify --evidence <execution-id> 要求当前版本签名成功；adopt 是独立人工步骤。

新 isolated Task 须绑定相同项目/Workspace、处于 running 且有结构化 Plan，然后 capability invoke --id <proposal> --task <new-task> 才执行批准容器命令。调用不会加载全局插件；跨项目重用需要重新适配/测试/批准，修改 Workspace 会拒绝旧能力。当前演示为确定性基础设施闭环，不代表模型自主发现或实现升级。

## 迁移

backup create / inspect / restore --review 的共同参数是 --passphrase-env DEVAGENT_BACKUP_PASSPHRASE。用专用凭据管理方式在进程设置口令，至少12字符；不要放参数或聊天。restore 不带 --review 只预览，不隐式恢复。预览后本机数据变化需重新预览。

设备 B：导入加密文件 → 检查冲突 → restore --review → project relink --project <stableId> --path <explicit-clone> → project refresh。相同远端无共同 Git 历史拒绝；独立 clone 有独立身份，不自动合并。恢复不包含路径/认证/Workspace/执行或写入许可；历史 Evidence 降级。需要规则读取时按原 Registry 流程显式重新注册相应读取授权，不能把 relink 当成权限恢复。

## 一次执行全部演示

```powershell
node apps/cli/dist/main.js eval --suite personal-engineering --image node:24-bookworm-slim
```

脚本在 .devagent-evals/v3-run-* 创建独立 fixture/state，模拟逐项人工审查，只在 fixture/dev 验证项目规范写入；原工程不变。报告包含路径，可继续用 --home <该state-a> 查看所有 IDs、Patch、Task 和 Evidence。unit/integration 单独执行，演示报告将未运行的这两层标记 skipped，不伪称通过。

```powershell
npx --yes pnpm@10.32.1 check
node apps/cli/dist/main.js eval --suite personal-engineering --online --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
```

--online 仅专用 fixture。缺少原生 auth 返回 blocked_by_auth，在线要求未满足时 CLI 非零；其他独立流程照常运行并保留各自结果。DSH 暂缓，不阻塞本套演示。原生 attach/inspect/login/session 见 [说明](codex-native.md)。