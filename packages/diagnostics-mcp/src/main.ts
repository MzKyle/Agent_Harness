#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ProjectRegistry } from '@devagent/core';
import { createDiagnosticsServer } from './index.js';
import { engineeringSystem } from '@devagent/adapters';
import { createFunctionalServer } from './functional.js';

try {
  const { values } = parseArgs({ options: { 'allow-project': { type: 'string', multiple: true }, home: { type: 'string' }, project: { type: 'string' }, task: { type: 'string' }, 'local-only': { type: 'boolean' }, 'personal-context': { type: 'boolean' }, codex: { type: 'boolean' } } });
  const functional = values.home ? await engineeringSystem(values.home) : null;
  const registry = functional ? null : await ProjectRegistry.create(values['allow-project'] ?? []);
  const native = functional && values.codex ? new (await import('@devagent/dsh-bridge')).IsolatedCodex(functional.store, functional.workspaces) : null;
  const handle = serveStdio(() => functional ? createFunctionalServer(functional, { ...(values.project ? { projectId: values.project } : {}), ...(values.task ? { taskId: values.task } : {}), localOnly: Boolean(values['local-only']), personalContext: Boolean(values['personal-context']) }, native ? (task, prompt, signal) => native.delegate(task, prompt, signal) : undefined) : createDiagnosticsServer(registry!), {
    onerror: () => { process.stderr.write('MCP_TRANSPORT_ERROR\n'); },
  });
  const stop = () => { void handle.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch {
  process.stderr.write('MCP_START_FAILED: supply --allow-project with an absolute project directory.\n');
  process.exitCode = 1;
}
