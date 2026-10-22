# V0.4 可重复工程对照

共同条件：官方 Codex 0.157.1、账户目录返回的 gpt-6-astra、low 思考配置、相同源 commit/
用户输入 Hash/独立 grader/受管 I/O 与容器限制。两边都禁止宿主任意执行；Baseline 是
**Codex Native + 相同受控源码/编辑/测试 I/O**，关闭 Harness Skill、Hooks、画像、记忆与诊断工具。
它不是无限制 host-shell Codex。Enhanced 增加 Harness 上下文、诊断、进展和 Skill。
两类实现均由官方运行时完成，没有第二套模型客户端或 Agent Loop。

四类：单模块百分比、多模块状态同步、日志故障阶段、显式选择的历史工作接续。
顺序按类别交替，每类每变体仅一次；记录耗时、调用/专用上下文调用、官方 usage、oracle、
测试与源完整性。运行中的人工干预为0；fixture 创建/审批属于共同操作员准备步骤。
usage 是原生 CLI 报告值，可能包含多步重复上下文与缓存，不能当成账单。

| 任务 | Baseline 秒 | Enhanced 秒 | 两侧正确性 | MCP 调用 B/E |
| --- | ---: | ---: | --- | ---: |
| 单模块逻辑 | 48.9 | 57.6 | passed / passed | 8 / 10 |
| 多模块同步 | 48.2 | 65.7 | passed / passed | 11 / 12 |
| 日志关联 | 35.9 | 46.8 | passed / passed | 5 / 7 |
| 历史接续（协议修订2） | 21.3 | 29.0 | passed / passed | 1 / 3 |

这些样本中 Enhanced 耗时与输入 Token 更高，**没有速度/成本收益证据**。可观察收益是额外的
项目/工作/诊断来源、进展记录和可审查上下文；最终测试验证两侧都使用相同门禁。
样本小、主机负载/缓存/网络不受严格控制，不能声称显著优劣或推广到 ALS 开发效率。

第一版历史接续选择 HISTORY.md，但受控源码工具拒绝 Markdown，两侧均 failed。
该失败完整保留；修订2将明确选择的摘要放到双方都可读的 src/selected-history.ts，明确 JSON 字段类型，
再对两侧重跑。不能静默替换失败，或把共享输入协议错误描述为某一侧能力差异。

```powershell
node evals/native-workflow/run.mjs --home <explicit-fixture-state> --auth-attachment <known-managed-auth>
node evals/native-workflow/compare.mjs --home <explicit-fixture-state> --auth-attachment <known-managed-auth>
node evals/native-workflow/compare.mjs --home <explicit-fixture-state> --auth-attachment <known-managed-auth> --case work-continuation
node evals/native-workflow/evolution.mjs --home <same-runtime-fixture-state>
node evals/native-workflow/continuation.mjs --home <same-runtime-fixture-state>
node evals/native-workflow/profile.mjs --home <dedicated-fixture-state> --auth-attachment <known-managed-auth>
```

没有登录则报告 blocked，不搜索其他凭据。compare 保留每次 run JSON，latest 可能是单独重跑的一类，
必须同时查看归档 run 才能汇总四类。重复执行会创建新受管 fixture，不会写业务源或自动清理旧证据。
新增 unit/integration 与旧离线 E2E 继续独立运行；分层报告区分 passed / failed / blocked / skipped。
