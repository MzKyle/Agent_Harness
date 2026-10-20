# V0.2 后续工作

基础工具、真实容器、离线 E2E 和真实源静态接入已验证；AI Functional MVP 在线验收未完成。

1. 隔离 Codex 原生认证后运行 eval --online；DSH 按用户选择暂留 blocked，提供已授权进程 Key 后补 smoke/真实修复。版本输出不算委派。
2. 验证 authenticated DSH→MCP→官方 Codex provider、实际编辑、失败反馈与最终 grader。代码有入口，未实测需继续标明。
3. 同任务/预算/grader 比较直接 Codex，记录耗时、步骤/工具次数、成功率和人工介入；当前无效率提升结论。
4. 按实际 gap 在隔离 workspace 添加成熟 Graphify/Python/C# 语义 runner，不在业务源刷新图谱。
5. 准备相应 Python/.NET 镜像或独立 Windows VM。动态 UI、GPU/CVAT、硬件和部署均需独立授权/隔离，本轮不执行。
6. 完善人工归档/崩溃恢复、同工作区操作串行化，必要时 VM 隔离，不自动删历史或扩大权限。

不新建自定义 Web UI、云上传、多用户调度、完整语言服务器、向量库或模型运行时。扩展以实际持久化 Capability Gap 为依据。
