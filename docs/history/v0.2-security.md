# V0.2 安全边界

业务源只读，包括 Git 管理目录、未提交内容、忽略数据与 AGENTS。注册、快照、计划、日志和 Patch 都在 Harness。无自动回写、推送、合并、硬件、GPU/CVAT、生产数据库或全局 Docker 清理。

绝对规范路径授权绑定项目 ID，拒绝 symlink/junction、穿越、Windows 特殊名/ADS、大小写碰撞和特殊 Git 条目。快照只物化允许普通 blob，不执行源 hooks/filters/脚本。Git 使用无可选锁、禁 hooks、禁 lazy fetch、忽略系统/全局配置；查询不刷新源索引。

人工批准 executable + argv，不接受 Shell 字符串。npm scripts、MSBuild 与测试始终视为任意不可信代码，白名单不是沙箱。执行必须经过实际 Docker Linux 探针：禁网、非 root、只读根、cap-drop、no-new-privileges、资源限额、最小挂载。Git 元数据单独只读，避免污染宿主 Diff。测试容器没有源业务根、HOME、模型 auth、Docker socket 或设备。partial/unavailable 一律 blocked，无宿主 Shell 回退。

源码、规则与日志是不可信上下文。规则显式授权并记录路径、hash、commit、scope、优先级和冲突，不能提升系统/用户权限。过滤常见密钥、密码、私钥、个人/设备字段；不能处理的内容拒绝。**正则脱敏不能保证发现全部秘密**，因此真实源默认禁止远端分享，本轮在线仅专用 mock 工程。不得扫描磁盘找凭据。

Codex 模型连接容器与测试容器分开：前者需要官方模型网络，只挂 fixture 与独立原生 auth，不带业务/生产凭据；原生配置关闭 shell、unified exec、code mode、浏览器、插件、web、multi-agent；计划阶段 workspace RO。后者完全禁网且无模型凭据。登录用官方设备认证，认证目录不纳入 Git。认证后在线路径尚未实测，不能凭配置声称已验收。

容器共享 Linux 内核，不承诺抵御未知容器逃逸漏洞；依赖 Docker Desktop/内核。宿主管理员可修改状态/镜像/签名密钥。HMAC 检测非持钥篡改，不是第三方不可否认证明。其他进程可能改源，前后指纹不一致使 gate 失败。大型排除目录只记不透明元数据，不声称逐字节不变。

源码每文件 512 KiB、读取最多 200 行/16 KiB、搜索最多 800 文件/50 结果/16 KiB；执行输出合计 64 KiB，单命令最长 300 秒，任务默认最多 3 次执行。诊断导入 1 MiB/2000 事件，最多 200 份；查询 100 条/32 KiB。证据到 1000 条停止新执行并要求归档。MCP 回执与状态集合也有限额。清理只针对本项目标记的自有容器和工作区。

CLI/MCP 拒绝保存 denial artifact，不含原始敏感参数；最多 500 份单条回执，之后聚合溢出计数并提示归档，避免攻击导致日志无限增长。执行失败/阻塞保存签名证据。系统密码/UAC/原生认证提示交用户按官方流程完成，不绕过交互确认。
