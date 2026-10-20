#!/usr/bin/env node
import { HarnessError } from '@devagent/core';
import { functionalMain } from './functional.js';
const functional = new Set(['project', 'code', 'workspace', 'isolation', 'command', 'evidence', 'diagnostics', 'task', 'eval', 'doctor', 'codex']);
if (!process.argv[2] || ['--help', '-h'].includes(process.argv[2])) {
  process.stdout.write('DevAgent-Harness V0.2\n doctor\n project add --path <absolute> --read-only [--rules]\n project list|inspect|rules|fingerprint|plan|remove --id <project-id>\n code search|read|symbol|dependencies --project <id>\n workspace create --project <id>\n workspace inspect|diff|cleanup --id <workspace-id>\n isolation configure --image <local-image>\n command approve --workspace <id> --id test --executable node --args-file <json-file>\n command run --workspace <id> --id test\n task run --project <id> --mode isolated --prompt <task> [--workspace <id>] [--codex]\n task status|report --id <task-id>\n evidence list|get|export\n diagnostics import|query|failures|diagnose\n codex configure|status|login\n eval --suite functional-mvp\n Legacy: init --path <project> [--dry-run]; inspect; runtime prepare|check|run\n');
} else if (functional.has(process.argv[2] ?? '')) {
  try { await functionalMain(process.argv.slice(2)); }
  catch (error) {
    process.stderr.write(JSON.stringify({ status: 'error', code: error instanceof HarnessError ? error.code : 'COMMAND_FAILED', remedy: error instanceof HarnessError ? error.remedy : '' })+'\n');
    process.exitCode = 1;
  }
} else await import('./legacy.js');
