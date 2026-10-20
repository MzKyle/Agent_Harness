import { afterEach, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { configureIsolation, fingerprint, staticPlan } from '../../packages/core/src/index.js';
import { engineeringSystem } from '../../packages/adapters/src/index.js';
import { CodexNativeIntegration, probeHarnessMcp } from '../../packages/codex-integration/src/index.js';
import { intelligenceFixture } from './helpers.js';
import { repo } from '../helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

it('onboards a fresh fixture with real MCP discovery/call, approved container regression and final-revision task history', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const before = await fingerprint(f.source); const s = f.system;
  expect((await configureIsolation(s.store, 'node:24-bookworm-slim')).verified).toBe(true);
  const plan = await s.onboarding.plan(f.identity.stableProjectId); const grant = await s.onboarding.approve(plan.id, 'workspace', plan.diffHash);
  const applied = await s.onboarding.apply(plan.id, grant.id, 'workspace'); const workspaceId = applied.plan.application!.workspaceId!;
  await s.execution.approve(workspaceId, { id: 'onboard-regression', executable: 'node', args: ['--test', 'tests/project.test.mjs'] });
  const result = await s.onboarding.verify(plan.id, ['onboard-regression'], () => probeHarnessMcp(s.store, f.identity.stableProjectId));
  expect(result.status).toBe('passed'); expect(result.regression).toBe('passed');
  const history = await s.history.recent(f.identity.stableProjectId); expect(history[0]?.verified).toEqual(['onboard-regression']); expect(history[0]?.evidenceTrust).toBe('local-verified');
  const candidate = (await s.memory.search({ projectId: f.record.id, includeCandidates: true })).records.find(item => item.type === 'task-summary');
  expect(candidate?.source).toBe('verified'); expect(candidate?.confirmation).toBe('candidate');
  expect(await fingerprint(f.source)).toEqual(before);
});

