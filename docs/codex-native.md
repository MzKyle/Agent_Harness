# 原生 Codex 接入（V0.4.1）

使用官方 CLI 0.157.1、app-server 与标准 MCP/Skill，不实现第二套模型循环。
认证配置边界见 [配置隔离](configuration-isolation.md)，Windows 日常命令见 [使用指南](daily-engineering.md)。

```powershell
$cli = 'E:\Agent_Harness\apps\cli\dist\main.js'
node $cli codex attach --project <approved-fixture> --home <state>
node $cli codex login-native --id <attachment> --method browser --home <state>
node $cli codex inspect --id <attachment> --home <state>
node $cli codex use --project <project> --mode auto --home <state>
node $cli codex run --project <fixture> --goal '完成当前任务' --coding --mode auto --home <state>
```

首次登录由用户完成；密码/Token 不进入报告。--auth-from 只显式引用同 state 的授权 fixture 认证
上下文，不复制宿主凭据。项目选择、在线源码分享、个人偏好分享是独立授权。
附件配置 HOME 与认证 HOME 分开，新附件签名并检查项目/Workspace/cwd。每次执行签名记录
Project/Task/配置 Hash，完整覆盖 MCP/Skill/工具与权限；exec 使用 --ignore-user-config、--ignore-rules、
--ephemeral、history none。共享认证配置不允许静默变化，设备迁移不恢复认证或批准。

inspect 真查询 initialize、skills/list、mcpServerStatus/list、account/read、model/list，仅存安全元数据，
不保存账号正文或 stderr，不发模型请求。session/run 使用官方 Exec JSON、签名回执、独立答案或
容器 Grader 验证；发现工具不等于模型使用。不同附件工具配置和模型运行分别绑定 Task。

Fast 不强制 Skill/brief；Engineering/Deep 按需加载。没有审批、恢复、采纳或原源写入 MCP 工具。
附件自己的公开 Skill 由工作区 `.agents/skills/devagent-native-bridge/SKILL.md` 官方发现，
配置按完整文件路径禁用共享旧 Skill，inspect 核对实际启用路径；不是只检查 TOML 声明。
服务端再次检查分享、scope、Plan、命令和隔离；模式不能扩权。Host read-only 不是完整宿主读取
隔离，因此真实 ALS/Pollen 本轮 local-only，不能因为已认证就分享业务源码。

Hooks 仅显式 --hooks 启用且须官方精确定义信任；缺回调时 Exec 元数据、MCP 回执和显式归档照常。
普通未绑定 IDE 聊天不自动记录，见 [Hooks兼容性](hooks-compatibility.md)。
Usage 是官方报告值，completed turns 只是请求下界，不是账单。完整答案只在内存交给 oracle，
官方失败事件只保留已知错误码及限额/认证/传输等枚举分类，原始错误正文和地址不落报告。
事件仅存白名单元数据；真实在线验收只发送受管 Fixture。
