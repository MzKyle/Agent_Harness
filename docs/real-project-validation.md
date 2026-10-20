# 真实项目只读验证

2026-10-20 本机实际执行，报告在 `.devagent-state/reports/real-als.json`、`real-pollen.json` 与 functional-latest.json。全部源码仅本地，modelCalls 0；未运行业务脚本、训练/GPU/CVAT、Full、硬件、数据库或云上传。

## ALS

源 `D:\Kyle\auto-label-studio`，基线 `c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab`。已注册、过滤规则、识别分层/测试入口、生成训练状态规划与过滤 Commit 快照。

源码证据（完整行号见报告）：CurrentTaskCard.tsx:8/:72 展示任务/计算进度；ProjectPage.tsx:34 请求 `/api/projects/${projectId}`；web/app.py 对应 route/聚合 workflows；product_workflow_handlers.py:20/:110 引用并调用 ProductTrainingService；product_worker.py:27/:41 构造 WorkflowEngine/调用 run_once；product_store.py 提供 list_workflows，SQLite 来源由当前 registry/store 静态证据支持。识别 training-recovery.test.tsx、test_product_training.py 等入口，未运行原项目测试。

训练状态计划包含状态映射、轮询/缓存、取消/恢复、workflow/task/trace、错误码、独立回归与数据边界。静态证据不能证明实时 DI、状态提交时机、Worker→SQL→API→React 的实际顺序，均列为待确认。没有修改业务训练流水线。

## Pollen Instrument

使用授权 GitHub 源的新独立稀疏副本 `.devagent-evals/real-projects/Pollen_Instrument`，基线 `d776a95bbffa57a129a1823f61dd2a1726362d6c`；不改任何已有业务目录。已识别 Application/Domain/Infrastructure/Presentation、MockHardware、Tests、Master.sln。

PermissionService.cs:11、TabPermissionManager.cs:48 RoleChanged 订阅/:334 退订、MainView 角色事件与 TabPermissionManagerTests 构成权限诊断证据。计划检查订阅、UI 线程、权限超时/恢复、按钮启用与 MockHardware 限制。

**当前主程序实际使用 Windows Forms/.NET Framework 4.8**：Presentation 引用 System.Windows.Forms，Application.Run 入口。不能沿用需求中的 WPF 假设。未启动 UI，安全 Windows/WPF runner 缺失，动态 UI 验证未完成。

## 不变性门禁

验证前后记录 HEAD、porcelain status 摘要、允许源码内容摘要、树元数据、Git HEAD/index/config/packed-refs/logsHEAD hash，Git no-optional-locks 不刷新索引。源码/规则/规划/快照后再比较，差异使 gate 失败。两个源本轮均通过。

覆盖为有限源码内容 + 树元数据 + Git 管理状态；大型排除目录只记不透明元数据，**未逐字节证明全部业务数据**。Pollen 稀疏副本也不等同完整安装工程。可复现命令见 README 带显式路径 eval。
