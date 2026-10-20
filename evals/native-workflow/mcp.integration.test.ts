import { afterEach, expect, it } from 'vitest';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { repo } from '../helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('uses real Work/runtime MCP tools with private project scope and no inferred execution authority', async () => {
  const a = await intelligenceFixture(); const b = await intelligenceFixture(); cleanups.push(a.cleanup, b.cleanup);
  const s = a.system; const other = await s.registry.add(b.source, { rules: true, fixture: true, shareFixture: true });
  const work = await s.work.start(a.identity.stableProjectId, 'Explicit MCP engineering observation');
  const foreign = await s.work.start(other.id, 'Private other-project engineering');
  const client = new Client({ name: 'work-runtime-scope-oracle', version: '0.4.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(repo, 'packages/diagnostics-mcp/dist/main.js'), '--home', s.store.root, '--project', a.identity.stableProjectId, '--task', work.taskId], stderr: 'pipe' }));
    const catalog = await client.listTools(); expect(catalog.tools.map(item => item.name)).toEqual(expect.arrayContaining(['get_work_status', 'record_work_progress', 'get_runtime_diagnostics', 'get_error_timeline', 'get_state_consistency', 'get_regression_context']));
    const status = await client.callTool({ name: 'get_work_status', arguments: { workId: work.id } }); expect(status.isError).not.toBe(true); expect(JSON.stringify(status)).not.toContain('lease-');
    expect((await client.callTool({ name: 'get_work_status', arguments: { workId: foreign.id } })).isError).toBe(true);
    expect((await client.callTool({ name: 'get_runtime_diagnostics', arguments: { projectId: other.id } })).isError).toBe(true);
    const progress = await client.callTool({ name: 'record_work_progress', arguments: { decisions: ['Keep public API compatible'], outstanding: ['Independent verification pending'] } }); expect(progress.isError).not.toBe(true);
    const sensitive = await client.callTool({ name: 'record_work_progress', arguments: { decisions: ['password: synthetic-must-refuse'], outstanding: [] } }); expect(sensitive.isError).toBe(true);
    const runtime = await client.callTool({ name: 'get_runtime_diagnostics', arguments: { projectId: a.identity.stableProjectId } }); expect(JSON.stringify(runtime)).toContain('unavailable');
    expect((await s.work.get(work.id)).outcome.verified).toEqual([]);
    expect((await s.work.events(work.id)).some(item => item.tool === 'record_work_progress')).toBe(true);
  } finally { await client.close(); }
});
