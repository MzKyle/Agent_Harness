import { afterEach, expect, it } from 'vitest';
import { cp } from 'node:fs/promises';
import path from 'node:path';
import { intelligenceFixture } from '../personal-engineering/helpers.js';
import { repo } from '../helpers.js';
import { configureIsolation, git } from '../../packages/core/src/index.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it('uses actual HTTP/worker/SQLite samples to distinguish eventual propagation from persistent failure', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  await cp(path.join(repo, 'fixtures/runtime-workflow'), f.source, { recursive: true });
  git(f.source, ['add', '--all']); git(f.source, ['commit', '-m', 'Async diagnostic fixture']); await s.registry.rescan(f.record.id);
  await configureIsolation(s.store, 'node:24-bookworm-slim'); const workspace = await s.workspaces.create(f.record.id);
  const setup = "import{test}from'node:test';import assert from'node:assert/strict';import{startRuntime}from'/workspace/src/service.ts';";
  const grader = (persistent: boolean) => `${setup}test('real asynchronous observation',async()=>{const r=await startRuntime({propagationDelayMs:150});try{await fetch(r.url+'/run/${persistent ? 'exception' : 'healthy'}',{method:'POST'});${persistent ? 'await new Promise(resolve=>setTimeout(resolve,240));' : ''}const first=await(await fetch(r.url+'/snapshot')).json();console.log('DEVAGENT_RUNTIME_SNAPSHOT '+JSON.stringify(first));assert.notEqual(first.worker[0].state,first.sqlite[0].state);${!persistent ? "await new Promise(resolve=>setTimeout(resolve,220));const later=await(await fetch(r.url+'/snapshot')).json();assert.equal(later.worker[0].state,later.sqlite[0].state);" : ''}}finally{await r.close()}});`;
  const findings = [];
  for (const persistent of [false, true]) {
    const id = persistent ? 'persistent' : 'transient'; await s.store.put(`graders/${workspace.id}/${id}.mjs`, grader(persistent));
    await s.execution.approve(workspace.id, { id, executable: 'node', args: ['--test', `/grader/${id}.mjs`] });
    const task = await s.tasks.create(f.record.id, `Real ${id} async diagnostic sample`, 'isolated', workspace.id);
    const evidence = await s.execution.run(workspace.id, id, task.id); expect(evidence.status).toBe('passed');
    const record = await s.runtime.capture(evidence.id); findings.push(record.findings.map(item => item.code));
  }
  expect(findings[0]).toContain('transient-inconsistency'); expect(findings[0]).not.toContain('persistent-mismatch');
  expect(findings[1]).toContain('persistent-mismatch'); expect(findings[1]).toContain('worker-error');
});
it('reanalyzes legacy derived findings without changing their original signed audit record', async () => {
  const f = await intelligenceFixture(); cleanups.push(f.cleanup); const s = f.system;
  await configureIsolation(s.store, 'node:24-bookworm-slim'); const workspace = await s.workspaces.create(f.record.id);
  const observation = (state: string) => ({ workflowId: 'legacy-observation', state, step: 'classify' });
  const snapshot = { schemaVersion: 1, adapter: s.runtime.adapters[0]!.id, serviceVersion: 'legacy-contract-fixture', timeoutMs: 1000, api: [observation('failed')], worker: [observation('failed')], sqlite: [observation('running')], ui: [observation('failed')], events: [] };
  await s.store.put(`graders/${workspace.id}/legacy-runtime.mjs`, `import{test}from'node:test';test('emit legacy snapshot',()=>console.log('DEVAGENT_RUNTIME_SNAPSHOT '+JSON.stringify({...${JSON.stringify(snapshot)},capturedAt:new Date().toISOString()})));`);
  await s.execution.approve(workspace.id, { id: 'legacy-runtime', executable: 'node', args: ['--test', '/grader/legacy-runtime.mjs'] });
  const task = await s.tasks.create(f.record.id, 'Observe a synthetic legacy snapshot', 'isolated', workspace.id);
  const evidence = await s.execution.run(workspace.id, 'legacy-runtime', task.id); expect(evidence.status).toBe('passed');
  const captured = await s.runtime.capture(evidence.id);
  // Persist the old heuristic as a migration fixture, while the actual signed command output has no clock metadata.
  const legacy = { ...captured, findings: [{ workflowId: 'legacy-observation', code: 'state-mismatch' as const, detail: 'Legacy instantaneous comparison', traceIds: [] }] };
  const file = `runtime-observations/${captured.id}.json`; await s.intelligence.writeSigned(file, legacy); const original = await s.store.text(file);
  const view = await s.runtime.query(f.record.id, captured.id);
  if (view.status !== 'available') throw new Error('Expected legacy observation view');
  expect(view.analysisVersion).toBe('0.4.1');
  expect(view.findings.map(item => item.code)).toContain('insufficient-evidence');
  expect(view.findings.map(item => item.code)).not.toContain('persistent-mismatch');
  expect(view.findings.map(item => item.code)).not.toContain('state-mismatch');
  expect((await s.runtime.get(captured.id)).findings[0]!.code).toBe('state-mismatch');
  expect(await s.store.text(file)).toBe(original);
});
