import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { CodexNativeIntegration, authenticationHome, authenticationLock, installWorkHooks, workHookConfiguration } from '../../packages/codex-integration/src/index.js';
import { NativeRpc } from '../../packages/codex-integration/src/rpc.js';
import { nativeEnvironment } from '../../packages/codex-integration/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('shares only an explicit managed authentication context, isolates real app-server configuration and serializes runs', async () => {
  const a = await intelligenceFixture(); const b = await intelligenceFixture(); cleanups.push(a.cleanup, b.cleanup);
  const s = a.system; const projectB = await s.registry.add(b.source, { fixture: true, shareFixture: true, rules: true });
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
  const first = await native.attach(a.record.id); const second = await native.attach(projectB.id, { authFrom: first.id });
  expect(first.home).not.toBe(second.home); expect(authenticationHome(first)).not.toBe(first.home); expect(authenticationHome(second)).toBe(authenticationHome(first));
  const authConfig = await readFile(path.join(authenticationHome(first), 'config.toml'), 'utf8'); expect(authConfig).not.toContain('mcp_servers'); expect(authConfig).not.toContain(first.projectId);
  for (const attachment of [first, second, first]) {
    const execution = await native.executionConfiguration(attachment.id, attachment.taskId, ['get_context_brief']);
    const rpc = new NativeRpc(attachment.executable, attachment.cwd, nativeEnvironment(authenticationHome(attachment), attachment.home), execution.args);
    try {
      await rpc.request('initialize', { clientInfo: { name: 'attachment-isolation-oracle', version: '0.4.1' }, capabilities: {} }); rpc.notify('initialized');
      const servers = await rpc.request<{ data: { name: string; tools: Record<string, unknown> }[] }>('mcpServerStatus/list', { limit: 100 });
      expect(servers.data.map(item => item.name)).toEqual(['devagent']);
      expect(Object.keys(servers.data[0]!.tools)).toEqual(['get_context_brief']);
      const skills = await rpc.request<{ data: { skills: { name: string; enabled: boolean }[] }[] }>('skills/list', { cwds: [attachment.cwd], forceReload: true });
      expect(skills.data.flatMap(item => item.skills).filter(item => item.name === 'devagent-project-engineering' && item.enabled)).toHaveLength(0);
    } finally { await rpc.close(); }
    // Execute the actual configured MCP process, then challenge its scope across Work, memory and source.
    const saved = await s.store.get<{ configuration: { mcp_servers: { devagent: { command: string; args: string[] } } } }>(execution.artifact);
    const server = saved.configuration.mcp_servers.devagent;
    const client = new Client({ name: 'attachment-scope-oracle', version: '0.4.1' });
    try {
      await client.connect(new StdioClientTransport({ command: server.command, args: server.args, stderr: 'pipe' }));
      const own = await client.callTool({ name: 'get_context_brief', arguments: { projectId: attachment.projectId, budget: 2000 } }); expect(own.isError).not.toBe(true);
      const foreign = attachment.id === first.id ? second : first;
      expect((await client.callTool({ name: 'get_context_brief', arguments: { projectId: foreign.projectId } })).isError).toBe(true);
      expect((await client.callTool({ name: 'search_project_memory', arguments: { projectId: foreign.projectId, query: 'private' } })).isError).toBe(true);
      expect((await client.callTool({ name: 'read_code_slice', arguments: { projectId: foreign.projectId, path: 'src/service.ts', start: 1, end: 10 } })).isError).toBe(true);
    } finally { await client.close(); }
  }
  await s.store.locked(authenticationLock(first), async () => {
    await expect(s.store.locked(authenticationLock(second), async () => true)).rejects.toThrow('CONCURRENT_TASK_MUTATION');
  });
  expect(await readFile(path.join(authenticationHome(first), 'config.toml'), 'utf8')).toBe(authConfig);
  for (const attachment of [first, second]) {
    expect((await native.inspect(attachment.id)).skillDiscovered).toBe(true);
    const work = await s.work.start(attachment.projectId, 'Scoped Hook configuration test', { taskId: attachment.taskId, workspaceId: attachment.workspaceId });
    const installed = await installWorkHooks(native, s.work, attachment.id, work.id, true);
    expect(installed.artifact).toContain(attachment.id); expect(await readFile(path.join(attachment.home, 'hooks.json'), 'utf8')).toContain(attachment.id);
    expect(await readFile(path.join(authenticationHome(attachment), 'config.toml'), 'utf8')).toBe(authConfig);
    const hooks = await workHookConfiguration(native, attachment.id, work.id); const execution = await native.executionConfiguration(attachment.id, work.taskId, [], { hooks });
    const rpc = new NativeRpc(attachment.executable, attachment.cwd, nativeEnvironment(authenticationHome(attachment), attachment.home), execution.args);
    try {
      await rpc.request('initialize', { clientInfo: { name: 'effective-hook-isolation-oracle', version: '0.4.1' }, capabilities: { experimentalApi: true } }); rpc.notify('initialized');
      const actual = await rpc.request<{ data: { hooks: { command: string; source: string }[] }[] }>('hooks/list', { cwds: [attachment.cwd] });
      const definitions = actual.data.flatMap(item => item.hooks); expect(definitions).toHaveLength(6);
      expect(definitions.every(item => item.source === 'sessionFlags' && item.command.includes(attachment.id) && !item.command.includes('--lease'))).toBe(true);
    } finally { await rpc.close(); }
  }
  await expect(native.executionConfiguration(first.id, second.taskId, ['get_context_brief'])).rejects.toThrow('CODEX_TASK_SCOPE_DENIED');
}, 60000);
