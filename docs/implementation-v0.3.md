# V0.3 最终实施报告

日期：2026-10-20。基于 V0.2 main 提交 448cf01d4db8cdd96aa8fc1671b7f02cb7ae31d4，在 dev/personal-engineering-v0.3 实施。功能验收阶段未提交或推送；随后用户明确授权将当前代码提交并推送到远程 main。本轮不是重新搭框架：已有 Registry、Task、Workspace、Execution、Evidence 和 MCP 被实际复用。

## 12 项回答

| 问题 | 当前实际答案 |
| --- | --- |
| 1. 用户画像能管理什么？ | 技术背景、工程/AI 偏好、Skill 偏好及通用知识。持久化、来源/确认/时效、版本历史、相关性检索、候选审查/废弃、删除和显式导出。示例模板只生成待确认候选。 |
| 2. 能从真实项目建立画像吗？ | 已在 ALS 和 Pollen 实际扫描 manifest、README、规则元数据、静态源码和 Git revision；事实有来源，配置声明/源码确认/候选层级分别标记。Pollen 正确识别 Windows Forms，不误报 WPF。没有声称理解全部动态架构。 |
| 3. 项目变化如何刷新？ | project refresh 重扫，检测 revision/source digest 与实际配置变化，替换事实保留 stale 历史，保留主观决策；引用旧版本的记忆标记 stale。恢复/重新关联后必须本机刷新，不能继续使用历史验证。 |
| 4. Onboarding 建议哪些文件？ | 缺少时增量建议 AGENTS.md、.agents/skills/devagent-project-engineering/SKILL.md、docs/agent-capabilities.json；明确 --with-codex 时才建议 .codex/config.toml。逐文件 Diff、理由、收益、风险、签名/过期/单次审批、Workspace 应用及验证均可执行。 |
| 5. 为什么不直接复用原规范？ | 优先复用。已有 AGENTS 字节前缀保留，已有 Skill/原生配置不覆盖、不新增等价 Skill。只补稳定工作流或缺失的能力快照。敏感/注入规则拒绝候选，不靠覆盖“修复”。实际 ALS AGENTS 敏感字段导致该文件候选被拒绝，原文件不动。 |
| 6. Codex 实际发现并调用了吗？ | 真实 fresh 官方 app-server 0.157.1 已发现 Skill 和14项 MCP 读取工具。标准 SDK 也真实连接/调用 context。独立原生 HOME 未登录，模型实际调用为 blocked_by_auth、0 次；未伪装为模型调用通过，自动 Skill 触发未证明。 |
| 7. 哪些感知/操作/验证可用？ | 有边界源码检索/切片、TS AST/Python-C#词法静态关联、授权规则、显式日志导入与关联查询、过滤快照/代码 Patch、批准 Docker 命令、签名且绑定版本/输出摘要的 Evidence、规范与 Schema/Skill/TOML/MCP 检查。UI/运行中服务/硬件/生产数据库没有实际访问能力。 |
| 8. 任务完成后更新记忆吗？ | Harness Task/report 自动写实际修改/执行/通过/失败/blocked/未完成摘要，生成带 Task/Evidence 来源的待审查记忆。真实失败和最终通过均保留。仅 Harness 任务或显式导入可关联，普通 Codex 活动不自动采集。 |
| 9. 如何迁移新电脑？ | 加密备份 → 设备B inspect冲突预览 → restore --review保留本机冲突 → 显式 relink核对仓库与历史 → refresh。逻辑ID/记忆保留；路径/auth/审批/Workspace/签名key/原始Evidence/源码不迁移。历史证据降级，规则读取与分享不恢复。 |
| 10. 双向迭代演示通过了吗？ | 通过确定性基础设施 E2E：gap 去重 → 人工审批模拟 → 独立 grader 初始真实失败 → 在 Workspace 实现有边界 trace 模块 → Docker 独立用例通过 → 人工审查采纳模拟 → 新 Task 实际调用并输出 worker 失败阶段。没有全局插件热加载，没有模型自主实现声明。 |
| 11. ALS/Pollen 不变吗？ | 实际只读分析/计划前后 gate 相等：HEAD/status/允许源码内容/树元数据/Git管理摘要。没有业务命令、写规范、改业务代码或发送真实源码。大型排除目录不声称递归逐字节不变。 |
| 12. 仍待验证什么？ | 已认证 Codex 模型的实际工具利用/自动Skill触发/自主修复、原生版本对应的完整读取权限边界；Graphify语义runner、WinForms/UI动态运行、真实GPU/CVAT/硬件/数据库/部署、Ubuntu实机迁移和与直接Codex的同任务效率对照。DSH按用户要求暂缓。 |

## 验证和证据

完整命令、数量和本机证据路径见 [verification.md](verification.md)。最终自动检查包括 typecheck、lint、42个单元、build、19个集成；补充独立回归覆盖规则换行、签名回执/答案 oracle、迁移信任与受控演进。4个 Skills 经官方 skill-creator quick_validate 验证。

演示入口：

```powershell
node apps/cli/dist/main.js eval --suite personal-engineering --online --als-path D:\Kyle\auto-label-studio --pollen-path E:\Agent_Harness\.devagent-evals\real-projects\Pollen_Instrument
```

在线被认证阻塞会返回2；离线各层结果和真实源不变性独立保存。默认演示使用新受管状态，防止模拟偏好混入用户画像；显式 --home 必须选择空的新状态。参考 [操作指南](personal-engineering.md) 和 [原生接入](codex-native.md)。

## 关键修改

- core/src/v3：画像、记忆、身份、能力合约、Onboarding/审批、加密迁移、上下文和演进。
- core/src/v2：复用原服务，仅增加回调、逻辑ID别名、工程文件快照/Diff和Task摘要衔接；旧格式与门禁保留。
- adapters/system.ts、detector：组合服务、真实重新检测、Windows Forms 增量识别。
- codex-integration：独立官方原生集成，DSH不作前置条件。
- diagnostics-mcp/functional.ts：有作用域/预算的context与记忆候选；签名调用来源；审批类操作不暴露。
- apps/cli/intelligence.ts、工程Skill、fixtures、分层eval与文档。完整清单见 [files.md](files.md)。

复用已安装并固定的 MCP SDK、YAML 和 smol-toml；Core 为 TOML 真正语法验证声明已有 smol-toml 1.9.1 依赖，没有引入新的第三方库。没有新数据库、向量库或自制模型循环。

## 兼容性和限制

V0.2 Registry、Task/Evidence和旧init/runtime/可选DSH保留，历史任务ID不重写。逻辑项目ID作为随机稳定标识，旧路径ID是别名；同远端多clone独立，不自动合并。显式relink重置分享/规则读取，防止旧路径授权复活。新备份为严格V3格式，未知版本拒绝，未制造不存在的旧画像备份兼容保证。

画像采用本地签名有限JSON和词法相关性，适合个人MVP；没有服务端加密磁盘/多用户安全边界。加密只用于显式备份。目录并发/崩溃回滚、有限历史保留、Docker共享内核及正则脱敏边界见 [security.md](security.md)。过滤快照不保证任意工程立即可构建；执行始终受已有镜像、依赖和批准约束。

原生发现通过仅证明安装/配置可被当前binary读取；已认证模型路径未验收。当前不宣称完整AI自主工程MVP在线通过，不宣称相对直接Codex有已量化效率收益。下一优先项是隔离原生认证/权限与fixture在线闭环，然后做同任务对照。
