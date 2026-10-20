---
name: feature-planning
description: Turn an engineering feature request into an evidence-based implementation and regression plan, including observability and reusable capability gaps.
---

Read project context and capabilities from the DevAgent MCP tools using the
authorized project ID. If unavailable, use the CLI `inspect` output and identify
its provenance. Avoid inferring source-level call graphs from manifest metadata.
Read only task-relevant authorized source modules if a separate code tool exists.

Load the `observability-design` skill with the runtime's skill tool before
finalizing the plan. Use [plan.schema.json](references/plan.schema.json) as the
output contract. Establish the requested behavior, scope, affected components,
source evidence, implementation steps, regression commands and their verification
status. Record acceptance criteria that can distinguish success from failure.

Include observation, failure diagnosis, regression entry points, and capability
gaps in each plan. For a gap, say whether it generalizes across projects and
whether it requires approval to change runtime plugins, global permissions, or
environment. Recommend such changes separately; the plan does not authorize them.
Preserve uncertainty and unsupported stacks explicitly. Produce a concrete plan
without claiming to have edited or tested the target project.
