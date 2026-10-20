# 快照与执行隔离

工作区在状态目录 `workspaces/<id>/code`。源必须登记且 revision 可解析为明确 Commit。受限 ls-tree/cat-file 只接受普通 blob；拒绝 symlink/gitlink、非法跨平台路径和大小写冲突；上限 5000 文件/48 MiB、单文件 512 KiB。不 lazy fetch、不建源 worktree、不 checkout 原工程。

过滤环境/凭据、数据库、图片/数据集、模型权重、日志/缓存/构建物与隐藏目录。含识别敏感内容的源文件排除；AGENTS 可脱敏后物化并记明。过滤可能使工程不完整；缺依赖/SDK 报 blocked。独立 baseline 用于 Diff，容器 `.git` RO；Patch 留在 Harness，不应用业务源。

isolation configure 只选择已有本地镜像，解析 image ID；探针检查 Linux/seccomp、非 root、NoNewPrivs、RO root、无路由/socket、memory/PID cgroup 限额。partial/unavailable 拒绝执行；cwd/路径检查不能替代 OS 隔离。

测试容器：network none、RO root、UID/GID 1000、cap-drop ALL、no-new-privileges、init、PID 128、512 MiB、CPU 1、/tmp tmpfs 64 MiB noexec。仅快照 RW、Git RO、可选独立 grader RO；无业务根、HOME、auth、socket、硬件。已验证 Node 镜像。Python/.NET 需人工准备相应镜像，WPF 无安全 Windows runner，本轮仅静态验证。

argv 人工批准、cwd 边界、manifest hash；执行并发 1、输出 64 KiB、最长 300 秒。取消/超时终止整个自有容器并清理，必须匹配 devagent-* 名称和 devagent.managed=v2 标签。无全局 rm/prune。

模型连接容器独立，允许官方模型网络、只挂 fixture/独立 auth，原生执行功能关闭；在线边界尚未验收。Docker 共享内核，不能承诺未知内核漏洞隔离。

cleanup 只删已核实的受管 code，拒绝 running，保留 Patch/证据；不删源数据或其他容器。崩溃后的锁/工作区需人工核实，不自动删证据恢复。
