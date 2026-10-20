# 知识与任务证据契约 v1

本版提供 `knowledgeSchema` 校验器及 JSON 示例，不实现数据库、检索、自动写入或自动晋升。
建议由受信任工具/人员维护以下位置，实际存储位置不能扩大项目授权：

| 类型 | 归属 | 建议位置 |
| --- | --- | --- |
| Global Knowledge | 通用工程知识，不带 projectId/taskId | 独立受控 knowledge/global/ |
| Project Knowledge | 必须有 projectId，不带 taskId | 项目 .devagent/knowledge/ |
| Task Evidence | 必须有 projectId 和 taskId | 项目 .devagent/evidence/ |

每条记录有 schemaVersion、稳定 id、scope、title、contentRef 和 references。
contentRef 必须是相对路径，引用的内容通常是 Markdown；不把正文放进清单字段。
references 用 knowledgeId + revision 固定引用版本。version 含 revision、recordedAt、
可选 repositoryCommit 和 supersedes；provenance 区分 human、tool-evidence、agent-proposal。
示例提交哈希是模拟值，不代表真实验证。

任务证据应记录命令、提交、环境、实际结果和限制；未经验证的 Agent 建议不能描述成人工确认结论。
本版 MCP 不提供知识正文读取工具，也不会自动读取这些建议目录。
将任务证据晋升为长期知识、变更全局权限或安装插件，需在后续流程中明确授权和审查。
