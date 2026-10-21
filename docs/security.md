# V0.4.1 安全边界

画像、记忆、规则、Skill、配置、模式、快照和导入历史均为上下文，不授予源码分享、命令、源写入
或设备权限。真实 ALS/Pollen 仅本地只读，包含 Git/忽略数据；不在原源运行 Graphify、脚本、构建、
Worker、数据库、训练、CVAT 或硬件，不部署、不推送合并、不改全局配置。只读完整性覆盖范围明确
记录，不承诺大型排除数据的逐字节递归 Hash。

认证上下文来自明确受管 HOME，不搜索/复制宿主认证。新附件签名、路径和 Workspace/项目核对；
exec 忽略用户配置并完整覆盖单次配置，app-server 核对共享配置 Hash，模型按认证上下文排他。
认证 HOME 的官方缓存/状态仍可能共用，不声称完全物理隔离；见 configuration-isolation.md。
首次认证也位于独立最小目录。公开 Harness Skill 仅 provision 到过滤 Workspace，签名声明仅可
排除未改动的公开上下文 Diff，任意源码不允许进入该声明，内容仍绑定 Evidence 的最终版本。
原生 shell/image/browser/apps/plugins/web/multi-agent 关闭，模型所需 Code Mode host 沿用官方运行时。
Host read-only 不是 Docker 等价的全读取隔离，真实源在线分享仍禁止。

MCP 每次检查 Project/Task/source-sharing。Fast/Engineering/Deep 只裁剪工具与上下文，不扩大权限。
源码缓存只存在当前进程，按项目/Task/内容版本绑定；编辑后失效，不落盘完整私有源码。
回执签名绑定工具/状态/项目/Task/时间和结果 Hash；拒绝不记录原始敏感参数。

执行依旧要求 Plan、具体批准 argv 和实际验证隔离器；禁网、非 root、只读根、cap-drop、资源限制、
最小挂载，独立 Grader 只读，不挂业务根、宿主 HOME、Docker socket 或设备。无宿主 Shell 回退。
最终 Evidence 核对命令定义、Task/Workspace、source/working/result revision、退出码、隔离、输出
Hash 与未截断状态；所有批准命令均通过才支持工程 verified。模型回答、Hook 和运行日志不是测试。

Work 生命周期、工程结果、证据有效性分开。Journal 保证可审查重放，不保证跨文件原子事务；
只能恢复签名同 Task/Workspace 的结果关联。旧权限不会恢复；原源版本改变需重新取快照。
只回收已识别且已退出的本机 PID 锁，未知/活锁拒绝。错误、旧证据或签名失败不能晋升成功。

Hook 启用可逆，仅选定附件；需官方精确定义信任，不绕过信任提示或改私有信任数据库。
只收白名单生命周期元数据，不保存原始聊天、工具正文或 transcript_path。客户端支持不足时使用
显式 Work 和受管 Exec/MCP 降级，见 hooks-compatibility.md。

StateStore/HMAC 防本机记录被无密钥篡改；持有宿主 key 的攻击者不在此保证内。文件拒绝穿越、
symlink/junction/特殊路径；快照过滤认证/数据集/权重/数据库等。敏感内容过滤是有限正则，不是完整
泄露防护，业务源仍不分享。Docker 共用内核也不等价于绝对隔离。

便携 schema3 备份保持 scrypt/AES-GCM；不含 key、认证、批准、绑定、Work、Workspace、原始 Evidence
或业务源码。恢复历史降级，真实绑定和批准重新建立。本机归档不是恢复权限的快捷方式。

活跃证据1000、知识索引3MiB/1500记忆/500摘要、Work30次 Task/100候选仍有界。回执与事件超窗口
分片保留；知识到限摘要保留本机签名副本，候选延后不阻塞既有进展。显式审查归档释放活跃索引，
不静默删审计。个人记忆删除与 Work/Task/执行证据/备份保留范围不同，见 daily-engineering.md。

Python 准备镜像仅含明确锁定的最小依赖；离线运行只挂 Harness 自有合成 Grader，不导入 ALS。
真实 Python 业务环境、pytest 执行器扩展、GPU/CVAT/设备另需授权与隔离验收。Ubuntu/IDE/部署未验收。
