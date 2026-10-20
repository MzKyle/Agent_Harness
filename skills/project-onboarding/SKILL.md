---
name: project-onboarding
description: Connect an explicitly authorized repository through the read-only external registry, inspect source and project rules, and report engineering capability gaps.
---

Use the user's authorized project path. The harness location is the parent of this
skill root's parent; the built CLI is `apps/cli/dist/main.js` there.

1. Use `node <harness>/apps/cli/dist/main.js project add --path <absolute> --read-only`
   for external projects. Add `--rules` only when reading engineering rules is
   authorized. Registration lives in the Harness state directory, never the source.
   Use `--fixture --share-fixture` only for dedicated mock projects explicitly
   authorized for remote model sharing; real source remains local-only.
2. Run `project inspect --id <project-id>` and `project rules --id <project-id>`.
   Do not use legacy `init` on a read-only business repository. It writes a config.
3. When connected,
   call `mcp__devagent__get_project_context`, `get_project_capabilities`,
   `get_project_rules` and bounded source tools with that ID.
4. Report identified components, source manifests, unrecognized portions, and gaps
   grouped by test execution, UI testing, observability, and device adaptation.
   Label declared commands `pending`; promote only with revision-bound execution
   evidence. `workspace create --project <id> --revision <commit>` creates a
   filtered independent snapshot; dirty source changes are excluded. Tests require
   separate human command approval and a successful isolation probe.

If no command tool is mounted, return the concrete CLI invocation for the human
and use MCP for already initialized projects. Do not invent an execution result.
Do not read logs, `.env`, datasets, or external directories to fill a detection gap.
Do not install missing tools or change global permissions as part of onboarding.
