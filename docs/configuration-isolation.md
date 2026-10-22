# V0.4.1 认证与配置隔离

V0.4 问题已复核：`attach(authFrom)` 写新配置，却把 `home` 改成旧附件目录。新配置不保证被加载。

| 对象 | 保存内容 | 作用域 |
| --- | --- | --- |
| Authentication Context | 显式受管 HOME 路径与配置 Hash；不读取凭据正文 | 官方认证复用；同上下文模型运行排他锁 |
| Attachment | 独立配置、Skill、过滤 Workspace、项目绑定 | 每项目/Workspace；新增记录有签名 |
| Execution Session | 完整运行配置、项目/Task、配置 Hash、时间 | 每次 inspect/exec；本机签名元数据 |

官方 `CODEX_HOME` 同时承载配置、认证和其他状态，并非独立认证目录开关。
CLI 0.157.1 的 `exec --ignore-user-config` 保留认证、跳过用户配置；再用完整 `-c` 覆盖
mcp_servers、features、hooks、skills、sandbox、history、analytics、项目表。
`--ignore-rules` 跳过外部 execpolicy 发现，Harness 服务端审批、隔离和分享门禁始终存在。
依据：[官方环境变量](https://learn.chatgpt.com/docs/config-file/environment-variables)、[开发命令](https://learn.chatgpt.com/docs/developer-commands)。

这是共享官方认证上下文、逐次隔离运行配置的兼容方案，不声称官方内部缓存/日志完全分离。
新建认证也单独放在 `runtime/codex-authentication/<id>/home`，仅有认证存储、禁用历史/分析和
默认关闭 Hooks 的最小配置；项目 MCP/Skill/信任表在附件配置目录。已有明确授权的旧附件只作为
认证引用兼容，原目录不搬运、不修改。`CODEX_HOME` 指向认证上下文，HOME/USERPROFILE 指向附件目录。
app-server 无相同 ignore-user-config 选项：发现检查完整覆盖并关闭 Hooks，核对共享配置 Hash。
Hash 变化时拒绝使用并要求审查，不自动覆盖。Hook发现使用实际认证上下文和本次完整内联定义，
核对真实信任与来源；不只枚举附件目录的候选定义。
本机实际官方 TUI 首次启动额外追加了独立 `[tui]` 的
`screen_reader_detection_done = true`，曾真实触发拒绝。只兼容这一个精确末尾区块，且移除该
区块后的全部字节 Hash 必须仍匹配签名原配置。原 pin 和配置都不改写；新增签名 UI 观察记录，
逐次执行同时保留 pinned/observed Hash。其他差异（包括该字段改为false、Hooks、MCP等）仍拒绝。

不复制、硬链接或 symlink auth.json，不扫描宿主登录、私有历史或会话数据库，不安装全局配置。
旧附件保留读取兼容，引用时检查受管根和 Workspace/项目；新附件另核对本机签名和精确 cwd。
每次 MCP 服务端再次检查项目/Task 与 fixture 分享。跨项目源码、Work 和私有记忆均拒绝。
模式与记忆不能扩权。同认证模型任务并发被锁拒绝；只读发现与模型执行分别记录。

Skill 必须由官方发现机制提供。Windows 下仅改变 HOME 或在 config 中启用任意路径不会让
附件 Skill 成为发现根。因此在过滤 Workspace 创建公开的
`.agents/skills/devagent-native-bridge/SKILL.md`，固定 Hash，拒绝覆盖不同内容。
完整 `SKILL.md` 路径控制 enabled，关闭共享认证目录中的同名旧 Skill；官方 `skills/list`
核对唯一启用的 Harness Skill 路径。Fast/Baseline 真正关闭，Engineering/Deep 才启用。
这不是新 Skill loader。该公开上下文由签名 provisioning manifest 单独列出，不计作模型源码修改，
但仍纳入最终内容版本；任意源码、修改后的上下文或伪造 manifest 不能借此隐藏。

实际检查发现早期按目录关闭 Skill 不生效，因此 V0.4 与早期 V0.4.1 的“Skill已关闭”性能
解释存在缺陷；保留历史报告，最终对照只使用修正后的独立项目协议4。

官方 Hook 文件是另一层：`CODEX_HOME/hooks.json` 与内联 Hook 合并，不能靠替换 `[hooks]` 表
删除。实际旧授权HOME中存在V0.4定义，曾发现6条旧定义+6条当前定义。因而该认证上下文
只能继续无Hooks运行；启用Hooks在建Task/启动模型前返回 `HOOK_AUTH_CONTEXT_ISOLATION_BLOCKED`。
不移动凭据、不改/删除旧认证目录文件。新建的最小认证HOME无Hook文件，官方列表验证A/B各
只出现自己的6条内联定义；后续仍须各自官方信任。发现检查在冲突上下文关闭Hooks执行功能。

跨设备备份仅包含 V3 便携知识，不恢复认证、附件、执行配置、lease、审批、Workspace、HMAC key
或原始 Evidence；历史降为 historical-unverified。
