---
name: project-onboarding
description: Identify a repository's supported stacks, create its DevAgent configuration, and report engineering capability gaps when onboarding a project.
---

Use the user's authorized project path. The harness location is the parent of this
skill root's parent; the built CLI is `apps/cli/dist/main.js` there.

1. Run `node <harness>/apps/cli/dist/main.js init --path <project> --dry-run`
   through an available authorized command tool. Inspect detection warnings and
   manifest sources. Detection reads bounded metadata, never executes project scripts.
2. Create configuration with the same command without `--dry-run` when project
   configuration writes are in scope. Existing configuration must be preserved;
   use `inspect` instead of deleting it or forcing reinitialization.
3. Run `inspect --path <project>` to obtain its stable project ID. When connected,
   call `mcp__devagent__get_project_context` and
   `mcp__devagent__get_project_capabilities` with that ID.
4. Report identified components, source manifests, unrecognized portions, and gaps
   grouped by test execution, UI testing, observability, and device adaptation.
   Label declared commands `pending`; promote only with revision-bound execution
   evidence. The M1 CLI deliberately has no automatic promotion command.

If no command tool is mounted, return the concrete CLI invocation for the human
and use MCP for already initialized projects. Do not invent an execution result.
Do not read logs, `.env`, datasets, or external directories to fill a detection gap.
Do not install missing tools or change global permissions as part of onboarding.
