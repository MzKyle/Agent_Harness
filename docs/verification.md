# V0.4 实施与分层验收

日期：2026-10-20。项目 E:\Agent_Harness；分支 dev/codex-workflow-v0.4，基于
V0.3 main 068e3a64bd36bb268f1c4d3615ab9ce15bbf3766。开始时 main/origin main 一致，工作区干净；
本轮未提交、push 或 merge。V0.3 原报告保留于 [历史](history/v0.3-verification.md)。

结论：**受管 Codex + Harness 工程闭环通过；原生 Hooks 真回调仍未观测到。**
真实模型已查询 MCP、使用返回数据、修改 fixture、通过独立 grader，并在新会话读取 Work 后复验。
不能推广为普通未绑定 IDE 会话自动采集，也不声称真实 ALS 运行验证或效率显著提升。

## 11 层实际结果

| 层级 | 结果 | 证据与边界 |
| --- | --- | --- |
| Unit | passed，48/48，8文件 | 兼容 V2/V3；Work 隐私、伪造/replay/中断、漂移、归档、删除、无测试不验证、源完整性、Hook 配置冲突 |
| MCP protocol | passed；integration 总计21/21，9文件 | 真 stdio；Task/项目 scope；Work/诊断目录、敏感进展与跨项目拒绝；容器执行、安全和旧集成 |
| Native discovery | passed | 官方 app-server 0.157.1 实际发现 Skill/MCP/认证；发现不算模型使用 |
| Online MCP | passed | 已认证官方 exec；签名 context/recent/source 回执；独立核对项目、原提交、路径、约束和近期状态 |
| Autonomous coding | passed | 初始独立 grader 真失败；模型通过 MCP 修改 service.ts 与测试；最终两条命令均通过，原始 fixture 指纹一致 |
| Work memory | passed（受管入口） | 新 Task/会话读取既有 Work，无新代码修改，重新提交 Plan 和两条复验；明确清除 pending。原生 Hooks 子项 blocked/unobserved |
| Runtime diagnostics | passed（fixture） | 真实 HTTP/worker/SQLite；初始两项持久状态不同步，修复后一致；注入的异常/超时错误事件仍是预期输入 |
| Capability evolution | passed | 实际运行观察驱动 gap 去重、实现、独立失败/通过、审查采纳模拟；下一 Task 真正容器调用新增命令 |
| Real read-only | passed | ALS/Pollen 真实画像/规则候选/上下文；前后完整性指纹相同；业务命令0、源分享0、写入0 |
| Security | passed（测试覆盖范围） | 伪造lease/Task/签名、跨项目、敏感事件、过期证据、审批/隔离、迁移剥权；不是绝对安全证明 |
| Comparison | passed（协议修订后4类各一对） | 相同模型/配置/输入/commit/grader/受控I/O；两侧都通过。保留第一版历史接续两侧失败，不隐藏协议缺陷 |

新增内容不包含新 Web UI、模型客户端、Agent Loop、注册系统或持久数据库。
Work、运行观察、Validator 在现有 StateStore/签名上增量实现；portable schema 仍为3。
机器约束强制最终内容版本的所有批准命令与源完整性；架构/覆盖/诊断建议保持 advice-only。
完整 [变更文件](files.md)、[12项交付回答](implementation-v0.4.md)。

## 实际执行

```powershell
npx --yes pnpm@10.32.1 install --offline --lockfile-only
npx --yes pnpm@10.32.1 check
node evals/personal-engineering/run.mjs --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
node evals/native-workflow/run.mjs --home <explicit-fixture-state> --auth-attachment <explicit-managed-auth>
node evals/native-workflow/compare.mjs --home <same-state> --auth-attachment <same-auth>
node evals/native-workflow/compare.mjs --home <same-state> --auth-attachment <same-auth> --case work-continuation
node evals/native-workflow/evolution.mjs --home <same-state>
node evals/native-workflow/continuation.mjs --home <same-state>
node evals/native-workflow/profile.mjs --home <dedicated-fixture-state> --auth-attachment <same-auth>
node evals/native-workflow/report.mjs --home <same-state> --compatibility-report <fresh-offline-report>
```

check 实际执行 typecheck、lint、48单元、build、21集成，退出0；最终完整日志与退出记录已保存，
报告脚本读取真实日志数量与Hash，不自行声称运行了测试。Skill 使用官方 skill-creator 的
quick_validate.py，uv 离线 Python3.14 / PyYAML6.0.3：valid。没有新增生产依赖。
V3 全离线 E2E、迁移、演进、安全和真实只读回归通过；其 fresh HOME 未登录，native 子层 blocked
是预期结果，不与已授权 V4 state 混淆。

