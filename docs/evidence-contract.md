# Evidence V2

真实 ExecutionEngine 生成 `evidence/<execution-id>.json`，模型无创建/修改证据工具。字段包括 schemaVersion、id、Task/Workspace/Project、源 Commit、执行前后工作区摘要、command ID 与 executable/args/cwd、起止时间、退出码、状态、隔离、image ID、reason、输出 artifact、truncated、HMAC signature。

状态 passed/failed/timeout/cancelled/blocked/stale。真实 exit 0 + verified-isolated + 前后版本相同才可通过；命令改源码会 stale。批准/未运行不能 verified，失败不能改成功。读取校验 HMAC-SHA256，不匹配拒绝；当前工作区摘要须与证据前后摘要一致。源 Commit 与工作区摘要是不同概念，摘要不覆盖被禁止的大型数据。

最后一次修改后，所有该工作区批准命令都要有最终版本成功证据；任意旧版本成功不足以完成 Task。单任务最多 3 次命令执行。CLI evidence get/list/export 返回 JSON/Markdown，Task report 附 Diff、变更文件、影响范围、风险和持久化 gap。

新执行记录将 stdout/stderr 内容 hash 纳入 HMAC；读取时重新校验，输出被改会拒绝。早期无输出 hash 的 V2 记录仍可查询，但不能晋升当前 verified。MCP 成功调用另存带 HMAC 回执（工具名、Task/Project、时间、输出 hash，无原始参数）。拒绝有 denial artifact。签名针对本地非持钥篡改，不是第三方证明；宿主持钥者能改签。

执行输出合计 64 KiB、最多 1000 条证据；达到上限拒绝新增并要求人工归档，不自动删历史。诊断另限 200 份、每份 2000 事件。任务可读持久状态，但不自动恢复运行中的模型/命令；遗留锁先核实存活运行再人工处理。
