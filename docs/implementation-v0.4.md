# V0.4 的12项交付回答

1. **模型真的使用 MCP：是。** 官方已认证 Codex exec 完成 turn，签名回执和独立 JSON oracle 同时通过。
2. **实际工具与证据：** get_context_brief、get_recent_work、search/read_code、get_runtime_diagnostics、
   submit_plan、write_workspace_code、run_approved_command、get_work_status、record_work_progress 等；
   原始签名回执、Task、版本与测试输出 Hash 见 [验收索引](verification.md)。工具名清单本身不作为成功证明。
3. **自主编码：有。** Codex 改了模拟 HTTP/Worker/SQLite 工程 service.ts 和回归测试；无确定性修复回退。
4. **独立测试：通过。** 初始只读 /grader 真失败，模型修复后 independent-runtime / internal-runtime
   在最终内容版本都通过；另一个新 Task 重新验证。
5. **普通工程会话记录：显式绑定时可用。** work start / checkpoint / finalize 支持外部工程观察，
   codex run 自动关联进展；未绑定聊天不采集。原生 Hooks 真回调未观测，不能声称任意 IDE 会话自动记录。
6. **下一会话接续：通过受管验收。** 新 Task 从 Work/近期上下文获取已有修改和 pending，提交新 Plan、
   复验两条命令并清除明确待办；没有恢复隐藏推理或旧权限。
7. **画像作用：合成偏好已实证。** 独立 fixture state 中显式分享的报告偏好被模型用于正确 JSON 输出，
   oracle 检查了提示词未提供的两个段落标识。真实用户私人画像未上传，个人效率收益未测。
8. **ALS 诊断适配器：真实可运行，但范围是隔离 fixture。** 实际 HTTP 请求、Worker 和 SQLite 触发异常、
   超时、状态不同步；Core通用关联 + ALS语义映射可复用。没有访问真实 ALS live DB/Worker。
9. **任务/状态/日志/源码关联：有。** Evidence→Task/Workspace/版本→runtime workflow/trace/组件/时间→
   源码候选可追溯；ALS 当前静态链路有路径与行号。静态关系和故障候选不冒充已证明根因。
10. **缺口带来真增强：有。** 真实观察驱动 Proposal，新增受控 consistency summary 模块/命令，
    独立测试和审查采纳模拟后下一 Task 真调用。未热加载全局插件；演进实现是确定性 fixture 测试，非模型自升级声明。
11. **ALS/Pollen 不变：是，限明确的完整性覆盖。** 真实只读报告的前后指纹一致，业务执行/源写入/分享均0。
12. **比直接 Codex 的增益：可观察到上下文/诊断/工作证据与接续；没有速度收益。** 四类最终配对都通过，
    Harness版开销更高。Baseline也使用相同受控I/O，不能推广为无限制host-shell Codex对比或声称显著效率提升。

代码核心：Work/事件/检查点、运行观察、最终版本 Validator、原生 exec 元数据装配、严格 MCP 工具和
真实运行 fixture。修改文件见 [完整清单](files.md)，实际48单元/21集成与命令、证据、限制见
[verification.md](verification.md)。本轮留在 dev/codex-workflow-v0.4，未提交/推送/合并。
