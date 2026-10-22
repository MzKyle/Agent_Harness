# ALS V0.5 离线环境准备

本轮授权仅本地只读分析和 Harness 自有模拟代码。真实 ALS 的 Python/React/Electron 测试、构建、
Worker、训练、数据库、CVAT 和硬件均未执行；也没有向模型发送源码。

只读基线仍为 c2b759cdb20e0bffb5b72ce74d9cf2940fdb19ab。已重新阅读桌面架构文档并核对
WorkflowEngine、ProductWorker、ProductStore 与现有候选锚点。基线不变；真实 ALS 本来已有异常持久化，
Fixture 故意缺陷不代表真实 ALS 有同一 Bug。

ALS `pyproject.toml` 要求 Python >=3.11,<3.12。`test_product_workflow.py` 导入 numpy、FastAPI、
项目训练/数据/发布服务，不能把简单 unittest 环境当作完整依赖或真实工作流回归。

已建立可复现的最小准备环境：固定 Python 基础镜像 digest、直接依赖清单和完整 freeze lock。
依赖安装只在专用 Docker build 中联网；运行时禁网、非 root、只读根、去 capabilities、限资源，
仅挂载 Harness 自有 `fixtures/als-offline` 到只读 `/grader`，临时 SQLite 位于容器 tmpfs。
两项测试验证 Python 依赖版本、异步 fake Worker、临时 SQLite；不导入 ALS。
固定完整 lock 重建后的实际镜像为
`sha256:133bbb718e5f7a0d4a62422485d59315cc88e108e0254a67004b9237768db8a7`；
该镜像复跑两项测试退出0，日志与命令元数据位于 `.devagent-evals/v041-python-smoke-result.json`。

```powershell
Set-Location E:\Agent_Harness
docker build --tag devagent-als-offline:v041 --file installer/als-offline/Dockerfile installer/als-offline
$image = docker image inspect devagent-als-offline:v041 --format '{{.Id}}'
docker run --rm --network none --read-only --user 65534:65534 --cap-drop ALL --security-opt no-new-privileges --memory 256m --pids-limit 64 --cpus 1 --tmpfs /tmp:rw,noexec,nosuid,size=32m --mount 'type=bind,source=E:\Agent_Harness\fixtures\als-offline,target=/grader,readonly' $image
```

它不是 Harness 的 Python 业务 runner 许可。现有执行器只批准 Python unittest 形式，不能通过
修改配置把 pytest 或 ALS 脚本塞进去，也不会回退到宿主 Python。没有在 ALS 原目录安装依赖。

下一步仍需明确授权：过滤已提交快照中的具体 ALS 测试白名单、完整 CPU 依赖 lock、离线 fake
依赖边界、网络禁用和资源限额、只读 grader、不可变测试数据。若需要 pytest，先扩展并审查执行器
契约及隔离探针；不把静态发现的命令自动视为已批准。真实 GPU/CVAT/硬件另行授权和验收。
观测候选 Patch 仍未应用。实际在过滤快照运行 git apply --check 时，第一次因 Windows CRLF
检出失败；保留该报告，统一 .patch 为 LF 后复验通过。它只证明补丁上下文可匹配，不是业务测试。
仍需在授权快照验证取消/异常/重试/传播延迟和敏感字段过滤。
