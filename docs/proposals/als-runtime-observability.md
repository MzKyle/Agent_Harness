# 独立 ALS 观测改造候选：未应用

原因：当前可静态关联 workflow_id、step_key、状态、heartbeat_at、error_text，但本轮没有
授权 live 日志/DB 读取器，也没有证明 API 与 Worker 共用统一 trace 字段。
替代方案：操作员显式导出脱敏 workflow/steps 状态，保留采样时间与版本，通过隔离 fixture 验证映射。

最小下一步是在既有日志设施中加入 workflow_claimed / step_started / workflow_failed 的结构化
workflow_id、step_key、component、event、error_type。避免记录参数、路径、令牌、原始异常正文。
[Patch 候选](als-workflow-observability.patch) 仅展示已核对 Engine 锚点上的最小日志增量。
它没有增加统一 trace、持久事件表或数据读取权限，也没有经过 ALS 依赖环境验证。
V0.4.1 在相同 ALS commit 的过滤快照中重新核对锚点并运行 `git apply --check`，LF Patch通过，
未应用补丁；第一次 Windows CRLF 冲突报告保留。检查不证明业务行为或 Python 回归通过。
后续采样接口还需定义 source/observedAt/updatedAt、可信 clock domain、传播期限和重复采样窗口，
避免把正常 API/Worker/SQLite/UI 的短暂差异直接判成持久故障。

独立验收应在过滤业务快照中执行：正常/取消/异常/重试/维护暂停、脱敏、重复事件、状态持久一致性；
之后再设计兼容的只读采样接口。需要明确审查文件 Diff、隔离依赖和测试证据，不能直接应用到真实 ALS。
