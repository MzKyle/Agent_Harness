# V0.4.1 工程对照协议

当前三策略结果见 [性能报告](performance-v0.4.1.md)，实现/验收见
[实施报告](implementation-v0.4.1.md) 与 [12层结果](verification.md)。
V0.4 原始表格保留在 [历史](history/v0.4-engineering-evals.md)。

最终冻结候选运行 `daily-comparison-1792508845617`：42/42通过，14组三策略条件与独立项目
核验通过；Baseline额外上下文调用为0，实际Skill开关符合策略。最终另增容量防截断与Work
项目过滤与历史诊断查询重分析，完整71单元/30集成通过；候选与最终二进制仅work-sessions.js及
runtime-diagnostics.js不同，未混入42次数字。
最终项目过滤另用同一签名状态作3轮交替本地API测量，结果相同；细节和局限在性能报告。

## 协议4：真实官方运行时与相同门禁

模型为授权账户目录提供的 gpt-6-astra/low，CLI 0.157.1。每次官方 exec 只有一次调用入口，
Harness 不实现模型循环。Baseline 是 **官方 Codex + 同一套受控源码/编辑/测试 MCP I/O**，
关闭额外 Harness context/历史/诊断/Skill；它不是无限制宿主 Shell Codex。
Auto/Fast 使用静态模式，Engineering/Deep 启用所需工程上下文，所有策略保留相同审批、Plan、
执行器、独立 Grader、资源限制、源完整性和最终版本证据要求。

| 场景 | 必要信息 | 独立核验 |
| --- | --- | --- |
| 单模块 Bug | 同一公开 API 与百分比需求 | 四舍五入/零分母，真实隔离测试 |
| 多模块 Bug | 同一百分比及状态 label 需求 | 两模块行为，真实隔离测试 |
| 日志诊断 | 同一 src/trace.ts 合成事件 | traceId、故障阶段、源码路径 oracle |
| 历史接续 | 相同已存 pending/decision/verified | 精确已选工作与未验证状态 oracle |
| 项目特殊约束 | 同一公开 API 与项目 contract | 非正分母、负数、超完成值、clamp |

每场景三策略各两轮，交替顺序。每次 trial 都有独立 fixture clone、Registry project、Work、
Workspace 与附件；源 commit/用户输入 Hash/只读 Grader Hash 对齐，只有策略提供的上下文面不同。
clone 不使用 hardlinks，移除的只是自有模拟 clone 的本地路径 origin，不涉及业务 Git。
模型不接收真实 ALS/Pollen 源码。Coding 每次独立预检先真失败，模型自行修改，不能预置固定补丁。

**相同信息条件**：5场景×3策略×2轮。历史位置与约束值显式包含于相同用户输入，衡量额外开销。
**自然发现条件**：历史与特殊约束2场景×3策略×2轮。所有策略都可从已提交源码归档/contract
查到相同事实；Harness 额外拥有正常的 scoped Work/记忆索引。输入不直接给值或选定文件。
该结果只描述这个 fixture 的发现条件，不能推广为真实个人记忆的普遍收益。

历史 oracle 要求返回已存字符串，不要求模型扩写；未完成的分析不能报告工程已验证。
所有策略使用相同 oracle。源码工具只支持允许的代码切片，search 为 literal 非 regex，
不能把 Markdown 不可读的输入协议问题解释成 Baseline 推理能力差。

报告保存单次真实状态、耗时、native耗时、completed turn、官方 usage、签名工具完成/拒绝、
工具分类、context brief字节/所有context结果字节、重复查询、缓存、实际测试及命令尝试、
人工干预、Plan/独立Evidence/源完整性。缺失指标保持null，不补0。
执行前记录源码与编译实现 digest，运行间若编译行为变化即中止该协议，不混合实现版本。

官方 usage 不等于账单 Token，completed turns 不等于精确请求数。上下文工具结果字节不等于
模型总输入；缓存前后、网络和主机负载未被完全控制。两轮仅作描述，不能主张统计显著或 ALS 生产效率。
失败也纳入完成数量，不能只挑成功样本；只有同时通过同一核验的配对才可讨论正确前提下的收益。

## 保留的失败与协议修订

- V0.4 历史协议曾使用不可读 Markdown，两侧失败，后改共同可读源码摘要；旧失败保留。
- 实际官方 Skill 枚举进一步证明，V0.4 及早期 V0.4.1 按目录禁用 Skill 没有关闭共享旧 Skill。
  这些运行的 model结果和证据仍有效，但不构成干净的 Skill额外开销对照。
- 协议1 `daily-comparison-1792498139741`：34次已完成，31通过、3失败；同项目反复复用导致
  Work 污染，停止该运行并保留专用进程树终止记录，没有将未完成试验计通过。
- 最初独立 clone 因本地路径 origin 被身份规则拒绝，发生在模型前；移除自有clone origin修正，
  不放宽身份规则。
- 协议2 `daily-comparison-1792501021080`：自然历史3次，Baseline/Auto通过、Enhanced失败；
  对未存原始答案不作事后猜测。后澄清共同的“复制原值”输出格式，没有放宽 oracle。
- 协议3 `daily-comparison-1792501540670`：自然历史3次，Baseline失败、Auto/Enhanced通过；
  原样保留，也不作为最终性能样本，因为完整 Skill路径修正尚未应用。
- 协议4 使用完整 SKILL.md 路径开关，官方 skills/list 真实核对启用根；公开 provisioned
  Skill 与模型代码 Diff 分开，内容仍绑定最终版本。以最终报告中的运行ID和实现digest为准。
- 真实 runtime 自主修复保留执行预算耗尽/编辑后证据过期，以及 native turn异常退出/Plan拒绝
  的失败。尝试上限仍为3；恢复创建新Task/lease，不伪造成功、不重置旧Task预算。
- 接续协议1中原pending已清除、两条复验通过且无编辑，但模型新增阈值语义待办，Work正确
  保持incomplete。旧总完成判定因此failed，完整归档。协议2单独验收接续合同：选定pending
  被解决、当前证据有效、无多余编辑、剩余问题与工程状态一致；不宣称全部工程工作已完成，
  也不改变独立Grader或把未完事项强制清除。对照协议4的统一oracle未因此改变。

## PowerShell 复跑

先使用显式已授权的 fixture state 与受管认证引用，不扫描其他登录。新建认证需用户官方交互。
下面命令只运行 Harness 合成工程，重复会生成新报告和临时 fixture，旧证据不自动清理。

```powershell
Set-Location E:\Agent_Harness
$state = 'E:\Agent_Harness\.devagent-evals\v04-native-onboarding\state'
$auth = '<explicit-managed-auth-attachment>'
node evals/native-workflow/isolation.mjs --home $state --auth-attachment $auth
node evals/native-workflow/run.mjs --home $state --auth-attachment $auth
# 仅当上一运行失败且源未漂移时，显式恢复到新Task
node evals/native-workflow/resume-runtime.mjs --home $state
node evals/native-workflow/continuation.mjs --home $state --with-pending
node evals/native-workflow/hooks.mjs --home $state --auth-attachment $auth
# 同认证运行必须串行；比较开始后保持编译实现不变
node evals/native-workflow/daily-compare.mjs --home $state --auth-attachment $auth --repeats 2 --information both
```

Hooks 精确定义尚未信任则保持 blocked/回调unobserved；使用官方 `/hooks` 审查，
不修改私有信任数据库、不使用 trust bypass。普通 IDE和真实 ALS runtime验收另列。
