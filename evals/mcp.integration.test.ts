import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import path from 'node:path';
import { EngineeringDetector } from '../packages/adapters/src/index.js';
import { initializeProject, ProjectRegistry } from '../packages/core/src/index.js';
import { fixture, repo } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
for (const mode of ['legacy', 'auto'] as const) {
  it(`validates real stdio MCP ${mode} discovery, schemas, results, and denials`, async () => {
    const a = await fixture('als-like'); const b = await fixture('pollen-like'); cleanups.push(a.cleanup, b.cleanup);
    const detector = new EngineeringDetector(); await initializeProject(a.root, detector); await initializeProject(b.root, detector);
    const registry = await ProjectRegistry.create([a.root, b.root]); const [als, pollen] = registry.list();
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [path.join(repo, 'packages/diagnostics-mcp/dist/main.js'), '--allow-project', a.root, '--allow-project', b.root], stderr: 'pipe' });
    const client = new Client({ name: 'devagent-protocol-eval', version: '0.1.0' }, { versionNegotiation: { mode } });
    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
      if (mode === 'auto') expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
      const catalog = await client.listTools();
      expect(catalog.tools.map((tool) => tool.name).sort()).toEqual(['get_project_capabilities', 'get_project_context']);
      for (const tool of catalog.tools) { expect(tool.inputSchema.type).toBe('object'); expect(tool.outputSchema?.type).toBe('object'); expect(tool.annotations?.readOnlyHint).toBe(true); }
      const first = await client.callTool({ name: 'get_project_context', arguments: { projectId: als!.projectId } });
      const second = await client.callTool({ name: 'get_project_context', arguments: { projectId: pollen!.projectId } });
      expect(first.isError).not.toBe(true); expect(first.structuredContent).toHaveProperty('projectId', als!.projectId);
      expect(JSON.stringify(first)).toContain('FastAPI'); expect(JSON.stringify(first)).not.toContain('WPF');
      expect(JSON.stringify(second)).toContain('WPF'); expect(JSON.stringify(second)).not.toContain('FastAPI');
      const capabilities = await client.callTool({ name: 'get_project_capabilities', arguments: { projectId: als!.projectId } });
      expect(capabilities.structuredContent).toHaveProperty('capabilities.execution.status', 'unsupported');
      const denial = await client.callTool({ name: 'get_project_context', arguments: { projectId: 'project-0000000000000000' } });
      expect(denial.isError).toBe(true); expect(JSON.stringify(denial)).toContain('ACCESS_DENIED');
      const traversal = await client.callTool({ name: 'get_project_context', arguments: { projectId: '../../private', path: a.parent } });
      expect(traversal.isError).toBe(true); expect(JSON.stringify(traversal)).not.toContain(a.parent.replaceAll('\\', '\\\\'));
    } finally { await client.close(); }
  });
}
