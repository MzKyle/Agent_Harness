#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ProjectRegistry } from '@devagent/core';
import { createDiagnosticsServer } from './index.js';

try {
  const { values } = parseArgs({ options: { 'allow-project': { type: 'string', multiple: true } } });
  const registry = await ProjectRegistry.create(values['allow-project'] ?? []);
  const handle = serveStdio(() => createDiagnosticsServer(registry), {
    onerror: () => { process.stderr.write('MCP_TRANSPORT_ERROR\n'); },
  });
  const stop = () => { void handle.close(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
} catch {
  process.stderr.write('MCP_START_FAILED: supply --allow-project with an absolute project directory.\n');
  process.exitCode = 1;
}
