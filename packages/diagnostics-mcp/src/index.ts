import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getProjectCapabilities, getProjectContext, ProjectError, ProjectRegistry } from '@devagent/core';
export { createFunctionalServer } from './functional.js';

export const inputSchema = z.object({ projectId: z.string().regex(/^project-[a-f0-9]{16}$/) }).strict();
const source = z.object({ path: z.string(), kind: z.literal('configuration'), schemaVersion: z.literal(1) }).strict();
const command = z.object({ id: z.string(), component: z.string(), purpose: z.enum(['build', 'test', 'typecheck', 'lint']),
  status: z.enum(['pending', 'verified']), source: z.string(),
  evidence: z.object({ revision: z.string(), checkedAt: z.string() }).nullable() }).strict();
const diagnosticStatus = z.enum(['available', 'pending', 'unavailable', 'unsupported']);
export const contextOutputSchema = z.object({
  projectId: z.string(), status: z.enum(['ok', 'partial']), source,
  project: z.object({ name: z.string(), components: z.array(z.object({
    name: z.string(), path: z.string(), languages: z.array(z.string()), frameworks: z.array(z.string()),
    buildSystems: z.array(z.string()), testFrameworks: z.array(z.string()),
    sources: z.array(z.object({ path: z.string(), kind: z.enum(['manifest', 'configuration', 'structure']) }).strict()),
  }).strict()), commands: z.array(command),
  observability: z.object({ logs: z.array(z.object({ path: z.string(), status: diagnosticStatus, contentAccess: z.literal(false) }).strict()), uiTesting: diagnosticStatus, deviceAdapter: diagnosticStatus }).strict(),
  permissions: z.object({ read: z.literal('metadata-only'), executeCommands: z.literal(false), hardware: z.literal(false), network: z.literal(false), remoteBusinessData: z.literal(false) }).strict(),
  detection: z.object({ status: z.enum(['complete', 'partial']), warnings: z.array(z.string()) }).strict(),
  }).strict(), structure: z.object({ directories: z.array(z.string()), warnings: z.array(z.string()) }).strict(),
}).strict();
export const capabilitiesOutputSchema = z.object({ projectId: z.string(), status: z.literal('ok'), source,
  capabilities: z.object({
    logs: z.object({ status: diagnosticStatus, sources: z.array(z.string()), contentAccess: z.literal(false) }).strict(),
    tests: z.object({ status: diagnosticStatus, commands: z.array(command) }).strict(),
    uiTesting: z.object({ status: diagnosticStatus }).strict(), deviceAdapter: z.object({ status: diagnosticStatus }).strict(),
    execution: z.object({ status: z.literal('unsupported') }).strict(),
  }).strict(), gaps: z.array(z.string()),
}).strict();

function failure(error: unknown) {
  const code = error instanceof ProjectError ? error.code : 'PROJECT_READ_FAILED';
  return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ status: 'error', code }) }] };
}
export function createDiagnosticsServer(registry: ProjectRegistry) {
  const server = new McpServer({ name: 'devagent-diagnostics', version: '0.1.0' }, {
    instructions: `Read-only metadata for explicitly authorized projects: ${JSON.stringify(registry.list())}. Commands are never executed. Logs and credentials cannot be read.`,
  });
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  server.registerTool('get_project_context', {
    description: 'Read validated project metadata and bounded directory structure by authorized project ID.',
    inputSchema, outputSchema: contextOutputSchema, annotations,
  }, async ({ projectId }) => {
    try {
      const output = contextOutputSchema.parse(await getProjectContext(registry, projectId));
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return failure(error); }
  });
  server.registerTool('get_project_capabilities', {
    description: 'Read diagnostic capability status and evidence-backed command metadata; never reads log contents or controls devices.',
    inputSchema, outputSchema: capabilitiesOutputSchema, annotations,
  }, async ({ projectId }) => {
    try {
      const output = capabilitiesOutputSchema.parse(await getProjectCapabilities(registry, projectId));
      return { content: [{ type: 'text', text: JSON.stringify(output) }], structuredContent: output };
    } catch (error) { return failure(error); }
  });
  return server;
}