it('implements, independently tests, reviews and adopts an actual diagnostic module, then a new task invokes it; restored evidence is never locally verified', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system; const id = f.identity.stableProjectId;
  await configureIsolation(s.store, 'node:24-bookworm-slim'); const workspace = await s.workspaces.create(id);
  const planning = await staticPlan(s.tasks, s.code, id, 'Add a reusable trace diagnostic, with independent tests and no hardware access', ['total']);
  const task = await s.tasks.create(id, 'Implement deterministic diagnostic extension; no autonomous model claim', 'isolated', workspace.id);
  await s.tasks.submitPlan(task.id, planning.plan); task.plan = planning.plan; task.state = 'running'; await s.tasks.save(task);
  const gap = { gap: 'Missing reusable trace diagnostic', why: 'Need the observed failure stage and shared components', existingAlternative: 'Manual sanitized trace query', crossProject: true, needsAdapter: false, suggestion: 'A bounded pure trace correlator in the managed workspace', risks: ['Sanitize inputs and preserve read-only source'], requiresApproval: true };
  await s.tasks.gap(task.id, gap); await s.tasks.gap(task.id, gap);
  const proposal = (await s.evolution.list(id)).find(item => item.title === gap.gap)!; expect(proposal.gapIds).toHaveLength(2);
  await expect(s.evolution.adopt(proposal.id)).rejects.toThrow('PROPOSAL_VERIFICATION_STALE'); await s.evolution.approve(proposal.id);
  await s.store.put(`graders/${workspace.id}/diagnostic.test.mjs`, `import{test}from'node:test';import assert from'node:assert/strict';import{correlate}from'/workspace/src/trace-diagnostic.ts';test('independent mixed trace oracle',()=>{const events=[{trace_id:'t',component:'api',severity:'info'},{trace_id:'other',component:'hardware',severity:'error'},{trace_id:'t',component:'worker',severity:'error'},{trace_id:'t',component:'ui',severity:'warning'}];assert.deepEqual(correlate(events,'t'),{traceId:'t',components:['api','worker','ui'],failureStage:'worker'});assert.deepEqual(correlate(events,'missing'),{traceId:'missing',components:[],failureStage:null});assert.equal(correlate([{trace_id:'ok',component:'api',severity:'info'}],'ok').failureStage,null)});`);
  await s.execution.approve(workspace.id, { id: 'diagnostic-oracle', executable: 'node', args: ['--test', '/grader/diagnostic.test.mjs'] });
  const failed = await s.tasks.runApproved(task.id, 'diagnostic-oracle'); expect(failed.status).toBe('failed');
  await s.workspaces.write(workspace.id, 'src/trace-diagnostic.ts', `export function correlate(events: {trace_id:string;component:string;severity:string}[], traceId:string) { const selected=events.filter(event=>event.trace_id===traceId); return {traceId,components:[...new Set(selected.map(event=>event.component))],failureStage:selected.find(event=>['error','fatal'].includes(event.severity))?.component??null}; }\n`);
  await s.workspaces.write(workspace.id, 'tools/diagnose-trace.mjs', `import events from'./diagnostic-input.ts';import{correlate}from'../src/trace-diagnostic.ts';console.log(JSON.stringify(correlate(events,'fixture-trace')));\n`);
  const events = (await readFile(path.join(f.source, 'events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
  await s.workspaces.write(workspace.id, 'tools/diagnostic-input.ts', `export default ${JSON.stringify(events, null, 2)};\n`);
  await s.execution.approve(workspace.id, { id: 'diagnose-trace', executable: 'node', args: ['--test', 'tools/diagnose-trace.mjs'] });
  await s.evolution.implemented(proposal.id, workspace.id, task.id, 'diagnose-trace');
  await expect(s.evolution.verify(proposal.id, failed.id)).rejects.toThrow('PROPOSAL_FINAL_VERIFICATION_REQUIRED');
  const passed = await s.tasks.runApproved(task.id, 'diagnostic-oracle'); expect(passed.status).toBe('passed');
  expect((await s.tasks.runApproved(task.id, 'diagnose-trace')).status).toBe('passed');
  await s.evolution.verify(proposal.id, passed.id); await s.evolution.adopt(proposal.id);
  const latest = await s.tasks.get(task.id); latest.state = 'succeeded'; latest.finishedAt = new Date().toISOString(); await s.tasks.save(latest); await s.tasks.report(task.id);
  const next = await s.tasks.create(id, 'Use the reviewed trace diagnostic in a subsequent task', 'isolated', workspace.id);
  await s.tasks.submitPlan(next.id, planning.plan); next.plan = planning.plan; next.state = 'running'; await s.tasks.save(next);
  expect((await s.tasks.runApproved(next.id, 'diagnostic-oracle')).status).toBe('passed');
  const output = await s.evolution.invoke(proposal.id, next.id); expect(output.evidence.status).toBe('passed'); expect(output.stdout).toContain('"failureStage":"worker"'); expect(output.hostPluginLoaded).toBe(false);
  expect((await s.capabilities.assess(id)).entries.find(item => item.id.startsWith('extension-'))?.status).toBe('verified');
  const backup = await s.portability.create('synthetic-evidence-backup-passphrase'); const b = await engineeringSystem(path.join(f.parent, 'state-b'));
  const preview = await b.portability.inspect(backup.file, 'synthetic-evidence-backup-passphrase'); await b.portability.restore(backup.file, 'synthetic-evidence-backup-passphrase', preview.review.id);
  expect((await b.history.recent(id)).find(item => item.taskId === task.id)?.verified).toEqual([]);
  expect((await b.history.recent(id)).find(item => item.taskId === task.id)?.evidenceTrust).toBe('historical-unverified');
  expect((await b.evolution.get(proposal.id)).state).toBe('proposed'); expect((await b.evolution.get(proposal.id)).invocationCommandId).toBeNull();
  await s.workspaces.write(workspace.id, 'src/service.ts', 'export function total(a:number,b:number){return a+b+1;}\n');
  await expect(s.evolution.invoke(proposal.id, next.id)).rejects.toThrow('CAPABILITY_REVISION_STALE');
  expect((await s.capabilities.assess(id)).entries.find(item => item.id.startsWith('extension-'))?.status).toBe('unavailable');
}, 90000);

it('exposes bounded context through the standard MCP without approval tools and emits signed source-path receipts', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const id = f.identity.stableProjectId;
  const task = await f.system.tasks.create(id, 'MCP context receipt acceptance', 'analysis');
  const client = new Client({ name: 'v3-security-eval', version: '0.3.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(repo, 'packages/diagnostics-mcp/dist/main.js'), '--home', f.system.store.root, '--project', id, '--task', task.id], stderr: 'pipe' });
  try {
    await client.connect(transport); const names = (await client.listTools()).tools.map(tool => tool.name);
    expect(names).toContain('get_context_brief'); expect(names.some(name => /approve|restore|adopt|apply_onboarding/.test(name) && name !== 'run_approved_command')).toBe(false);
    expect((await client.callTool({ name: 'read_code_slice', arguments: { projectId: id, path: 'src/service.ts', start: 1, end: 3 } })).isError).toBeFalsy();
    expect((await client.callTool({ name: 'get_developer_profile', arguments: {} })).isError).toBe(true);
    expect((await client.callTool({ name: 'read_code_slice', arguments: { projectId: id, path: '../outside', start: 1, end: 2 } })).isError).toBe(true);
    const receipts = await f.system.store.list<{ tool: string; sourcePaths: string[]; signature: string }>(`artifacts/${task.id}/mcp-receipts`);
    const receipt = receipts.find(item => item.tool === 'read_code_slice')!; expect(receipt.sourcePaths).toEqual(['src/service.ts']); const { signature, ...payload } = receipt; expect(await f.system.store.verify(payload, signature)).toBe(true);
  } finally { await client.close(); }
});

it('a genuine fresh native Codex app-server discovers the Skill and MCP; no copied authentication or fabricated model-call success', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  const native = new CodexNativeIntegration(s.store, s.registry, s.identities, s.workspaces, s.tasks);
  const attachment = await native.attach(f.identity.stableProjectId); const discovery = await native.inspect(attachment.id);
  expect(discovery.freshAppServer).toBe(true); expect(discovery.skillDiscovered).toBe(true); expect(discovery.mcpDiscovered).toBe(true); expect(discovery.hostAuthenticationImported).toBe(false);
  expect(discovery.modelToolUse).toBe('not-proven');
  const session = await native.session(attachment.id); expect(session.status).toBe('blocked_by_auth');
  expect((await s.history.recent(f.identity.stableProjectId))[0]?.blocked).toContain('blocked_by_auth');
}, 90000);
