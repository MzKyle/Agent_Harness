import { afterEach, expect, it } from 'vitest';
import { readFile, writeFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { staticPlan } from '../../packages/core/src/index.js';
import { FunctionalDshDriver } from '../../packages/dsh-bridge/src/index.js';
import { functionalFixture } from './helpers.js';
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(run => run())); });
it('requires a structured plan, serializes counters, persists capability gaps and refuses terminal edits', async () => {
  const item = await functionalFixture(); cleanups.push(item.cleanup);
  const workspace = await item.system.workspaces.create(item.project.id);
  const task = await item.system.tasks.create(item.project.id, 'Fix percentage', 'isolated', workspace.id);
  task.state = 'running'; await item.system.tasks.save(task);
  await expect(item.system.tasks.requireCoding(task.id)).rejects.toThrow('CODING_PLAN_GATE');
  const plan = await staticPlan(item.system.tasks, item.system.code, item.project.id, 'Fix percentage', ['progress']);
  await item.system.tasks.submitPlan(task.id, plan.plan);
  const concurrent = await Promise.allSettled([item.system.tasks.requireCoding(task.id), item.system.tasks.requireCoding(task.id)]);
  expect(concurrent.filter(row => row.status === 'fulfilled')).toHaveLength(1);
  const current = await item.system.tasks.get(task.id); expect(current.toolCalls).toBe(1);
  await item.system.tasks.gap(task.id, { gap: 'Missing semantic Python resolution', why: 'Dynamic imports need confirmation', existingAlternative: 'Static imports and source slices', crossProject: true, needsAdapter: true, suggestion: 'Only add an adapter after bounded source evidence', risks: ['Do not enable unrestricted execution'], requiresApproval: true });
  expect((await item.system.tasks.get(task.id)).gapIds).toHaveLength(1);
  current.state = 'succeeded'; await item.system.tasks.save(current);
  await expect(item.system.tasks.submitPlan(task.id, plan.plan)).rejects.toThrow('TASK_TERMINAL');
});
it('filters a multi-component trace, supports time/severity/operation queries and preserves observed failure stage', async () => {
  const item = await functionalFixture(); cleanups.push(item.cleanup);
  const imported = await item.system.diagnostics.import(await readFile(path.join(item.source, 'events.jsonl'), 'utf8'), 'explicit fixture');
  const all = await item.system.diagnostics.query({ diagnosticId: imported.id, traceId: 'trace-fixture-1' });
  expect(all.events).toHaveLength(3); expect(JSON.stringify(all)).not.toMatch(/mock-secret-only|mock-device|mock@example/);
  const error = await item.system.diagnostics.query({ operationId: 'train-fixture', severity: 'error', from: '2026-10-20T09:00:00+08:00', to: '2026-10-20T09:00:02+08:00' });
  expect(error.events).toHaveLength(1); expect(error.events[0]?.component).toBe('worker');
  expect((await item.system.code.search(item.project.id, 'progress')).matches.some(match => match.path === 'src/backend.ts')).toBe(true);
  expect((await item.system.diagnostics.query({ limit: 1 })).truncated).toBe(true);
  await expect(item.system.diagnostics.query({ from: 'tomorrow' })).rejects.toThrow('INVALID_TIME_RANGE');
  const planning = await staticPlan(item.system.tasks, item.system.code, item.project.id, 'Diagnose percentage evidence', ['progress']);
  const diagnosis = await item.system.diagnostics.diagnose(item.project.id, planning.taskId);
  expect(diagnosis.relatedSource.some(source => source.path === 'src/backend.ts')).toBe(true);
  await expect(item.system.diagnostics.diagnose('project-0000000000000000', planning.taskId)).rejects.toThrow('TASK_PROJECT_MISMATCH');
});
it('queries Python and C# static declarations/imports and rejects symlink changes in a managed diff', async () => {
  const item = await functionalFixture(); cleanups.push(item.cleanup);
  await writeFile(path.join(item.source, 'src/service.py'), 'from app.store import Store\nclass TrainingService:\n    def train(self):\n        pass\n');
  await writeFile(path.join(item.source, 'src/service.cs'), 'using Pollen.Domain;\npublic class PermissionService { }\n');
  expect((await item.system.code.symbols(item.project.id, 'TrainingService')).symbols[0]?.matchType).toBe('python-static-declaration');
  expect((await item.system.code.symbols(item.project.id, 'PermissionService')).symbols[0]?.matchType).toBe('csharp-lexical-declaration');
  expect((await item.system.code.dependencies(item.project.id, 'src/service.py')).dependencies[0]?.target).toBe('app.store');
  expect((await item.system.code.dependencies(item.project.id, 'src/service.cs')).dependencies[0]?.target).toBe('Pollen.Domain');
  const workspace = await item.system.workspaces.create(item.project.id); const root = await item.system.workspaces.root(workspace.id);
  await symlink(item.source, path.join(root, 'escape'), 'junction');
  await expect(item.system.workspaces.diff(workspace.id)).rejects.toThrow('WORKSPACE_LINK_DENIED');
});
it('creates a neutral official analysis profile and honestly blocks absent DSH authentication', async () => {
  const item = await functionalFixture(); cleanups.push(item.cleanup);
  const task = await item.system.tasks.create(item.project.id, 'Read source', 'analysis');
  const driver = new FunctionalDshDriver(item.system.store, item.system.registry, item.system.workspaces, item.system.tasks);
  const prepared = await driver.prepare(task); expect(prepared.root).not.toBe(item.source); expect(prepared.profileKind).toBe('analysis');
  const saved = process.env.DEEPSEEK_API_KEY; delete process.env.DEEPSEEK_API_KEY;
  try {
    const result = await item.system.tasks.run(item.project.id, 'Inspect the fixture', 'analysis', driver);
    expect(result.state).toBe('blocked'); expect(result.reason).toBe('blocked_by_auth'); expect(result.modelCalls).toBe(0);
    expect(result.gapIds).toHaveLength(1); expect((await item.system.tasks.report(result.id)).summary).toContain('Not completed');
  } finally { if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; }
});
