# V0.3 安全边界

## 信任和授权

画像、记忆、AGENTS、Skill、能力合约、导入备份都是上下文，不能批准命令、分享、源写入、设备或插件。MCP 的项目/Task 绑定、fixture 分享和个人上下文授权分别检查。候选不能自行确认；审批、恢复和能力采纳没有 MCP 工具。跨项目私有信息不自动拼接。普通外部会话不自动采集。

项目默认只读，包含 Git 管理目录、未提交内容、忽略数据。注册/扫描不执行 hooks、filters、Graphify、业务脚本，不自动修改规则。真实 ALS/Pollen 本轮只分析/计划，没有 apply、训练、GPU/CVAT、数据库、硬件、部署、push/merge 或全局 Docker 清理。Git 查询禁可选锁/hooks/lazy fetch 和系统/全局配置影响。

规范写入是独立权限：精确文件白名单、Diff Hash、前后内容 Hash、源 commit、源 digest、本机根、分支、目标、过期和单次使用。main/master/stable/prod/production/release 分支和 detached 禁止原项目写入。CAS 冲突拒绝；失败回滚仅回滚仍保持本次 after Hash 的文件，不覆盖并发人工改动。跨文件应用不是操作系统事务；崩溃/回滚冲突可能需要人工复核。测试性原项目写入只针对受管 fixture。

## 文件与数据

绝对根授权，拒绝 symlink/junction/穿越/ADS/设备名；规范文件拒绝硬链接。Snapshot 只物化允许普通 blob，排除认证、数据集、数据库、图片、权重、缓存、日志等。源完整性检查包含 bounded source、树元数据与 Git index/config/HEAD；大型排除目录不做递归逐字节承诺。

常见密钥、密码、私钥和日志个人/设备字段过滤；不能安全处理时拒绝。能力 JSON 仅豁免严格验证的结构化 hash，所有自由文本仍扫描。备份解密后同样检查敏感记忆和画像文本。正则无法识别全部秘密；真实业务源本轮禁止远端分享。ALS AGENTS 含敏感字段时规范候选生成会拒绝，现有文件保留。拒绝日志不保存原始敏感参数。

便携数据签名、本机绑定签名、审批签名复用 StateStore/HMAC。持有宿主签名 key 的攻击者不在 HMAC 防篡改保证内；不是第三方不可否认证明。可迁移备份 scrypt + AES-GCM，严格 JSON、AAD、摘要、长度和 Schema/归属检查，没有路径解包或反序列化执行。导入不含 key/auth/批准/绑定/源码/Workspace/原始 Evidence，不恢复验证权威。预览绑定状态且恢复原子替换，冲突保留本机；口令不写参数或日志。

## 执行

发现命令、人工批准和最终版本验证是三个不同状态。固定 executable/argv 白名单不是沙箱；npm scripts/MSBuild/测试均视为任意代码。必须通过 Docker Linux 的实际隔离探针：禁网、非 root、RO root、cap-drop、no-new-privileges、seccomp/cgroup 限额、最小挂载；Git 和独立 grader 只读。不挂业务根、宿主 HOME/auth、Docker socket 或设备。partial/unavailable 返回 blocked，禁止宿主 Shell 回退。只删除带本项目标记的自有容器/工作区。

签名 Evidence 绑定命令、workspace/source revision、退出码、隔离级别和 stdout/stderr Hash；记录/产物/命令定义变化拒绝旧验证。Task 默认3次实际执行、60次受控操作；所有批准命令的最终成功证据才支持原 V0.2 coding Task 完成。演进能力仍在同一计划/预算/执行门禁内，版本变化立即失效，不热加载宿主插件。

容器共享内核，不能抵御所有未知逃逸漏洞；依赖 Docker Desktop/内核和宿主可信性。高强度隔离仍可采用独立 VM，不把路径过滤当成绝对安全。

## 原生 Codex

发现检查真实运行官方 app-server，但不启动模型。独立 HOME/CODEX_HOME 和最小环境，不搜索或复制系统认证；官方交互登录由用户完成，UAC/密码提示不绕过。MCP 接入仍受 scope/分享门禁约束。原生配置关闭 shell/unified exec/code mode、浏览器、插件、apps、web 和 multi-agent，使用 read-only。

原生宿主 read-only **不是**与 Docker 等价的全文件读取隔离；不同 Codex 版本的原生工具/配置行为可能变化。已认证模型路径和完整原生读取权限验收尚未完成；不能用配置文本或离线发现证明其安全性/模型行为。真实源保持 local-only，当前独立环境无 auth，实际模型调用为0。进一步放开真实源之前必须完成版本对应的权限/读取边界验收。官方 [权限文档](https://learn.chatgpt.com/docs/permissions) 与 [app-server 文档](https://learn.chatgpt.com/docs/app-server) 存在随版本变化的读权限配置，当前不盲用不兼容新字段。

模型会话验收要求服务端签名回执和真实 turn 完成，核对真实 revision、实际返回路径、禁止操作和最近任务状态。只落盘过滤后的 transcript；结构化答案先在内存检查，避免日志脱敏把合法 commit hash 遮蔽导致误判。CLI 未暴露精确后端请求数，完成 turn 数仅作为 modelCalls 下界，明确写入报告。

## 容量与剩余风险

源码单文件512 KiB、切片最多200行/16 KiB、搜索最多800文件/50结果/16 KiB；输出64 KiB、命令最长300秒；诊断导入1 MiB/2000事件、200份，查询100条/32 KiB；证据1000条后拒绝新增执行。画像3 MiB、1500条记忆/500任务摘要。拒绝回执500份后聚合溢出；MCP Task 回执最多200份。达到整体限额需人工归档。

Windows 实测；Ubuntu、真实 UI/.NET Framework 运行环境、GPU/CVAT、硬件、安装/升级/部署未验收。外部进程并发修改和进程崩溃不能由路径检查彻底消除；保留失败证据，不覆盖人工变更，不自动清理审计历史。