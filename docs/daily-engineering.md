# 日常使用（Windows PowerShell）

```powershell
Set-Location E:\Agent_Harness
$cli = 'E:\Agent_Harness\apps\cli\dist\main.js'
$state = 'E:\Agent_Harness\.devagent-state'
node $cli project list --home $state
node $cli codex use --project <project-id> --mode auto --home $state
node $cli codex status --project <project-id> --home $state
node $cli work latest --project <project-id> --home $state
```

`use` 选择已注册项目并检查绑定，没有 Goal 时不启动模型或创建开发进展。
首次附件使用官方 `codex login-native --id <attachment> --method browser`；同 state 明确授权
的 fixture 才能 `--auth-from <managed-attachment>`，不会寻找宿主登录。

```powershell
node $cli codex run --project <fixture-id> --goal '修复单文件百分比计算' --mode fast --coding --home $state
node $cli codex run --project <fixture-id> --goal '分析 API/Worker 状态不同步' --mode deep --home $state
node $cli work resume --project <project-id> --home $state
node $cli codex run --project <fixture-id> --work <returned-work-id> --goal '继续上次开发，核对当前版本并复验' --coding --mode auto --home $state
```

编码仍需批准 Workspace 的具体命令；没有 Plan/批准/隔离器即拒绝，无宿主 Shell 回退。
`--id <attachment>` 精确选择附件；显式 mode 覆盖 `use` 的选择。Auto 使用静态特征，无分类模型请求。
Fast 只提供源码、可选小型 brief 和编码必需工具，不强制加载 Skill/完整画像；Engineering
按需增加历史/约束/相关偏好；Deep 再增加运行快照、日志和真实能力缺口。不机械调用全部工具。
服务端固定集合限制能力，模式不授予权限；来源、版本和不确定性保留。

普通 IDE 生命周期关联尚未证明；实际可用的显式本地观察：

```powershell
node $cli work start --project <project-id> --goal '本次显式本地工作' --home $state
node $cli work progress --project <project-id> --decision '保留公开接口' --outstanding '回归待执行' --home $state
node $cli work checkpoint --project <project-id> --home $state
node $cli work finalize --project <project-id> --home $state
node $cli work recover --project <project-id> --home $state
node $cli doctor --home $state
```

外部观察不执行项目脚本，会话结束而修改未验证时工程结果仍 incomplete。Git/内容/绑定漂移需要
审查；受管 Workspace 落后原源 commit 时创建新快照。`--accept-change` 不恢复旧 Plan、证据或权限。
30 次 Task 接续上限保留；到限显式建立新 Work，旧记录可归档。
每Work还最多20条决策和20条待办；满额时新进展会明确拒绝，不会挤掉未解决问题。
先审查/显式解决旧待办，或建立新Work；其他Task与Work不受该记录容量影响。

```powershell
node $cli work archive --id <completed-work> --home $state
node $cli evidence archive --task <terminal-task> --home $state
node $cli evidence archive --task <terminal-task> --apply --home $state
node $cli memory archive-history --before '2026-10-01T00:00:00Z' --home $state
node $cli memory archive-history --before '2026-10-01T00:00:00Z' --digest <reviewed-archiveDigest> --home $state
```

归档先保存可验证记录，再移出活跃索引，不删除审计输出。知识到限时 Task 摘要保留本机签名副本，
doctor 显示 retention notice；已确认个人记忆不自动清理。个人记忆删除会清理 Work 候选 ID，
但 Work 决策审计、独立导出和旧备份另行保留。Work 删除清理其摘要/候选/事件，保留 Task、
执行证据、补丁；删除标记防止报告重建摘要。归档知识不自动加入旧便携备份。

真实 ALS/Pollen 本轮仅本地只读；认证或 mode=deep 不允许在线分享或运行业务测试。
当前Native run只接受fixture-only分享，真实项目在线接入还需独立同意契约与读取隔离审查；
不得改标fixture绕过。真实项目可先用本地画像/显式Work流程，use成功只表示绑定检查成功。
