# 官方 Hooks 与受管事件降级

2026-10-20 核对了 [官方 Hooks 文档](https://learn.chatgpt.com/docs/hooks)、
[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) 与本机 CLI 0.157.1。
文档支持 SessionStart、UserPromptSubmit、PostToolUse、Stop、SessionEnd、Interrupt；
CLI 的 hooks feature 可发现。**本机验收已安装配置，但尚未观测到原生 hook 回调。**
不能把 feature=true、hooks.json 或手工投递当成实际回调通过。

`codex hooks --id <attachment> --work <work>` 只写该受管 HOME 的 hooks.json，
不会修改用户全局配置或业务 .codex。已有非本工具管理或 Hash 已变化的 hook 配置会冲突拒绝。
命令固定为 Harness CLI + 固定本机参数；不把仓库指令、hook 输入或模型文字拼入命令。
观察 lease 留本机，不进入知识导出。启用普通本地 Codex 会话时，用户应明确选择 Work 和这套
独立配置；无法保证未受管的 IDE/桌面会话自动关联。

实际通过路径是 `codex run`：官方 exec JSON 事件提供 Thread/Turn 完成元数据；
标准 MCP 签名回执提供工具完成元数据。二者归入同一 Work，CLI 在退出时显式 checkpoint/finalize。
不解析私有数据库、不另写模型循环。缺失 Hooks 不影响命令门禁，也不阻止普通 Codex 的原安全工作流。

SessionStart 回调若实际触发，会按预算返回项目上下文，个人偏好默认关闭。
Stop 持久化进展，SessionEnd/Interrupt 记录中断检查点；显式 finalize 才结束 Work。
重复 event/tool-use ID 精确去重；缺少唯一 ID 时按白名单元数据粗粒度去重，不能当精确调用计数。
失败、超时、未知事件只给出观察不可用提示，不授予权限、不生成通过证据。

待完成：在本机实际执行面定位 hook 未回调原因、逐事件真触发验证，以及普通 IDE 会话体验。
当前报告对原生 Hooks 保持 unobserved，已验证的受管事件路径独立标 passed。
