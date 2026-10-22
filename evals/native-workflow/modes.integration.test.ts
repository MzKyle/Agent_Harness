import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { repo } from '../helpers.js';
import { readMcpReceipts } from '../../packages/core/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('enforces small server catalogs, scopes duplicate query cache to revision and retains signed receipts', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const workspace = await s.workspaces.create(f.record.id); const work = await s.work.start(f.record.id, 'Small fixture edit', { workspaceId: workspace.id });
  const client = new Client({ name: 'fast-mode-oracle', version: '0.4.1' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repo, 'packages/diagnostics-mcp/dist/main.js'), '--home', s.store.root, '--project', f.identity.stableProjectId, '--task', work.taskId, '--mode', 'fast', '--context-budget', '1800'], stderr: 'pipe' }));
    const catalog = (await client.listTools()).tools.map(item => item.name);
    expect(catalog).not.toContain('get_runtime_diagnostics'); expect(catalog).not.toContain('record_capability_gap'); expect(catalog).toContain('run_approved_command');
    const args = { projectId: f.identity.stableProjectId, path: 'src/service.ts', start: 1, end: 10 };
    for (let i = 0; i < 2; i++) expect((await client.callTool({ name: 'read_code_slice', arguments: args })).isError).not.toBe(true);
    await s.workspaces.write(workspace.id, 'src/service.ts', 'export const currentRevision = true;\n');
    const changed = await client.callTool({ name: 'read_code_slice', arguments: args }); expect(JSON.stringify(changed)).toContain('currentRevision');
    const receipts = await readMcpReceipts<{ cacheHit: boolean; taskId: string }>(s.store, work.taskId);
    expect(receipts.filter(item => item.cacheHit)).toHaveLength(1); expect(receipts.every(item => item.taskId === work.taskId)).toBe(true);
    expect((await client.callTool({ name: 'run_approved_command', arguments: { commandId: 'unapproved' } })).isError).toBe(true);
    expect((await client.callTool({ name: 'get_context_brief', arguments: { projectId: f.identity.stableProjectId, budget: 16000 } })).isError).not.toBe(true);
  } finally { await client.close(); }
});
