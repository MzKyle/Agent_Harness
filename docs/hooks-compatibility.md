# V0.4.1 Hooks 兼容性记录

本机 CLI：0.157.1（Windows）。实际调用官方 app-server `hooks/list`，六类事件均可发现，定义
状态为 `untrusted`；真实 exec 没有产生原生回调。当前不能把安装或服务端 MCP 事件算作 Hook 成功。
进一步用实际认证上下文复核发现旧HOME文件与本次定义合并，共6条旧定义+6条当前定义。
现在该上下文启用Hooks被隔离门禁拒绝；新建空认证HOME的A/B配置枚举各仅6条自身定义。
新HOME尚无在线登录与回调验收，因此仍不能声称真Hooks已通过。
原有效配置探针记录见本机 `reports/hook-effective-scope-audit.json`；最后的隔离拒绝检查会关闭
Hook功能，其空定义列表不表示旧定义已消失，真实文件存在门禁仍阻止启用。
依据：[官方 Hooks](https://learn.chatgpt.com/docs/hooks)、[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。

| 事件 | 官方发现 | 真实回调 | 当前限制 |
| --- | --- | --- | --- |
| SessionStart | supported | unobserved | 精确定义尚未在官方 UI 信任 |
| UserPromptSubmit | supported | unobserved | 同上 |
| PostToolUse | supported | unobserved | 同上；具体工具覆盖随执行面而变 |
| Stop | supported | unobserved | 同上 |
| SessionEnd | supported | unobserved | 同上；正常关闭/归档才是结束，不等于切换页面 |
| Interrupt | supported | unobserved | 同上；还需真正中断正在执行的 turn |

信任未完成属于 blocked，回调交付本身仍 unobserved；不会合并成 passed。普通 IDE 支持尚未
建立，`--client ide` 返回 blocked，使用显式 Work 操作。CLI 独立配置没有全局强制安装。

`hooks.json` 与内联 `[hooks]` 均由官方配置层加载。项目层还受项目 trust 约束；用户层不依赖
项目 trust。安装不等于信任：官方 CLI `/hooks` 要求逐个审查当前 Hash，改动后需要重新审查。
不写私有信任数据库，不默认使用 `--dangerously-bypass-hook-trust`。

受管运行采用会话内Hook定义；官方另合并认证HOME的hooks.json，存在该文件时拒绝启用，
要求新建专用受管登录，旧HOME不修改。发现使用与运行相同的认证上下文，核对command精确匹配
及sessionFlags来源；冲突时只发现不启用功能，不把候选目录的信任状态当成运行信任状态。
命令固定为 Harness CLI 与 attachment ID；签名单次执行绑定选择 Work，核对 cwd/项目/Workspace/lease。
运行环境携带随机执行会话标识，必须匹配签名 binding；切换会话后旧回调拒绝，不按“最新Work”猜测归属。
事件保存该执行标识，逐次报告只统计同一次执行的回调，不把同一 Work 中较早的审查窗口回调混入。
因此同一附件的回调命令不再随着 Task/lease 改变，Work 绑定也不从 stdin 或模型输入取得。
Windows 命令参数排除 shell 元字符，并提供 `commandWindows`。不拼接 Hook 输入、仓库文字或工具输出。

输入读取 stdin，白名单保存事件名、Thread/Turn/工具标识、时间和来源；不保存原始聊天、参数、
transcript_path 或敏感工具输出。普通事件超时10秒，SessionEnd/Interrupt 3秒；官方最后两类上限3秒。
Hook 错误返回有限观察提示，不生成通过 Evidence、不授予权限。乱序回调不会把 interrupted 改回 active。

```powershell
$cli = 'E:\Agent_Harness\apps\cli\dist\main.js'
node $cli codex hooks --id <attachment> --work <active-work> --action enable --client cli --home <state>
node $cli codex hooks --id <attachment> --action inspect --home <state>
node $cli codex hooks --id <attachment> --action health --home <state>
node $cli codex hooks --id <attachment> --action disable --home <state>
node $cli codex run --id <attachment> --work <active-work> --goal '检查模拟工程' --hooks --home <state>
```

启用/安装后需在对应官方 CLI `/hooks` 审查。没有审批时可继续不带 `--hooks` 的 run；官方
Exec JSON、签名 MCP 回执、checkpoint/finalize 和恢复 Journal 独立工作。
不同认证 HOME 的信任不自动迁移，不承诺在不同客户端会自动生效。
旧上下文继续不带--hooks的受管运行；如要验收Hook，先创建不带--auth-from的新附件/认证目录，
由用户官方登录后审查当前6条定义。没有认证或人工信任时明确blocked，不复制旧登录绕过此步骤。
本轮已打开专用官方CLI审查窗口；三分钟未完成确认后关闭，记录实际超时。启动TUI自动追加
screen-reader detection偏好曾触发认证配置Hash拒绝；已按精确已观测的UI区块单独审计兼容，
没有修改认证文件、降低执行门禁或代写Hook信任。最终回调状态以最后真实exec报告为准。
