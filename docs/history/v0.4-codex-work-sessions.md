# V0.4 工作会话

Work 是现有 Task / Workspace / Evidence 的会话关联，不是第二套 Agent Loop。
只有显式 start 或受管 codex run 才建立记录；不采集普通聊天或扫描 Codex 私有历史。

```powershell
$cli = 'E:\Agent_Harness\apps\cli\dist\main.js'
node $cli work start --project <project> --goal '排查状态异常' --home <state>
node $cli work status --project <project> --home <state>
node $cli work progress --id <work> --decision '保留公开 API' --outstanding '独立回归待执行' --home <state>
node $cli work progress --id <work> --resolved '独立回归待执行' --home <state>
node $cli work checkpoint --id <work> --home <state>
node $cli work finalize --id <work> --home <state>
node $cli work resume --id <work> --home <state>
node $cli work events --id <work> --home <state>
node $cli work export --id <work> --home <state>
node $cli work delete --id <work> --home <state>
```

外部观察模式读取当前项目的 Git、允许源码文件 Hash 和实际变更路径，不执行项目命令。
受管模式绑定过滤 Workspace，编码仍需现有 Plan、命令审批与 Docker 门禁。
finalize 对所有批准命令调用同一个最终版本 Validator；没有实际测试的变更不能成为 verified。
分析 Task 完成表示分析结束，摘要明确写出实现未验证。

状态为 started / active / interrupted / completed。Stop、Interrupt、SessionEnd 做 checkpoint；
显式 finalize 归档并吊销当前观察 lease，重复 finalize 幂等。事件只保存白名单字段，
包含 Work/Task/项目、事件名、Thread/Turn/工具 ID、时间和观察状态。
提示词、命令输入、工具输出、环境变量、源文件正文和最终模型回答不进入事件记录。
受管 Task 的显式 goal 仍由既有 Task.prompt 保存，这不同于 Hooks 收集完整对话。

resume 建立新 Task 与观察 lease，复用逻辑 Work。Git、内容或本机绑定变化需显式
`--accept-change`；它表示用户检查漂移，不恢复任何执行或分享权限。旧 lease 不能写新会话。
新 Task 需要自己的 Plan 和最终版本证据，不恢复隐藏推理或旧审批。
进程异常退出后可检查 status、events、checkpoint，再 resume；遗留锁由操作员检查，绝不自动
删除一个可能仍活跃的进程锁。事件文件和会话索引不是跨文件事务；保留 fail-closed 恢复边界。

变更、已测、最终版本通过、历史失败、阻塞和未完成分别存储；决策/问题生成待审查记忆。
同一逻辑 Work 的 Task 历史保留失败与最近20个证据索引；verified 只取当前 Task 的最终版本，
历史成功不会在 resume 后自动恢复验证权威。
`resolved` 只清除明确匹配的待办文字，不会制造测试证据。确认记忆使用原 memory review。
Context Brief 读取当前 Git 与最近三份 Work，输出待验证、未审查决策及版本漂移提示。

每 Work 最多 500 个事件、30 次 Task 关联、100 个记忆候选；超限拒绝继续写入。
本机 Work/lease/事件和运行快照不进 V3 备份；可迁移摘要与记忆继续降级信任、剥离权限。
delete 删除该 Work、事件、关联摘要和记忆候选；保留已吊销 lease、Task、证据、Patch、
独立导出和旧备份。删除导出/备份是单独的本机文件管理动作，不能声称全局历史已被清除。
