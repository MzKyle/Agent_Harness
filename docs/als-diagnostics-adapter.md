# ALS 诊断映射与真实运行 Fixture

ALS 只读基线：`c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab`。
已完整阅读桌面架构文档；它明确区分目标与实现。根据 Harness 本轮只读规则，不在业务源执行
Graphify、脚本、构建或 Worker；采用有界源码查询降级，没有刷新语义图谱。

| 静态源码事实 | 当前路径与行号 |
| --- | --- |
| WorkflowStatus 与 StepStatus 是两个状态域 | `src/auto_label_studio/domain/product.py:27`、`:37` |
| Web 组装 ProductStore、WorkflowService | `src/auto_label_studio/web/app.py:267` |
| 训练/标注请求调用 enqueue；查询、取消和 retry 分开 | `web/app.py:918`、`:961`、`:988`、`:994`、`:1003` |
| ProductWorker 构建 handlers 和 WorkflowEngine，tick 调用 run_once | `application/product_worker.py:22`、`:27`、`:41` |
| Engine 恢复 stale、claim，按步骤执行 handler | `application/workflow_engine.py:171`、`:172`、`:173` |
| 活跃 handler 每 15 秒 heartbeat；异常完成 failed | `application/workflow_engine.py:207`、`:238` |
| SQLite workflow_runs / workflow_steps 表 | `infrastructure/registry.py:155`、`:180` |
| Store 单 worker claim / 60 秒 stale recovery | `infrastructure/product_store.py:446`、`:521` |
| heartbeat、start_step、finish_step 更新持久状态 | `product_store.py:606`、`:637`、`:654` |
| React 展示 workflow 状态并调用取消/retry API | `desktop/renderer/src/pages/project/workflow/WorkflowRow.tsx:43`、`:76` |
| 现有 claim/stale/idempotency 测试源码 | `tests/unit/test_product_workflow.py:711` |

表中省略前缀的 Python 路径均在 `src/auto_label_studio/` 下。
这是导入、调用语句、SQL 和测试源的静态关系。API → 持久队列 → Worker → 更新 → React 消费是
有源码支持的关联候选；当前机器的进程拓扑、请求/线程时间顺序、GPU/CVAT、真实 UI 表现均未运行确认。
没有把测试文件存在描述为业务测试已执行。ALS 实现已经有异常持久化，本轮 fixture 的故意缺陷不代表 ALS 有同一缺陷。

Core `runtime-diagnostics.ts` 提供严格快照解析、状态/停滞/错误时间线和持久一致性关联；
Adapter `als-runtime.ts` 单独保存 ALS 工作流状态语义与源码检查候选。转移表是诊断期望，
不会作为 ALS 全部状态机的形式化证明，也不执行或修改真实 ALS。
查询工具为 get_runtime_diagnostics / get_error_timeline / get_state_consistency / get_regression_context。
可按 Harness taskId、业务 workflowId 和 traceId 筛选；原始签名观察与筛选视图分开，跨 Task/项目归属不匹配拒绝。

输入来自**明确批准的隔离命令** stdout 中唯一 `DEVAGENT_RUNTIME_SNAPSHOT <JSON>` 标记。
捕获检查 Evidence HMAC、输出 Hash、真实 Task/Workspace 归属、隔离状态、大小、时间和敏感字段。
快照关联原 Evidence、版本、workflowId、traceId、组件、时间和步骤；按项目隔离查询。
签名证明命令确实输出了内容，不证明任意不可信程序的陈述都是真实业务事实。
原始 stderr/数据库不默认导入；失败命令可以提供故障观察，但不能因此成为通过的测试。
版本变化或超过 24 小时标 stale，既有观察也不等于当前 live 状态。

```powershell
node apps/cli/dist/main.js diagnostics capture-runtime --id <execution-id> --home <state>
node apps/cli/dist/main.js diagnostics runtime --project <project> --home <state>
node apps/cli/dist/main.js diagnostics validate --task <task> --home <state>
```

运行 Fixture 使用 Node 24 内置 HTTP、worker_threads 和真实临时 SQLite，省去新的 Python/FastAPI
依赖。它确实接收 loopback 请求、执行 worker、读写隔离数据库，并注入异常、超时和状态不同步。
它不覆盖 FastAPI 中间件、Electron、Python 调度、CVAT、GPU 或 ALS 的真实数据库迁移。
独立 `/grader` 只读测试验证 healthy/exception/timeout 四层状态一致；初始失败和模型修复后通过均有签名证据。

V0.4.1 为 v1 快照新增可选 clock domain/trust/skew、state source、observedAt/updatedAt、传播
延迟策略和重复采样窗口。不同状态先区分 transient-inconsistency、persistent-mismatch、
stale-observation、illegal-transition、worker-error、insufficient-evidence；只有可信时间及
超出传播期限的重复分歧才判 persistent。缺时钟或时间戳不能推断因果。旧快照仍可读，旧
state-mismatch 别名仅对应已确认的持久分歧。真实 fixture 集成额外验证允许延迟的 healthy
持久化先短暂不同、随后收敛，独立 grader 也保留这条正常路径。
查询视图按当前已注册 Adapter 重新分析，并标明 analysisVersion=0.4.1；旧快照缺时钟时返回
insufficient-evidence，不能沿用旧的瞬时不一致结论。get 读取的原签名记录和原输出保持不变。
Adapter 不再可用时保留历史派生结果并标明 stored-unreclassified，不冒充当前分析。

真实 ALS 尚无本 Harness 可直接授权读取的统一事件流；现有 workflow_id / step_key / heartbeat /
error_text 可作为适配输入，traceId 不能凭空补造。进一步接入见
[观测改造候选](proposals/als-runtime-observability.md)，没有应用到业务源。
