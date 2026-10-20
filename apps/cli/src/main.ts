#!/usr/bin/env node
import { HarnessError } from '@devagent/core';
import { intelligenceCommand, intelligenceMain } from './intelligence.js';
const functional = new Set(['project', 'code', 'workspace', 'isolation', 'command', 'evidence', 'diagnostics', 'task', 'eval', 'doctor', 'codex']);
if (!process.argv[2] || ['--help', '-h'].includes(process.argv[2])) {
  process.stdout.write(`DevAgent-Harness V0.3
 profile show|set|propose|review|history|delete|import-template|export
 memory show|set|propose|search|review|history|delete|export
 project add --path <absolute> --read-only [--rules]
 project list|inspect|rules|fingerprint|plan|remove --id <project-id>
 project identity|profile|refresh --project <stable-or-legacy-id>
 project relink --project <stable-id> --path <absolute-clone>
 onboard analyze|plan --project <id> [--with-codex]
 onboard diff --plan <id> [--human]
 onboard approve --plan <id> --target workspace --digest <reviewed-diff-hash>
 onboard apply --plan <id> --target workspace --grant <id>
 onboard verify|report --plan <id> [--commands-file <approved-command-ids.json>]
 context show --project <id> --task <goal> [--budget 6000] [--human]
 capability inspect|proposals --project <id>
 capability approve|implemented|verify|adopt|invoke|deprecate --id <proposal-id>
 backup create|inspect|restore --passphrase-env DEVAGENT_BACKUP_PASSPHRASE
 codex attach --project <fixture-id> [--include-preferences]
 codex inspect|session|login-native --id <attachment-id>
 code search|read|symbol|dependencies --project <id>
 workspace create --project <id>; workspace inspect|diff|cleanup --id <id>
 isolation configure --image <local-image>
 command approve --workspace <id> --id test --executable node --args-file <json-file>
 command run --workspace <id> --id test
 task run --project <id> --mode isolated --prompt <task> [--workspace <id>] [--codex]
 task status|report --id <task-id>; evidence list|get|export
 diagnostics import|query|failures|diagnose; doctor
 eval --suite personal-engineering [--online] [--als-path <readonly>] [--pollen-path <readonly>]
 All operations: --home <absolute-state-root>. See README and docs/personal-engineering.md for exact inputs and approval boundaries.
 V0.2 optional DSH: codex configure|status|login; eval --suite functional-mvp
 Legacy: init --path <project> [--dry-run]; inspect; runtime prepare|check|run
`);
} else if (intelligenceCommand(process.argv.slice(2)) || functional.has(process.argv[2] ?? '')) {
  try {
    if (intelligenceCommand(process.argv.slice(2))) await intelligenceMain(process.argv.slice(2));
    else await (await import('./functional.js')).functionalMain(process.argv.slice(2));
  }
  catch (error) {
    process.stderr.write(JSON.stringify({ status: 'error', code: error instanceof HarnessError ? error.code : 'COMMAND_FAILED', remedy: error instanceof HarnessError ? error.remedy : '' })+'\n');
    process.exitCode = 1;
  }
} else await import('./legacy.js');
