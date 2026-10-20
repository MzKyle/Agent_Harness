# V0.3 实施与分层验收

日期：2026-10-20。项目 E:\Agent_Harness；分支 dev/personal-engineering-v0.3，基于 V0.2 main 448cf01d4db8cdd96aa8fc1671b7f02cb7ae31d4。开发前 main 与 origin/main 一致（0/0），新分支隔离。功能验收阶段未提交或推送；随后用户明确授权将当前代码提交并推送到远程 main，在线验收结论保持不变。

结论：**V0.3 离线功能闭环通过，真实项目只读接入通过；Codex 原生发现通过，真实模型调用 blocked_by_auth。** 不把 SDK 探针、Skill 文件或确定性演示描述为模型自主工程验收。

## 分层实际结果

| 层级 | 结果 | 实际证明与边界 |
| --- | --- | --- |
| Unit Tests | passed，42/42，7文件 | V0.2 兼容；画像来源/审查/版本/删除；作用域/预算/时效；身份/备份冲突/认证/篡改/恶意schema/关联；审批/换行/注入/链接/主分支/过期；外部答案oracle |
| Integration Tests | passed，19/19，7文件 | 真正 stdio MCP、真实 CLI、官方原生发现、Docker失败/通过/篡改/超时/取消；Onboarding/任务摘要；演进与恢复；V0.2 DSH runtime装配保留（无模型请求） |
| Onboarding E2E | passed | 从零建立实际画像/能力；4份候选 Diff → 独立审批模拟 → Workspace应用 → Schema/Skill/TOML检查 → 实际MCP调用 → 已批准Docker回归通过 |
| Existing Norms E2E | passed | 原AGENTS前缀保留，复用已有Skill/原生配置；fixture/dev项目写入与重复计划幂等；不覆盖人工修改 |
| Memory E2E | passed | 真实修改/失败/最终通过与Task/Evidence关联；候选审查、近期摘要、预算上下文和3组件trace查询；外部普通Codex历史不自动采集 |
| Portability E2E | passed | 独立state-a/state-b，加密备份、冲突预览、原子恢复、移动clone显式relink、refresh；ID稳定，auth/路径/审批/证据权威不恢复 |
| Codex Native Integration | discovery passed；模型 blocked_by_auth | fresh官方app-server 0.157.1发现工程Skill与14项读取工具；独立HOME无认证；模型调用0；自动Skill使用未证明 |
| Capability Evolution E2E | passed，确定性方法 | 去重gap → 审批模拟 → 独立RO grader真实失败 → 实现bounded trace模块 → Docker独立用例通过 → 审查采纳模拟 → 新Task实际调用；两Task全部批准命令均有最终版本证据 |
| Real Project Read-Only Validation | passed，ALS/Pollen | 实际画像/能力/规范计划，识别Electron/React/Python与Windows Forms；前后HEAD/status/source/tree/Git摘要相同；未执行/写入/分享真实工程 |
| Security Regression | passed，限本机测试覆盖 | 无审批/过期/主分支/并发内容变更/链接/穿越/跨项目访问拒绝；状态和Evidence/输出篡改拒绝；恢复不复制auth/权限；原生发现不等于认证后权限验收 |

## 实际执行命令

```powershell
npx --yes pnpm@10.32.1 install --offline --frozen-lockfile
npx --yes pnpm@10.32.1 check
node apps/cli/dist/main.js --help
node apps/cli/dist/main.js eval --suite personal-engineering --online --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
```

最终 check：typecheck、lint、42单元、build、19集成全部通过；集成约70秒。CLI演示运行约31秒，**退出码2**准确表示在线认证阻塞，不是离线失败。unit/integration由check单独运行，E2E JSON内这两层仍标skipped，避免声称脚本运行了未运行的检查；本表记录实际独立check结果。

4个Skill用官方skill-creator/scripts/quick_validate.py，uv Python3.14 + PyYAML6.0.3验证，全部valid，没有安装全局Python依赖。frozen lock离线安装通过，未下载新依赖。git diff --check与变更代码1500行上限检查通过；产物/认证目录被忽略。常见凭据模式检查无命中，不替代敏感内容人工审查或绝对无秘密保证。

