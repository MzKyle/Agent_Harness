# V0.4.1 分层验收

2026-10-20 至 2026-10-21（Asia/Shanghai），Windows x64；开发分支 `dev/daily-engineering-v0.4.1`，起点
`c3551bf017ef9841b78f2c094418462f5fde673c`。本轮代码未提交、推送或合并。
分层验收已完成：11层passed，Hooks层blocked（真实回调unobserved）。71单元、30集成及42次冻结候选对照通过；不将未验收能力计入passed。
旧报告见 [V0.4历史](history/v0.4-verification.md)。

## 12层状态

| 层级 | 状态 | 实际证据与边界 |
| --- | --- | --- |
| Unit / Integration | passed | 完整 check：71单元/16文件，30集成/15文件；typecheck/lint/build通过；附件篡改、实际Hook定义隔离、容量防截断、项目查询和历史runtime重分析回归通过 |
| Native Authentication & Attachment Isolation | passed | `attachment-e2e-1792504185777`：A→B→A三次真实模型查询，源码/Work跨项目签名拒绝；并发模型明确锁拒绝；官方发现核对附件自己的Skill路径 |
| Hooks Real Callback | blocked / unobserved | `hooks-v041-1792508619114`：旧认证HOME有Hook文件，启用被隔离拒绝；此前真实exec回调0且定义untrusted；新空HOME的A/B定义隔离通过，在线新登录/回调未验收。普通IDE blocked |
| Work Session Correctness | passed | 真执行fail→pass、无测试、证据过期、命令定义/原源漂移、未完成事项、签名Evidence索引对账；未验证不能verified |
| Crash Recovery | passed | 实际终止专用进程、已知父/子进程存活锁、Journal故障注入/重放、重复事件、lease撤销；未知/活锁不自动删，不恢复权限 |
| Adaptive Mode Selection | passed | 静态Auto与显式覆盖、服务端集合/预算、无分类模型请求；42次真实选择记录核验通过 |
| Context / Tool Overhead | passed（测量） | 候选单模块Fast相对Engineering耗时中位数少33.6%、调用少30%、官方input少33.3%；最终本地Work.list中位10.89秒→0.46秒，结果一致；不代表整体模型提速 |
| Autonomous Coding Regression | passed（含历史失败） | 最新真实恢复运行：`task-e76d9a459c4a41038e9817061f971861`，最终两命令通过，修复阶段verified/valid，源指纹不变；接续阶段另保留新待办；旧Plan拒绝/native退出和预算失败保留 |
| Runtime Diagnostics | passed（fixture） | HTTP/worker_threads/临时SQLite真运行；正常延迟传播先瞬态后收敛、持久分歧/异常/超时、时钟不足/陈旧/非法转移；真实ALS runtime未授权 |
| Memory Continuation | passed（接续合同2） | 真实新会话读取历史、重新Plan、复验两命令并清除选定pending，无编辑；新阈值语义待办保留，工程incomplete/证据valid。原总完成判定failed仍归档 |
| Native vs Harness Comparison | passed（候选42/42） | 协议4，相同信息30次+自然发现12次；14组三策略条件/独立项目核验通过，Skill开关正确，Baseline额外上下文调用0；旧失败/中断/协议缺陷保留 |
| Real Project Read-Only Safety | passed | `readonly-v041-1792515073062` 与 `als-review-v041-1792515075443`：ALS/Pollen基线和有界指纹不变；业务测试/构建/写入/分享0；Patch只在过滤快照check通过 |

## 实际命令及证据

```powershell
Set-Location E:\Agent_Harness
npx --yes pnpm@10.32.1 install --offline --lockfile-only
npx --yes pnpm@10.32.1 check
$state = 'E:\Agent_Harness\.devagent-evals\v04-native-onboarding\state'
$auth = '<explicit-authorized-managed-fixture-attachment>'
node evals/native-workflow/isolation.mjs --home $state --auth-attachment $auth
node evals/native-workflow/run.mjs --home $state --auth-attachment $auth
node evals/native-workflow/resume-runtime.mjs --home $state
node evals/native-workflow/continuation.mjs --home $state --with-pending
node evals/native-workflow/hooks.mjs --home $state --id <hook-fixture-attachment> --work <hook-work>
node evals/native-workflow/daily-compare.mjs --home $state --auth-attachment $auth --repeats 2 --information both
node evals/native-workflow/readonly.mjs --home E:\Agent_Harness\.devagent-evals\v041-readonly\state --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
node evals/native-workflow/als-review.mjs --home E:\Agent_Harness\.devagent-evals\v041-readonly\state --als-path D:\Kyle\auto-label-studio
```

单元/集成/构建完整日志与退出记录保存在 `.devagent-evals/v041-check-result.json` 所指日志。
在线报告位于 `$state\reports`，readonly报告位于独立readonly state；不提交本机报告、凭据或源码快照。
最终签名汇总由 `report-v041.mjs` 读取真实日志和每层原始报告生成，缺证据不生成假通过。
Git HEAD只表示起点，不是已提交发布。普通Work有界摘要会排除超过512KiB的锁文件，不能视为整个仓库完整源码Hash；另生成受源码允许策略覆盖的247文件版本清单，包含完整锁文件，见签名汇总versionedSourceManifest及artifacts/v041-source-manifest.json。对照另以全部64个编译JS、输入/源commit/Grader Hash和附件Skill Hash绑定。