环境：Windows x64、Node24.19.0、pnpm10.32.1、Codex0.157.1、账户实际目录模型 gpt-6-astra/low。
实际 Docker Node24 Linux 镜像 SHA：a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5。
授权由用户在官方浏览器/localhost 回调完成，没有复制宿主认证。仅专用模拟源码/日志在线。

## 可审查本机证据

受管在线状态根：
`E:\Agent_Harness\.devagent-evals\v04-native-onboarding\state`。下列路径相对它：

```text
reports/engineering-v04-latest.json                 # 签名的11层汇总
artifacts/v04-check-result.json                     # 实际check退出0
artifacts/v04-check-sanitized.txt                   # 实际check完整日志
reports/attachment-8ee3ecbdec4c4ca7a750893bad5cdbbd.native-session.json
reports/native-workflow-latest.json
reports/native-continuation-latest.json
reports/native-profile-latest.json
reports/runtime-evolution-latest.json
reports/comparison-1792485746169.json                # 第一轮4类，含接续失败
reports/comparison-1792486219298.json                # 修订2，接续两侧通过
artifacts/workspace-0f2f971319c04b12b6c6bc2a6dfedce9/changes.patch
runtime-observations/runtime-2b3933fa84ef47fb8bd2d7c23346822b.json
reports/task-563df4cb61484d62a8ec56fd8aa167fd.native-work.json
reports/task-ddd7826430fb43dfaffecb9f2070ce95.native-work.json
validation-reports/task-ddd7826430fb43dfaffecb9f2070ce95.json
artifacts/workspace-52973f4f4f5046c9bf1fd6d27d5dc0c4/changes.patch
```

初始失败 execution-ca957e9f0e2142b689534c02573a4ac4；首次模型修复后通过
execution-69b5525bc0f64c2286967cbfd3f9d64a / execution-fe8a96eb14f94105b71a01c06b573699。
下一会话复验 execution-1b908496dc4947e3852314f8eb04f4e7 / execution-564eb3bfb14748feb2abd705101077d5。
记录在 evidence/<id>.json，关联 stdout/stderr Hash、版本与退出码。MCP 回执在对应 artifacts/<task>/mcp-receipts。
最终补强运行 native-eval-1792487839028：Work work-6150892c91e94305a495984c91d09bb1
保留初始失败 execution-3fb3a7f75ea44e00b7d606cee41fc5a9；模型 Task task-28477b2760934f3291b37b00a5c571c6
最终通过 execution-8e0451331c0142f08783971da61592ac / execution-99bfb7e06d5e43128ddb3849af51dd7a。
同一逻辑 Work 同时记录历史 failed 和当前 verified；旧失败不会抹掉，也不会阻止当前最终版本正确通过。
升级 Proposal proposal-ab48d4e3ff5d436baadc696a9eacb57a；下一 Task task-8f4bbe12bb2b41a699d7198c5189a54f 真调用。

离线兼容/真实源报告：
`E:\Agent_Harness\.devagent-evals\v3-run-3Qm7kC\state-a\reports\personal-engineering-latest.json`。
ALS head c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab；Pollen 授权副本 head d776a95bbffa57a129a1823f61dd2a1726362d6c。
完整性覆盖 bounded source、tree metadata 与 Git index/config/HEAD；不承诺大型排除数据的逐字节递归 Hash。

## 失败、阻塞与未运行

- 认证后早期遇到代理环境未继承、Code Mode host 关闭、提交版本 oracle 混淆和 Plan 工具 schema 不明确；
  修复后重新验收。自主编码首次 Plan 被拒绝的 failed Task 保留，没有用固定补丁代替模型修复。
- 原生 Hooks 配置实际已安装，但各事件真回调仍 unobserved；额外无模型生命周期探针未完成，未伪装通过。
  受管 exec 元数据、签名 MCP 回执和显式 finalize 可独立运行。Skill 自动选择未证明，当前显式调用。
- 四类对照增强版耗时/Token 更高，样本与主机负载/缓存不足以推断显著性。详见 engineering-evals.md。
- 合成偏好通过真实模型答案 oracle；未上传真实个人数据，不能据此宣称个人开发效率已提升。
- 未运行真实 ALS/Pollen 构建、业务测试、Worker、DB写入、GPU/CVAT、硬件、安装部署；本轮仅授权只读。
  Node fixture 不等于 FastAPI/Electron 全环境；独立 ALS 观测 Patch 仅候选，没有应用或业务环境测试。
- Ubuntu、完整原生宿主读取隔离、普通 IDE 自动关联未验收；DSH 按用户选择暂缓。
  Work/事件跨文件崩溃、HMAC宿主信任、有限容量、删除范围和容器共享内核边界见 security.md。