环境：Windows x64，Node24.19.0、pnpm10.32.1、TypeScript5.9.3、Git2.55.0.windows.3、Docker Linux29.7.2；实际测试镜像 sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5。原生CLI0.157.1与可选DSH provider0.153.4独立，未升级宿主CLI。

## 可审查本机证据

以下均在被忽略的 .devagent-evals，不进入源码仓库。相对路径以该状态根为准：

```text
E:\Agent_Harness\.devagent-evals\v3-run-KxsScx\state-a
reports/personal-engineering-latest.json
reports/personal-engineering-latest.md
reports/personal-engineering-1792481879284.json
reports/onboard-030c17b013714a91a5582b80fc826065.onboarding.json
artifacts/onboard-030c17b013714a91a5582b80fc826065/provisioning.patch
reports/attachment-8f8ad010dca443f4ab97561b63c4226b.native-inspection.json
reports/attachment-8f8ad010dca443f4ab97561b63c4226b.native-session.json
reports/task-1ef3fcfe02194d1f97e3abfeb6ba98fb.json
reports/task-fdf77dfa375e4e6eaf565a257f7fe337.json
artifacts/workspace-ee2ebc98abfc43f9a69c6cbe231f7425/changes.patch
evidence/execution-6efd8842b0584f9489a34dadfc2c6ee6.json
evidence/execution-17ab49bd289845adb52e0bf08d0d8fff.json
evidence/execution-839e2437a278499e8f0fdc5bba41fabc.json
evidence/execution-1c1050f2d9824f6b9e4a962a24991446.json
evidence/execution-ac534d96fac44c14bd5fe72a44d47ec9.json
artifacts/backups/backup-73f3f045691c4ae5a1a53e3bbe5b1235.devagent-backup.json
```

首份演进Evidence为实际失败；第二份为独立grader通过；第三份为实现Task的实际诊断调用；第四份为新Task的独立复验；第五份为新Task使用采纳能力。签名记录指向stdout/stderr产物及Hash，不只保存“passed”字符串。备份演示使用仅用于fixture的模拟口令，不用个人认证。设备B为同级state-b，当前绑定local-only，规则读取false。

ALS检查commit c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab；Pollen授权副本commit d776a95bbffa57a129a1823f61dd2a1726362d6c。完整before/after保存在results.realProjects.projects。ALS AGENTS候选由于敏感字段被拒绝；原规范未改。Pollen未假定WPF。无业务命令/硬件/数据库/真实训练，modelCalls=0。完整性coverage=bounded-source-content+tree-metadata+git-index-config-head，不声称大型排除数据递归字节哈希。

## 未完成、跳过与后续风险

- 原生独立认证缺失：真实模型调用、回答正确性、Skill自动触发和自主开发仍blocked/未验收；DSH按用户明确选择暂缓，无Key测试不伪装通过。
- 尚未运行：认证后原生工具/读取权限完整验收、Ubuntu实机、Graphify语义runner、WinForms动态UI、真实GPU/CVAT/硬件/数据库、安装升级部署。当前无适当授权/隔离环境；真实项目本轮限定只读。
- 演进是确定性实现/人工审查模拟，证明基础设施闭环，不证明Codex自主升级。无直接Codex同任务对照数据，不能量化效率增益。
- 过滤快照、词法检索/静态层、有限历史、跨文件崩溃回滚、宿主HMAC可信性、正则脱敏和容器共享内核边界见security.md。原生宿主read-only不是Docker全文件隔离，不能靠配置文字视作验收。
- 真实工程的全部构建/测试并未运行：用户本轮仅授权只读接入，没有业务执行许可。19项集成执行的是受管fixture和Harness自身。

12项交付问题见 [implementation-v0.3.md](implementation-v0.3.md)，操作步骤见 [personal-engineering.md](personal-engineering.md)，完整变更见 [files.md](files.md)。V0.2历史验收保留于 [history/v0.2-verification.md](history/v0.2-verification.md)。
