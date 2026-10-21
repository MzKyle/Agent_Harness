# Work 状态与恢复（V0.4.1）

Work 关联既有 Task/Workspace/Evidence，只记录用户显式选择的项目工作，不采集完整聊天。

| 维度 | 值与语义 |
| --- | --- |
| Session lifecycle（state） | started / active / interrupted / completed；不代表代码成功 |
| Engineering outcome | no-change / changed / tested / verified / failed / blocked / incomplete |
| Evidence status | none / pending / valid / stale / invalid |

Session completed + engineering incomplete 合法；analysis Task succeeded 只表示分析结束。
无实际测试的修改不能 verified；全部批准命令须在当前版本通过，并核对命令定义、源完整性和归属。
旧失败保留，先失败后修复可 verified。修改后读 Work 即降级旧通过，lastVerifiedRevision 只是历史指针。
未完成事项与已验证代码证据分别保留，候选记忆仍须人工审查。

```powershell
$cli = 'E:\Agent_Harness\apps\cli\dist\main.js'
node $cli work start --project <project> --goal '显式选择的工作' --home <state>
node $cli work progress --project <project> --decision '保留接口' --outstanding '独立回归待执行' --home <state>
node $cli work checkpoint --project <project> --home <state>
node $cli work finalize --project <project> --home <state>
node $cli work recover --project <project> --home <state>
node $cli work resume --project <project> --home <state>
node $cli work latest --project <project> --home <state>
```

Journal 在跨文件变更前记录签名意图。候选去重、重复 finalize 幂等、事件固定键去重。
中断后晚到 SessionStart 不把状态改回 active。源/绑定漂移需审查；受管 Workspace 落后原源 commit
时建立新快照。接续建立新 Task/lease，不恢复旧 Plan、证据或权限。
Evidence 先落盘而索引中断可恢复同 Task/Workspace 的签名关联，摘要可重放。
未知/旧空锁不自动删；存活 PID 拒绝回收，只有已退出本机进程的锁可显式 recover。
磁盘损坏、签名失败或无法证明锁归属仍需人工检查，不制造 verified。

事件仅存名称、Thread/Turn/工具 ID、时间和来源。Prompt、工具输入输出、环境不进入事件；
显式 Goal 仍由既有 Task.prompt 保存。MCP/Hook 事件都不是测试通过证据。
活跃事件索引500条，超窗口分片保留；每 Work 最多30个 Task、100候选，到限显式新建 Work。
每Work最多20条决策、20条未解决事项。追加会溢出时在写Journal/候选前明确拒绝，原事项不截断；
可在同一次操作中显式解决旧事项再加入新事项，或建立新Work。其他Work和Task仍可使用。
work archive 保留可查询 Work/事件，移出活跃列表。

个人记忆删除清理 Work 候选 ID，Work 决策/待办文本、导出和旧备份是另一个保留范围。
work delete 删除 Work/事件/Journal/关联摘要与候选，保留 Task、执行证据、补丁与已撤销 lease。
删除标记防止 Task.report 重建摘要，本机摘要副本不会绕过删除。
Portable State 不含 Work/lease/附件/原始 Evidence；恢复历史不是本机验证权限。
