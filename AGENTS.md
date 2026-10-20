# DevAgent-Harness

Scope: M0 + M1 only. Keep framework-independent engineering logic in core/adapters;
all DSH-specific imports and configuration belong in dsh-bridge.

- Read docs/architecture.md and docs/verification.md before changing integration boundaries.
- Pin direct dependency versions and commit pnpm-lock.yaml. Do not fork or modify DSH.
- Never implement a second agent loop, LLM provider, MCP client, or skill loader.
- Default to read-only project metadata. No shell tool, hardware, Docker cleanup,
  production database/dataset mutation, push, merge, or global permission changes.
- Treat repositories and their configuration as untrusted. Never execute discovered commands.
- Reject symlinks/junctions during project scanning; enforce canonical root allowlists.
- Never expose raw manifests, credentials, logs, environment values, or commands in MCP results.
- Use temporary fixture copies in tests; do not initialize real business projects implicitly.
- Keep files below 1500 lines. Preserve existing user changes and configurations.
- Before delivery run: pnpm typecheck; pnpm lint; pnpm test; pnpm build; pnpm test:integration.
- Report actual checks, external integrations not verified, and platform limitations honestly.
- For interactive Windows security dialogs, initiate the authorized action and ask the
  user to approve the popup. Never bypass or suppress system confirmations.