Node24.19.0、pnpm10.32.1、TypeScript5.9.3、Vitest5.0.5、Codex0.157.1、授权账户模型gpt-6-astra/low；Docker Linux Node24
隔离镜像固定为 `sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5`。真实exec仅分享明确授权的模拟源码/脱敏日志；业务源码未发送。
完整最小Python锁重建镜像 `sha256:133bbb718e5f7a0d4a62422485d59315cc88e108e0254a67004b9237768db8a7`
离线2项fake测试退出0；命令/镜像/日志记录见 `.devagent-evals/v041-python-smoke-result.json`。

## 测量候选与最终构建

42次对照运行 `daily-comparison-1792508845617`，全部编译JS digest为
`3ba26e65ca9ee6e2874fa7e2c7be75bd87cf95c421531a571736a0abc512e6dc`。
最终另含进展容量保护、项目过滤及历史runtime查询重分析，完整check退出0，最终digest为
`a6321c007579b5623fcf405b0c82378b222badd4f642f6f6f2441e2e9b246d8e`。
核对64文件清单，差异只有 `packages/core/dist/v4/work-sessions.js` 与
`packages/core/dist/v4/runtime-diagnostics.js`；未将候选42次数字称为最终
二进制的整矩阵测量。最终保护另经回归，查询优化另作3轮交替API实测：135个活跃Work中选1个，
两版结果摘要一致，Work.get调用135→1、workingRevision检查150→3，中位10886.1→458.6毫秒。
仅说明本地查询，不能外推模型总耗时或真实ALS开发效率。完整数字见 [性能](performance-v0.4.1.md)。

接续协议2验收的是读取历史、复验并解决选定事项的合同；整个模拟Work仍有
`timeoutMs=300`与handler定时350ms的语义问题待核对，保持incomplete/证据valid。
原总完成判定failed没有改写；候选记忆与未完成事项均未强制清除。

签名汇总 `reports/engineering-v041-latest.json` 包含12层状态、14组条件核验、版本范围和本地查询
样本；本机报告不提交仓库。生成命令（已执行）：

```powershell
node evals/native-workflow/report-v041.mjs --home $state --readonly-home E:\Agent_Harness\.devagent-evals\v041-readonly\state --check-result E:\Agent_Harness\.devagent-evals\v041-check-result.json --python-result E:\Agent_Harness\.devagent-evals\v041-python-smoke-result.json --measured-runtime E:\Agent_Harness\.devagent-evals\v041-measured-runtime-hashes.json --final-runtime E:\Agent_Harness\.devagent-evals\v041-final-runtime-hashes.json --work-query-report E:\Agent_Harness\.devagent-evals\v04-native-onboarding\state\reports\work-query-v041.json
```

## 保留的失败、限制与未执行项

1. `native-eval-1792502495946`：模型在测试后继续编辑，耗尽3次执行预算；最终证据不完整，
   保留failed/tested结果，没有加预算。`native-eval-1792504456839`：官方turn异常退出，Plan
   被UNSAFE_PLAN_REFUSED拒绝，无模型编辑/执行；之后新Task恢复，旧失败不删除。
2. 早期比较按目录禁用Skill无效；官方枚举发现后改完整SKILL.md路径。协议1跨试验Work污染、
   协议2/3历史oracle失败和协议中断均保留，不能作为最终纯开销基线，见 [评测协议](engineering-evals.md)。
3. ALS/Pollen源和Git管理状态保持只读；没有执行Graphify、真实Python/React/Electron业务测试、
   Worker、生产DB、训练、CVAT、GPU、硬件、安装、部署或模型发布。只读指纹不声称排除大数据逐字节Hash。
4. 普通Codex IDE自动关联、Ubuntu、真实ALS采样接口及完整CPU依赖尚未验收；DSH按用户决定继续blocked。
   Python镜像只导入Harness合成测试，不代表ALS业务回归。观测候选Patch未应用。
5. 原生read-only不是完整宿主读取隔离；没有扩大Shell权限或隔离失败回退。没有全局配置/信任绕过、
   认证复制、私有会话数据库扫描或原始聊天归档。Hooks不作为权限或最终验证边界。
6. 两轮小样本、网络/主机负载/缓存影响仍在；usage不是账单，completed turns不是精确请求数。
   每类正确性与开销分开报告，不保证Enhanced总更快，也不外推真实ALS开发效率。
7. 历史runtime查询回归先真实失败：仍返回旧state-mismatch；修复后当前视图按新规则返回
   insufficient-evidence，原签名记录与文件字节保持不变。该回归使用真实隔离命令输出的旧格式
   合成快照，历史派生结论是迁移测试输入，不冒充在线模型或真实ALS观测。

14项回答见 [实施报告](implementation-v0.4.1.md)，日常PowerShell入口见 [使用指南](daily-engineering.md)，
所有变更文件见 [清单](files.md)。
