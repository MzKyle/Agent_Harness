# V0.3 画像、记忆与迁移契约

V0.1 knowledgeSchema 和 JSON 示例继续兼容；V0.3 已实现真实存储和检索。

## 记录与审查

记录有独立 ID、domain（developer/project/knowledge/skills）、作用域、类型、topic、正文、tags、来源 explicit/observed/inferred/verified、candidate/confirmed/rejected、freshness、local/imported 信任、引用和时间。类型涵盖技术背景、工程/AI 偏好、项目目的/架构/工作流/约束/目标/问题/决策、知识、Skill 偏好和任务摘要。

人工 set 为 explicit/confirmed；Agent propose 只能 inferred/candidate；Task 报告候选是 observed 或基于真实 Evidence 的 verified，仍需人工确认。确认保留原来源，不伪造工程验证。同 scope/type/topic/content 去重；显式更新留版本；确认同主题新候选会废弃旧确认项。删除清除当前正文及该记录历史，不自动删除已有加密备份或独立任务证据。

仅确认、非废弃项默认参与检索；候选和历史需显式包含。按逻辑项目 ID 隔离，默认全局查询不混入项目私有信息。词法相关性不保证语义召回。MCP 不能设置 source/confirmation/trust/证据字段，没有确认/删除工具。显式导出限受管状态目录 artifacts，不自动建私人画像 Git 仓库；不要向公共仓库提交导出文件。

templates/developer-profile.candidates.json 是待确认模板，不是用户事实。项目事实注明来源和文件/行/commit（可用时）；刷新/关联后的失效事实重新建立。任务结果和主观决策分别保留。

## 身份与设备

逻辑 project-随机16hex 不含路径，V0.2 路径摘要 ID 是兼容别名。仓库身份取 origin 的 host/port/path，不保存认证或本地 remote 路径；同远端多 clone 不自动合并。已知 commit/共同历史用于 relink，不能只凭名称认定同一项目。

machineId、路径绑定和读取授权是本机数据。恢复不激活路径；project relink 是显式新只读关联，重置规则读取与分享，移除旧能力快照。别名也遵从当前绑定；命令批准仍只属于原 Workspace，不移到新 clone。

## 加密备份与恢复

严格 JSON 加密信封，无 ZIP/文件路径解包。Node 标准 crypto：scrypt（N=16384,r=8,p=1，随机16字节 salt）派生32字节 key，AES-256-GCM 随机12字节 IV、16字节 tag；manifest 为 AAD，明文另有 SHA-256。口令至少12字符，通过专用 DEVAGENT_* 进程环境变量传递。解密后检查 Schema、ID/归属一致性、数量和长度；不执行备份内容。参见 [Node crypto](https://nodejs.org/api/crypto.html)。

包含：开发者/项目记忆、逻辑身份和别名、项目事实历史、任务摘要、能力状态、Proposal、Skill 偏好。排除：auth/密钥/签名 key、路径绑定、命令/写入审批、Docker/设备权限、原始 Evidence、Workspace、源码、数据集、数据库。

inspect 不改便携数据，生成签名、1小时有效、绑定当前状态/备份 Hash 的冲突预览。restore --review 重新检查，在同一锁中原子合并。相同 ID 冲突保留本机；同主题新 ID 冲突作为 candidate/conflicted 导入；项目身份冲突拒绝整个恢复。预览后便携数据有变化就拒绝，需重新预览；审查单次使用。写入失败不留下半份 manifest。

导入记忆 imported，依赖源码/证据的记忆 stale，画像事实 stale，配置/验证能力 unavailable，危险能力 forbidden。Task verified 清空，evidenceTrust=historical-unverified；已实现/采纳 Proposal 降为 proposed，清空 Workspace/执行引用。历史描述只供审查，不能当本机新验证；不加载插件、复制 auth 或执行命令。

实际迁移覆盖：V0.2 Registry 惰性逻辑身份迁移、V3 加密备份双目录恢复。保留纯 payload schemaVersion2→3 migrator（补 Skill 偏好），不承诺兼容从未存在的 V0.2 画像备份格式。未知未来版本拒绝。

存储/备份有容量上限，详见 [架构](architecture.md) 和 [安全](security.md)。加密不提供口令恢复；旧备份中的已删除内容需用户按保留策略自行处理。