# 官方 Hooks 与可靠降级（V0.4.1）

官方 CLI 0.157.1 能发现六类定义，但精确 Hash 未经信任时跳过执行，安装不是实际交付。
逐事件结果、官方依据、Windows 命令和生命周期限制见 [Hooks兼容性报告](hooks-compatibility.md)。
Enable / Inspect / Disable / Health 只操作选定附件/Work；已有或手工改变配置发生冲突时拒绝。
固定命令按附件解析签名 Work 绑定，核对 cwd、项目、Workspace、lease，不从模型或 stdin 获取权限。
不强制全局配置，不写私有信任状态，不跳过 Hook 审查。普通 IDE 支持未证明，返回 blocked。
实际认证HOME存在旧hooks.json时官方会合并旧定义，因此启用前直接隔离拒绝；继续无Hooks或
新建专用受管登录。定义/信任发现使用实际认证上下文，旧文件与凭据均不改写。

```powershell
node apps/cli/dist/main.js codex hooks --id <attachment> --work <active-work> --action enable --home <state>
node apps/cli/dist/main.js codex hooks --id <attachment> --action inspect --home <state>
node apps/cli/dist/main.js codex hooks --id <attachment> --action health --home <state>
node apps/cli/dist/main.js codex hooks --id <attachment> --action disable --home <state>
```

没有 Hooks 时正常使用 codex run；官方 Exec JSON、签名 MCP 回执、checkpoint/finalize 与 Journal
独立记录，不读取私有历史数据库，不依赖 Hook 生成测试证据。异常退出 recover 后显式 resume，
不还原旧 Plan、lease、验证权威或任何权限。
